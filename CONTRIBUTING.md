# Contributing

Thank you for improving Provider Tracker.

## Before opening a change

1. Search existing issues and pull requests.
2. Open an issue for large behavior, schema, security, or importer changes.
3. Never attach real workbooks, authorization records, provider notes, databases, exports, credentials, or logs containing real work data.
4. Use fictional fixtures with clearly non-production identifiers.

## Local checks

Create the demo environment with `scripts/setup_demo.ps1`, then run:

```powershell
.\.venv\Scripts\ruff.exe check .
.\.venv\Scripts\ruff.exe format --check .
.\.venv\Scripts\python.exe manage.py check
.\.venv\Scripts\python.exe manage.py makemigrations --check
.\.venv\Scripts\python.exe -m pytest
```

Importer changes should include a small generated workbook fixture that covers the relevant header or malformed-row condition. Business-rule changes must update both tests and `docs/BUSINESS_RULES.md`.

## Pull requests

Keep commits focused. Explain what changes for users or stored data, list the checks you ran, and call out database migrations or deployment changes. Pull requests must pass CI and must not contain sensitive data.
