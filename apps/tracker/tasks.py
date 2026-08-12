from celery import shared_task

from .models import AutomationRule
from .services.automations import run_automation


@shared_task
def run_rule(rule_id):
    rule = AutomationRule.objects.get(pk=rule_id, enabled=True)
    run, created = run_automation(rule)
    return {"run_id": str(run.pk), "created": created, "affected_count": run.affected_count}


@shared_task
def run_enabled_automations():
    results = []
    for rule_id in AutomationRule.objects.filter(enabled=True).values_list("id", flat=True):
        results.append(run_rule(str(rule_id)))
    return results
