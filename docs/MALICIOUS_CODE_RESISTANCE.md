# Malicious-code resistance

This review assumes the attacker knows the stack and source layout. No live malware, shell payload, or persistence mechanism was introduced during testing.

## Code-entry paths

| Vector | Can introduce executable code? | Privilege and reach if compromised | Persistence | Controls | Remaining work |
| --- | --- | --- | --- | --- | --- |
| npm dependency | Yes, during install/build or runtime | CI identity during install; app identity at runtime; runtime can read app secrets and use runtime DB grants | In an image or lockfile | Exact direct versions, committed lockfile, npm-registry/SHA-512 enforcement, five reviewed lifecycle scripts, production advisory gate, SBOM | Repository review/branch protection and image signing |
| CI action | Yes, inside CI | Workflow token and any attached environment secret | Built artifact or repository write if permission exists | Actions pinned to full commits, default read-only permissions, no deployment secrets in current workflow | Protected environments and approved maintainers |
| Build script/config | Yes, by design | Build worker; no production secret should be present | Image/artifact | Reviewed package scripts, clean build context, `.dockerignore`, secret scan, SBOM, immutable release metadata | Isolated runner and artifact signing |
| Docker base/image layer | Yes | Container process; possible host impact if overprivileged | Image layer | Base digest pins, multi-stage standalone output, non-root UID, no package manager install at runtime | Registry admission, scan/signature verification, local scan unavailable |
| Workbook | No supported execution path | Parser process can consume bounded CPU/memory and write reviewed migration rows | Database rows after explicit apply | Signature/type check; macros, external references, DTD/entities, traversal, encryption blocked; ZIP/row/column/cell/string/ratio limits; formulas not executed | Optional antivirus/CDR at protected intake |
| HTTP/body/query input | No supported execution path | Only the requested service operation after auth and validation | Normal database rows and audit events | No `eval`, raw HTML, dynamic import, VM execution, shell interpolation, or arbitrary URL fetch; strict schemas and parameterized queries | Edge DDoS controls |
| Migration SQL | Yes, trusted release content | Migration identity can change schema | Database schema/data | Migrations are committed/reviewed, run separately, and never accepted from an HTTP body | Release approvals and migration-role custody |
| Scheduler command | Existing trusted command only | Scheduler identity and runtime database grants | Job-created work/audit rows | Allowlisted command names, fixed argument parsing, job locks, no HTTP shell execution | Scheduler network/credential isolation |
| Compromised application process | Already has code execution | Reads process environment, uses configured DB grants and allowed network | Limited by read-only image; database writes can persist | Non-root, read-only root in production Compose, tmpfs `/tmp`, no capabilities, no container socket, restricted DB identity | Deny-by-default egress and workload isolation |

## Executable APIs and static review

The runtime source contains no `eval`, `new Function`, Node `vm`, `dangerouslySetInnerHTML`, `innerHTML`, or user-controlled dynamic import. Child-process use is confined to repository operations scripts. Those scripts pass fixed executables and argument arrays; HTTP, workbook, database, and user inputs do not select an executable or shell fragment.

The application has no plug-in loader, template editor, package-install endpoint, Git endpoint, server-side arbitrary URL fetch, or executable file upload. Workbook formulas are data, not instructions; the parser never calculates them. Exported CSV values must use the existing spreadsheet-safe escaping path when user-entered data is included.

## Runtime blast radius

If the application process is compromised, assume the attacker can read all environment variables available to that container and all application data granted to the runtime database identity. The attacker cannot rely on the repository controls alone to stop arbitrary outbound connections. IT must therefore restrict egress to private PostgreSQL, DNS, time, log collection, and any specifically approved identity endpoint.

The restricted database identity can select and change application data needed by the product and can insert audit events. It cannot:

- become superuser or manage roles/databases;
- create an extension or change schema;
- read server files or run server programs;
- update, delete, truncate, reference, or trigger on `audit_events`;
- access an unrelated database unless separately granted.

The production container must run with a read-only root, a memory-backed `/tmp`, all Linux capabilities dropped, `no-new-privileges`, a PID limit, no host mounts, and no Docker/container runtime socket. The provided production Compose example expresses these settings, but IT must verify the actual platform.

## Build and artifact integrity

CI creates a CycloneDX production SBOM, builds the same Dockerfile used for release, and fails on unmitigated High/Critical Trivy findings. Actions and base images are pinned. Release records must retain the source commit, image digest, SBOM, scan result, build time, and approver. The registry should require a signature/provenance statement before staging or production admission.

Production output uses Next.js standalone files. Browser source maps are disabled. Development dependencies, test files, `.git`, local environment files, documentation, workbooks, and database dumps are not copied into the runtime image.

## Suspicious change review

Treat these changes as security-sensitive even when tests pass:

- a new dependency, lifecycle script, download command, CI action, or Docker base;
- a new child process, dynamic import, VM, HTML injection, arbitrary URL, upload type, or writable path;
- a change to authentication endpoint allowlists, proxy trust, CSP, origins, cookies, permissions, database grants, or audit actions;
- a binary or minified source file without a reviewed origin;
- a lockfile change not explained by a manifest change;
- a release job gaining write permission or access to a production secret.

Run `npm run audit:supply-chain`, `npm run audit:static-security`, `npm run scan:secrets`, the production dependency audit, the security acceptance suite, SBOM generation, and image scanning after any such change.
