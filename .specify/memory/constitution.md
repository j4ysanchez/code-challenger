<!--
Sync Impact Report
==================
Version change: 1.1.0 → 1.2.0
Modified principles: none renamed
Added sections:
  - Core Principles → VI. Vertical Slice Architecture (new principle)
Removed sections: none
Templates requiring updates:
  - ✅ .specify/templates/plan-template.md — Constitution Check gate picks up the new
    principle per-feature; project-structure guidance remains advisory, no edit required
  - ✅ .specify/templates/spec-template.md — no constitution-specific references
  - ✅ .specify/templates/tasks-template.md — no constitution-specific references
  - ✅ .specify/templates/checklist-template.md — no constitution-specific references
Follow-up TODOs: none
-->

# Code Challenger Constitution

## Core Principles

### I. Sandboxed Execution Isolation (NON-NEGOTIABLE)

User-submitted code is hostile by definition and MUST never execute in the same trust
boundary as the application.

- All submitted code MUST run inside an isolated sandbox (container, microVM, or
  equivalent kernel-level isolation) that is separate from the web/API process, the
  database, and the host filesystem.
- Sandboxes MUST be ephemeral: created per submission, destroyed after evaluation, and
  never reused across users.
- Sandboxes MUST run with no network egress by default. Any exception requires a
  documented justification and an explicit allowlist.
- Sandboxes MUST run as a non-root, unprivileged user with a read-only root filesystem
  and a minimal writable scratch area.
- The execution service MUST communicate with the sandbox only through a narrow,
  defined interface (stdin/stdout/files), never by sharing application memory,
  credentials, or environment secrets.

**Rationale**: The core product feature — running arbitrary code — is also the primary
attack vector. A single sandbox escape compromises every user; isolation failures are
not degradations, they are total failures.

### II. Least Privilege by Default

Every component MUST hold only the permissions it needs to perform its function.

- The web/API tier MUST NOT have permission to spawn arbitrary processes; only the
  dedicated execution service may create sandboxes.
- Database credentials MUST be scoped per service (e.g., the execution service cannot
  read user account tables).
- Secrets (API keys, DB passwords, signing keys) MUST come from a secrets manager or
  environment injection — never committed to the repository or baked into images.
- Any privilege expansion (new capability, broader IAM role, new mount) MUST be
  justified in the PR description and reviewed as a security-relevant change.

**Rationale**: When (not if) a component is compromised, least privilege determines
whether the blast radius is one feature or the whole platform.

### III. All Input Is Untrusted

Every input — code submissions, problem metadata, usernames, query parameters — MUST be
validated and encoded at trust boundaries.

- Server-side validation is mandatory; client-side validation is a UX aid only.
- Database access MUST use parameterized queries or a vetted ORM — string-built SQL is
  prohibited.
- All user-controlled output MUST be encoded for its context (HTML, JS, URL) to prevent
  XSS; submitted code displayed back to users MUST be rendered as inert text, never
  interpreted.
- Submission payloads MUST enforce size limits, accepted-language allowlists, and
  schema validation before reaching the execution service.

**Rationale**: A code-execution platform attracts adversarial users; every classic web
vulnerability (SQLi, XSS, SSRF) is amplified when the audience is programmers probing
the system for sport.

### IV. Resource Limits & Abuse Prevention

Evaluation MUST be bounded in time, memory, and volume so no submission can degrade the
platform.

- Every sandbox MUST enforce hard limits: CPU time, wall-clock timeout, memory ceiling,
  process/thread count, output size, and disk quota. Exceeding a limit terminates the
  run and returns a clear verdict (e.g., "Time Limit Exceeded"), never a hung worker.
- Submission endpoints MUST be rate-limited per user and per IP.
- Evaluation MUST run through a queue with bounded concurrency so a spike in
  submissions degrades wait time, not stability.
- Fork bombs, infinite loops, and OOM attempts are expected inputs and MUST be covered
  by automated tests.

**Rationale**: Denial of service on a code runner requires no exploit — a `while(true)`
suffices. Limits are a correctness requirement, not an optimization.

### V. Security Testing & Auditable Observability

Security properties MUST be verified by tests and observable in production.

- Test-first for the execution path: sandbox escape attempts, resource-limit
  violations, and malicious payload fixtures MUST exist as automated tests before an
  execution feature ships, and MUST fail when protections are removed.
- Every code submission MUST produce an audit record: who, when, what language, verdict,
  and resource usage. Audit logs are append-only.
- Structured logging is required across services; secrets and full user code MUST NOT
  appear in general application logs.
- Authentication events (login, failure, password change) MUST be logged and alertable.
- Dependency scanning (SCA) and static analysis (SAST) MUST run in CI; builds fail on
  known-critical vulnerabilities.

