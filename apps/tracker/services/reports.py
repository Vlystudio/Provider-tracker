import hashlib
import json
from datetime import timedelta

from django.db.models import Count, Q
from django.utils import timezone

from ..models import ProviderCall, ReportSnapshot, ReviewTask

SUCCESS_CODES = {"meets_availability_guidelines", "meets_availability_guidelines_urgent"}


def report_metrics(*, start=None, end=None, line_of_business=None, specialty=None, caller=None):
    end = end or timezone.localdate()
    start = start or end - timedelta(days=29)
    calls = ProviderCall.objects.filter(call_at__date__range=(start, end))
    if line_of_business:
        calls = calls.filter(authorization__line_of_business=line_of_business)
    if specialty:
        calls = calls.filter(specialty=specialty)
    if caller:
        calls = calls.filter(caller=caller)
    total = calls.count()
    successful = calls.filter(result_code__in=SUCCESS_CODES).count()
    unable = calls.filter(result_code="unable_to_contact").count()
    urgent = calls.filter(result_code="meets_availability_guidelines_urgent").count()
    by_day = list(
        calls.extra(select={"period": "date(call_at)"})
        .values("period")
        .annotate(total=Count("id"), successful=Count("id", filter=Q(result_code__in=SUCCESS_CODES)))
        .order_by("period")
    )
    by_specialty = list(calls.values("specialty__name").annotate(total=Count("id")).order_by("-total")[:8])
    return {
        "period_start": start.isoformat(),
        "period_end": end.isoformat(),
        "total_calls": total,
        "successful_calls": successful,
        "success_rate": round(successful / total * 100, 1) if total else 0,
        "success_denominator": total,
        "unable_to_contact": unable,
        "unable_rate": round(unable / total * 100, 1) if total else 0,
        "urgent_referral_successes": urgent,
        "open_reviews": ReviewTask.objects.exclude(status__in=["resolved", "dismissed"]).count(),
        "by_day": by_day,
        "chart_days": by_day[-10:],
        "by_specialty": by_specialty,
    }


def save_snapshot(*, report_type, metrics, actor=None):
    payload = json.dumps({"report_type": report_type, "metrics": metrics}, sort_keys=True, default=str)
    fingerprint = hashlib.sha256(payload.encode()).hexdigest()
    snapshot, _ = ReportSnapshot.objects.get_or_create(
        source_fingerprint=fingerprint,
        defaults={
            "report_type": report_type,
            "period_start": metrics["period_start"],
            "period_end": metrics["period_end"],
            "metrics": metrics,
            "generated_by": actor,
        },
    )
    return snapshot
