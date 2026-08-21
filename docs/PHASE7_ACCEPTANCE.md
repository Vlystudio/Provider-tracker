# Phase 7 acceptance record

## Automated checks included in the repository

- strict date and legacy-state normalization tests;
- XLSX macro, external-link, expansion-limit, hidden-row, and formula-value tests;
- row-state reconciliation tests;
- database transaction rollback, newer-value protection, and advisory-lock checks;
- planning benchmarks at 1,000, 10,000, and 50,000 rows;
- migration route authentication, role, CSRF, identifier, export, and macro-upload checks in the security suite;
- full lint, type, unit, production build, dependency audit, and secret scan gates.

Current local results: 107 unit tests, 71 live security scenarios, 16 automation scenarios, and 11 migration database scenarios passed. The 1,000/10,000/50,000-row planning benchmark also passed. Rerun the commands in the target environment; these numbers are not a substitute for staging evidence.

Run the local database checks only with a database whose name ends in `_test`.

## Evidence still required in staging

- preview and apply timing for the final source files;
- PostGIS-backed apply and provider-search verification;
- backup and full restore rehearsal;
- business UAT sign-off;
- final source hashes and reconciliation export;
- production notification baseline review;
- named GO/NO-GO approval.

These items depend on IT-controlled infrastructure or business testers and are not marked complete by repository tests.
