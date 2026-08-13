from django.conf import settings

from .permissions import ROLE_NAV, user_role


def application_context(request):
    role = user_role(request.user) if request.user.is_authenticated else None
    return {"demo_mode": settings.DEMO_MODE, "user_role": role, "allowed_nav": ROLE_NAV.get(role, set())}
