from datetime import timedelta
from types import SimpleNamespace

import pytest

from apps.tracker.models import ProviderCall
from apps.tracker.services.business_rules import (
    authorization_narrative,
    calculate_result,
    call_fingerprint,
    haversine_miles,
    is_fdm_eligible,
    next_review_date,
    seven_day_recommendation,
    weekly_duplicate_key,
)


@pytest.mark.parametrize(
    ("values", "code", "phrase"),
    [
        (
            {"did_not_leave_vm": True, "accepting": "yes", "can_treat": "yes", "schedule": "yes"},
            "unable_to_contact",
            "unable to contact, did not leave voicemail",
        ),
        (
            {"did_not_leave_vm": False, "accepting": "no", "can_treat": "yes", "schedule": "yes"},
            "does_not_meet_availability_guidelines",
            "does not meet availability guidelines",
        ),
        (
            {"did_not_leave_vm": False, "accepting": "yes", "can_treat": "no", "schedule": "yes"},
            "does_not_meet_availability_guidelines",
            "does not meet availability guidelines",
        ),
        (
            {
                "did_not_leave_vm": False,
                "accepting": "yes",
                "can_treat": "yes",
                "schedule": "urgent_referral_required",
            },
            "meets_availability_guidelines_urgent",
            "meets availability guidelines - can schedule within 4 weeks with urgent referral",
        ),
        (
            {"did_not_leave_vm": False, "accepting": "yes", "can_treat": "yes", "schedule": "yes"},
            "meets_availability_guidelines",
            "meets availability guidelines",
        ),
        (
            {"did_not_leave_vm": False, "accepting": "unknown", "can_treat": "yes", "schedule": "yes"},
            "does_not_meet_availability_guidelines",
            "does not meet availability guidelines",
        ),
    ],
)
def test_result_rule_order(values, code, phrase):
    result = calculate_result(**values)
    assert (result.code, result.phrase) == (code, phrase)


@pytest.mark.parametrize(
    ("values", "expected"),
    [
        ({"facility_present": False, "did_not_leave_vm": False, "accepting": "yes", "schedule": "yes"}, ""),
        (
            {
                "facility_present": True,
                "did_not_leave_vm": True,
                "accepting": "unknown",
                "schedule": "unknown",
            },
            "Call again",
        ),
        (
            {"facility_present": True, "did_not_leave_vm": False, "accepting": "yes", "schedule": "yes"},
            "Good provider",
        ),
        (
            {"facility_present": True, "did_not_leave_vm": False, "accepting": "yes", "schedule": "no"},
            "Do not call",
        ),
        (
            {"facility_present": True, "did_not_leave_vm": False, "accepting": "no", "schedule": "unknown"},
            "Do not call",
        ),
        (
            {
                "facility_present": True,
                "did_not_leave_vm": False,
                "accepting": "unknown",
                "schedule": "unknown",
            },
            "Call to verify",
        ),
        (
            {
                "facility_present": True,
                "did_not_leave_vm": False,
                "accepting": "not_applicable",
                "schedule": "not_applicable",
            },
            "not confirmed",
        ),
    ],
)
def test_seven_day_recommendations(values, expected):
    assert expected in seven_day_recommendation(**values)


def test_duplicate_key_is_week_based(domain):
    first = weekly_duplicate_key(domain["facility"].pk, domain["diagnosis"].pk, domain["now"])
    second = weekly_duplicate_key(
        domain["facility"].pk, domain["diagnosis"].pk, domain["now"] + timedelta(days=2)
    )
    next_week = weekly_duplicate_key(
        domain["facility"].pk, domain["diagnosis"].pk, domain["now"] + timedelta(days=7)
    )
    assert first == second
    assert first != next_week


def test_call_fingerprint_is_stable(domain):
    values = {
        "caller_initials": "UR",
        "call_at": domain["now"],
        "authorization_number": "TEST-1001",
        "facility_key": domain["facility"].display_key,
        "specialty": domain["specialty"].name,
        "diagnosis": domain["diagnosis"].code,
    }
    assert call_fingerprint(**values) == call_fingerprint(**values)
    assert call_fingerprint(**values) != call_fingerprint(**{**values, "authorization_number": "TEST-1002"})


def test_next_review_date_is_seven_days(domain):
    assert next_review_date(domain["now"]) == domain["now"].date() + timedelta(days=7)


def test_fdm_requires_fresh_positive_confirmed_observation(domain):
    call = SimpleNamespace(
        call_at=domain["now"] - timedelta(days=29), accepting_new_patients="yes", can_treat_diagnosis="yes"
    )
    assert is_fdm_eligible(call, mapping_confirmed=True, as_of=domain["now"])
    assert not is_fdm_eligible(call, mapping_confirmed=False, as_of=domain["now"])
    call.call_at = domain["now"] - timedelta(days=31)
    assert not is_fdm_eligible(call, mapping_confirmed=True, as_of=domain["now"])


@pytest.mark.django_db
def test_authorization_narrative_stops_after_second_success(domain):
    for index, status in enumerate(["no", "yes", "no", "yes", "yes"]):
        ProviderCall.objects.create(
            authorization=domain["authorization"],
            facility=domain["facility"],
            specialty=domain["specialty"],
            diagnosis=domain["diagnosis"],
            caller=domain["users"]["ura_user"],
            call_at=domain["now"] + timedelta(hours=index),
            accepting_new_patients="yes",
            can_treat_diagnosis="yes",
            can_schedule_within_four_weeks=status,
            import_fingerprint=f"narrative-{index}",
        )
    narrative = authorization_narrative(domain["authorization"])
    assert narrative.count(domain["facility"].name) == 4
    assert "2 successful provider outcome(s)" in narrative


def test_haversine_distance_is_symmetric_and_reasonable():
    distance = haversine_miles(42.3570, -71.0637, 42.3648, -71.1028)
    reverse = haversine_miles(42.3648, -71.1028, 42.3570, -71.0637)
    assert distance == pytest.approx(reverse)
    assert 1.5 < distance < 3
