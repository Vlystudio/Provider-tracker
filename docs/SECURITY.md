# Security and operational safeguards

## Current baseline

- browser responses include a content security policy and clickjacking, MIME-sniffing, referrer, and permissions controls
- production responses use HSTS when the app is served over HTTPS
- the app does not send the default Next.js identification header
- sample data mode is blocked when `APP_ENV=production`
- database connection strings are validated as PostgreSQL URLs and remain server-side
- local environment files, workbooks, exports, and generated reconciliation files are excluded from Git

Authentication and role checks are not finished. Do not place this app on a public network until those controls are implemented and reviewed.

## Access model

- all access requires authenticated sessions
- authorization checks are enforced on the server
- roles: admin, ura_user, report_viewer, auditor
- least-privilege patterns are required for import, reconciliation, and audit access

## Session and transport

- HttpOnly, SameSite cookies
- CSRF protection on mutation endpoints
- secure headers and Content Security Policy
- TLS required for production deployments

## Data handling

- authorization numbers, provider data, diagnosis codes, and narratives are treated as sensitive operational data
- logs must redact or omit direct identifiers where possible
- no workbook or generated export artifacts are committed to version control
- all file uploads are subject to safe-size checks and validation

## Operational requirements

- external hosting should be paired with a signed BAA where applicable
- document encryption at rest, backup rotation, and restore testing
- production requires secret scanning, dependency scanning, and review of external packages
- import endpoints should restrict file types, ZIP bombs, and row counts
- the CLI accepts only XLSX/XLSM containers, rejects encrypted/unsafe ZIP entries, and bounds compressed size, expanded size, and sheet rows
- reconciliation output excludes raw row content and local source paths; staged raw data remains inside PostgreSQL access controls
- source workbook and export patterns are ignored by Git

## Dependency posture

- Placeholder Auth.js packages were removed after the production audit reported critical/high advisories and before any auth code was introduced.
- The authentication phase must install a current security-reviewed integration and rerun the production dependency audit.
- The importer uses narrowly scoped streaming ZIP/XML packages and does not execute macros or workbook formulas.

## Compliance note

This application does not claim HIPAA compliance by code alone. Production deployment requires the organization’s security/compliance owner to confirm hosting, BAA coverage, policy controls, and risk assessment.
