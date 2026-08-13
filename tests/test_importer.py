from datetime import datetime

import pytest
from openpyxl import Workbook

from apps.tracker.models import ImportBatch, ImportRowResult, ProviderCall
from apps.tracker.services.importer import apply_plan, parse_workbook, reconcile, safe_summary

FACILITY_HEADERS = [
    "Facility Key",
    "Facility",
    "Location / City",
    "Facility Type",
    "Phone Number",
    "Zipcode",
    "Latitude",
    "Longitude",
]
MAPPING_HEADERS = ["Facility Key", "Specialty", "Treats This Specialty", "Notes"]
CALL_BASE = [
    "URA Initials",
    "Call Date",
    "LOB",
    "Authorization Number",
    "Facility Key",
    "Specialty",
    "Diagnosis Code",
    "Diagnosis Description",
    "Phone Number",
    "Did not leave VM",
    "Accepting New Patients",
    "Can Treat Diagnosis",
    "Can Schedule W/in 4 Weeks",
]


def add_sheet(workbook, name, headers, rows):
    sheet = workbook.create_sheet(name)
    sheet.append(headers)
    for row in rows:
        sheet.append(row)


def build_workbook(path, kind):
    workbook = Workbook()
    workbook.remove(workbook.active)
    facility = [
        "North River Health | Boston",
        "North River Health",
        "Boston",
        "Clinic",
        "(617) 555-0100",
        "02108",
        42.357,
        -71.063,
    ]
    mapping = ["North River Health | Boston", "Behavioral Health", "Yes", "Confirmed"]
    add_sheet(workbook, "Facilities", FACILITY_HEADERS, [facility])
    add_sheet(workbook, "Facility-Specialty Map", MAPPING_HEADERS, [mapping])
    add_sheet(
        workbook, "Zip Coordinates", ["Zip Code", "Latitude", "Longitude"], [["02108", 42.357, -71.063]]
    )
    if kind == "admin":
        headers = [
            *CALL_BASE,
            "Notes",
            "Referral Type",
            "Reason for OON Referral",
            "Output Phrase",
            "Manual Call Time Override",
        ]
        row = [
            "UR",
            datetime(2026, 8, 12, 10),
            "Commercial",
            "TEST-IMPORT",
            "North River Health | Boston",
            "Behavioral Health",
            "F41.1",
            "Generalized anxiety",
            "6175550100",
            "No",
            "Yes",
            "Yes",
            "Yes",
            "Admin note",
            "Standard",
            "Network access",
            "meets availability guidelines",
            None,
        ]
        add_sheet(workbook, "tblWeeklyCallLog", headers, [row])
        add_sheet(
            workbook,
            "Monthly Archive",
            headers,
            [
                [
                    "UR",
                    None,
                    "Commercial",
                    "BROKEN",
                    None,
                    "Behavioral Health",
                    "F41.1",
                    "Generalized anxiety",
                    "6175550100",
                    "No",
                    "Yes",
                    "Yes",
                    "Yes",
                    "Malformed block",
                    "",
                    "",
                    "",
                    None,
                ]
            ],
        )
    else:
        headers = [
            *CALL_BASE,
            "Booking Out",
            "Notes",
            "Reason for OON Referral",
            "Output Phrase",
            "Manual Call Time Override",
        ]
        row = [
            "UR",
            datetime(2026, 8, 12, 10),
            "Commercial",
            "TEST-IMPORT",
            "North River Health | Boston",
            "Behavioral Health",
            "F41.1",
            "Generalized anxiety",
            "6175550100",
            "No",
            "Yes",
            "Yes",
            "Yes",
            "1–2 weeks",
            "User note",
            "Network access",
            "meets availability guidelines",
            None,
        ]
        add_sheet(workbook, "Weekly Call Log", headers, [row])
    workbook.save(path)


@pytest.fixture
def workbook_pair(tmp_path):
    admin = tmp_path / "admin.xlsx"
    user = tmp_path / "user.xlsx"
    build_workbook(admin, "admin")
    build_workbook(user, "user")
    return admin, user


def test_header_drift_and_malformed_archive_are_handled(workbook_pair):
    admin, user = workbook_pair
    parsed_admin = parse_workbook(admin, "admin")
    parsed_user = parse_workbook(user, "user")
    assert parsed_admin["counts"]["rejected_rows"] == 1
    assert parsed_user["calls"][0]["booking_out"] == "1–2 weeks"
    assert parsed_user["calls"][0]["notes"] == "User note"
    plan = reconcile([parsed_admin, parsed_user])
    assert plan["counts"]["unique_calls"] == 1
    assert plan["counts"]["exact_duplicate_calls"] == 1
    assert plan["counts"]["unique_facilities"] == 1
    assert plan["counts"]["unique_facility_specialties"] == 1


def test_safe_summary_redacts_local_paths(workbook_pair):
    admin, user = workbook_pair
    summary = safe_summary(reconcile([parse_workbook(admin, "admin"), parse_workbook(user, "user")]))
    rendered = str(summary)
    assert str(admin.parent) not in rendered
    assert all(source["local_path"] == "[redacted]" for source in summary["sources"])


def test_rejects_unsafe_or_wrong_workbook(tmp_path):
    invalid = tmp_path / "invalid.xlsx"
    invalid.write_bytes(b"not-a-workbook")
    with pytest.raises(ValueError, match="valid Office Open XML"):
        parse_workbook(invalid, "admin")


@pytest.mark.django_db
def test_apply_is_idempotent(domain, workbook_pair):
    admin, user = workbook_pair
    plan = reconcile([parse_workbook(admin, "admin"), parse_workbook(user, "user")])
    first = apply_plan(plan, actor=domain["users"]["administrator"])
    second = apply_plan(plan, actor=domain["users"]["administrator"])
    assert first["calls_imported"] == 1
    assert second["calls_imported"] == 0
    assert ProviderCall.objects.filter(import_fingerprint=plan["calls"][0]["fingerprint"]).count() == 1
    assert ImportBatch.objects.count() == 2
    assert ImportRowResult.objects.filter(status="rejected").count() == 1
