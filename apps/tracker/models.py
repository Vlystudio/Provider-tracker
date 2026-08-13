import uuid

from django.conf import settings
from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models


class UUIDModel(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)

    class Meta:
        abstract = True


class TimeStampedModel(models.Model):
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        abstract = True


class NamedReference(UUIDModel):
    name = models.CharField(max_length=160)
    normalized_name = models.CharField(max_length=160, unique=True)
    active = models.BooleanField(default=True, db_index=True)

    class Meta:
        abstract = True
        ordering = ["name"]

    def __str__(self):
        return self.name


class LineOfBusiness(NamedReference):
    code = models.CharField(max_length=24, unique=True)

    class Meta(NamedReference.Meta):
        verbose_name_plural = "lines of business"


class Specialty(NamedReference):
    pass


class Diagnosis(UUIDModel):
    code = models.CharField(max_length=24, unique=True)
    description = models.CharField(max_length=255)
    normalized_description = models.CharField(max_length=255, db_index=True)
    active = models.BooleanField(default=True, db_index=True)

    class Meta:
        ordering = ["code"]
        verbose_name_plural = "diagnoses"

    def __str__(self):
        return f"{self.code} — {self.description}"


class ReferralReason(NamedReference):
    pass


class BookingOutBucket(NamedReference):
    sort_order = models.PositiveSmallIntegerField(default=0)

    class Meta(NamedReference.Meta):
        ordering = ["sort_order", "name"]


class PostalCodeCentroid(UUIDModel):
    postal_code = models.CharField(max_length=5, unique=True)
    latitude = models.DecimalField(
        max_digits=9, decimal_places=6, validators=[MinValueValidator(-90), MaxValueValidator(90)]
    )
    longitude = models.DecimalField(
        max_digits=9, decimal_places=6, validators=[MinValueValidator(-180), MaxValueValidator(180)]
    )
    source_workbook = models.CharField(max_length=255, blank=True)
    source_sheet = models.CharField(max_length=120, blank=True)
    source_row = models.PositiveIntegerField(null=True, blank=True)
    source_file_hash = models.CharField(max_length=64, blank=True)

    class Meta:
        ordering = ["postal_code"]

    def __str__(self):
        return self.postal_code


class Facility(UUIDModel, TimeStampedModel):
    class Quality(models.TextChoices):
        VERIFIED = "verified", "Verified"
        REVIEW = "review", "Needs review"
        MISSING_COORDINATES = "missing_coordinates", "Missing coordinates"
        CONFLICT = "conflict", "Conflicting source records"

    name = models.CharField(max_length=255)
    normalized_name = models.CharField(max_length=255)
    city = models.CharField(max_length=120, blank=True)
    normalized_city = models.CharField(max_length=120, blank=True)
    display_key = models.CharField(max_length=400, unique=True)
    facility_type = models.CharField(max_length=100, default="Hospital", db_index=True)
    phone_display = models.CharField(max_length=80, blank=True)
    phone_normalized = models.CharField(max_length=32, blank=True)
    address_line = models.CharField(max_length=255, blank=True)
    state = models.CharField(max_length=2, blank=True)
    postal_code = models.CharField(max_length=10, blank=True, db_index=True)
    latitude = models.DecimalField(max_digits=9, decimal_places=6, null=True, blank=True)
    longitude = models.DecimalField(max_digits=9, decimal_places=6, null=True, blank=True)
    coordinate_provenance = models.CharField(max_length=80, blank=True)
    data_quality_status = models.CharField(
        max_length=32, choices=Quality.choices, default=Quality.VERIFIED, db_index=True
    )
    active = models.BooleanField(default=True, db_index=True)
    last_reviewed_at = models.DateTimeField(null=True, blank=True)
    source_workbook = models.CharField(max_length=255, blank=True)
    source_sheet = models.CharField(max_length=120, blank=True)
    source_row = models.PositiveIntegerField(null=True, blank=True)
    source_file_hash = models.CharField(max_length=64, blank=True)
    importer_version = models.CharField(max_length=40, blank=True)
    import_fingerprint = models.CharField(max_length=64, blank=True, db_index=True)
    provenance = models.JSONField(default=dict, blank=True)

    class Meta:
        ordering = ["name", "city"]
        constraints = [
            models.UniqueConstraint(
                fields=["normalized_name", "normalized_city"], name="unique_facility_identity"
            )
        ]
        indexes = [
            models.Index(fields=["active", "facility_type"]),
            models.Index(fields=["postal_code", "active"]),
            models.Index(fields=["data_quality_status", "name"]),
        ]

    def __str__(self):
        return self.display_key


