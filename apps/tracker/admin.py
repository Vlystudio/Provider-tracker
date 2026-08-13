from django.contrib import admin

from . import models

for model in (
    models.LineOfBusiness,
    models.Specialty,
    models.Diagnosis,
    models.ReferralReason,
    models.BookingOutBucket,
    models.PostalCodeCentroid,
    models.Facility,
    models.FacilitySpecialty,
    models.Authorization,
    models.ProviderCall,
    models.ReviewTask,
    models.DuplicateCallGroup,
    models.ImportBatch,
    models.ImportRowResult,
    models.AuditEvent,
    models.ReportSnapshot,
    models.AutomationRule,
    models.AutomationRun,
):
    admin.site.register(model)

admin.site.site_header = "Provider Tracker Administration"
admin.site.site_title = "Provider Tracker"
