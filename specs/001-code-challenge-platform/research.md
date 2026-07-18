# Phase 0 Research: Code Challenge Platform (MVP)

**Date**: 2026-07-16
**Input**: [spec.md](spec.md), constitution v1.2.0, planning interview with project owner

All Technical Context unknowns are resolved below. Owner-interview decisions are marked
**(interview)**; the rest are defaults chosen to satisfy the constitution and the
minimal-spend constraint.

## R1. Backend language & runtime

- **Decision**: TypeScript 5.x on Node.js 22 LTS for both the API and the evaluation
  worker. **(interview)**
- **Rationale**: One language across API, worker, shared contracts, and frontend;
  largest ecosystem; FP discipline achievable with `readonly` types and lint
  enforcement (see R8).
- **Alternatives considered**: F#/.NET (purest FP fit, but split-language stack),
  Elixir/Phoenix (great queue concurrency, dynamic typing), Scala (heavy tooling).

## R2. Sandbox isolation technology

- **Decision**: Plain hardened Docker containers, one ephemeral container per
  submission run. **(interview — chosen over gVisor for simplicity)**
- **Hardening profile** (all mandatory, enforced by the worker):
  `--network=none`, non-root UID (`--user 65534:65534`), `--read-only` rootfs with a
  small `--tmpfs /scratch` work dir, `--cap-drop=ALL`,
  `--security-opt=no-new-privileges`, default seccomp profile, `--pids-limit`,
  `--memory` + `--memory-swap` (equal, to disable swap), `--cpus`, wall-clock kill
  timer in the worker, stdout/stderr capped by the worker while streaming.
- **Rationale**: Satisfies constitution Principle I's container requirement with zero
  software cost and the least operational complexity on a single free-tier VM.
  Trade-off
  acknowledged: containers share the host kernel, so this is the weakest of the
  compliant options. Mitigations: the hardening profile above, images with no shell
  tooling beyond the language runtime, and the host runs nothing but this platform.
- **Upgrade path**: gVisor (`runsc`) can be adopted later by changing only the Docker
  runtime flag in the sandbox profile — no application changes. Revisit before any
  public launch beyond a friendly-user MVP.
- **Alternatives considered**: Docker+gVisor (recommended, deferred by owner),
  Firecracker (needs KVM/bare-metal, too much infra for MVP), WASM runtimes (immature
  language support).

## R3. Deployment target

- **Decision**: Single GCP Compute Engine `e2-micro` VM running Docker Compose (web,
  api, worker, Postgres, sandbox runtime), on the Always Free tier ($0). **(interview
  — switched from VPS to GCP, minimal spend)**
  - Region: one of `us-west1`, `us-central1`, `us-east1` (the only regions eligible
    for the Always Free `e2-micro` instance).
  - Architecture: amd64 only — the free `e2-micro` shape is x86-64; GCP's Arm VMs
    (Tau T2A) are not part of the Always Free tier, so no arm64 build target is
    needed (drops the multi-arch image requirement from the original VPS plan).
  - Disk: 30 GB-month standard persistent disk (Always Free allowance) — sized
    against Postgres + container images.
  - Networking: one Always Free static external IP (free while attached to a
    running instance) for stable DNS; a VPC firewall rule opening `80/tcp` and
    `443/tcp` ingress (GCP denies all inbound but SSH by default); egress capped at
    1 GB/month to most destinations under Always Free, which is expected to be
    sufficient at MVP scale (SPA assets served once per session, JSON API payloads
    small).
  - Budget alert: a GCP Budget + billing alert at low USD threshold guards against
    accidental spend if usage exceeds free-tier limits.
- **Rationale**: Free-tier PaaS (Render, Railway, Vercel, Heroku, Cloud Run) cannot
  spawn sibling Docker containers the way the evaluation worker requires without
  restructuring the architecture; a VM that owns its own Docker socket is the
  cheapest environment that can. GCP's Always Free `e2-micro` matches the original
  VPS plan's cost target ($0) while consolidating billing/IAM/monitoring under one
  cloud account.
- **Alternatives considered**: Hetzner (~$5/mo) or Oracle Cloud Always Free ARM VM
  (the prior VPS candidates — still viable, but the owner chose to consolidate on
  GCP); Cloud Run (fully managed TLS + autoscaling, but wants one container per
  service rather than a docker-compose multi-container host, and cannot mount a
  Docker socket for the worker to spawn sandbox containers — would require
  splitting the worker's sandbox execution onto a separate VM anyway, at which
  point the single-VM Compute Engine approach is simpler); AWS ECS/RDS (cost);
  Fly.io Machines (per-second VM spawn is elegant but no free tier and adds an API
  dependency).

## R4. Frontend

- **Decision**: React SPA (Vite build) talking to the JSON API; CodeMirror 6 as the
  code editor. **(interview: React SPA + JSON API)**
- **Rationale**: Clean API contract boundary per vertical slice. CodeMirror 6 over
  Monaco: ~10x smaller bundle, easier theming, sufficient syntax highlighting for two
  languages.
- **Alternatives considered**: Next.js full-stack (blurs API contract), SSR + light JS
  (weaker editor/status UX), Monaco (heavyweight).

## R5. Database & data access

- **Decision**: PostgreSQL 16; Kysely query builder over `pg` for type-safe,
  parameterized queries; migrations via `kysely` migration files.
