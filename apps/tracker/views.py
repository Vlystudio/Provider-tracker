import tempfile
from datetime import timedelta

from django.conf import settings
from django.contrib import messages
from django.contrib.auth import get_user_model, login
from django.core.exceptions import PermissionDenied
from django.core.paginator import Paginator
from django.db import connections
from django.db.models import Count, Q
from django.http import Http404, JsonResponse
from django.shortcuts import get_object_or_404, redirect, render
from django.urls import reverse
from django.utils import timezone
from django.views.decorators.http import require_http_methods, require_POST

from .exports import (
    authorization_pdf_response,
    calls_csv_response,
    calls_excel_response,
    report_excel_response,
)
from .forms import (
    AuthorizationCallForm,
    AuthorizationLookupForm,
    CallLogFilterForm,
    ImportUploadForm,
    ProviderSearchForm,
    ReportFilterForm,
    ReviewResolutionForm,
)
from .models import (
    AuditEvent,
    Authorization,
    AutomationRule,
    Facility,
    ImportBatch,
    ImportRowResult,
    ProviderCall,
    ReportSnapshot,
    ReviewTask,
)
from .permissions import ADMIN, AUDITOR, URA, VIEWER, role_required
from .selectors import filtered_calls
from .selectors import provider_search as search_providers
from .services.automations import run_automation
from .services.business_rules import authorization_narrative
from .services.importer import apply_plan, parse_workbook, reconcile, safe_summary
from .services.reports import report_metrics, save_snapshot
from .services.workflows import audit, create_authorization_call


def health_live(request):
    return JsonResponse({"status": "ok"})


def health_ready(request):
    try:
        with connections["default"].cursor() as cursor:
            cursor.execute("SELECT 1")
            cursor.fetchone()
    except Exception:
        return JsonResponse({"status": "unavailable"}, status=503)
    return JsonResponse({"status": "ready"})


def landing(request):
    if request.user.is_authenticated:
        return redirect("dashboard")
    return render(request, "tracker/landing.html")


@require_POST
def demo_login(request, role):
    if not settings.DEMO_MODE or not settings.DEBUG:
        raise PermissionDenied("Demo sign-in is not available.")
    usernames = {
        "ura": "ura.demo",
        "administrator": "admin.demo",
        "viewer": "viewer.demo",
        "auditor": "auditor.demo",
    }
    if role not in usernames:
        raise Http404
    user = get_object_or_404(get_user_model(), username=usernames[role], is_active=True)
    login(request, user, backend="django.contrib.auth.backends.ModelBackend")
    messages.success(request, f"Signed in with the {user.profile.get_role_display()} demo account.")
    return redirect("dashboard")


@role_required(ADMIN, URA, VIEWER, AUDITOR)
def dashboard(request):
    today = timezone.localdate()
    start = today - timedelta(days=today.weekday())
    calls = ProviderCall.objects.filter(call_at__date__range=(start, today))
    total = calls.count()
    success = calls.filter(
        result_code__in=["meets_availability_guidelines", "meets_availability_guidelines_urgent"]
    ).count()
    metrics = {
        "calls": total,
        "success": success,
        "success_rate": round(success / total * 100, 1) if total else 0,
        "open_reviews": ReviewTask.objects.exclude(status__in=["resolved", "dismissed"]).count(),
        "overdue_reviews": ReviewTask.objects.exclude(status__in=["resolved", "dismissed"])
        .filter(due_date__lt=today)
        .count(),
        "duplicates": ProviderCall.objects.filter(
            duplicate_group__call_count__gt=1, duplicate_group__resolved=False
        )
        .values("duplicate_group")
        .distinct()
        .count(),
        "import_issues": ImportRowResult.objects.filter(status="rejected").count(),
        "facility_review": Facility.objects.exclude(data_quality_status=Facility.Quality.VERIFIED).count(),
        "period": f"{start:%b %d}–{today:%b %d, %Y}",
        "denominator": total,
    }
    trend = []
    for offset in range(5, -1, -1):
        week_end = today - timedelta(days=today.weekday() + 7 * offset)
        week_start = week_end - timedelta(days=6)
        weekly = ProviderCall.objects.filter(call_at__date__range=(week_start, week_end))
        weekly_total = weekly.count()
        weekly_success = weekly.filter(
            result_code__in=["meets_availability_guidelines", "meets_availability_guidelines_urgent"]
        ).count()
        trend.append(
            {
                "label": week_end.strftime("%b %d"),
                "total": weekly_total,
                "success": weekly_success,
                "height": min(100, weekly_total * 8),
            }
        )
    context = {
        "metrics": metrics,
        "trend": trend,
        "reviews": ReviewTask.objects.exclude(status__in=["resolved", "dismissed"])
        .select_related("facility")
        .order_by("due_date")[:5],
        "authorizations": Authorization.objects.select_related("diagnosis", "specialty")
        .annotate(call_count=Count("calls"))
        .order_by("-created_at")[:5],
        "automations": AutomationRule.objects.filter(enabled=True).order_by("next_run_at")[:4],
    }
    return render(request, "tracker/dashboard.html", context)


