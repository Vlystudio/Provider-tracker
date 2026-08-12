import hashlib
import random
from datetime import datetime, time, timedelta
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand
from django.utils import timezone

from apps.accounts.models import UserProfile
from apps.tracker.models import (
    AuditEvent,
    Authorization,
    AutomationRule,
    AutomationRun,
    BookingOutBucket,
    Diagnosis,
    DuplicateCallGroup,
    Facility,
    FacilitySpecialty,
    ImportBatch,
    ImportRowResult,
    LineOfBusiness,
    PostalCodeCentroid,
    ProviderCall,
    ReferralReason,
    ReviewTask,
    Specialty,
)
from apps.tracker.services.business_rules import (
    next_review_date,
    normalize_key,
    week_start,
    weekly_duplicate_key,
)

DEMO_PASSWORD = "DemoOnly!2026"


class Command(BaseCommand):
    help = "Create deterministic, fictional demonstration records."

    def handle(self, *args, **options):
        random.seed(7426)
        today = timezone.localdate()
        now = timezone.now()
        user_model = get_user_model()
        accounts = [
            ("admin.demo", "Avery", "Morgan", "AM", UserProfile.Role.ADMINISTRATOR, True),
            ("ura.demo", "Jordan", "Lee", "JL", UserProfile.Role.URA_USER, False),
            ("viewer.demo", "Casey", "Reed", "CR", UserProfile.Role.REPORT_VIEWER, False),
            ("auditor.demo", "Riley", "Patel", "RP", UserProfile.Role.AUDITOR, False),
        ]
        users = {}
        for username, first, last, initials, role, staff in accounts:
            user, created = user_model.objects.get_or_create(
                username=username,
                defaults={
                    "first_name": first,
                    "last_name": last,
                    "email": f"{username}@example.invalid",
                    "is_staff": staff,
                    "is_superuser": False,
                },
            )
            user.first_name, user.last_name, user.is_staff, user.is_active = first, last, staff, True
            user.set_password(DEMO_PASSWORD)
            user.save()
            profile, _ = UserProfile.objects.update_or_create(
                user=user,
                defaults={
                    "initials": initials,
                    "role": role,
                    "display_name": f"{first} {last}",
                    "activity_status": "active",
                },
            )
            users[role] = user

        def named(model, name, **extra):
            return model.objects.update_or_create(
                normalized_name=normalize_key(name), defaults={"name": name, "active": True, **extra}
            )[0]

        lobs = [
            named(LineOfBusiness, "Commercial", code="COMM"),
            named(LineOfBusiness, "Medicaid", code="MCD"),
            named(LineOfBusiness, "Medicare Advantage", code="MA"),
        ]
        specialty_names = [
            "Behavioral Health",
            "Cardiology",
            "Dermatology",
            "Endocrinology",
            "Neurology",
            "Orthopedics",
        ]
        specialties = [named(Specialty, value) for value in specialty_names]
        diagnosis_data = [
            ("F41.1", "Generalized anxiety disorder", 0),
            ("I10", "Essential hypertension", 1),
            ("L30.9", "Dermatitis, unspecified", 2),
            ("E11.9", "Type 2 diabetes without complications", 3),
            ("G43.909", "Migraine, unspecified", 4),
            ("M25.561", "Pain in right knee", 5),
        ]
        diagnoses = []
        for code, description, _ in diagnosis_data:
            diagnosis, _ = Diagnosis.objects.update_or_create(
                code=code,
                defaults={
                    "description": description,
                    "normalized_description": normalize_key(description),
                    "active": True,
                },
            )
            diagnoses.append(diagnosis)
        referrals = [
            named(ReferralReason, value)
            for value in [
                "Network access",
                "Continuity of care",
                "Clinical specialization",
                "Member preference",
            ]
        ]
        booking = [
            named(BookingOutBucket, value, sort_order=index)
            for index, value in enumerate(
                ["Same week", "1–2 weeks", "3–4 weeks", "More than 4 weeks"], start=1
            )
        ]
        zip_data = [
            ("02108", "42.3570", "-71.0637", "Boston"),
            ("02139", "42.3648", "-71.1028", "Cambridge"),
            ("02446", "42.3435", "-71.1226", "Brookline"),
            ("02155", "42.4184", "-71.1062", "Medford"),
            ("02451", "42.3931", "-71.2458", "Waltham"),
            ("01970", "42.5195", "-70.8967", "Salem"),
        ]
        for postal_code, latitude, longitude, _ in zip_data:
            PostalCodeCentroid.objects.update_or_create(
                postal_code=postal_code,
                defaults={
                    "latitude": Decimal(latitude),
                    "longitude": Decimal(longitude),
                    "source_workbook": "sanitized-demo-fixture",
                    "source_sheet": "Postal Codes",
                    "source_row": 1,
                },
            )
        prefixes = [
            "North River",
            "Harbor",
            "Summit",
            "Lakeview",
            "Cedar",
            "Beacon",
            "Pinecrest",
            "Oak Street",
            "Meadow",
            "Riverside",
        ]
        suffixes = ["Medical Group", "Health Center", "Specialty Care"]
        facilities = []
        for index in range(30):
            prefix = prefixes[index % len(prefixes)]
            suffix = suffixes[index // len(prefixes)]
            postal_code, latitude, longitude, city = zip_data[index % len(zip_data)]
            offset = Decimal(str(((index % 5) - 2) * 0.006))
            quality = (
                Facility.Quality.MISSING_COORDINATES
                if index == 28
                else Facility.Quality.REVIEW
                if index in {7, 21, 29}
                else Facility.Quality.VERIFIED
            )
            lat_value = None if index == 28 else Decimal(latitude) + offset
            lon_value = None if index == 28 else Decimal(longitude) - offset
            name = f"{prefix} {suffix}"
            facility, _ = Facility.objects.update_or_create(
                normalized_name=normalize_key(name),
                normalized_city=normalize_key(city),
                defaults={
                    "name": name,
                    "city": city,
                    "state": "MA",
                    "display_key": f"{name} | {city}",
                    "facility_type": ["Hospital", "Outpatient clinic", "Specialty practice"][index % 3],
                    "phone_display": f"(617) 555-{1100 + index:04d}",
                    "phone_normalized": f"617555{1100 + index:04d}",
                    "address_line": f"{100 + index * 7} Example Avenue",
                    "postal_code": postal_code,
                    "latitude": lat_value,
                    "longitude": lon_value,
                    "coordinate_provenance": "Sanitized demo ZIP centroid",
                    "data_quality_status": quality,
                    "last_reviewed_at": now - timedelta(days=index % 40),
                    "active": True,
                    "source_workbook": "sanitized-demo-fixture",
                    "source_sheet": "Facilities",
                    "source_row": index + 2,
                    "source_file_hash": hashlib.sha256(b"sanitized-demo").hexdigest(),
                    "importer_version": "demo-v1",
                    "import_fingerprint": hashlib.sha256(f"facility-{index}".encode()).hexdigest(),
                    "provenance": {"fictional": True},
                },
            )
            facilities.append(facility)
            for specialty in {specialties[index % 6], specialties[(index + 2) % 6]}:
                FacilitySpecialty.objects.update_or_create(
                    facility=facility,
                    specialty=specialty,
                    defaults={
                        "treatment_status": "yes",
                        "confirmed": index % 6 != 0,
                        "last_confirmed_at": now - timedelta(days=index % 35),
                        "source_workbook": "sanitized-demo-fixture",
                        "source_sheet": "Facility-Specialty Map",
                        "source_row": index + 2,
                    },
                )
        admin = users[UserProfile.Role.ADMINISTRATOR]
        ura = users[UserProfile.Role.URA_USER]
        authorizations = []
        for index in range(24):
            diagnosis = diagnoses[index % 6]
            specialty = specialties[index % 6]
            authorization, _ = Authorization.objects.update_or_create(
                authorization_number=f"DEMO-{today.year}-{1000 + index}",
                defaults={
                    "line_of_business": lobs[index % 3],
                    "member_postal_code": zip_data[index % 6][0],
                    "diagnosis": diagnosis,
                    "specialty": specialty,
                    "referral_reason": referrals[index % len(referrals)],
                    "referral_details": (
                        "Fictional demonstration referral requiring provider availability research."
                    ),
                    "status": "open",
                    "created_by": ura,
                },
            )
            authorizations.append(authorization)
        ProviderCall.objects.filter(import_fingerprint__startswith="demo-call-").delete()
        DuplicateCallGroup.objects.filter(group_key__startswith="demo-").delete()
        calls = []
        statuses = [
            (False, "yes", "yes", "yes", False),
            (False, "yes", "yes", "urgent_referral_required", True),
            (True, "unknown", "unknown", "unknown", False),
            (False, "no", "yes", "no", False),
            (False, "yes", "no", "no", False),
            (False, "yes", "yes", "no", False),
        ]
        for index in range(68):
            authorization = authorizations[index % len(authorizations)]
            facility = facilities[(index * 7) % len(facilities)]
            call_day = today - timedelta(days=(index * 3) % 52)
            call_at = timezone.make_aware(datetime.combine(call_day, time(9 + index % 8, (index * 7) % 60)))
            did_not, accepting, treating, scheduling, urgent = statuses[index % len(statuses)]
            call = ProviderCall.objects.create(
                authorization=authorization,
                facility=facility,
                specialty=authorization.specialty,
                diagnosis=authorization.diagnosis,
                caller=ura if index % 4 else admin,
                call_at=call_at,
                phone_snapshot=facility.phone_display,
                did_not_leave_vm=did_not,
                accepting_new_patients=accepting,
                can_treat_diagnosis=treating,
                can_schedule_within_four_weeks=scheduling,
                urgent_referral_required=urgent,
                booking_out_bucket=booking[index % len(booking)]
                if scheduling == "no"
                else booking[min(index % 3, 2)],
                booking_out_notes="Fictional scheduling observation",
                notes="Sanitized demonstration call note.",
                referral_type="Standard referral",
                out_of_network_reason="Network access" if scheduling == "no" else "",
                specialty_confirmed=index % 4 != 0,
                use_in_fdm=index % 5 == 0,
                next_review_date=next_review_date(call_at),
                import_fingerprint=f"demo-call-{index:03d}",
            )
            calls.append(call)
        # Two same-week facility/diagnosis calls demonstrate the weekly duplicate guardrail.
        duplicate_calls = calls[:2]
        duplicate_facility = facilities[0]
        duplicate_diagnosis = diagnoses[0]
        duplicate_week = week_start(timezone.now())
        group = DuplicateCallGroup.objects.create(
            group_key=(
                f"demo-{weekly_duplicate_key(duplicate_facility.pk, duplicate_diagnosis.pk, timezone.now())}"
            ),
            facility=duplicate_facility,
            diagnosis=duplicate_diagnosis,
            week_start=duplicate_week,
            call_count=2,
        )
        for offset, call in enumerate(duplicate_calls):
            call.facility = duplicate_facility
            call.diagnosis = duplicate_diagnosis
            call.specialty = specialties[0]
            call.call_at = timezone.now() - timedelta(days=offset)
            call.duplicate_group = group
            call.repeat_call_reason = "Second contact requested by provider" if offset else ""
            call.next_review_date = next_review_date(call.call_at)
            call.save()
        ReviewTask.objects.filter(automation_key__startswith="demo:").delete()
        review_specs = [
            (
                "seven_day_follow_up",
                "Follow up on recent scheduling evidence",
                -4,
                "high",
                facilities[3],
                calls[3],
            ),
            (
                "weekly_duplicate",
                "Review repeated calls this week",
                0,
                "high",
                duplicate_facility,
                duplicate_calls[1],
            ),
            (
                "missing_coordinates",
                "Resolve missing facility coordinates",
                2,
                "medium",
                facilities[28],
                None,
            ),
            (
                "stale_availability",
                "Reconfirm stale availability evidence",
                5,
                "medium",
                facilities[12],
                calls[12],
            ),
            (
                "conflicting_facility",
                "Review conflicting facility source fields",
                7,
                "low",
                facilities[21],
                None,
            ),
        ]
        for index, (task_type, title, due_offset, priority, facility, call) in enumerate(review_specs):
            ReviewTask.objects.create(
                task_type=task_type,
                title=title,
                description="Fictional demonstration review work created by a business rule.",
                facility=facility,
                provider_call=call,
                due_date=today + timedelta(days=due_offset),
                priority=priority,
                status="open",
                automation_key=f"demo:{index}",
            )
        source_hash = hashlib.sha256(b"sanitized-demo-import").hexdigest()
        batch, _ = ImportBatch.objects.update_or_create(
            source_hash=source_hash,
            importer_version="demo-v1",
            defaults={
                "source_name": "sanitized_demo_workbook.xlsx",
                "source_kind": "admin",
                "status": "applied",
                "summary": {"counts": {"facilities": 30, "calls": 68, "rejected": 4}},
                "applied_by": admin,
                "applied_at": now - timedelta(days=5),
            },
        )
        for index, issue in enumerate(
            [
                "call_missing_timestamp",
                "facility_missing_coordinates",
                "mapping_missing_identity",
                "postal_code_invalid",
            ],
            start=1,
        ):
            ImportRowResult.objects.update_or_create(
                batch=batch,
                source_sheet="Sanitized Review",
                source_row=index + 1,
                defaults={
                    "entity_type": "call" if index == 1 else "facility",
                    "fingerprint": hashlib.sha256(f"rejected-{index}".encode()).hexdigest(),
                    "status": "rejected",
                    "issue_codes": [issue],
                    "raw_data": {"notice": "Fictional demonstration row", "field": "redacted"},
                    "normalized_data": {"fictional": True},
                },
            )
        rule_specs = [
            (
                "Seven-day follow-ups",
                "seven-day-follow-ups",
                "Create follow-up work seven days after a relevant call.",
                "After each provider call",
            ),
            (
                "Overdue review notifications",
                "overdue-reviews",
                "Identify open reviews that passed their due date.",
                "Weekdays at 8:00 AM",
            ),
            (
                "Weekly duplicate monitoring",
                "weekly-duplicates",
                "Flag repeated facility and diagnosis calls in the same week.",
                "After each provider call",
            ),
            (
                "Stale availability monitoring",
                "stale-availability",
                "Identify provider evidence older than 30 days.",
                "Daily at 6:00 AM",
            ),
            (
                "Missing coordinate review",
                "missing-coordinates",
                "Flag facilities that cannot participate in radius search.",
                "Nightly",
            ),
            (
                "Weekly report snapshot",
                "weekly-report-snapshot",
                "Save a reproducible weekly activity snapshot.",
                "Mondays at 7:00 AM",
            ),
            (
                "Monthly report snapshot",
                "monthly-report-snapshot",
                "Save a reproducible monthly activity snapshot.",
                "First day of month",
            ),
            (
                "Unresolved import issues",
                "unresolved-import-issues",
                "Surface quarantined rows awaiting administrative review.",
                "After each import",
            ),
            (
                "Facility reconfirmation",
                "facility-reconfirmation",
                "Identify facilities whose network mappings need confirmation.",
                "Every Friday",
            ),
        ]
        for index, (name, slug, purpose, schedule) in enumerate(rule_specs):
            rule, _ = AutomationRule.objects.update_or_create(
                slug=slug,
                defaults={
                    "name": name,
                    "purpose": purpose,
                    "schedule": schedule,
                    "enabled": True,
                    "next_run_at": now + timedelta(hours=12 + index),
                },
            )
            AutomationRun.objects.update_or_create(
                idempotency_key=f"demo:{slug}:{today - timedelta(days=7)}",
                defaults={
                    "rule": rule,
                    "started_at": now - timedelta(days=7, minutes=2),
                    "completed_at": now - timedelta(days=7),
                    "affected_count": (index * 3) % 11,
                    "outcome": "succeeded",
                    "details": {"fictional": True},
                    "triggered_by": admin,
                },
            )
        AuditEvent.objects.filter(metadata__fictional=True).delete()
        for index, action in enumerate(
            [
                "demo.seeded",
                "call.created",
                "review.resolved",
                "report.snapshot",
                "automation.run",
                "import.applied",
            ]
        ):
            AuditEvent.objects.create(
                actor=admin if index % 2 == 0 else ura,
                action=action,
                object_type="DemonstrationRecord",
                object_id=f"demo-{index}",
                summary=f"Fictional demonstration event: {action}",
                metadata={"fictional": True},
            )
        self.stdout.write(
            self.style.SUCCESS(
                "Sanitized demo ready: 30 facilities, 24 authorizations, 68 calls, four role accounts."
            )
        )
        self.stdout.write("Demo usernames: ura.demo, admin.demo, viewer.demo, auditor.demo")
        self.stdout.write(f"Demo password: {DEMO_PASSWORD}")