class FacilitySpecialty(UUIDModel, TimeStampedModel):
    class Treatment(models.TextChoices):
        YES = "yes", "Yes"
        NO = "no", "No"
        UNKNOWN = "unknown", "Unknown"
        NOT_APPLICABLE = "not_applicable", "N/A"
        TRIAGE = "unable_to_tell_without_triage", "Unable to tell without triage"

    facility = models.ForeignKey(Facility, on_delete=models.CASCADE, related_name="specialty_links")
    specialty = models.ForeignKey(Specialty, on_delete=models.PROTECT, related_name="facility_links")
    treatment_status = models.CharField(max_length=40, choices=Treatment.choices, default=Treatment.UNKNOWN)
    confirmed = models.BooleanField(default=False, db_index=True)
    notes = models.TextField(blank=True)
    last_confirmed_at = models.DateTimeField(null=True, blank=True)
    source_workbook = models.CharField(max_length=255, blank=True)
    source_sheet = models.CharField(max_length=120, blank=True)
    source_row = models.PositiveIntegerField(null=True, blank=True)
    source_file_hash = models.CharField(max_length=64, blank=True)
    import_fingerprint = models.CharField(max_length=64, blank=True, db_index=True)
    provenance = models.JSONField(default=dict, blank=True)

    class Meta:
        ordering = ["facility__name", "specialty__name"]
        constraints = [
            models.UniqueConstraint(fields=["facility", "specialty"], name="unique_facility_specialty")
        ]

    def __str__(self):
        return f"{self.facility} — {self.specialty}"


class Authorization(UUIDModel, TimeStampedModel):
    class Status(models.TextChoices):
        OPEN = "open", "Open"
        COMPLETE = "complete", "Complete"
        CANCELLED = "cancelled", "Cancelled"

    authorization_number = models.CharField(max_length=64, unique=True)
    line_of_business = models.ForeignKey(
        LineOfBusiness, on_delete=models.PROTECT, related_name="authorizations"
    )
    member_postal_code = models.CharField(max_length=5)
    diagnosis = models.ForeignKey(Diagnosis, on_delete=models.PROTECT, related_name="authorizations")
    specialty = models.ForeignKey(Specialty, on_delete=models.PROTECT, related_name="authorizations")
    referral_reason = models.ForeignKey(
        ReferralReason, on_delete=models.PROTECT, related_name="authorizations"
    )
    referral_details = models.TextField(blank=True)
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.OPEN, db_index=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="created_authorizations"
    )

    class Meta:
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["status", "created_at"])]

    def __str__(self):
        return self.authorization_number


class DuplicateCallGroup(UUIDModel, TimeStampedModel):
    group_key = models.CharField(max_length=64, unique=True)
    facility = models.ForeignKey(Facility, on_delete=models.CASCADE, related_name="duplicate_groups")
    diagnosis = models.ForeignKey(Diagnosis, on_delete=models.PROTECT, related_name="duplicate_groups")
    week_start = models.DateField(db_index=True)
    call_count = models.PositiveIntegerField(default=0)
    resolved = models.BooleanField(default=False, db_index=True)
    resolution = models.TextField(blank=True)

    class Meta:
        ordering = ["-week_start", "facility__name"]

    def __str__(self):
        return f"{self.facility} — {self.week_start}"


