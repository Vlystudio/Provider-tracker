from django.urls import path

from . import views

urlpatterns = [
    path("", views.landing, name="landing"),
    path("dashboard/", views.dashboard, name="dashboard"),
    path("new-call/", views.new_call, name="new_call"),
    path("new-call/result-preview/", views.call_result_preview, name="call_result_preview"),
    path("provider-search/", views.provider_search, name="provider_search"),
    path("call-log/", views.call_log, name="call_log"),
    path("authorization-summary/", views.authorization_summary, name="authorization_summary"),
    path("authorization/<uuid:pk>/", views.authorization_detail, name="authorization_detail"),
    path("authorization/<uuid:pk>/pdf/", views.authorization_pdf, name="authorization_pdf"),
    path("review-queue/", views.review_queue, name="review_queue"),
    path("review-queue/<uuid:pk>/resolve/", views.resolve_review, name="resolve_review"),
    path("facilities/", views.facilities, name="facilities"),
    path("facilities/<uuid:pk>/", views.facility_detail, name="facility_detail"),
    path("reports/", views.reports, name="reports"),
    path("automations/", views.automations, name="automations"),
    path("automations/<uuid:pk>/run/", views.automation_run, name="automation_run"),
    path("imports/", views.imports, name="imports"),
    path("imports/rejected/<uuid:pk>/", views.rejected_import_row, name="rejected_import_row"),
    path("administration/", views.administration, name="administration"),
    path("audit/", views.audit_history, name="audit_history"),
]
