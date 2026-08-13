from django.contrib import admin

from .models import UserProfile


@admin.register(UserProfile)
class UserProfileAdmin(admin.ModelAdmin):
    list_display = ("user", "initials", "role", "activity_status")
    list_filter = ("role", "activity_status")
    search_fields = ("user__username", "user__email", "display_name", "initials")