class ProviderCall(UUIDModel, TimeStampedModel):
    class StatusValue(models.TextChoices):
        YES = "yes", "Yes"
        NO = "no", "No"
        UNKNOWN = "unknown", "Unknown"
        NOT_APPLICABLE = "not_applicable", "N/A"
        TRIAGE = "unable_to_tell_without_triage", "Unable to tell without triage"

    class ScheduleValue(models.TextChoices):
        YES = "yes", "Yes"
        NO = "no", "No"
        UNKNOWN = "unknown", "Unknown"
        NOT_APPLICABLE = "not_applicable", "N/A"
        TRIAGE = "unable_to_tell_without_triage", "Unable to tell without triage"
        URGENT = "urgent_referral_required", "Urgent referral required"

    authorization = models.ForeignKey(Authorization, on_delete=models.CASCADE, related_name="calls")
    facility = models.ForeignKey(Facility, on_delete=models.PROTECT, related_name="calls")
    specialty = models.ForeignKey(Specialty, on_delete=models.PROTECT, related_name="calls")
    diagnosis = models.ForeignKey(Diagnosis, on_delete=models.PROTECT, related_name="calls")
    caller = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="provider_calls"
    )
    call_at = models.DateTimeField(db_index=True)
    phone_snapshot = models.CharField(max_length=80, blank=True)
    did_not_leave_vm = models.BooleanField(default=False)
    accepting_new_patients = models.CharField(
        max_length=40, choices=StatusValue.choices, default=StatusValue.UNKNOWN
    )
    can_treat_diagnosis = models.CharField(
        max_length=40, choices=StatusValue.choices, default=StatusValue.UNKNOWN
    )
    can_schedule_within_four_weeks = models.CharField(
        max_length=40, choices=ScheduleValue.choices, default=ScheduleValue.UNKNOWN
    )
    booking_out_bucket = models.ForeignKey(
        BookingOutBucket, on_delete=models.SET_NULL, null=True, blank=True, related_name="calls"
    )
    booking_out_notes = models.CharField(max_length=160, blank=True)
    urgent_referral_required = models.BooleanField(default=False)
    notes = models.TextField(blank=True)
    referral_type = models.CharField(max_length=120, blank=True)
    out_of_network_reason = models.TextField(blank=True)
    specialty_confirmed = models.BooleanField(default=False)
    use_in_fdm = models.BooleanField(default=False)
    repeat_call_reason = models.TextField(blank=True)
    result_code = models.CharField(max_length=64, editable=False, db_index=True)
    result_phrase = models.CharField(max_length=255, editable=False)
    recommendation = models.CharField(max_length=255, editable=False)
    rule_version = models.CharField(max_length=24, default="2026.1", editable=False)
    duplicate_group = models.ForeignKey(
        DuplicateCallGroup, on_delete=models.SET_NULL, null=True, blank=True, related_name="calls"
    )
    next_review_date = models.DateField(null=True, blank=True, db_index=True)
    source_workbook = models.CharField(max_length=255, blank=True)
    source_sheet = models.CharField(max_length=120, blank=True)
    source_row = models.PositiveIntegerField(null=True, blank=True)
    source_file_hash = models.CharField(max_length=64, blank=True)
    importer_version = models.CharField(max_length=40, blank=True)
    import_fingerprint = models.CharField(max_length=64, blank=True, unique=True, null=True)
    original_cached_result_phrase = models.CharField(max_length=255, blank=True)
    normalization_issues = models.JSONField(default=list, blank=True)

    class Meta:
        ordering = ["-call_at", "facility__name"]
        indexes = [
            models.Index(fields=["facility", "diagnosis", "call_at"]),
            models.Index(fields=["authorization", "result_code"]),
            models.Index(fields=["caller", "call_at"]),
        ]

    def __str__(self):
        return f"{self.authorization} — {self.facility}"

    def save(self, *args, **kwargs):
        from .services.business_rules import calculate_result, seven_day_recommendation

        result = calculate_result(
            did_not_leave_vm=self.did_not_leave_vm,
            accepting=self.accepting_new_patients,
            can_treat=self.can_treat_diagnosis,
            schedule=self.can_schedule_within_four_weeks,
            urgent_referral_required=self.urgent_referral_required,
        )
        self.result_code = result.code
        self.result_phrase = result.phrase
        self.recommendation = seven_day_recommendation(
            facility_present=bool(self.facility_id),
            did_not_leave_vm=self.did_not_leave_vm,
            accepting=self.accepting_new_patients,
            schedule=self.can_schedule_within_four_weeks,
            urgent_referral_required=self.urgent_referral_required,
        )
        super().save(*args, **kwargs)


class ReviewTask(UUIDModel, TimeStampedModel):
    class Priority(models.TextChoices):
        HIGH = "high", "High"
        MEDIUM = "medium", "Medium"
        LOW = "low", "Low"

    class Status(models.TextChoices):
        OPEN = "open", "Open"
        IN_PROGRESS = "in_progress", "In progress"
        RESOLVED = "resolved", "Resolved"
        DISMISSED = "dismissed", "Dismissed"

    task_type = models.CharField(max_length=60, db_index=True)
    title = models.CharField(max_length=255)
    description = models.TextField(blank=True)
    facility = models.ForeignKey(
        Facility, on_delete=models.CASCADE, null=True, blank=True, related_name="review_tasks"
    )
    provider_call = models.ForeignKey(
        ProviderCall, on_delete=models.CASCADE, null=True, blank=True, related_name="review_tasks"
    )
    import_row = models.ForeignKey(
        "ImportRowResult", on_delete=models.SET_NULL, null=True, blank=True, related_name="review_tasks"
    )
    assigned_to = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="assigned_reviews",
    )
    due_date = models.DateField(db_index=True)
    priority = models.CharField(
        max_length=12, choices=Priority.choices, default=Priority.MEDIUM, db_index=True
    )
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.OPEN, db_index=True)
    reviewer_notes = models.TextField(blank=True)
    resolution = models.TextField(blank=True)
    resolved_at = models.DateTimeField(null=True, blank=True)
    automation_key = models.CharField(max_length=255, blank=True, unique=True, null=True)

    class Meta:
        indexes = [models.Index(fields=["status", "due_date", "priority"])]

    def __str__(self):
        return self.title