@role_required(ADMIN, URA)
@require_http_methods(["GET", "POST"])
def new_call(request):
    initial = {"call_at": timezone.localtime().strftime("%Y-%m-%dT%H:%M")}
    for field in ("facility", "diagnosis", "specialty"):
        if request.GET.get(field):
            initial[field] = request.GET[field]
    form = AuthorizationCallForm(request.POST or None, initial=initial)
    recent_calls = ProviderCall.objects.select_related("facility", "authorization", "diagnosis").order_by(
        "-call_at"
    )[:6]
    if request.method == "POST" and form.is_valid():
        authorization, provider_call = create_authorization_call(
            form.cleaned_data, actor=request.user, request=request
        )
        messages.success(request, f"Call saved. Result: {provider_call.result_phrase}.")
        return redirect(
            f"{reverse('authorization_detail', args=[authorization.pk])}?saved={provider_call.pk}"
        )
    return render(request, "tracker/new_call.html", {"form": form, "recent_calls": recent_calls})


@role_required(ADMIN, URA, VIEWER)
def provider_search(request):
    form = ProviderSearchForm(request.GET or None)
    results = []
    searched = bool(request.GET)
    if form.is_valid():
        results = search_providers(form.cleaned_data)
    page = Paginator(results, 12).get_page(request.GET.get("page"))
    return render(request, "tracker/provider_search.html", {"form": form, "page": page, "searched": searched})


@role_required(ADMIN, URA, VIEWER, AUDITOR)
def call_log(request):
    form = CallLogFilterForm(request.GET or None)
    queryset = filtered_calls(form.cleaned_data) if form.is_valid() else ProviderCall.objects.none()
    export = request.GET.get("export")
    if export == "csv":
        return calls_csv_response(queryset)
    if export == "xlsx":
        return calls_excel_response(queryset)
    page = Paginator(queryset, 25).get_page(request.GET.get("page"))
    return render(request, "tracker/call_log.html", {"form": form, "page": page})


@role_required(ADMIN, URA, VIEWER, AUDITOR)
def authorization_summary(request):
    form = AuthorizationLookupForm(request.GET or None)
    if form.is_valid():
        authorization = Authorization.objects.filter(
            authorization_number__iexact=form.cleaned_data["authorization_number"]
        ).first()
        if authorization:
            return redirect("authorization_detail", pk=authorization.pk)
        form.add_error("authorization_number", "No matching authorization was found.")
    recent = (
        Authorization.objects.select_related("diagnosis", "specialty")
        .annotate(call_count=Count("calls"))
        .order_by("-created_at")[:12]
    )
    return render(request, "tracker/authorization_summary.html", {"form": form, "recent": recent})


