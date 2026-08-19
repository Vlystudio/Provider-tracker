from datetime import timedelta

from django.db import transaction
from django.utils import timezone

from ..models import AutomationRun, ProviderCall, ReportSnapshot, ReviewTask
from .business_rules import next_review_date
from .reports import report_metrics, save_snapshot


@transaction.atomic
def run_automation(rule, *, actor=None, run_date=None):
    """Run a scheduled rule once per date, returning the existing run on retries."""
    run_date = run_date or timezone.localdate()
    key = f"{rule.slug}:{run_date.isoformat()}"
    existing = AutomationRun.objects.filter(idempotency_key=key).first()
    if existing:
        return existing, False
    started = timezone.now()
    affected = 0
    details = {}
    if rule.slug == "seven-day-follow-ups":
        for call in ProviderCall.objects.filter(next_review_date__isnull=True).select_related("facility"):
            call.next_review_date = next_review_date(call.call_at)
            call.save(update_fields=["next_review_date", "result_code", "result_phrase", "recommendation"])
            _, created = ReviewTask.objects.get_or_create(
                automation_key=f"follow-up:{call.pk}",
                defaults={
                    "task_type": "seven_day_follow_up",
                    "title": f"Follow up with {call.facility.name}",
                    "description": call.recommendation,
                    "facility": call.facility,
                    "provider_call": call,
                    "due_date": call.next_review_date,
                },
            )
            affected += int(created)
    elif rule.slug == "overdue-reviews":
        affected = ReviewTask.objects.filter(status="open", due_date__lt=run_date).count()
        details["message"] = f"{affected} overdue review(s) ready for notification delivery."
    elif rule.slug == "stale-availability":
        cutoff = timezone.now() - timedelta(days=30)
        affected = ProviderCall.objects.filter(call_at__lt=cutoff).values("facility_id").distinct().count()
    elif rule.slug == "missing-coordinates":
        from ..models import Facility

        affected = Facility.objects.filter(latitude__isnull=True).count()
    elif rule.slug in {"weekly-report-snapshot", "monthly-report-snapshot"}:
        days = 6 if rule.slug.startswith("weekly") else 29
        metrics = report_metrics(start=run_date - timedelta(days=days), end=run_date)
        before = ReportSnapshot.objects.count()
        snapshot = save_snapshot(report_type=rule.slug, metrics=metrics, actor=actor)
        affected = int(ReportSnapshot.objects.count() > before)
        details["snapshot_id"] = str(snapshot.pk)
    else:
        details["message"] = "Rule evaluated safely; no new records required."
    run = AutomationRun.objects.create(
        rule=rule,
        started_at=started,
        completed_at=timezone.now(),
        affected_count=affected,
        outcome="succeeded" if affected else "no_change",
        details=details,
        triggered_by=actor,
        idempotency_key=key,
    )
    return run, True
