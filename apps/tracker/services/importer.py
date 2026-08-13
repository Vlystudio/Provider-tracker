import hashlib
import os
import posixpath
import re
import zipfile
from collections import Counter
from datetime import date, datetime, time, timedelta
from pathlib import Path
from xml.etree import ElementTree

from django.conf import settings
from django.db import transaction
from django.utils import timezone

from ..models import (
    Authorization,
    BookingOutBucket,
    Diagnosis,
    Facility,
    FacilitySpecialty,
    ImportBatch,
    ImportRowResult,
    LineOfBusiness,
    PostalCodeCentroid,
    ProviderCall,
    ReferralReason,
    Specialty,
)
from .business_rules import (
    calculate_result,
    call_fingerprint,
    clean_text,
    normalize_header,
    normalize_key,
    normalize_phone,
    normalize_postal_code,
    normalize_status,
    stable_hash,
)

TARGET_SHEETS = {
    "admin": {
        "Facilities",
        "Facility-Specialty Map",
        "tblWeeklyCallLog",
        "Monthly Archive",
        "Zip Coordinates",
    },
    "user": {"Facilities", "Facility-Specialty Map", "Weekly Call Log", "Zip Coordinates"},
}
IMPORTER_VERSION = settings.IMPORTER_VERSION


def file_sha256(path):
    digest = hashlib.sha256()
    with open(path, "rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def validate_workbook_container(path):
    size = os.path.getsize(path)
    if size > settings.DATA_UPLOAD_MAX_MEMORY_SIZE:
        raise ValueError("Workbook exceeds the configured compressed upload limit.")
    if Path(path).suffix.lower() not in {".xlsx", ".xlsm"}:
        raise ValueError("Workbook must use the .xlsx or .xlsm extension.")
    try:
        with zipfile.ZipFile(path) as archive:
            total = 0
            for info in archive.infolist():
                normalized = info.filename.replace("\\", "/")
                if normalized.startswith("/") or "../" in normalized:
                    raise ValueError("Workbook contains an unsafe archive path.")
                total += info.file_size
                if total > settings.WORKBOOK_MAX_UNCOMPRESSED_BYTES:
                    raise ValueError("Workbook expanded content exceeds the configured safety limit.")
            if "[Content_Types].xml" not in archive.namelist():
                raise ValueError("Workbook metadata is missing.")
    except zipfile.BadZipFile as exc:
        raise ValueError("Workbook is not a valid Office Open XML container.") from exc


XML_NAMESPACE = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
REL_NAMESPACE = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"
PACKAGE_REL_NAMESPACE = "{http://schemas.openxmlformats.org/package/2006/relationships}"


def column_index(reference):
    letters = re.match(r"[A-Z]+", reference or "A")
    result = 0
    for character in letters.group(0) if letters else "A":
        result = result * 26 + ord(character) - 64
    return result - 1


def workbook_metadata(archive):
    workbook_root = ElementTree.fromstring(archive.read("xl/workbook.xml"))
    relationship_root = ElementTree.fromstring(archive.read("xl/_rels/workbook.xml.rels"))
    relationships = {
        node.attrib["Id"]: node.attrib["Target"]
        for node in relationship_root.findall(f"{PACKAGE_REL_NAMESPACE}Relationship")
    }
    sheets = []
    sheet_parent = workbook_root.find(f"{XML_NAMESPACE}sheets")
    for sheet in sheet_parent if sheet_parent is not None else []:
        relationship_id = sheet.attrib.get(f"{REL_NAMESPACE}id")
        target = relationships.get(relationship_id, "")
        target = target.lstrip("/")
        if not target.startswith("xl/"):
            target = posixpath.normpath(posixpath.join("xl", target))
        sheets.append((sheet.attrib.get("name", ""), target))
    return sheets


def shared_strings(archive):
    if "xl/sharedStrings.xml" not in archive.namelist():
        return []
    values = []
    with archive.open("xl/sharedStrings.xml") as source:
        for _, element in ElementTree.iterparse(source, events=("end",)):
            if element.tag == f"{XML_NAMESPACE}si":
                values.append("".join(node.text or "" for node in element.iter(f"{XML_NAMESPACE}t")))
                element.clear()
    return values


def convert_xml_cell(cell, strings):
    cell_type = cell.attrib.get("t", "n")
    if cell_type == "inlineStr":
        return "".join(node.text or "" for node in cell.iter(f"{XML_NAMESPACE}t"))
    value_node = cell.find(f"{XML_NAMESPACE}v")
    if value_node is None or value_node.text is None:
        return None
    value = value_node.text
    if cell_type == "s":
        try:
            return strings[int(value)]
        except IndexError, ValueError:
            return ""
    if cell_type == "b":
        return value == "1"
    if cell_type in {"str", "d", "e"}:
        return value
    try:
        number = float(value)
        return int(number) if number.is_integer() else number
    except ValueError:
        return value


def stream_sheet_rows(archive, entry_name, strings):
    with archive.open(entry_name) as source:
        for _, element in ElementTree.iterparse(source, events=("end",)):
            if element.tag != f"{XML_NAMESPACE}row":
                continue
            row_number = int(element.attrib.get("r", "0") or 0)
            values = []
            for cell in element.findall(f"{XML_NAMESPACE}c"):
                index = column_index(cell.attrib.get("r", "A1"))
                while len(values) <= index:
                    values.append(None)
                values[index] = convert_xml_cell(cell, strings)
            yield row_number, tuple(values)
            element.clear()


def row_record(headers, values):
    raw = {
        header: json_safe(values[index] if index < len(values) else None)
        for index, header in enumerate(headers)
        if header
    }
    normalized = {
        normalize_header(header): values[index] if index < len(values) else None
        for index, header in enumerate(headers)
        if header
    }
    return raw, normalized


def json_safe(value):
    if isinstance(value, (datetime, date, time)):
        return value.isoformat()
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    return str(value)


def pick(record, *aliases):
    for alias in aliases:
        value = record.get(normalize_header(alias))
        if value is not None and clean_text(value):
            return value
    return None


def split_facility_key(value):
    text = clean_text(value)
    if "|" not in text:
        return text, ""
    name, city = text.rsplit("|", 1)
    return clean_text(name), clean_text(city)


def facility_identity(name, city):
    name, city = clean_text(name), clean_text(city)
    return {
        "name": name,
        "city": city,
        "normalized_name": normalize_key(name),
        "normalized_city": normalize_key(city),
        "normalized_key": f"{normalize_key(name)}|{normalize_key(city)}",
        "display_key": f"{name} | {city}" if city else name,
    }


def parse_datetime(value):
    if isinstance(value, datetime):
        result = value
    elif isinstance(value, date):
        result = datetime.combine(value, time(12))
    elif isinstance(value, (int, float)):
        if value <= 0:
            return None
        try:
            result = datetime(1899, 12, 30) + timedelta(milliseconds=round(float(value) * 86_400_000))
        except TypeError, ValueError, OverflowError:
            return None
    else:
        text_value = clean_text(value)
        if not text_value:
            return None
        formats = (
            "%m/%d/%Y %I:%M:%S %p",
            "%m/%d/%Y %I:%M %p",
            "%m/%d/%y %I:%M:%S %p",
            "%m/%d/%y %I:%M %p",
            "%m/%d/%Y %H:%M",
            "%m/%d/%y %H:%M",
            "%m/%d/%Y",
            "%m/%d/%y",
            "%Y-%m-%dT%H:%M:%S",
            "%Y-%m-%d %H:%M:%S",
            "%Y-%m-%d",
        )
        result = None
        for date_format in formats:
            try:
                result = datetime.strptime(text_value, date_format)
                break
            except ValueError:
                pass
        if result is None and re.fullmatch(r"\d{8}", re.sub(r"\D", "", text_value)):
            try:
                result = datetime.strptime(re.sub(r"\D", "", text_value), "%m%d%Y")
            except ValueError:
                return None
        if result is None:
            return None
    if timezone.is_naive(result):
        result = timezone.make_aware(result, timezone.get_default_timezone())
    return result


def bool_value(value):
    return normalize_status(value) == "yes"


def did_not_leave_voicemail(value):
    normalized = clean_text(value).lower()
    return (
        normalize_status(value) == "yes"
        or "did not leave vm" in normalized
        or "did not leave voicemail" in normalized
    )


def parse_facility(record, source):
    facility_key = clean_text(pick(record, "Facility Key"))
    key_name, key_city = split_facility_key(facility_key)
    name = clean_text(pick(record, "Facility", "Facility Name")) or key_name
    city = clean_text(pick(record, "Location / City", "Location", "City")) or key_city
    if not name and not facility_key:
        return None
    if normalize_header(name) == "facility" or normalize_header(facility_key) == "facilitykey":
        return None
    identity = facility_identity(name, city)
    issues = []
    latitude = number_value(pick(record, "Latitude"))
    longitude = number_value(pick(record, "Longitude"))
    if not city:
        issues.append("facility_missing_city")
    if latitude is None or longitude is None:
        issues.append("facility_missing_coordinates")
    phone = clean_text(pick(record, "Phone Number", "Phone"))
    return {
        **identity,
        "facility_type": clean_text(pick(record, "Facility Type")) or "Hospital",
        "phone_display": phone,
        "phone_normalized": normalize_phone(phone),
        "postal_code": normalize_postal_code(pick(record, "Zipcode", "ZIP Code", "Postal Code")),
        "latitude": latitude,
        "longitude": longitude,
        "fingerprint": stable_hash("facility", identity["normalized_key"]),
        "source": source,
        "issues": issues,
    }


def parse_mapping(record, source):
    facility_key = clean_text(pick(record, "Facility Key", "Facility Name"))
    specialty = clean_text(pick(record, "Specialty"))
    if not facility_key and not specialty:
        return None
    if normalize_header(facility_key) == "facilitykey" or normalize_header(specialty) == "specialty":
        return None
    name, city = split_facility_key(facility_key)
    identity = facility_identity(name, city)
    issues = []
    if not facility_key or not specialty:
        issues.append("mapping_missing_identity")
    return {
        "facility_display_key": identity["display_key"],
        "normalized_facility_key": identity["normalized_key"],
        "specialty": specialty,
        "normalized_specialty": normalize_key(specialty),
        "treatment_status": normalize_status(pick(record, "Treats This Specialty", "Can Treat Diagnosis")),
        "notes": clean_text(pick(record, "Notes")),
        "fingerprint": stable_hash(
            "facility_specialty", identity["normalized_key"], normalize_key(specialty)
        ),
        "source": source,
        "issues": issues,
    }


def parse_postal(record, source):
    postal_code = normalize_postal_code(pick(record, "Zip Code", "Zipcode", "Postal Code"))
    latitude = number_value(pick(record, "Latitude"))
    longitude = number_value(pick(record, "Longitude"))
    if not postal_code and latitude is None and longitude is None:
        return None
    issues = []
    if (
        not postal_code
        or latitude is None
        or longitude is None
        or not (-90 <= latitude <= 90)
        or not (-180 <= longitude <= 180)
    ):
        issues.append("postal_code_invalid")
    return {
        "postal_code": postal_code,
        "latitude": latitude,
        "longitude": longitude,
        "fingerprint": stable_hash("postal_code", postal_code)
        if postal_code
        else stable_hash("postal_rejected", source["sheet"], source["row"]),
        "source": source,
        "issues": issues,
    }


def number_value(value):
    try:
        return float(str(value).replace(",", "")) if value is not None and clean_text(value) else None
    except ValueError:
        return None


def parse_call(record, source):
    caller = clean_text(pick(record, "Caller Initials", "URA Initials"))
    authorization = clean_text(pick(record, "Auth #", "Authorization Number"))
    facility_value = clean_text(pick(record, "Facility Name", "Facility Key"))
    specialty = clean_text(pick(record, "Specialty"))
    diagnosis_code = clean_text(pick(record, "ICD-10 Code", "Diagnosis Code"))
    diagnosis_description = clean_text(pick(record, "Diagnosis Description"))
    phone = clean_text(pick(record, "Phone Number"))
    notes = clean_text(pick(record, "Notes"))
    referral_reason = clean_text(pick(record, "Reason for OON Referral"))
    booking_out = clean_text(pick(record, "Booking Out"))
    if not any(
        (
            caller,
            authorization,
            facility_value,
            specialty,
            diagnosis_code,
            phone,
            notes,
            referral_reason,
            booking_out,
        )
    ):
        return None
    manual_value = pick(record, "Manual Call Time Override")
    manual = parse_datetime(manual_value)
    call_at = manual or parse_datetime(pick(record, "Call Date/Time", "Call Date"))
    issues = []
    if manual_value and not manual:
        issues.append("call_manual_override_invalid")
    if not facility_value:
        issues.append("call_missing_facility")
    if not call_at:
        issues.append("call_missing_timestamp")
    if not caller:
        issues.append("call_missing_initials")
    name, city = split_facility_key(facility_value)
    identity = facility_identity(name, city)
    did_not_leave_vm = did_not_leave_voicemail(
        pick(record, "Did not leave VM", "Unable to contact Did not leave VM")
    )
    accepting = normalize_status(pick(record, "Accepting New Patients"))
    can_treat = normalize_status(pick(record, "Can Treat Diagnosis"))
    schedule = normalize_status(pick(record, "Can Schedule Within 4 Weeks", "Can Schedule W/in 4 Weeks"))
    urgent = schedule == "urgent_referral_required"
    result = calculate_result(
        did_not_leave_vm=did_not_leave_vm,
        accepting=accepting,
        can_treat=can_treat,
        schedule=schedule,
        urgent_referral_required=urgent,
    )
    cached = clean_text(pick(record, "Output Phrase", "Result Phrase"))
    if cached and cached.lower() != result.phrase.lower():
        issues.append("call_cached_result_mismatch")
    if not call_at or not facility_value:
        fingerprint = stable_hash("call_rejected", source["sheet"], source["row"])
    else:
        fingerprint = call_fingerprint(
            caller_initials=caller,
            call_at=call_at,
            authorization_number=authorization,
            facility_key=identity["normalized_key"],
            specialty=specialty,
            diagnosis=diagnosis_code,
        )
    return {
        "caller_initials": caller.upper(),
        "authorization_number": authorization.upper(),
        "lob": clean_text(pick(record, "LOB")),
        "facility_display_key": identity["display_key"],
        "normalized_facility_key": identity["normalized_key"],
        "specialty": specialty,
        "diagnosis_code": diagnosis_code.upper(),
        "diagnosis_description": diagnosis_description,
        "phone": phone,
        "call_at": call_at,
        "did_not_leave_vm": did_not_leave_vm,
        "accepting_new_patients": accepting,
        "can_treat_diagnosis": can_treat,
        "can_schedule_within_four_weeks": schedule,
        "urgent_referral_required": urgent,
        "booking_out": booking_out,
        "notes": notes,
        "referral_type": clean_text(pick(record, "Referral Type")),
        "referral_reason": referral_reason,
        "specialty_confirmed": bool_value(pick(record, "Specialty Confirmed")),
        "use_in_fdm": bool_value(pick(record, "Use in FDM", "Use in FDM?")),
        "result_code": result.code,
        "result_phrase": result.phrase,
        "cached_result_phrase": cached,
        "fingerprint": fingerprint,
        "source": source,
        "issues": issues,
    }


def parse_workbook(path, kind):
    validate_workbook_container(path)
    source_hash = file_sha256(path)
    with zipfile.ZipFile(path) as archive:
        sheet_entries = workbook_metadata(archive)
        sheet_names = [name for name, _ in sheet_entries]
        missing = TARGET_SHEETS[kind] - set(sheet_names)
        if missing:
            raise ValueError(f"{kind} workbook is missing required sheets: {', '.join(sorted(missing))}")
        strings = shared_strings(archive)
        facilities, mappings, calls, postals, staged_rows, issues = [], [], [], [], [], []
        counts = Counter(
            rows_visited=0,
            scaffold_rows_skipped=0,
            rejected_rows=0,
            facilities=0,
            facility_specialties=0,
            calls=0,
            postal_codes=0,
        )
        for sheet_name, entry_name in sheet_entries:
            if sheet_name not in TARGET_SHEETS[kind]:
                continue
            rows = iter(stream_sheet_rows(archive, entry_name, strings))
            try:
                _, header_values = next(rows)
                headers = [clean_text(value) for value in header_values]
            except StopIteration:
                continue
            for source_row, values in rows:
                if source_row > settings.WORKBOOK_MAX_ROWS_PER_SHEET:
                    raise ValueError(f"{sheet_name} exceeds the configured row safety limit.")
                counts["rows_visited"] += 1
                raw, normalized = row_record(headers, values)
                source = {
                    "kind": kind,
                    "file_name": Path(path).name,
                    "hash": source_hash,
                    "sheet": sheet_name,
                    "row": source_row,
                }
                entity_type = "call"
                if sheet_name == "Facilities":
                    entity_type, candidate = "facility", parse_facility(normalized, source)
                    target = facilities
                    count_key = "facilities"
                elif sheet_name == "Facility-Specialty Map":
                    entity_type, candidate = "facility_specialty", parse_mapping(normalized, source)
                    target = mappings
                    count_key = "facility_specialties"
                elif sheet_name == "Zip Coordinates":
                    entity_type, candidate = "postal_code", parse_postal(normalized, source)
                    target = postals
                    count_key = "postal_codes"
                else:
                    candidate = parse_call(normalized, source)
                    target = calls
                    count_key = "calls"
                if candidate is None:
                    counts["scaffold_rows_skipped"] += 1
                    continue
                rejected = any(
                    code in candidate["issues"]
                    for code in {
                        "mapping_missing_identity",
                        "postal_code_invalid",
                        "call_missing_facility",
                        "call_missing_timestamp",
                    }
                )
                if rejected:
                    counts["rejected_rows"] += 1
                else:
                    target.append(candidate)
                    counts[count_key] += 1
                staged_rows.append(
                    {
                        "entity_type": entity_type,
                        "source": source,
                        "fingerprint": candidate["fingerprint"],
                        "status": "rejected" if rejected else "staged",
                        "raw_data": raw,
                        "normalized_data": {
                            key: json_safe(value)
                            for key, value in candidate.items()
                            if key not in {"source", "issues"}
                        },
                        "issues": candidate["issues"],
                    }
                )
                issues.extend({"code": code, "source": source} for code in candidate["issues"])
        return {
            "source": {
                "kind": kind,
                "file_name": Path(path).name,
                "hash": source_hash,
                "size": os.path.getsize(path),
                "sheets": sheet_names,
            },
            "counts": dict(counts),
            "facilities": facilities,
            "mappings": mappings,
            "calls": calls,
            "postals": postals,
            "staged_rows": staged_rows,
            "issues": issues,
        }


def source_priority(item):
    source = item["source"]
    if source["kind"] == "admin" and source["sheet"] == "tblWeeklyCallLog":
        return 500
    if source["kind"] == "admin" and source["sheet"] in {"Facilities", "Facility-Specialty Map"}:
        return 450
    if source["kind"] == "user" and source["sheet"] == "Weekly Call Log":
        return 400
    if source["kind"] == "admin" and source["sheet"] == "Monthly Archive":
        return 350
    return 300 if source["kind"] == "admin" else 200


def reconcile(parsed_workbooks):
    raw_facilities = [item for workbook in parsed_workbooks for item in workbook["facilities"]]
    raw_mappings = [item for workbook in parsed_workbooks for item in workbook["mappings"]]
    raw_calls = [item for workbook in parsed_workbooks for item in workbook["calls"]]
    raw_postals = [item for workbook in parsed_workbooks for item in workbook["postals"]]
    facilities_by_key = {}
    for item in raw_facilities:
        current = facilities_by_key.get(item["fingerprint"])
        if not current:
            facilities_by_key[item["fingerprint"]] = item
            continue
        preferred, fallback = (
            (item, current) if source_priority(item) > source_priority(current) else (current, item)
        )
        merged = preferred.copy()
        for field in ("phone_display", "phone_normalized", "postal_code", "latitude", "longitude"):
            merged[field] = preferred.get(field) or fallback.get(field)
        merged["issues"] = sorted(set(preferred["issues"] + fallback["issues"]))
        facilities_by_key[item["fingerprint"]] = merged

    def preferred_unique(items):
        result = {}
        for item in items:
            current = result.get(item["fingerprint"])
            if not current or source_priority(item) > source_priority(current):
                result[item["fingerprint"]] = item
        return list(result.values())

    mappings = preferred_unique(raw_mappings)
    calls = preferred_unique(raw_calls)
    postals = preferred_unique(raw_postals)
    exact_duplicates = len(raw_calls) - len(calls)
    facility_keys = {item["normalized_key"] for item in facilities_by_key.values()}
    reconciliation_issues = []
    unresolved = 0
    for call in calls:
        if call["normalized_facility_key"] not in facility_keys:
            unresolved += 1
            call["issues"] = sorted(set([*call["issues"], "call_facility_not_in_master"]))
            reconciliation_issues.append({"code": "call_facility_not_in_master", "source": call["source"]})
    for mapping in mappings:
        if mapping["normalized_facility_key"] not in facility_keys:
            mapping["issues"] = sorted(set([*mapping["issues"], "mapping_facility_not_in_master"]))
            reconciliation_issues.append(
                {"code": "mapping_facility_not_in_master", "source": mapping["source"]}
            )
    aggregate = Counter()
    for workbook in parsed_workbooks:
        aggregate.update(workbook["counts"])
    all_issues = [
        issue for workbook in parsed_workbooks for issue in workbook["issues"]
    ] + reconciliation_issues
    issue_counts = Counter(issue["code"] for issue in all_issues)
    return {
        "importer_version": IMPORTER_VERSION,
        "generated_at": timezone.now().isoformat(),
        "sources": [workbook["source"] for workbook in parsed_workbooks],
        "counts": {
            **dict(aggregate),
            "source_files": len(parsed_workbooks),
            "unique_facilities": len(facilities_by_key),
            "unique_facility_specialties": len(mappings),
            "unique_calls": len(calls),
            "unique_postal_codes": len(postals),
            "exact_duplicate_calls": exact_duplicates,
            "unresolved_facility_references": unresolved,
            "issue_warnings": sum(
                count
                for code, count in issue_counts.items()
                if code
                not in {
                    "mapping_missing_identity",
                    "postal_code_invalid",
                    "call_missing_facility",
                    "call_missing_timestamp",
                }
            ),
            "issue_errors": sum(
                count
                for code, count in issue_counts.items()
                if code
                in {
                    "mapping_missing_identity",
                    "postal_code_invalid",
                    "call_missing_facility",
                    "call_missing_timestamp",
                }
            ),
        },
        "issue_counts": dict(issue_counts),
        "facilities": sorted(facilities_by_key.values(), key=lambda item: item["normalized_key"]),
        "mappings": mappings,
        "calls": calls,
        "postals": postals,
        "staged_rows": [row for workbook in parsed_workbooks for row in workbook["staged_rows"]],
    }


def safe_summary(plan):
    return {
        "importer_version": plan["importer_version"],
        "generated_at": plan["generated_at"],
        "sources": [{**source, "local_path": "[redacted]"} for source in plan["sources"]],
        "counts": plan["counts"],
        "issue_counts": plan["issue_counts"],
    }


def reference(model, name, **defaults):
    normalized = normalize_key(name or "Unknown")
    return model.objects.get_or_create(
        normalized_name=normalized, defaults={"name": name or "Unknown", **defaults}
    )[0]


@transaction.atomic
def apply_plan(plan, *, actor):
    batches = {}
    for source in plan["sources"]:
        batch, _ = ImportBatch.objects.get_or_create(
            source_hash=source["hash"],
            importer_version=IMPORTER_VERSION,
            defaults={
                "source_name": source["file_name"],
                "source_kind": source["kind"],
                "summary": safe_summary(plan),
            },
        )
        if batch.status == ImportBatch.Status.APPLIED:
            batches[(source["kind"], source["hash"])] = batch
            continue
        batch.status = ImportBatch.Status.PREVIEWED
        batch.summary = safe_summary(plan)
        batch.save()
        batches[(source["kind"], source["hash"])] = batch
    for row in plan["staged_rows"]:
        batch = batches[(row["source"]["kind"], row["source"]["hash"])]
        ImportRowResult.objects.update_or_create(
            batch=batch,
            source_sheet=row["source"]["sheet"],
            source_row=row["source"]["row"],
            defaults={
                "entity_type": row["entity_type"],
                "fingerprint": row["fingerprint"],
                "status": row["status"],
                "issue_codes": row["issues"],
                "raw_data": row["raw_data"],
                "normalized_data": row["normalized_data"],
            },
        )
    facility_map = {}
    for item in plan["facilities"]:
        quality = (
            Facility.Quality.MISSING_COORDINATES
            if item["latitude"] is None or item["longitude"] is None
            else Facility.Quality.VERIFIED
        )
        facility, _ = Facility.objects.update_or_create(
            normalized_name=item["normalized_name"],
            normalized_city=item["normalized_city"],
            defaults={
                "name": item["name"],
                "city": item["city"],
                "display_key": item["display_key"],
                "facility_type": item["facility_type"],
                "phone_display": item["phone_display"],
                "phone_normalized": item["phone_normalized"],
                "postal_code": item["postal_code"],
                "latitude": item["latitude"],
                "longitude": item["longitude"],
                "coordinate_provenance": "workbook",
                "data_quality_status": quality,
                "source_workbook": item["source"]["file_name"],
                "source_sheet": item["source"]["sheet"],
                "source_row": item["source"]["row"],
                "source_file_hash": item["source"]["hash"],
                "importer_version": IMPORTER_VERSION,
                "import_fingerprint": item["fingerprint"],
                "provenance": {"issues": item["issues"]},
            },
        )
        facility_map[item["normalized_key"]] = facility
    for item in plan["postals"]:
        PostalCodeCentroid.objects.update_or_create(
            postal_code=item["postal_code"],
            defaults={
                "latitude": item["latitude"],
                "longitude": item["longitude"],
                "source_workbook": item["source"]["file_name"],
                "source_sheet": item["source"]["sheet"],
                "source_row": item["source"]["row"],
                "source_file_hash": item["source"]["hash"],
            },
        )
    for item in plan["mappings"]:
        facility = facility_map.get(item["normalized_facility_key"])
        if not facility:
            continue
        specialty = reference(Specialty, item["specialty"])
        FacilitySpecialty.objects.update_or_create(
            facility=facility,
            specialty=specialty,
            defaults={
                "treatment_status": item["treatment_status"],
                "confirmed": item["treatment_status"] == "yes",
                "notes": item["notes"],
                "source_workbook": item["source"]["file_name"],
                "source_sheet": item["source"]["sheet"],
                "source_row": item["source"]["row"],
                "source_file_hash": item["source"]["hash"],
                "import_fingerprint": item["fingerprint"],
            },
        )
    default_referral = reference(ReferralReason, "Imported workbook")
    booking_bucket = reference(BookingOutBucket, "Imported / uncategorized", sort_order=99)
    imported_calls = 0
    for item in plan["calls"]:
        if ProviderCall.objects.filter(import_fingerprint=item["fingerprint"]).exists():
            continue
        facility = facility_map.get(item["normalized_facility_key"])
        if not facility:
            name, city = split_facility_key(item["facility_display_key"])
            identity = facility_identity(name, city)
            facility, _ = Facility.objects.get_or_create(
                normalized_name=identity["normalized_name"],
                normalized_city=identity["normalized_city"],
                defaults={
                    "name": name or "Unlinked imported facility",
                    "city": city,
                    "display_key": identity["display_key"],
                    "data_quality_status": Facility.Quality.REVIEW,
                    "active": False,
                },
            )
            facility_map[item["normalized_facility_key"]] = facility
        lob_name = item["lob"] or "Unknown"
        lob = reference(
            LineOfBusiness, lob_name, code=re.sub(r"[^A-Z0-9]", "", lob_name.upper())[:24] or "UNKNOWN"
        )
        specialty = reference(Specialty, item["specialty"] or "Unknown")
        diagnosis_code = item["diagnosis_code"] or f"UNK-{item['fingerprint'][:8]}"
        diagnosis, _ = Diagnosis.objects.get_or_create(
            code=diagnosis_code,
            defaults={
                "description": item["diagnosis_description"] or "Unknown imported diagnosis",
                "normalized_description": normalize_key(
                    item["diagnosis_description"] or "Unknown imported diagnosis"
                ),
            },
        )
        auth_number = item["authorization_number"] or f"IMPORTED-{item['fingerprint'][:12].upper()}"
        authorization, _ = Authorization.objects.get_or_create(
            authorization_number=auth_number,
            defaults={
                "line_of_business": lob,
                "member_postal_code": facility.postal_code[:5] or "00000",
                "diagnosis": diagnosis,
                "specialty": specialty,
                "referral_reason": default_referral,
                "created_by": actor,
            },
        )
        caller = actor
        if item["caller_initials"]:
            profile = (
                __import__("apps.accounts.models", fromlist=["UserProfile"])
                .UserProfile.objects.filter(initials=item["caller_initials"])
                .select_related("user")
                .first()
            )
            if profile:
                caller = profile.user
        ProviderCall.objects.create(
            authorization=authorization,
            facility=facility,
            specialty=specialty,
            diagnosis=diagnosis,
            caller=caller,
            call_at=item["call_at"],
            phone_snapshot=item["phone"],
            did_not_leave_vm=item["did_not_leave_vm"],
            accepting_new_patients=item["accepting_new_patients"],
            can_treat_diagnosis=item["can_treat_diagnosis"],
            can_schedule_within_four_weeks=item["can_schedule_within_four_weeks"],
            urgent_referral_required=item["urgent_referral_required"],
            booking_out_bucket=booking_bucket if item["booking_out"] else None,
            booking_out_notes=item["booking_out"],
            notes=item["notes"],
            referral_type=item["referral_type"],
            out_of_network_reason=item["referral_reason"],
            specialty_confirmed=item["specialty_confirmed"],
            use_in_fdm=item["use_in_fdm"],
            source_workbook=item["source"]["file_name"],
            source_sheet=item["source"]["sheet"],
            source_row=item["source"]["row"],
            source_file_hash=item["source"]["hash"],
            importer_version=IMPORTER_VERSION,
            import_fingerprint=item["fingerprint"],
            original_cached_result_phrase=item["cached_result_phrase"],
            normalization_issues=item["issues"],
        )
        imported_calls += 1
    for batch in batches.values():
        batch.status = ImportBatch.Status.APPLIED
        batch.applied_by = actor
        batch.applied_at = timezone.now()
        batch.save()
    return {"batches": len(batches), "facilities": len(facility_map), "calls_imported": imported_calls}
