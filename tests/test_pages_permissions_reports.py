from datetime import timedelta

import pytest
from django.test import override_settings
from django.urls import reverse

from apps.accounts.models import UserProfile
from apps.tracker.models import AutomationRule, ProviderCall, ReviewTask
from apps.tracker.services.automations import run_automation
from apps.tracker.services.distance import distance_repository
from apps.tracker.services.reports import report_metrics

ROLE_PAGES = {
    UserProfile.Role.ADMINISTRATOR: {
        "dashboard",
        "new_call",
        "provider_search",
        "call_log",
        "authorization_summary",
        "review_queue",
        "facilities",
        "reports",
        "automations",
        "imports",
        "administration",
        "audit_history",
        "comparison",
    },
    UserProfile.Role.URA_USER: {
        "dashboard",
        "new_call",
        "provider_search",
        "call_log",
        "authorization_summary",
        "review_queue",
        "facilities",
        "comparison",
    },
    UserProfile.Role.REPORT_VIEWER: {
        "dashboard",
        "provider_search",
        "call_log",
        "authorization_summary",
        "facilities",
        "reports",
        "comparison",
    },
    UserProfile.Role.AUDITOR: {
        "dashboard",
        "call_log",
        "authorization_summary",
        "facilities",
        "reports",
        "imports",
        "audit_history",
        "comparison",
    },
}


@pytest.mark.django_db
def test_health_endpoints(client):
    live = client.get(reverse("health_live"))
    ready = client.get(reverse("health_ready"))
    assert live.status_code == 200
    assert live.json() == {"status": "ok"}
    assert ready.status_code == 200
    assert ready.json() == {"status": "ready"}


@pytest.mark.django_db
@pytest.mark.parametrize("role", list(ROLE_PAGES))
def test_role_permission_matrix(client, domain, role):
    client.force_login(domain["users"][role])
    all_pages = set().union(*ROLE_PAGES.values())
    for page in all_pages:
        response = client.get(reverse(page))
        expected = 200 if page in ROLE_PAGES[role] else 403
        assert response.status_code == expected, (role, page)


@pytest.mark.django_db
def test_unauthorized_review_mutation_is_blocked(client, domain):
    task = ReviewTask.objects.create(task_type="follow_up", title="Review", due_date=domain["now"].date())
    client.force_login(domain["users"][UserProfile.Role.REPORT_VIEWER])
    response = client.post(
        reverse("resolve_review", args=[task.pk]),
        {"status": "resolved", "reviewer_notes": "Done", "resolution": "Verified"},
    )
    assert response.status_code == 403
    task.refresh_from_db()
    assert task.status == "open"


@pytest.mark.django_db
@override_settings(DEBUG=False, DEMO_MODE=False)
def test_demo_login_is_blocked_in_production(client, domain):
    response = client.post(reverse("demo_login", args=["ura"]))
    assert response.status_code == 403


@pytest.mark.django_db
def test_distance_repository_uses_bounded_real_records(domain):
    results = distance_repository().search(postal_code="02108", radius=10)
    assert results[0].facility == domain["facility"]
    assert results[0].miles < 1


@pytest.mark.django_db
def test_dashboard_metrics_and_query_bound(client, domain, django_assert_max_num_queries):
    ProviderCall.objects.create(
        authorization=domain["authorization"],
        facility=domain["facility"],
        specialty=domain["specialty"],
        diagnosis=domain["diagnosis"],
        caller=domain["users"][UserProfile.Role.URA_USER],
        call_at=domain["now"],
        accepting_new_patients="yes",
        can_treat_diagnosis="yes",
        can_schedule_within_four_weeks="yes",
        import_fingerprint="dashboard-call",
    )
    client.force_login(domain["users"][UserProfile.Role.ADMINISTRATOR])
    with django_assert_max_num_queries(30):
        response = client.get(reverse("dashboard"))
    assert response.status_code == 200
    assert response.context["metrics"]["denominator"] == 1
    assert response.context["metrics"]["success_rate"] == 100


@pytest.mark.django_db
def test_report_denominators_do_not_fabricate_change(domain):
    empty = report_metrics(
        start=domain["now"].date() - timedelta(days=5), end=domain["now"].date() - timedelta(days=1)
    )
    assert empty["success_denominator"] == 0
    assert empty["success_rate"] == 0
    ProviderCall.objects.create(
        authorization=domain["authorization"],
        facility=domain["facility"],
        specialty=domain["specialty"],
        diagnosis=domain["diagnosis"],
        caller=domain["users"][UserProfile.Role.URA_USER],
        call_at=domain["now"],
        accepting_new_patients="yes",
        can_treat_diagnosis="yes",
        can_schedule_within_four_weeks="yes",
        import_fingerprint="report-call",
    )
    metrics = report_metrics(start=domain["now"].date(), end=domain["now"].date())
    assert metrics["success_denominator"] == 1
    assert metrics["success_rate"] == 100


@pytest.mark.django_db
def test_automation_run_is_idempotent(domain):
    rule = AutomationRule.objects.create(
        name="Overdue reviews", slug="overdue-reviews", purpose="Find overdue work", schedule="Daily"
    )
    ReviewTask.objects.create(
        task_type="follow_up", title="Overdue", due_date=domain["now"].date() - timedelta(days=1)
    )
    first, created = run_automation(
        rule, actor=domain["users"][UserProfile.Role.ADMINISTRATOR], run_date=domain["now"].date()
    )
    second, created_again = run_automation(
        rule, actor=domain["users"][UserProfile.Role.ADMINISTRATOR], run_date=domain["now"].date()
    )
    assert created and not created_again
    assert first.pk == second.pk
    assert first.affected_count == 1


@pytest.mark.django_db
def test_exports_are_downloadable(client, domain):
    ProviderCall.objects.create(
        authorization=domain["authorization"],
        facility=domain["facility"],
        specialty=domain["specialty"],
        diagnosis=domain["diagnosis"],
        caller=domain["users"][UserProfile.Role.URA_USER],
        call_at=domain["now"],
        accepting_new_patients="yes",
        can_treat_diagnosis="yes",
        can_schedule_within_four_weeks="yes",
        import_fingerprint="export-call",
    )
    client.force_login(domain["users"][UserProfile.Role.REPORT_VIEWER])
    csv_response = client.get(reverse("call_log"), {"export": "csv"})
    excel_response = client.get(reverse("call_log"), {"export": "xlsx"})
    report_response = client.get(reverse("reports"), {"export": "xlsx"})
    pdf_response = client.get(reverse("authorization_pdf", args=[domain["authorization"].pk]))
    assert csv_response["Content-Type"] == "text/csv"
    assert excel_response.content.startswith(b"PK")
    assert report_response.content.startswith(b"PK")
    assert pdf_response.content.startswith(b"%PDF")


@pytest.mark.django_db
def test_empty_and_validation_states_render(client, domain):
    client.force_login(domain["users"][UserProfile.Role.URA_USER])
    empty = client.get(reverse("call_log"))
    invalid = client.get(reverse("provider_search"), {"member_postal_code": "02108", "radius": 25})
    missing = client.get("/facilities/00000000-0000-0000-0000-000000000000/")
    assert b"No calls match" in empty.content
    assert b"Choose exactly one diagnosis" in invalid.content
    assert missing.status_code == 404
