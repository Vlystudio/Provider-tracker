from datetime import datetime
from decimal import Decimal

import pytest
from django.contrib.auth import get_user_model
from django.utils import timezone

from apps.accounts.models import UserProfile
from apps.tracker.models import (
    Authorization,
    BookingOutBucket,
    Diagnosis,
    Facility,
    FacilitySpecialty,
    LineOfBusiness,
    PostalCodeCentroid,
    ReferralReason,
    Specialty,
)


@pytest.fixture
def domain(db):
    user_model = get_user_model()
    users = {}
    for role, username, initials in [
        (UserProfile.Role.ADMINISTRATOR, "admin", "AD"),
        (UserProfile.Role.URA_USER, "ura", "UR"),
        (UserProfile.Role.REPORT_VIEWER, "viewer", "RV"),
        (UserProfile.Role.AUDITOR, "auditor", "AU"),
    ]:
        user = user_model.objects.create_user(username=username, password="TestPass!2026")
        UserProfile.objects.create(user=user, initials=initials, role=role, display_name=username.title())
        users[role] = user
    lob = LineOfBusiness.objects.create(name="Commercial", normalized_name="commercial", code="COMM")
    specialty = Specialty.objects.create(name="Behavioral Health", normalized_name="behavioral health")
    diagnosis = Diagnosis.objects.create(
        code="F41.1", description="Generalized anxiety", normalized_description="generalized anxiety"
    )
    referral = ReferralReason.objects.create(name="Network access", normalized_name="network access")
    booking = BookingOutBucket.objects.create(name="1–2 weeks", normalized_name="1-2 weeks", sort_order=1)
    PostalCodeCentroid.objects.create(
        postal_code="02108", latitude=Decimal("42.3570"), longitude=Decimal("-71.0637")
    )
    facility = Facility.objects.create(
        name="North River Health Center",
        normalized_name="north river health center",
        city="Boston",
        normalized_city="boston",
        display_key="North River Health Center | Boston",
        phone_display="(617) 555-0100",
        phone_normalized="6175550100",
        postal_code="02108",
        latitude=Decimal("42.3590"),
        longitude=Decimal("-71.0600"),
    )
    FacilitySpecialty.objects.create(
        facility=facility, specialty=specialty, treatment_status="yes", confirmed=True
    )
    authorization = Authorization.objects.create(
        authorization_number="TEST-1001",
        line_of_business=lob,
        member_postal_code="02108",
        diagnosis=diagnosis,
        specialty=specialty,
        referral_reason=referral,
        created_by=users[UserProfile.Role.URA_USER],
    )
    return {
        "users": users,
        "lob": lob,
        "specialty": specialty,
        "diagnosis": diagnosis,
        "referral": referral,
        "booking": booking,
        "facility": facility,
        "authorization": authorization,
        "now": timezone.make_aware(datetime(2026, 8, 12, 10, 0)),
    }


@pytest.fixture
def valid_call_data(domain):
    return {
        "authorization_number": "TEST-2001",
        "line_of_business": domain["lob"].pk,
        "member_postal_code": "02108",
        "diagnosis": domain["diagnosis"].pk,
        "specialty": domain["specialty"].pk,
        "referral_reason": domain["referral"].pk,
        "referral_details": "Fictional test referral",
        "facility": domain["facility"].pk,
        "facility_phone": "(617) 555-0100",
        "call_at": "2026-08-12T10:00",
        "accepting_new_patients": "yes",
        "can_treat_diagnosis": "yes",
        "can_schedule_within_four_weeks": "yes",
        "booking_out_bucket": domain["booking"].pk,
        "booking_out_notes": "Two weeks",
        "notes": "Fictional test note",
        "referral_type": "Standard",
    }
