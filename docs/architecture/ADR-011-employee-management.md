# ADR-011: Employee records, effective-dated job history and sensitive data

- Status: Accepted (2026-11-18, Phase 04)
- Builds on: [ADR-003](ADR-003-database-roles-and-rls.md), [ADR-009](ADR-009-authorization-rbac-abac.md),
  [ADR-010](ADR-010-organization-structure-and-scoped-access.md)

## Context

Phase 04 introduces the employee record. Nearly every later module hangs off it: attendance,
leave, payroll, performance and documents. Four decisions need recording:

- how job placement is stored over time;
- how scoped (ABAC) access is applied to people;
- how sensitive data (bank and statutory identifiers, documents) is protected;
- which requirements are deliberately deferred.

## Decisions

### Employee vs. placement

- `employees` holds identity, contact, personal details and lifecycle state:
  - joining date;
  - probation (NOT_APPLICABLE / ON_PROBATION / CONFIRMED);
  - notice period;
  - status ACTIVE / ON_NOTICE / SEPARATED, plus separation details.

  CHECK constraints make these states consistent; for example, separation fields exist exactly
  when the employee is on notice or separated.

- **Placement is effective-dated** in `employment_records`: company (required); legal entity,
  branch, department, team, designation, job grade, cost center, reporting manager (optional);
  employment type; and the change type (JOINING, TRANSFER, PROMOTION, …).
  - `effective_to` is inclusive; NULL means open-ended.
  - A GiST exclusion constraint on `(employee_id, daterange)` makes overlapping periods
    impossible.
  - A partial unique index allows only one open record per employee.
- **History is append-only.** A trigger rejects DELETE and any UPDATE except closing a record by
  setting `effective_to`. The runtime role has no DELETE on `employees` or
  `employment_records`. Corrections are recorded as new changes.
- A change closes the open record the day before the new one starts. One future-dated change may
  be scheduled at a time.
- The **current placement** is the record in force today. For someone who has not joined yet it
  is their pending joining record; after separation it is the last record. Directory filters and
  ABAC both use the in-force record.
- Placement consistency is checked twice. The service returns field errors, and a trigger
  (`app.employment_record_structure_guard`) is the backstop. The checks are: legal entity,
  branch and department belong to the company; the team belongs to the department; the cost
  center belongs to the company or is organization-wide. The service also rejects inactive
  structure records and circular reporting lines.

### Numbering

`employee_settings` holds a per-organization prefix, zero-padding and next number. A number is
allocated by an `UPDATE … next_number + 1` inside the joining transaction; the row lock prevents
duplicates under concurrency, and numbers already used manually are skipped. A manual number is
allowed but must be unique (409).

### Access (consuming ADR-010 scopes)

- Directory and profile endpoints use `@RequireScopedPermissions`: a grant at **any** scope
  passes the guard. The service then restricts data:
  - lists use `employeeScopeWhere`, an OR of the caller's grants over the in-force placement
    (company / branch / department subtree / team) or SELF (the linked membership);
  - single records use `can()` with the employee's attributes.
- An employee outside the caller's scope returns **404**, not 403, so its existence is not
  revealed. Visible-but-not-permitted actions return 403.
- Permission groups:
  - `employee.read` / `create` / `update`;
  - `lifecycle.manage`;
  - `personal.read` (date of birth, gender, personal contacts, addresses, emergency contacts,
    family);
  - `sensitive.read` / `manage` (bank, PAN, UAN);
  - `document.read` / `manage`;
  - `settings.manage` (organization-wide only);
  - `self.access`.
- Scoped creation and job changes require the permission for the **target** placement as well,
  so a department-scoped HR user cannot hire into, or move people into, other departments.
- **Self-service** (`/me/employee`) lets an employee read their own profile and maintain:
  - their contact details;
  - addresses, emergency contacts and family;
  - education, experience, certifications and skills.

  Bank and statutory data are shown masked to the employee and are maintained by HR. Managers see
  their direct reports through `/me/employee/team` without an HR role.

### Sensitive data

- Bank account numbers, PAN and UAN are stored with `FieldEncryption` (AES-256-GCM). The
  ciphertext is bound to row and column through the encryption context, and only the last four
  characters are kept in clear for masking.
- APIs return masked values. Full values come only from `POST …/reveal`, which requires
  `sensitive.read` and writes an `employee.sensitive_revealed` audit entry.
- Audit entries for personal fields record **which fields changed, never their values**.
- **Aadhaar numbers are not collected.** The Aadhaar Act and UIDAI regulations restrict storage
  to purposes and vault arrangements this product does not provide. Identity-proof documents
  can be uploaded instead, so the owner can choose consciously later.
- Only formats are validated: IFSC (`AAAA0XXXXXX`), PAN, UAN (12 digits). No statutory
  eligibility or contribution rules are implemented in Phase 04.

### Documents

- Files are stored in S3-compatible storage under `org/<tenant>/employees/<id>/documents/<docId>`.
  A CHECK constraint ties each storage key to the row's tenant prefix.
- Uploads are limited to 10 MB. The **content type is detected from magic bytes** (PDF, PNG,
  JPEG, WebP); the client-declared MIME type is ignored. A SHA-256 hash is stored, and file names
  are sanitized.
- Downloads stream through the API after authorization (no long-lived public URLs), with an
  RFC 6266 `Content-Disposition: attachment` header, and every download is audited.
- If the database insert fails, the uploaded object is deleted. If deleting an object fails after
  its record is removed, the orphan is logged (it is never exposed).

### Separation and access

Completing a separation closes the open record on the last working day and **suspends the
linked membership**, unless the member is an owner, which needs an owner's action. Rejoining
reactivates the employee record and creates a REJOINING record. Login access is restored by an
admin, deliberately not automatically.

## Deferred (documented, not silently skipped)

- **Salary and salary-revision history:** Phase 07 (payroll), with effective-dated salary
  assignments.
- **Approval workflows for self-service changes:** Phase 10 (workflow engine). Phase 04 applies
  employee self-edits directly, limited to the fields above.
- **Linking during invitation acceptance:** HR links accounts explicitly (`PUT
/employees/:id/member`); no e-mail-based auto-linking.
- **Statutory registrations** (ESIC, PT, LWF) and **contract/letter generation:** Phases 07 and 10.
- **Malware scanning** of uploads and retention policies: Phase 10 (documents) or 14.

## Consequences

- Attendance, leave and payroll can resolve "who was where on date D" from one table, and the
  history is tamper-resistant.
- Scoped HR and manager access works without new schema; tests cover department-subtree scoping,
  scoped hiring and organization-wide-only settings.
- Reference pickers (managers, structure) still load at most 200 options; organizations larger
  than that need search-as-you-type pickers (tracked in the roadmap).
