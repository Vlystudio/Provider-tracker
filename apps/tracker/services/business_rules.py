import hashlib
import math
import re
import unicodedata
from dataclasses import dataclass
from datetime import timedelta

from django.utils import timezone

RULE_VERSION = "2026.1"


@dataclass(frozen=True)
class Result:
    code: str
    phrase: str


RESULT_PHRASES = {
    "unable_to_contact": "unable to contact, did not leave voicemail",
    "does_not_meet_availability_guidelines": "does not meet availability guidelines",
    "meets_availability_guidelines": "meets availability guidelines",
    "meets_availability_guidelines_urgent": (
        "meets availability guidelines - can schedule within 4 weeks with urgent referral"
    ),
}


def clean_text(value) -> str:
    if value is None:
        return ""
    text = unicodedata.normalize("NFKC", str(value))
    text = text.replace("\u00a0", " ").replace("\u2007", " ").replace("\u202f", " ").replace("Â", " ")
    text = re.sub(r"\s*\|\s*", " | ", text)
    return re.sub(r"\s+", " ", text).strip()


def normalize_key(value) -> str:
    text = unicodedata.normalize("NFKD", clean_text(value))
    return "".join(character for character in text if not unicodedata.combining(character)).lower()


def normalize_header(value) -> str:
    """Collapse workbook header variations into one importer lookup key."""
    return re.sub(r"[^a-z0-9]+", "", normalize_key(value))


def normalize_status(value) -> str:
    status = clean_text(value).lower().replace("unkown", "unknown")
    if status in {"n/a", "na", "not applicable"}:
        return "not_applicable"
    if "urgent" in status and "referral" in status:
        return "urgent_referral_required"
    if "unable to tell" in status and "triage" in status:
        return "unable_to_tell_without_triage"
    if status.startswith("yes"):
        return "yes"
    if status.startswith("no"):
        return "no"
    return "unknown"


def normalize_phone(value) -> str:
    text = clean_text(value)
    extension = re.search(r"(?:ext\.?|x)\s*(\d+)$", text, flags=re.I)
    digits = re.sub(r"\D", "", text)
    if extension:
        digits = digits[: -len(extension.group(1))]
    if len(digits) == 11 and digits.startswith("1"):
        digits = digits[1:]
    if extension:
        return f"{digits}x{extension.group(1)}"
    return digits


def normalize_postal_code(value) -> str:
    digits = re.sub(r"\D", "", clean_text(value))
    return digits[:5].zfill(5) if digits else ""


def stable_hash(*parts) -> str:
    return hashlib.sha256("\x1f".join(clean_text(part) for part in parts).encode()).hexdigest()


def calculate_result(
    *, did_not_leave_vm, accepting, can_treat, schedule, urgent_referral_required=False
) -> Result:
    """Apply the approved outcome rules in precedence order."""
    if did_not_leave_vm:
        code = "unable_to_contact"
    elif accepting != "yes" or can_treat != "yes":
        code = "does_not_meet_availability_guidelines"
    elif urgent_referral_required or schedule == "urgent_referral_required":
        code = "meets_availability_guidelines_urgent"
    elif schedule == "yes":
        code = "meets_availability_guidelines"
    else:
        code = "does_not_meet_availability_guidelines"
    return Result(code, RESULT_PHRASES[code])


def seven_day_recommendation(
    *, facility_present, did_not_leave_vm, accepting, schedule, urgent_referral_required=False
):
    if not facility_present:
        return ""
    if did_not_leave_vm:
        return "Call again — previous attempt unable to contact / did not leave voicemail"
    if accepting == "yes" and (
        schedule == "yes" or schedule == "urgent_referral_required" or urgent_referral_required
    ):
        return "Good provider to call — verify if they treat the diagnosis"
    if accepting == "yes":
        return "Do not call — provider cannot schedule within 4 weeks"
    if accepting == "no":
        return "Do not call — provider not accepting new patients"
    if accepting == "unknown":
        return "Call to verify — accepting status unknown"
    return "Provider availability not confirmed"


def week_start(value):
    calendar_date = value.date() if hasattr(value, "date") else value
    return calendar_date - timedelta(days=calendar_date.weekday())


def weekly_duplicate_key(facility_id, diagnosis_id, call_at):
    return stable_hash("weekly_duplicate", facility_id, diagnosis_id, week_start(call_at).isoformat())


def call_fingerprint(*, caller_initials, call_at, authorization_number, facility_key, specialty, diagnosis):
    timestamp = call_at.isoformat() if hasattr(call_at, "isoformat") else call_at
    return stable_hash(
        "call",
        clean_text(caller_initials).upper(),
        timestamp,
        clean_text(authorization_number).upper(),
        normalize_key(facility_key),
        normalize_key(specialty),
        clean_text(diagnosis).upper(),
    )


def next_review_date(call_at):
    return (call_at.date() if hasattr(call_at, "date") else call_at) + timedelta(days=7)


def is_fdm_eligible(call, *, mapping_confirmed, as_of=None):
    as_of = as_of or timezone.now()
    age = as_of - call.call_at
    return (
        age <= timedelta(days=30)
        and call.accepting_new_patients == "yes"
        and call.can_treat_diagnosis == "yes"
        and mapping_confirmed
    )


def authorization_narrative(authorization, calls=None):
    """Summarize outreach through the second successful provider outcome."""
    calls = list(
        calls
        if calls is not None
        else authorization.calls.select_related("facility", "specialty", "diagnosis").order_by("call_at")
    )
    success_codes = {"meets_availability_guidelines", "meets_availability_guidelines_urgent"}
    total_successes = sum(call.result_code in success_codes for call in calls)
    selected = []
    successes = 0
    for call in calls:
        selected.append(call)
        if call.result_code in success_codes:
            successes += 1
            if successes == 2:
                break
    if total_successes < 2:
        selected = calls
    heading = (
        f"Authorization {authorization.authorization_number}: provider outreach for "
        f"{authorization.diagnosis.code} ({authorization.specialty.name}), "
        f"member ZIP {authorization.member_postal_code}."
    )
    details = []
    for call in selected:
        when = timezone.localtime(call.call_at).strftime("%b %d, %Y")
        details.append(f"{when}: {call.facility.name} — {call.result_phrase}.")
    outcome = (
        f"{successes if total_successes >= 2 else total_successes} successful provider outcome(s) documented."
    )
    return " ".join([heading, *details, outcome])


def haversine_miles(lat1, lon1, lat2, lon2):
    radius = 3958.7613
    phi1, phi2 = math.radians(float(lat1)), math.radians(float(lat2))
    delta_phi = math.radians(float(lat2) - float(lat1))
    delta_lambda = math.radians(float(lon2) - float(lon1))
    a = math.sin(delta_phi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(delta_lambda / 2) ** 2
    return radius * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
