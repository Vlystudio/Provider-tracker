import json

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError

from apps.tracker.services.importer import apply_plan, parse_workbook, reconcile, safe_summary


class Command(BaseCommand):
    help = "Preview or apply the idempotent URA workbook reconciliation pipeline."

    def add_arguments(self, parser):
        parser.add_argument("--admin", required=True)
        parser.add_argument("--user", required=True)
        mode = parser.add_mutually_exclusive_group(required=True)
        mode.add_argument("--preview", action="store_true")
        mode.add_argument("--apply", action="store_true")
        parser.add_argument("--actor", default="admin.demo")

    def handle(self, *args, **options):
        try:
            plan = reconcile(
                [parse_workbook(options["admin"], "admin"), parse_workbook(options["user"], "user")]
            )
        except (OSError, ValueError) as exc:
            raise CommandError(str(exc)) from exc
        self.stdout.write(json.dumps(safe_summary(plan), indent=2))
        if options["apply"]:
            user_model = get_user_model()
            try:
                actor = user_model.objects.get(username=options["actor"])
            except user_model.DoesNotExist as exc:
                raise CommandError(
                    f"Apply actor {options['actor']!r} does not exist. Run seed_demo or pass --actor."
                ) from exc
            self.stdout.write(json.dumps(apply_plan(plan, actor=actor), indent=2))
