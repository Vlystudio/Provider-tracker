from django.db import transaction
from django.utils import timezone

from ..models import AuditEvent, Authorization, DuplicateCallGroup, ProviderCall, ReviewTask
from .business_rules import call_fingerprint, next_review_date, week_start, weekly_duplicate_key


def client_ip(request):
    forwarded = request.META.get("HTTP_X_FORWARDED_FOR", "")
    return forwarded.split(",")[0].strip() if forwarded else request.META.get("REMOTE_ADDR")


def audit(*, actor, action, instance, summary, request=None, metadata=None):
    return AuditEvent.objects.create(
        actor=actor if getattr(actor, "is_authenticated", False) else None,
        action=action,
        object_type=instance.__class__.__name__,
        object_id=str(instance.pk),
        summary=summary,
        metadata=metadata or {},
        ip_address=client_ip(request) if request else None,
    )


@transaction.atomic
def create_authorization_call(cleaned_data, *, actor, request=None):
    authorization, created = Authorization.objects.get_or_create(
        authorization_number=cleaned_data["authorization_number"].strip().upper(),
        defaults={
            "line_of_business": cleaned_data["line_of_business"],
            "member_postal_code": cleaned_data["member_postal_code"],
            "diagnosis": cleaned_data["diagnosis"],
            "specialty": cleaned_data["specialty"],
            "referral_reason": cleaned_data["referral_reason"],
            "referral_details": cleaned_data.get("referral_details", ""),
            "created_by": actor,
        },
    )
    call_at = cleaned_data["call_at"]
    facility = cleaned_data["facility"]
    diagnosis = cleaned_data["diagnosis"]
    group_key = weekly_duplicate_key(facility.pk, diagnosis.pk, call_at)
    duplicate_group, _ = DuplicateCallGroup.objects.get_or_create(
        group_key=group_key,
        defaults={"facility": facility, "diagnosis": diagnosis, "week_start": week_start(call_at)},
    )
    fingerprint = call_fingerprint(
        caller_initials=getattr(actor.profile, "initials", actor.username),
        call_at=call_at,
        authorization_number=authorization.authorization_number,
        facility_key=facility.display_key,
        specialty=cleaned_data["specialty"].name,
        diagnosis=diagnosis.code,
    )
    provider_call = ProviderCall.objects.create(
        authorization=authorization,
        facility=facility,
        specialty=cleaned_data["specialty"],
        diagnosis=diagnosis,
        caller=actor,
        call_at=call_at,
        phone_snapshot=cleaned_data.get("facility_phone") or facility.phone_display,
        did_not_leave_vm=cleaned_data.get("did_not_leave_vm", False),
        accepting_new_patients=cleaned_data["accepting_new_patients"],
        can_treat_diagnosis=cleaned_data["can_treat_diagnosis"],
        can_schedule_within_four_weeks=cleaned_data["can_schedule_within_four_weeks"],
        booking_out_bucket=cleaned_data.get("booking_out_bucket"),
        booking_out_notes=cleaned_data.get("booking_out_notes", ""),
        urgent_referral_required=cleaned_data.get("urgent_referral_required", False),
        notes=cleaned_data.get("notes", ""),
        referral_type=cleaned_data.get("referral_type", ""),
        out_of_network_reason=cleaned_data.get("out_of_network_reason", ""),
        specialty_confirmed=cleaned_data.get("specialty_confirmed", False),
        use_in_fdm=cleaned_data.get("use_in_fdm", False),
        repeat_call_reason=cleaned_data.get("repeat_call_reason", ""),
        duplicate_group=duplicate_group,
        next_review_date=next_review_date(call_at),
        import_fingerprint=fingerprint,
    )
    duplicate_group.call_count = duplicate_group.calls.count()
    duplicate_group.save(update_fields=["call_count", "updated_at"])
    ReviewTask.objects.get_or_create(
        automation_key=f"follow-up:{provider_call.pk}",
        defaults={
            "task_type": "seven_day_follow_up",
            "title": f"Follow up with {facility.name}",
            "description": provider_call.recommendation,
            "facility": facility,
            "provider_call": provider_call,
            "due_date": provider_call.next_review_date,
            "priority": ReviewTask.Priority.MEDIUM,
        },
    )
    if duplicate_group.call_count > 1:
        ReviewTask.objects.get_or_create(
            automation_key=f"duplicate:{group_key}",
            defaults={
                "task_type": "weekly_duplicate",
                "title": f"Review repeated call to {facility.name}",
                "description": "Multiple calls share the facility, diagnosis, and week.",
                "facility": facility,
                "provider_call": provider_call,
                "due_date": timezone.localdate(),
                "priority": ReviewTask.Priority.HIGH,
            },
        )
    audit(
        actor=actor,
        action="call.created",
        instance=provider_call,
        summary=f"Recorded provider call for {authorization.authorization_number}",
        request=request,
        metadata={"result_code": provider_call.result_code, "authorization_created": created},
    )
    return authorization, provider_call