@role_required(ADMIN, URA, VIEWER, AUDITOR)
def authorization_detail(request, pk):
    authorization = get_object_or_404(
        Authorization.objects.select_related("line_of_business", "diagnosis", "specialty", "referral_reason"),
        pk=pk,
    )
    calls = authorization.calls.select_related("facility", "caller", "booking_out_bucket").order_by("call_at")
    return render(
        request,
        "tracker/authorization_detail.html",
        {
            "authorization": authorization,
            "calls": calls,
            "narrative": authorization_narrative(authorization, calls),
        },
    )


@role_required(ADMIN, URA, VIEWER, AUDITOR)
def authorization_pdf(request, pk):
    authorization = get_object_or_404(Authorization, pk=pk)
    return authorization_pdf_response(authorization)


@role_required(ADMIN, URA)
@require_http_methods(["GET", "POST"])
def review_queue(request):
    tasks = ReviewTask.objects.select_related("facility", "provider_call", "assigned_to").exclude(
        status__in=["resolved", "dismissed"]
    )
    status = request.GET.get("status")
    if status:
        tasks = tasks.filter(status=status)
    page = Paginator(tasks.order_by("due_date", "-priority", "facility__name", "title"), 20).get_page(
        request.GET.get("page")
    )
    return render(request, "tracker/review_queue.html", {"page": page, "today": timezone.localdate()})


@role_required(ADMIN, URA)
@require_POST
def resolve_review(request, pk):
    task = get_object_or_404(ReviewTask, pk=pk)
    form = ReviewResolutionForm(request.POST)
    if not form.is_valid():
        messages.error(request, "Resolution and reviewer notes are required.")
        return redirect("review_queue")
    task.status = form.cleaned_data["status"]
    task.reviewer_notes = form.cleaned_data["reviewer_notes"]
    task.resolution = form.cleaned_data["resolution"]
    task.resolved_at = timezone.now()
    task.assigned_to = request.user
    task.save()
    audit(
        actor=request.user,
        action="review.resolved",
        instance=task,
        summary=f"Resolved review: {task.title}",
        request=request,
    )
    messages.success(request, "Review saved.")
    return redirect("review_queue")


@role_required(ADMIN, URA, VIEWER, AUDITOR)
def facilities(request):
    queryset = Facility.objects.annotate(
        specialty_count=Count("specialty_links"), call_count=Count("calls", distinct=True)
    )
    query = request.GET.get("q", "").strip()
    quality = request.GET.get("quality", "")
    if query:
        queryset = queryset.filter(
            Q(name__icontains=query) | Q(city__icontains=query) | Q(postal_code__icontains=query)
        )
    if quality:
        queryset = queryset.filter(data_quality_status=quality)
    page = Paginator(queryset.order_by("name", "city"), 20).get_page(request.GET.get("page"))
    return render(
        request,
        "tracker/facilities.html",
        {"page": page, "query": query, "quality": quality, "quality_choices": Facility.Quality.choices},
    )


@role_required(ADMIN, URA, VIEWER, AUDITOR)
def facility_detail(request, pk):
    facility = get_object_or_404(Facility, pk=pk)
    specialties = facility.specialty_links.select_related("specialty").order_by("specialty__name")
    calls = facility.calls.select_related("authorization", "diagnosis", "specialty", "caller").order_by(
        "-call_at"
    )[:20]
    return render(
        request,
        "tracker/facility_detail.html",
        {"facility": facility, "specialties": specialties, "calls": calls},
    )


@role_required(ADMIN, VIEWER, AUDITOR)
@require_http_methods(["GET", "POST"])
def reports(request):
    form = ReportFilterForm(request.GET or None)
    cleaned = form.cleaned_data if form.is_valid() else {}
    caller = (
        get_user_model().objects.filter(pk=cleaned.get("caller")).first() if cleaned.get("caller") else None
    )
    metrics = report_metrics(
        start=cleaned.get("start"),
        end=cleaned.get("end"),
        line_of_business=cleaned.get("line_of_business"),
        specialty=cleaned.get("specialty"),
        caller=caller,
    )
    if request.GET.get("export") == "xlsx":
        return report_excel_response(metrics)
    if request.method == "POST":
        snapshot = save_snapshot(report_type="activity", metrics=metrics, actor=request.user)
        audit(
            actor=request.user,
            action="report.snapshot",
            instance=snapshot,
            summary="Saved report snapshot",
            request=request,
        )
        messages.success(request, "Report snapshot saved.")
        return redirect("reports")
    return render(
        request,
        "tracker/reports.html",
        {"form": form, "metrics": metrics, "snapshots": ReportSnapshot.objects.all()[:8]},
    )