- **Rationale**: One store covers relational data, the job queue (R6), and append-only
  audit events — nothing else to pay for or operate. Kysely is parameterized-only
  (satisfies Principle III's SQL-injection ban), fully typed, and has no
  mutable-model/ActiveRecord layer, which fits the immutability mandate better than a
  classic ORM.
- **Alternatives considered**: Prisma (heavier runtime, mutation-oriented client),
  raw `pg` (loses type safety), SQLite (no row-level concurrency for queue + audit).

## R6. Evaluation queue

- **Decision**: `pg-boss` (Postgres-backed job queue) with bounded worker concurrency
  (start: 2 concurrent evaluations per worker) and per-job retry limit; submission
  rows carry `queued/running/complete` status for the UI.
- **Rationale**: No Redis to run or pay for; pg-boss gives at-least-once delivery,
  retries, and dead-lettering on the Postgres we already have — covers the
  worker-crash edge case in the spec. Bounded concurrency satisfies Principle IV.
- **Alternatives considered**: BullMQ (+Redis container: the `e2-micro`'s 1 GB RAM
  budget is already split across Postgres + api + worker + sandbox runs, so an
  extra Redis process is not affordable), hand-rolled
  `SELECT ... FOR UPDATE SKIP LOCKED` (reinventing retries/dead-letter).

## R7. Web framework & validation

- **Decision**: Fastify for the API; Zod schemas (shared from the `contracts` package)
  validating every request body/query at the boundary; `@fastify/rate-limit` for
  per-IP limits plus a per-user submission limiter backed by Postgres.
- **Rationale**: Fastify is fast, structured-logging-native (pino), and its plugin
  encapsulation maps cleanly onto vertical slices. Zod schemas double as the shared
  API contract types for the SPA.
- **Alternatives considered**: Express (weaker typing/validation story), Hono (fine,
  smaller ecosystem for sessions/rate limiting).

## R8. FP style & enforcement

- **Decision**: Disciplined plain TypeScript **(interview)**: pure domain functions,
  `readonly`/`Readonly<T>` everywhere, a small local `Result<T, E>` type for expected
  errors, effects confined to `platform/` modules behind interfaces. Enforced by
  `eslint-plugin-functional` (no-let, immutable-data, no-throw in domain code) +
  `tsconfig` strict mode + PR review.
- **Rationale**: Meets the constitution's purity/immutability mandates without a
  framework learning curve.
- **Alternatives considered**: Effect (powerful, steep curve, lock-in), fp-ts
  (maintenance mode).

## R9. Authentication & sessions

- **Decision**: Email/password with `argon2id` hashing (`argon2` package); server-side
  sessions stored in Postgres, delivered via `HttpOnly`, `Secure`, `SameSite=Lax`
  cookies; password reset via single-use, hashed, expiring tokens. CSRF covered by
  SameSite plus origin checks on state-changing routes (SPA uses same-origin API).
- **Rationale**: Matches the constitution's Security Requirements verbatim;
  server-side sessions give instant revocation.
- **Alternatives considered**: JWTs (revocation complexity for no benefit on one
  origin), OAuth social login (out of MVP scope per spec assumptions).

## R10. Supported languages & sandbox images

- **Decision**: Python 3.12 and Node.js 22 at launch, each as a dedicated minimal
  sandbox image (distroless/alpine base, language runtime only, non-root user, no
  package managers or shells beyond what execution needs). Per-image profile file
  declares default limits per constitution's Workflow rule.
- **Rationale**: Spec FR-004; matches the platform's own toolchain (JS) plus the most
  popular learning language (Python).

## R11. Testing & CI

- **Decision**: Vitest for unit and integration tests (API tested via
  `fastify.inject`, no network); a dedicated **hostile-submission suite** (infinite
  loop, fork bomb, memory bomb, filesystem probe, network probe, oversized output,
  script-injection output) that runs against real sandbox containers and asserts
  containment (spec SC-004). CI on GitHub Actions: typecheck, ESLint (functional
  rules), Vitest, `npm audit --audit-level=critical`, CodeQL; hostile suite runs in CI
  via Docker-in-runner.
- **Rationale**: Constitution Principle V requires security tests to exist before
  execution features ship and to fail if protections are removed; TDD mandate applies
  repo-wide.

## R12. Observability & audit

- **Decision**: pino structured JSON logs in api and worker (request IDs, no source
  code or secrets in general logs); `audit_events` Postgres table written for every
  submission and auth event, with the application DB role granted INSERT/SELECT only
  (no UPDATE/DELETE) to make it append-only.
- **Rationale**: Principle V audit requirements with zero extra infrastructure;
  DB-grant enforcement beats convention.

## R13. Least-privilege layout (Principle II)

- **Decision**: Three runtime services with distinct Postgres roles: `api_role` (no
  access to job tables' internals beyond enqueue via pg-boss schema), `worker_role`
  (submissions, test cases, results, jobs; **no** access to `users`/`sessions`
  tables), `migrator_role` (DDL, used only at deploy). Only the worker container
  mounts the Docker socket; the API container cannot create containers. Secrets
  injected via Compose environment from an untracked `.env` file.
- **Rationale**: Direct application of Principle II; the Docker socket is the crown
  jewel and is confined to the one service whose job is spawning sandboxes.

## R14. Password-reset token delivery

- **Decision**: For the MVP, the raw reset link/token is emitted as a dedicated
  structured-log event (pino) on the API service — no outbound email. An operator
  relays the link to the user on request. The token itself remains single-use,
  hashed at rest, and 1-hour-expiring per R9, and is never returned in any API
  response.
- **Rationale**: The free-tier VM has no email infrastructure and a 1 GB/month
  egress cap; MVP users are a friendly cohort. Swapping in a real sender later
  changes only the delivery edge in the auth slice — the token flow, storage, and
  endpoints are unchanged.
- **Alternatives considered**: Transactional email SaaS (Resend/Mailgun/SendGrid
  free tiers — adds an account, API secret, and deliverability setup; deferred until
  there are real users), self-hosted SMTP on the VM (deliverability/reputation
  burden far exceeds MVP value).
