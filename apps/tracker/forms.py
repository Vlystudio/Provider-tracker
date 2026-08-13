import re

from django import forms
from django.utils import timezone

from .models import (
    BookingOutBucket,
    Diagnosis,
    Facility,
    LineOfBusiness,
    ProviderCall,
    ReferralReason,
    Specialty,
)
from .services.business_rules import weekly_duplicate_key


class StyledFormMixin:
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        for field in self.fields.values():
            css = "checkbox" if isinstance(field.widget, forms.CheckboxInput) else "input"
            field.widget.attrs.setdefault("class", css)


class AuthorizationCallForm(StyledFormMixin, forms.Form):
    authorization_number = forms.CharField(
        max_length=64, help_text="Use the authorization identifier—not a member name."
    )
    line_of_business = forms.ModelChoiceField(queryset=LineOfBusiness.objects.none())
    member_postal_code = forms.CharField(max_length=5, min_length=5, label="Member ZIP")
    diagnosis = forms.ModelChoiceField(queryset=Diagnosis.objects.none())
    specialty = forms.ModelChoiceField(queryset=Specialty.objects.none())
    referral_reason = forms.ModelChoiceField(queryset=ReferralReason.objects.none())
    referral_details = forms.CharField(widget=forms.Textarea(attrs={"rows": 2}), required=False)
    facility = forms.ModelChoiceField(queryset=Facility.objects.none())
    facility_phone = forms.CharField(max_length=80, required=False)
    call_at = forms.DateTimeField(
        widget=forms.DateTimeInput(attrs={"type": "datetime-local"}), initial=timezone.now
    )
    did_not_leave_vm = forms.BooleanField(required=False, label="Unable to contact; did not leave voicemail")
    accepting_new_patients = forms.ChoiceField(choices=ProviderCall.StatusValue.choices)
    can_treat_diagnosis = forms.ChoiceField(choices=ProviderCall.StatusValue.choices)
    can_schedule_within_four_weeks = forms.ChoiceField(choices=ProviderCall.ScheduleValue.choices)
    booking_out_bucket = forms.ModelChoiceField(queryset=BookingOutBucket.objects.none(), required=False)
    booking_out_notes = forms.CharField(max_length=160, required=False)
    urgent_referral_required = forms.BooleanField(required=False)
    notes = forms.CharField(widget=forms.Textarea(attrs={"rows": 3}), required=False)
    referral_type = forms.CharField(max_length=120, required=False)
    out_of_network_reason = forms.CharField(widget=forms.Textarea(attrs={"rows": 2}), required=False)
    specialty_confirmed = forms.BooleanField(required=False)
    use_in_fdm = forms.BooleanField(required=False, label="Mark for FDM review")
    repeat_call_reason = forms.CharField(
        widget=forms.Textarea(attrs={"rows": 2}),
        required=False,
        help_text="Required only when the same facility and diagnosis already have a call this week.",
    )

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.fields["line_of_business"].queryset = LineOfBusiness.objects.filter(active=True)
        self.fields["diagnosis"].queryset = Diagnosis.objects.filter(active=True)
        self.fields["specialty"].queryset = Specialty.objects.filter(active=True)
        self.fields["referral_reason"].queryset = ReferralReason.objects.filter(active=True)
        self.fields["booking_out_bucket"].queryset = BookingOutBucket.objects.filter(active=True)
        self.fields["facility"].queryset = Facility.objects.filter(active=True)

    def clean_member_postal_code(self):
        value = self.cleaned_data["member_postal_code"].strip()
        if not re.fullmatch(r"\d{5}", value):
            raise forms.ValidationError("Enter a five-digit ZIP code.")
        return value

    def clean(self):
        cleaned = super().clean()
        facility = cleaned.get("facility")
        diagnosis = cleaned.get("diagnosis")
        call_at = cleaned.get("call_at")
        if facility and diagnosis and call_at:
            key = weekly_duplicate_key(facility.pk, diagnosis.pk, call_at)
            existing = ProviderCall.objects.filter(duplicate_group__group_key=key).exists()
            if existing and not cleaned.get("repeat_call_reason", "").strip():
                self.add_error(
                    "repeat_call_reason",
                    "A call already exists for this facility and diagnosis this week. "
                    "Record why this repeat is legitimate.",
                )
        if cleaned.get("did_not_leave_vm"):
            cleaned["accepting_new_patients"] = ProviderCall.StatusValue.UNKNOWN
            cleaned["can_treat_diagnosis"] = ProviderCall.StatusValue.UNKNOWN
            cleaned["can_schedule_within_four_weeks"] = ProviderCall.ScheduleValue.UNKNOWN
        return cleaned