@role_required(ADMIN)
def automations(request):
    rules = AutomationRule.objects.prefetch_related("runs").all()
    return render(request, "tracker/automations.html", {"rules": rules})


@role_required(ADMIN)
@require_POST
def automation_run(request, pk):
    rule = get_object_or_404(AutomationRule, pk=pk, enabled=True)
    run, created = run_automation(rule, actor=request.user)
    audit(
        actor=request.user,
        action="automation.run",
        instance=run,
        summary=f"Ran automation: {rule.name}",
        request=request,
        metadata={"affected": run.affected_count},
    )
    messages.success(
        request,
        f"{rule.name}: {run.affected_count} item(s) updated."
        if created
        else f"{rule.name} already ran for this period. The earlier result was used.",
    )
    return redirect("automations")


@role_required(ADMIN, AUDITOR)
@require_http_methods(["GET", "POST"])
def imports(request):
    form = ImportUploadForm(request.POST or None, request.FILES or None)
    summary = None
    if request.method == "POST" and form.is_valid():
        upload = form.cleaned_data["workbook"]
        suffix = ".xlsm" if upload.name.lower().endswith(".xlsm") else ".xlsx"
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as temporary:
            for chunk in upload.chunks():
                temporary.write(chunk)
            temporary_path = temporary.name
        try:
            parsed = parse_workbook(temporary_path, form.cleaned_data["workbook_kind"])
            plan = reconcile([parsed])
            summary = safe_summary(plan)
            if request.POST.get("action") == "apply":
                result = apply_plan(plan, actor=request.user)
                messages.success(request, f"Import complete: {result['calls_imported']} new call(s).")
                return redirect("imports")
            messages.success(request, "Preview complete. No records were changed.")
        except (OSError, ValueError) as exc:
            form.add_error("workbook", str(exc))
        finally:
            __import__("os").unlink(temporary_path)
    batches = ImportBatch.objects.all()[:12]
    rejected = ImportRowResult.objects.filter(status="rejected").select_related("batch")[:12]
    return render(
        request,
        "tracker/imports.html",
        {"form": form, "summary": summary, "batches": batches, "rejected": rejected},
    )


@role_required(ADMIN, AUDITOR)
def rejected_import_row(request, pk):
    row = get_object_or_404(ImportRowResult.objects.select_related("batch"), pk=pk, status="rejected")
    return render(request, "tracker/rejected_row.html", {"row": row})


@role_required(ADMIN)
def administration(request):
    counts = {
        "users": get_user_model().objects.count(),
        "facilities": Facility.objects.count(),
        "imports": ImportBatch.objects.count(),
        "automations": AutomationRule.objects.count(),
    }
    users = get_user_model().objects.select_related("profile").order_by("username")
    return render(request, "tracker/administration.html", {"counts": counts, "users": users})


@role_required(ADMIN, AUDITOR)
def audit_history(request):
    queryset = AuditEvent.objects.select_related("actor")
    action = request.GET.get("action", "")
    if action:
        queryset = queryset.filter(action__icontains=action)
    page = Paginator(queryset, 30).get_page(request.GET.get("page"))
    return render(request, "tracker/audit.html", {"page": page, "action": action})


@role_required(ADMIN, URA, VIEWER, AUDITOR)
def comparison(request):
    return render(request, "tracker/comparison.html")


def permission_denied(request, exception=None):
    return render(request, "403.html", status=403)


def page_not_found(request, exception=None):
    return render(request, "404.html", status=404)


def server_error(request):
    return render(request, "500.html", status=500)
