from functools import wraps

from django.contrib.auth.decorators import login_required
from django.core.exceptions import PermissionDenied

from apps.accounts.models import UserProfile

ADMIN = UserProfile.Role.ADMINISTRATOR
URA = UserProfile.Role.URA_USER
VIEWER = UserProfile.Role.REPORT_VIEWER
AUDITOR = UserProfile.Role.AUDITOR


def user_role(user):
    if user.is_superuser:
        return ADMIN
    try:
        return user.profile.role
    except UserProfile.DoesNotExist:
        return None


def role_required(*roles):
    def decorator(view):
        @login_required
        @wraps(view)
        def wrapped(request, *args, **kwargs):
            if user_role(request.user) not in roles:
                raise PermissionDenied
            return view(request, *args, **kwargs)

        return wrapped

    return decorator


ROLE_NAV = {
    ADMIN: {
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
        "audit",
    },
    URA: {
        "dashboard",
        "new_call",
        "provider_search",
        "call_log",
        "authorization_summary",
        "review_queue",
        "facilities",
    },
    VIEWER: {"dashboard", "provider_search", "call_log", "authorization_summary", "facilities", "reports"},
    AUDITOR: {"dashboard", "call_log", "authorization_summary", "facilities", "reports", "imports", "audit"},
}
