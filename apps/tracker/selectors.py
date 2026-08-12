from datetime import timedelta

from django.db.models import Prefetch
from django.utils import timezone

from .models import Facility, ProviderCall
from .services.distance import distance_repository


def provider_search(cleaned):
    calls = ProviderCall.objects.select_related("facility", "specialty", "diagnosis").order_by("-call_at")
    facilities = Facility.objects.filter(active=True)
    diagnosis = cleaned.get("diagnosis")
    specialty = cleaned.get("specialty")
    if diagnosis:
        facilities = facilities.filter(calls__diagnosis=diagnosis).distinct()
        calls = calls.filter(diagnosis=diagnosis)
    else:
        facilities = facilities.filter(specialty_links__specialty=specialty).distinct()
        calls = calls.filter(specialty=specialty)
    if cleaned.get("facility_type"):
        facilities = facilities.filter(facility_type=cleaned["facility_type"])
    if cleaned.get("data_quality_status"):
        facilities = facilities.filter(data_quality_status=cleaned["data_quality_status"])
    if cleaned.get("accepting_status"):
        calls = calls.filter(accepting_new_patients=cleaned["accepting_status"])
    if cleaned.get("scheduling_status"):
        calls = calls.filter(can_schedule_within_four_weeks=cleaned["scheduling_status"])
    if cleaned.get("last_verified_days"):
        calls = calls.filter(call_at__gte=timezone.now() - timedelta(days=cleaned["last_verified_days"]))
    facilities = facilities.prefetch_related(Prefetch("calls", queryset=calls, to_attr="matching_calls"))
    distances = distance_repository().search(
        postal_code=cleaned["member_postal_code"], radius=cleaned["radius"], queryset=facilities
    )
    results = []
    for item in distances:
        latest = item.facility.matching_calls[0] if item.facility.matching_calls else None
        results.append({"facility": item.facility, "distance": item.miles, "latest": latest})
    return results


def filtered_calls(cleaned):
    queryset = ProviderCall.objects.select_related(
        "authorization", "facility", "diagnosis", "specialty", "caller", "booking_out_bucket"
    )
    if cleaned.get("authorization"):
        queryset = queryset.filter(authorization__authorization_number__icontains=cleaned["authorization"])
    if cleaned.get("facility"):
        queryset = queryset.filter(facility__name__icontains=cleaned["facility"])
    for field in ("diagnosis", "specialty"):
        if cleaned.get(field):
            queryset = queryset.filter(**{field: cleaned[field]})
    if cleaned.get("result"):
        queryset = queryset.filter(result_code=cleaned["result"])
    if cleaned.get("caller"):
        queryset = queryset.filter(caller_id=cleaned["caller"])
    if cleaned.get("start"):
        queryset = queryset.filter(call_at__date__gte=cleaned["start"])
    if cleaned.get("end"):
        queryset = queryset.filter(call_at__date__lte=cleaned["end"])
    sort = cleaned.get("sort", "-call_at")
    return queryset.order_by(
        sort
        if sort in {"call_at", "-call_at", "facility__name", "-facility__name", "result_code", "-result_code"}
        else "-call_at"
    )