class ProviderSearchForm(StyledFormMixin, forms.Form):
    member_postal_code = forms.CharField(max_length=5, min_length=5, label="Member ZIP")
    radius = forms.TypedChoiceField(
        choices=[(10, "10 miles"), (25, "25 miles"), (50, "50 miles"), (100, "100 miles")],
        coerce=int,
        initial=25,
    )
    diagnosis = forms.ModelChoiceField(queryset=Diagnosis.objects.none(), required=False)
    specialty = forms.ModelChoiceField(queryset=Specialty.objects.none(), required=False)
    facility_type = forms.ChoiceField(required=False)
    accepting_status = forms.ChoiceField(
        required=False, choices=[("", "Any accepting status"), *ProviderCall.StatusValue.choices]
    )
    scheduling_status = forms.ChoiceField(
        required=False, choices=[("", "Any scheduling status"), *ProviderCall.ScheduleValue.choices]
    )
    last_verified_days = forms.TypedChoiceField(
        required=False,
        coerce=int,
        choices=[
            ("", "Any verification date"),
            (30, "Within 30 days"),
            (60, "Within 60 days"),
            (90, "Within 90 days"),
        ],
    )
    data_quality_status = forms.ChoiceField(
        required=False, choices=[("", "Any data quality"), *Facility.Quality.choices]
    )

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.fields["diagnosis"].queryset = Diagnosis.objects.filter(active=True)
        self.fields["specialty"].queryset = Specialty.objects.filter(active=True)
        types = Facility.objects.order_by().values_list("facility_type", flat=True).distinct()
        self.fields["facility_type"].choices = [
            ("", "Any facility type"),
            *((value, value) for value in types if value),
        ]

    def clean_member_postal_code(self):
        value = self.cleaned_data["member_postal_code"].strip()
        if not re.fullmatch(r"\d{5}", value):
            raise forms.ValidationError("Enter a five-digit ZIP code.")
        from .models import PostalCodeCentroid

        if not PostalCodeCentroid.objects.filter(postal_code=value).exists():
            raise forms.ValidationError("This ZIP code has no coordinate record.")
        return value

    def clean(self):
        cleaned = super().clean()
        if bool(cleaned.get("diagnosis")) == bool(cleaned.get("specialty")):
            raise forms.ValidationError("Choose exactly one diagnosis or one specialty.")
        return cleaned


class CallLogFilterForm(StyledFormMixin, forms.Form):
    authorization = forms.CharField(required=False)
    facility = forms.CharField(required=False)
    diagnosis = forms.ModelChoiceField(queryset=Diagnosis.objects.none(), required=False)
    specialty = forms.ModelChoiceField(queryset=Specialty.objects.none(), required=False)
    result = forms.ChoiceField(
        required=False,
        choices=[
            ("", "Any result"),
            ("meets_availability_guidelines", "Meets guidelines"),
            ("meets_availability_guidelines_urgent", "Meets with urgent referral"),
            ("does_not_meet_availability_guidelines", "Does not meet"),
            ("unable_to_contact", "Unable to contact"),
        ],
    )
    caller = forms.ChoiceField(required=False)
    start = forms.DateField(required=False, widget=forms.DateInput(attrs={"type": "date"}))
    end = forms.DateField(required=False, widget=forms.DateInput(attrs={"type": "date"}))

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.fields["diagnosis"].queryset = Diagnosis.objects.filter(active=True)
        self.fields["specialty"].queryset = Specialty.objects.filter(active=True)
        callers = (
            ProviderCall.objects.select_related("caller")
            .values_list("caller_id", "caller__username")
            .distinct()
        )
        self.fields["caller"].choices = [("", "Any caller"), *callers]

    def clean(self):
        cleaned = super().clean()
        if cleaned.get("start") and cleaned.get("end") and cleaned["start"] > cleaned["end"]:
            raise forms.ValidationError("Start date must be on or before end date.")
        return cleaned


class AuthorizationLookupForm(StyledFormMixin, forms.Form):
    authorization_number = forms.CharField(max_length=64)


class ReviewResolutionForm(StyledFormMixin, forms.Form):
    status = forms.ChoiceField(choices=[("resolved", "Resolved"), ("dismissed", "Dismissed")])
    reviewer_notes = forms.CharField(widget=forms.Textarea(attrs={"rows": 3}))
    resolution = forms.CharField(widget=forms.Textarea(attrs={"rows": 3}))


class ImportUploadForm(StyledFormMixin, forms.Form):
    workbook_kind = forms.ChoiceField(choices=[("admin", "Admin master"), ("user", "User active")])
    workbook = forms.FileField(help_text="Accepted formats: .xlsx and .xlsm; maximum 100 MB.")

    def clean_workbook(self):
        upload = self.cleaned_data["workbook"]
        if not upload.name.lower().endswith((".xlsx", ".xlsm")):
            raise forms.ValidationError("Upload an XLSX or XLSM workbook.")
        if upload.size > 100 * 1024 * 1024:
            raise forms.ValidationError("Workbook exceeds the 100 MB upload limit.")
        if not upload.read(4).startswith(b"PK"):
            raise forms.ValidationError("The file is not a valid Office Open XML workbook.")
        upload.seek(0)
        upload.name = re.sub(r"[^A-Za-z0-9._-]", "_", upload.name)
        return upload


class ReportFilterForm(StyledFormMixin, forms.Form):
    start = forms.DateField(required=False, widget=forms.DateInput(attrs={"type": "date"}))
    end = forms.DateField(required=False, widget=forms.DateInput(attrs={"type": "date"}))
    line_of_business = forms.ModelChoiceField(queryset=LineOfBusiness.objects.none(), required=False)
    specialty = forms.ModelChoiceField(queryset=Specialty.objects.none(), required=False)
    caller = forms.ChoiceField(required=False)

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.fields["line_of_business"].queryset = LineOfBusiness.objects.filter(active=True)
        self.fields["specialty"].queryset = Specialty.objects.filter(active=True)
        callers = (
            ProviderCall.objects.select_related("caller")
            .values_list("caller_id", "caller__username")
            .distinct()
        )
        self.fields["caller"].choices = [("", "Any caller"), *callers]