**Rationale**: Untested security controls decay silently. Logs and audits turn a breach
from an unknowable event into an investigable one.

### VI. Vertical Slice Architecture

Code is organized by feature, not by technical layer.

- Each feature (e.g., submit-solution, list-problems, register-account) MUST live in
  its own slice containing everything the feature needs — request handling,
  validation, domain logic, and data access — colocated under one feature directory.
- Slices MUST NOT call into other slices' internals. Cross-slice needs are met through
  shared kernel/domain primitives or explicitly published contracts, never by reaching
  into another feature's modules.
- Shared abstractions (base classes, generic repositories, layer-wide services) MUST
  NOT be introduced speculatively; extract shared code only after duplication is
  observed in two or more slices and the extraction is justified in the PR.
- A slice MUST be independently testable end-to-end: its tests exercise the feature
  from its entry point to its effects without requiring other slices.
- Trust boundaries still hold across slices: the sandbox/execution isolation
  (Principle I) and per-service least privilege (Principle II) are system boundaries
  that no slice organization may blur.

**Rationale**: Vertical slices keep each feature's full behavior — including its
validation and authorization — visible and reviewable in one place, which is exactly
where security review needs it. They also match this project's spec-driven workflow:
each spec's user stories map one-to-one onto independently testable slices.

## Security Requirements

Baseline requirements for the web application, independent of the execution engine:

- **Transport**: All traffic MUST use TLS (HTTPS); HTTP requests redirect. HSTS enabled
  in production.
- **Authentication**: Passwords MUST be hashed with a modern adaptive algorithm
  (argon2id or bcrypt); sessions use secure, HttpOnly, SameSite cookies or short-lived
  signed tokens with server-side revocation.
- **Authorization**: Every API endpoint MUST enforce authorization server-side; object
  access MUST verify ownership (no IDOR). Deny by default.
- **CSRF**: State-changing endpoints MUST be protected via anti-CSRF tokens or
  strict SameSite cookie policy.
- **Headers**: Content-Security-Policy, X-Content-Type-Options, and frame-ancestors
  restrictions MUST be set on all HTML responses.
- **Data**: Personal data is minimized (collect only what the product needs); backups
  encrypted at rest.
- **Errors**: Stack traces and internal details MUST never reach clients; return
  generic errors with correlation IDs.

## Development Workflow & Quality Gates

### Engineering Discipline

- **Pure functional programming**: Application logic MUST be written in a pure
  functional style — functions are deterministic, avoid shared mutable state, and have
  no hidden side effects. Effects (I/O, database access, sandbox invocation, clock,
  randomness) MUST be isolated at the edges of the system behind explicit interfaces,
  keeping core domain logic pure and testable in isolation.
- **Immutable data structures**: Data MUST be modeled with immutable structures by
  default; state changes produce new values rather than mutating existing ones.
  Mutation is permitted only where a measured performance need requires it, confined to
  a narrow local scope, and justified in the PR description.
- **Test-driven development (NON-NEGOTIABLE)**: All production code MUST be developed
  test-first: write a failing test, make it pass with the minimal implementation, then
  refactor. PRs MUST show tests covering the new behavior; code merged without
  accompanying tests written against its requirements violates this constitution. This
  generalizes Principle V's execution-path mandate to the entire codebase.

**Rationale**: A platform that runs hostile code cannot afford ambient mutable state or
untested paths — purity and immutability shrink the attack and defect surface, and TDD
keeps the security guarantees continuously verified.

### Quality Gates

- Every PR MUST pass CI (tests, SAST, dependency scan) before merge.
- Changes touching the execution service, sandbox configuration, authentication, or
  authorization are **security-relevant** and MUST receive an explicit security-focused
  review (human or tooling-assisted) noted in the PR.
- New languages/runtimes for evaluation MUST ship with their own sandbox profile,
  resource limits, and malicious-payload test fixtures — no runtime is enabled by
  configuration alone.
- The plan-phase "Constitution Check" gate MUST evaluate each feature against
  Principles I–VI; violations require an entry in the plan's Complexity Tracking table
  with justification.

## Governance

This constitution supersedes ad-hoc practices for this repository. All plans, specs,
and PR reviews MUST verify compliance with the Core Principles; Principle I admits no
exceptions.

- **Amendments**: Proposed via PR modifying this file, including a Sync Impact Report
  and updates to any dependent templates. Approval by the project owner is required.
- **Versioning**: Semantic versioning — MAJOR for principle removals or redefinitions,
  MINOR for new principles or materially expanded guidance, PATCH for clarifications.
- **Compliance review**: The Constitution Check in each feature plan is the enforcement
  point; unjustified violations block implementation. Security-relevant changes (see
  Workflow) require review evidence in the PR.

**Version**: 1.2.0 | **Ratified**: 2026-07-16 | **Last Amended**: 2026-07-16
