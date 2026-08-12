from datetime import timedelta

import pytest
from django.urls import reverse

from apps.tracker.forms import AuthorizationCallForm, ProviderSearchForm
from apps.tracker.models import AuditEvent, DuplicateCallGroup, ProviderCall, ReviewTask
from apps.tracker.services.workflows import create_authorization_call


@pytest.mark.django_db
def test_provider_search_requires_exactly_one_clinical_criterion(domain):
    base = {"member_postal_code": "02108", "radius": 25}
    assert not ProviderSearchForm(base).is_valid()
    assert ProviderSearchForm({**base, "diagnosis": domain["diagnosis"].pk}).is_valid()
    assert ProviderSearchForm({**base, "specialty": domain["specialty"].pk}).is_valid()
    assert not ProviderSearchForm(
        {**base, "diagnosis": domain["diagnosis"].pk, "specialty": domain["specialty"].pk}
    ).is_valid()


@pytest.mark.django_db
def test_repeat_call_requires_reason(domain, valid_call_data):
    first = AuthorizationCallForm(valid_call_data)
    assert first.is_valid(), first.errors
    create_authorization_call(first.cleaned_data, actor=domain["users"]["ura_user"])
    duplicate = AuthorizationCallForm({**valid_call_data, "authorization_number": "TEST-2002"})
    assert not duplicate.is_valid()
    assert "repeat_call_reason" in duplicate.errors
    allowed = AuthorizationCallForm(
        {
            **valid_call_data,
            "authorization_number": "TEST-2002",
            "repeat_call_reason": "Provider requested a callback",
        }
    )
    assert allowed.is_valid(), allowed.errors


@pytest.mark.django_db
def test_transactional_call_updates_downstream_records(domain, valid_call_data):
    form = AuthorizationCallForm(valid_call_data)
    assert form.is_valid(), form.errors
    authorization, call = create_authorization_call(form.cleaned_data, actor=domain["users"]["ura_user"])
    assert call.result_code == "meets_availability_guidelines"
    assert call.next_review_date == domain["now"].date() + timedelta(days=7)
    assert ReviewTask.objects.filter(provider_call=call).exists()
    assert DuplicateCallGroup.objects.filter(calls=call, call_count=1).exists()
    assert AuditEvent.objects.filter(action="call.created", object_id=str(call.pk)).exists()
    assert authorization.calls.count() == 1


@pytest.mark.django_db
def test_server_recalculates_browser_outcome(domain):
    call = ProviderCall.objects.create(
        authorization=domain["authorization"],
        facility=domain["facility"],
        specialty=domain["specialty"],
        diagnosis=domain["diagnosis"],
        caller=domain["users"]["ura_user"],
        call_at=domain["now"],
        accepting_new_patients="no",
        can_treat_diagnosis="yes",
        can_schedule_within_four_weeks="yes",
        result_code="forged",
        result_phrase="forged",
        recommendation="forged",
        import_fingerprint="server-rule",
    )
    assert call.result_code == "does_not_meet_availability_guidelines"
    assert call.result_phrase != "forged"


@pytest.mark.django_db
def test_guided_http_workflow(client, domain, valid_call_data):
    client.force_login(domain["users"]["ura_user"])
    response = client.post(reverse("new_call"), valid_call_data)
    assert response.status_code == 302
    call = ProviderCall.objects.get(import_fingerprint__isnull=False)
    summary = client.get(reverse("authorization_detail", args=[call.authorization_id]))
    assert summary.status_code == 200
    assert b"meets availability guidelines" in summary.content
    assert ReviewTask.objects.filter(provider_call=call).exists()
