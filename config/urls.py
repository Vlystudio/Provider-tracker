from django.contrib import admin
from django.contrib.auth import views as auth_views
from django.urls import include, path

from apps.tracker import views

urlpatterns = [
    path("django-admin/", admin.site.urls),
    path("login/", auth_views.LoginView.as_view(template_name="registration/login.html"), name="login"),
    path("logout/", auth_views.LogoutView.as_view(), name="logout"),
    path("demo-login/<str:role>/", views.demo_login, name="demo_login"),
    path("", include("apps.tracker.urls")),
]

handler403 = "apps.tracker.views.permission_denied"
handler404 = "apps.tracker.views.page_not_found"
handler500 = "apps.tracker.views.server_error"
