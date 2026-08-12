from django.conf import settings
from django.db import models


class UserProfile(models.Model):
    class Role(models.TextChoices):
        ADMINISTRATOR = "administrator", "Administrator"
        URA_USER = "ura_user", "URA User"
        REPORT_VIEWER = "report_viewer", "Report Viewer"
        AUDITOR = "auditor", "Auditor"

    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="profile")
    initials = models.CharField(max_length=12, unique=True, null=True, blank=True)
    role = models.CharField(max_length=24, choices=Role.choices, default=Role.URA_USER, db_index=True)
    display_name = models.CharField(max_length=120, blank=True)
    activity_status = models.CharField(max_length=24, default="active", db_index=True)

    def __str__(self):
        return self.display_name or self.user.get_full_name() or self.user.username
