# Security Notes

## Implemented controls

- Django password hashing and session authentication.
- CSRF middleware and tokens on state-changing forms.
- Role-protected views and role-aware navigation.
- Server-side outcome recalculation and transactional writes.
- Secure production cookie, HTTPS redirect, HSTS, content-type, referrer, and frame settings.
- Production startup refusal for insecure secret defaults or enabled demo authentication.
- Workbook extension, signature, size, expanded-size, row, sheet, and archive-path validation.
- Restricted raw import-row review.
- Structured logs that avoid raw form and workbook payloads.
- Audit events for calls, review resolutions, report snapshots, and automation runs.
- Ignored workbooks, databases, uploads, exports, environment files, logs, caches, and dumps.

## Data handling

The repository and sample database contain fictional data only. Do not place real workbooks or production data inside the repository. Use a private, access-controlled location and encrypted storage for any approved production import.

## Production review still required

The project does not claim HIPAA compliance. Production use requires organizational privacy/security approval, identity-provider integration, least-privilege administration, encryption and key management, database/network isolation, backup and recovery tests, monitoring, vulnerability management, retention/deletion policy, incident response, vendor review, accessibility review, and formal authorization to handle regulated data.

## Credential response

Never commit credentials. If a credential is exposed in chat, logs, screenshots, terminal history, or a repository, revoke it immediately, replace it with a least-privilege credential, and review access logs and repository history before publication.