class ImportBatch(UUIDModel, TimeStampedModel):
    class Status(models.TextChoices):
        PREVIEWED = "previewed", "Previewed"
        APPLIED = "applied", "Applied"
        FAILED = "failed", "Failed"

    source_name = models.CharField(max_length=255)
    source_kind = models.CharField(max_length=16)
    source_hash = models.CharField(max_length=64)
    importer_version = models.CharField(max_length=40)
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.PREVIEWED, db_index=True)
    summary = models.JSONField(default=dict)
    applied_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True)
    applied_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]
        constraints = [
            models.UniqueConstraint(fields=["source_hash", "importer_version"], name="unique_import_batch")
        ]

    def __str__(self):
        return f"{self.source_name} — {self.get_status_display()}"


class ImportRowResult(UUIDModel, TimeStampedModel):
    batch = models.ForeignKey(ImportBatch, on_delete=models.CASCADE, related_name="rows")
    entity_type = models.CharField(max_length=40, db_index=True)
    source_sheet = models.CharField(max_length=120)
    source_row = models.PositiveIntegerField()
    fingerprint = models.CharField(max_length=64, db_index=True)
    status = models.CharField(max_length=20, db_index=True)
    issue_codes = models.JSONField(default=list)
    raw_data = models.JSONField(default=dict)
    normalized_data = models.JSONField(default=dict)

    class Meta:
        ordering = ["source_sheet", "source_row"]
        constraints = [
            models.UniqueConstraint(
                fields=["batch", "source_sheet", "source_row"], name="unique_import_source_row"
            )
        ]

    def __str__(self):
        return f"{self.source_sheet} row {self.source_row} — {self.status}"


class AuditEvent(UUIDModel):
    occurred_at = models.DateTimeField(auto_now_add=True, db_index=True)
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True)
    action = models.CharField(max_length=80, db_index=True)
    object_type = models.CharField(max_length=80)
    object_id = models.CharField(max_length=64, blank=True)
    summary = models.CharField(max_length=255)
    metadata = models.JSONField(default=dict, blank=True)
    ip_address = models.GenericIPAddressField(null=True, blank=True)

    class Meta:
        ordering = ["-occurred_at"]

    def __str__(self):
        return f"{self.action} — {self.summary}"


class ReportSnapshot(UUIDModel):
    report_type = models.CharField(max_length=60, db_index=True)
    period_start = models.DateField()
    period_end = models.DateField()
    metrics = models.JSONField(default=dict)
    generated_at = models.DateTimeField(auto_now_add=True)
    generated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True
    )
    source_fingerprint = models.CharField(max_length=64, unique=True)

    class Meta:
        ordering = ["-generated_at"]

    def __str__(self):
        return f"{self.report_type} — {self.period_start} to {self.period_end}"


class AutomationRule(UUIDModel, TimeStampedModel):
    name = models.CharField(max_length=160, unique=True)
    slug = models.SlugField(max_length=160, unique=True)
    purpose = models.TextField()
    schedule = models.CharField(max_length=120)
    enabled = models.BooleanField(default=True, db_index=True)
    next_run_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return self.name


class AutomationRun(UUIDModel):
    class Outcome(models.TextChoices):
        SUCCEEDED = "succeeded", "Succeeded"
        FAILED = "failed", "Failed"
        NO_CHANGE = "no_change", "No change"

    rule = models.ForeignKey(AutomationRule, on_delete=models.CASCADE, related_name="runs")
    started_at = models.DateTimeField()
    completed_at = models.DateTimeField(null=True, blank=True)
    affected_count = models.PositiveIntegerField(default=0)
    outcome = models.CharField(max_length=20, choices=Outcome.choices)
    error_message = models.CharField(max_length=255, blank=True)
    details = models.JSONField(default=dict, blank=True)
    triggered_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True
    )
    idempotency_key = models.CharField(max_length=255, unique=True)

    class Meta:
        ordering = ["-started_at"]

    def __str__(self):
        return f"{self.rule} — {self.get_outcome_display()}"
