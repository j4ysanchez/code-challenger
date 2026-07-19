# Tasks: Code Challenge Platform (MVP)

**Input**: Design documents from `/specs/001-code-challenge-platform/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/api.md, contracts/sandbox-profile.md, quickstart.md

**Tests**: INCLUDED — the constitution (v1.2.0) makes TDD non-negotiable: every implementation task below is executed test-first (write the failing test named in the task, make it pass, refactor). Principle V additionally requires the hostile-submission containment suite to exist **before** the evaluation feature ships (T022 precedes T023–T026).

**Organization**: Tasks are grouped by user story so each story is an independently implementable, independently testable increment, delivered in priority order (US1 → US2 → US3) per the incremental-delivery request.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: Which user story the task belongs to (US1, US2, US3)
- Every task names exact file paths

## Path Conventions

npm-workspaces monorepo per plan.md: `packages/contracts/`, `apps/api/`, `apps/worker/`, `apps/web/`, `infra/`. Within each app, `src/features/<slice>/` (vertical slices), `src/kernel/` (pure domain), `src/platform/` (effect edges).

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Monorepo skeleton, tooling, CI — everything that must exist before any code

- [X] T001 Create npm-workspaces monorepo root: `package.json` (workspaces `packages/contracts`, `apps/api`, `apps/worker`, `apps/web`; scripts `typecheck`, `lint`, `test`, `test:hostile`, `db:migrate`, `db:seed`, `dev:api`, `dev:worker`, `dev:web`), strict `tsconfig.base.json`, `.gitignore`, `.env.example`
- [X] T002 Scaffold the four workspaces with `package.json`, `tsconfig.json` extending the base, and empty `src/` in `packages/contracts/`, `apps/api/`, `apps/worker/`, `apps/web/`
- [X] T003 [P] Configure ESLint flat config with `eslint-plugin-functional` (no-let, immutable-data, no-throw in `kernel/` and `features/`) + typescript-eslint strict in `eslint.config.js`
- [X] T004 [P] Configure Vitest workspace (unit + integration projects per app, separate `hostile` project for `apps/worker/tests/hostile/`, jsdom environment for `apps/web`) in `vitest.config.ts` (Vitest 4 replaced `vitest.workspace.ts` with a `test.projects` array in a single config — `@testing-library/react` itself is added in T019/T032 alongside React)
- [X] T005 [P] Create `infra/docker-compose.yml` with `postgres:16` service (credentials from `.env`, named volume, healthcheck) and dev port mapping
- [X] T006 [P] Add GitHub Actions CI running typecheck, ESLint, Vitest, `npm audit --audit-level=critical`, and CodeQL in `.github/workflows/ci.yml`, plus a hostile-containment job that builds the sandbox images and runs `npm run test:hostile` via Docker-in-runner (job skips while `infra/sandbox/` is absent; MUST be green from T035 onward — constitution Principle V)

**Checkpoint**: `npm install`, `npm run typecheck`, `npm run lint`, `npm test` all run green on the empty skeleton

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Shared contracts, database schema + roles, API platform (config/logging/db/sessions/audit), base auth (FR-005 requires an authenticated user before any submission), SPA shell. No user story can start until this phase completes.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [X] T007 [P] Write failing tests, then implement shared contract primitives — language allowlist (`python`,`javascript`) with declared versions, verdict enum, submission/problem status enums, error codes + error envelope schema — in `packages/contracts/src/primitives.ts` (tests in `packages/contracts/src/primitives.test.ts`)
- [X] T008 Write failing tests, then implement Zod request/response schemas for every endpoint in contracts/api.md (auth, problems, drafts, submissions, admin-problems; validation rules from data-model.md: email ≤254, password 8–128, code 1 B–100 KB, slug regex, limit ranges) in `packages/contracts/src/schemas/` (depends on T007)
- [X] T009 [P] Set up Kysely migration runner wired to `npm run db:migrate` (uses `migrator_role` connection from env) in `infra/db/migrate.ts`
- [X] T010 Write the initial schema migration for all tables per data-model.md — users, sessions, password_reset_tokens, problems, starter_code, test_cases, submissions, submission_test_results, drafts, audit_events, with CHECK constraints, FKs, citext email, history and solved-status indexes — in `infra/db/migrations/0001_initial_schema.ts` (depends on T009)
- [X] T011 Write the roles migration creating `api_role`, `worker_role`, `migrator_role` with per-table grants per data-model.md (worker: no users/sessions; audit_events INSERT/SELECT only for both runtime roles — append-only enforced by grants; `pgboss` schema access: enqueue for `api_role`, consume/complete for `worker_role`) in `infra/db/migrations/0002_roles_grants.ts` (depends on T010)
- [X] T012 [P] Write failing tests, then implement API kernel primitives — `Result<T,E>`, branded id types, pure verdict/status type guards — in `apps/api/src/kernel/` (tests in `apps/api/src/kernel/result.test.ts`)
- [X] T013 [P] Write failing tests, then implement API platform effect edges: Zod-validated env config loader, pino logger (request ids, never logs source code or secrets), clock interface, Kysely connection factory + generated table types in `apps/api/src/platform/` (config.ts, logger.ts, clock.ts, db.ts; config-loader and logger-redaction tests in `apps/api/tests/platform.test.ts`)
- [X] T014 Write failing tests, then implement the Fastify app factory — error handler mapping every failure to the contract error envelope (no stack traces), security headers (CSP, X-Content-Type-Options, frame-ancestors), `@fastify/rate-limit` per-IP baseline, Origin check on state-changing routes, Zod validation hook — in `apps/api/src/app.ts` (tests in `apps/api/tests/app.test.ts`; depends on T008, T013)
- [X] T015 Write failing tests, then implement session platform: `sid` HttpOnly/Secure/SameSite=Lax cookie, session lookup + rolling expiry validation, `requireMember`/`requireAdmin` deny-by-default preHandlers in `apps/api/src/platform/sessions.ts` (tests in `apps/api/tests/sessions.test.ts`; depends on T010, T014)
- [X] T016 [P] Write failing tests, then implement the append-only audit writer (INSERT only; event_type, user_id, jsonb data — never source code or secrets) in `apps/api/src/platform/audit.ts` (tests in `apps/api/src/platform/audit.test.ts`)
- [X] T017 Write failing `fastify.inject` tests, then implement the auth slice — POST register (argon2id hash, 409 on duplicate), POST login (uniform 401 message, sets `sid`), POST logout (server-side revocation), GET me — with `auth.login`/`auth.login_failed`/`auth.register`/`auth.logout` audit events, in `apps/api/src/features/auth/` (tests in `apps/api/src/features/auth/auth.test.ts`; depends on T015, T016)
- [X] T018 Create the seed script wired to `npm run db:seed`: one admin user, one member user, two published sample problems with starter code and ≥1 visible + ≥1 hidden test case each, in `infra/db/seed.ts` (depends on T010)
- [X] T019 Scaffold the React SPA shell test-first: Vite config with `/api` → `:3000` proxy, router, session state store, typed API client generated from `packages/contracts` schemas in `apps/web/src/platform/` (api-client.ts, session.ts) and `apps/web/src/App.tsx` (client + session-store tests in `apps/web/src/platform/api-client.test.ts`)

**Checkpoint**: migrations + seed run against dockerized Postgres; register/login/logout works via `fastify.inject`; SPA shell renders — user story implementation can now begin

---

## Phase 3: User Story 1 — Solve a Problem (Priority: P1) 🎯 MVP

**Goal**: A signed-in user browses the catalog, opens a problem, writes code in the in-browser editor (drafts preserved), submits, and receives a correct verdict with per-test feedback within seconds — with hostile submissions fully contained.

**Independent Test**: Seed one problem with test cases; submit a correct solution, a wrong one, and each hostile fixture; verify each receives the appropriate verdict within limits and platform stability is unaffected (quickstart Manual scenario 1, SC-001/SC-004).

### Sandbox & containment tests (MUST precede evaluation implementation — Principle V)

- [X] T020 [P] [US1] Build the Python sandbox image: minimal Dockerfile (python:3.12, non-root 65534, no package manager/shell tooling) + `profile.json` declaring compile (`python -m py_compile main.py`), run (`python main.py`), and default limits in `infra/sandbox/python312/`
- [X] T021 [P] [US1] Build the Node sandbox image: minimal Dockerfile (node:22, non-root, runtime only) + `profile.json` declaring `node --check main.js` / `node main.js` and default limits in `infra/sandbox/node22/`
- [X] T022 [US1] Write the hostile-submission containment suite FIRST (failing until T026): one fixture per row of the sandbox contract's containment table — infinite loop, fork bomb, memory bomb, filesystem probe, network probe, 100 MB output, script-injection output — asserting mapped verdict, bounded completion time, and host unaffected, in `apps/worker/tests/hostile/containment.test.ts` with fixtures in `apps/worker/tests/hostile/fixtures/` (depends on T020, T021)

### Evaluation worker

- [X] T023 [US1] Implement the dockerode sandbox runner enforcing the full hardening profile from contracts/sandbox-profile.md — network=none, user 65534, read-only rootfs + noexec tmpfs /scratch, cap-drop ALL, no-new-privileges, pids/memory(=swap)/cpus/ulimit limits, --init, fresh container per run force-removed after, wall-clock kill, CPU-time check from container stats → TLE, streamed 1 MB output cap — in `apps/worker/src/platform/docker.ts` (runner-level containment tests from T022 begin passing; depends on T022)
- [X] T024 [P] [US1] Write failing tests, then implement pure worker kernel logic: exit-status→verdict mapping, trailing-whitespace-normalized output comparison, first-non-pass verdict fold with early stop on hidden failures, in `apps/worker/src/kernel/verdict.ts` (tests in `apps/worker/src/kernel/verdict.test.ts`)
- [X] T025 [US1] Implement worker platform edges test-first: `worker_role` Kysely connection (no users/sessions access), pg-boss subscription with bounded concurrency (2), per-job retry limit, dead-letter handler marking `verdict='system_error'`, and an INSERT-only audit writer, in `apps/worker/src/platform/` (db.ts, queue.ts, audit.ts; tests in `apps/worker/tests/platform.test.ts`; depends on T010, T011)
- [X] T026 [US1] Write failing tests, then implement the evaluate slice: consume job → load submission + ordered test cases → compile step (compile_error short-circuits) → run each case piping stdin, compare stdout → persist `submission_test_results` (actual_output only for visible cases, 4 KB truncation) → update status queued→running→complete + verdict/resource stats → `submission.completed` audit event, in `apps/worker/src/features/evaluate/` (tests in `apps/worker/src/features/evaluate/evaluate.test.ts`; full hostile suite T022 green here; depends on T023, T024, T025)

### API slices

- [X] T027 [P] [US1] Write failing `fastify.inject` tests, then implement the problems slice: GET `/api/problems` (published only, difficulty/tag filters) and GET `/api/problems/:slug` (statement, limits, starter code, visible test cases only; 404 for drafts/unknown) in `apps/api/src/features/problems/` (tests in `apps/api/src/features/problems/problems.test.ts`)
- [X] T028 [P] [US1] Write failing tests, then implement the drafts slice: GET/PUT `/api/problems/:slug/draft` (member-only, owner-scoped upsert keyed user+problem+language, ≤100 KB) in `apps/api/src/features/drafts/` (tests in `apps/api/src/features/drafts/drafts.test.ts`)
- [X] T029 [US1] Write failing tests, then implement submission creation: POST `/api/problems/:slug/submissions` — FR-005 pre-execution validation (session, language allowlist, 1 B–100 KB source) → insert `queued` row → enqueue pg-boss job → `submission.created` audit; per-user rate limit 6/min returning 429 + Retry-After, in `apps/api/src/features/submissions/create.ts` (tests in `apps/api/src/features/submissions/create.test.ts`; depends on T014, T017)
- [X] T030 [US1] Write failing tests, then implement submission status: GET `/api/submissions/:id` — owner-scoped (non-owner indistinguishable 404), full detail shape from contracts/api.md, `firstFailure` with hidden-case redaction (caseIndex + visible:false only), in `apps/api/src/features/submissions/detail.ts` (tests in `apps/api/src/features/submissions/detail.test.ts`; depends on T029)
- [X] T031 [US1] Write the end-to-end solve-loop integration test: seeded problem, submit correct / wrong-output / infinite-loop Python solutions through the API with the real worker + sandboxes → accepted, wrong_answer (with first failing visible case), time_limit_exceeded, each within 10 s, in `apps/api/tests/solve-loop.e2e.test.ts` (depends on T026, T030)

### Web UI

- [X] T032 [P] [US1] Write failing component tests, then build the catalog page: fetch + render problem list with difficulty/tag filters in `apps/web/src/features/catalog/CatalogPage.tsx` (tests in `apps/web/src/features/catalog/CatalogPage.test.tsx`)
- [X] T033 [US1] Write failing component tests, then build the problem page: sanitized-markdown statement, visible example cases, CodeMirror 6 editor with Python/JavaScript modes and language picker (versions shown), starter-code load, debounced draft autosave + restore via drafts API in `apps/web/src/features/problem/ProblemPage.tsx` (tests in `apps/web/src/features/problem/ProblemPage.test.tsx`; depends on T028, T032)
- [X] T034 [US1] Write failing component tests, then build the submission flow: submit action, queued/running polling of GET `/api/submissions/:id` at 2 s, verdict panel (verdict, tests passed/total, runtime, first-failure input/expected/actual for visible cases) — all user code and program output rendered as inert text nodes (FR-010) in `apps/web/src/features/problem/SubmissionResult.tsx` (tests in `apps/web/src/features/problem/SubmissionResult.test.tsx`, including a script-injection-output-rendered-as-text assertion; depends on T030, T033)
- [X] T035 [US1] Story checkpoint: build sandbox images, run `npm run test:hostile` and the quickstart Manual scenario 1 locally; confirm the CI hostile-containment job (T006) now runs and passes; verify verdicts < 10 s (SC-001) and containment (SC-004); record results in `specs/001-code-challenge-platform/checklists/us1-validation.md`

**Checkpoint**: User Story 1 fully functional and independently testable — deployable MVP

---

## Phase 4: User Story 2 — Account & Submission History (Priority: P2)

**Goal**: Users manage their account end-to-end (including password reset), see per-problem submission history with verdicts and code, and see solved status in the catalog — with strict cross-user isolation.

**Independent Test**: Register an account, make several submissions, verify history shows only that user's submissions with correct verdicts and solved status, and that another user's direct access attempts are denied (quickstart Manual scenario 2, SC-005).

- [ ] T036 [P] [US2] Write failing tests, then implement password reset: POST request (202 always — no enumeration; sha-256-hashed single-use 1 h token; raw token delivered via a dedicated structured-log event per research R14 — never in the API response; `auth.password_reset` audit) and POST confirm (400 invalid/expired/used) in `apps/api/src/features/auth/password-reset.ts` (tests in `apps/api/src/features/auth/password-reset.test.ts`)
- [ ] T037 [P] [US2] Write failing tests, then implement submission history: GET `/api/problems/:slug/submissions` returning only the caller's submissions, newest first, summary shape, in `apps/api/src/features/submissions/history.ts` (tests in `apps/api/src/features/submissions/history.test.ts`)
- [ ] T038 [US2] Write failing tests, then add solved status: `solved` flag on catalog + detail responses via the accepted-verdict partial index, false/absent for anonymous, in `apps/api/src/features/problems/` (tests extend `apps/api/src/features/problems/problems.test.ts`; depends on T027)
- [ ] T039 [US2] Write the cross-slice authorization matrix test: user B reads user A's submission/draft → 404, anonymous hits member routes → 401, every member route deny-by-default, in `apps/api/tests/authz-matrix.test.ts` (depends on T036, T037, T038)
- [ ] T040 [P] [US2] Write failing component tests, then build web auth pages: register, login, logout, password-reset request/confirm forms with session-aware navigation in `apps/web/src/features/auth/` (RegisterPage.tsx, LoginPage.tsx, ResetPage.tsx; tests in `apps/web/src/features/auth/auth-pages.test.tsx`)
- [ ] T041 [US2] Write failing component tests, then build web history + profile: per-problem submission history (verdict, language, time, submitted code as inert text), profile page with solved count, solved checkmarks in the catalog, in `apps/web/src/features/submissions/HistoryPage.tsx` and `apps/web/src/features/profile/ProfilePage.tsx` (tests in `apps/web/src/features/submissions/HistoryPage.test.tsx`; depends on T037, T038, T040)
- [ ] T042 [US2] Story checkpoint: run quickstart Manual scenario 2 (isolation & ownership) end-to-end; verify SC-005; record results in `specs/001-code-challenge-platform/checklists/us2-validation.md`

**Checkpoint**: User Stories 1 AND 2 work independently; cross-user isolation proven

---

## Phase 5: User Story 3 — Problem Authoring & Administration (Priority: P3)

**Goal**: Admins create, edit, publish, and unpublish problems (statement, difficulty, tags, starter code, visible+hidden test cases, limits); drafts stay invisible to non-admins; authoring is admin-only.

**Independent Test**: Admin creates a draft with test cases → invisible in public catalog; publish → visible and solvable end-to-end; member hitting any `/api/admin/*` route gets 403 (quickstart Manual scenario 3).

- [ ] T043 [US3] Write the admin authorization tests FIRST: every `/api/admin/*` route returns 403 for member and anonymous callers (failing until T044/T045) in `apps/api/tests/admin-authz.test.ts`
- [ ] T044 [US3] Write failing tests, then implement admin problem CRUD: POST `/api/admin/problems` (creates draft), PATCH `/api/admin/problems/:id`, PUT `/api/admin/problems/:id/test-cases` (full ordered replace), GET `/api/admin/problems` (includes drafts), all behind `requireAdmin`, in `apps/api/src/features/admin-problems/` (tests in `apps/api/src/features/admin-problems/admin-problems.test.ts`; depends on T043)
- [ ] T045 [US3] Write failing tests, then implement publish/unpublish: POST publish (422 unless ≥1 visible + ≥1 hidden case and all fields valid) and POST unpublish, with `problem.published`/`problem.unpublished` audit events, in `apps/api/src/features/admin-problems/publish.ts` (tests in `apps/api/src/features/admin-problems/publish.test.ts`; depends on T044)
- [ ] T046 [P] [US3] Write failing component tests, then build the web admin UI: admin-only routes, problem form (statement, difficulty, tags, limits, per-language starter code), test-case editor with visible/hidden flags and ordering, draft/preview/publish controls, in `apps/web/src/features/admin/` (AdminProblemsPage.tsx, ProblemForm.tsx, TestCaseEditor.tsx; tests in `apps/web/src/features/admin/ProblemForm.test.tsx`)
- [ ] T047 [US3] Story checkpoint: run quickstart Manual scenario 3 (draft invisible → publish → solve end-to-end; member 403); record results in `specs/001-code-challenge-platform/checklists/us3-validation.md`

**Checkpoint**: All three user stories independently functional

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Production posture, audit/limits verification, load validation, docs, deploy

- [ ] T048 [P] Containerize the three apps and add the production profile to `infra/docker-compose.yml`: multi-stage Dockerfiles in `apps/api/Dockerfile`, `apps/worker/Dockerfile`, `apps/web/Dockerfile` (only the worker service mounts the Docker socket — Principle II), api/worker/web services in the prod profile, and a Caddy front container with auto-HTTPS (HTTP→HTTPS redirect, HSTS), serving the built SPA and proxying `/api`, with Caddyfile in `infra/caddy/Caddyfile`
- [ ] T049 [P] Write the audit & rate-limit verification test: 7 submissions in a minute → 7th is 429 with Retry-After; every submission/auth action has an `audit_events` row; `UPDATE audit_events` as `api_role` → permission denied, in `apps/api/tests/audit-and-limits.test.ts`
- [ ] T050 [P] Write the concurrency load check for SC-003: script driving 100 concurrent users submitting solutions, asserting zero lost submissions and no cross-user interference, in `scripts/load-check.ts`
- [ ] T051 Write the project README covering setup, run, and validation commands from quickstart.md in `README.md`
- [ ] T052 Full validation pass: run the complete quickstart (automated validation + all four manual scenarios), then deploy to the GCP `e2-micro` VM per quickstart's production section and re-run Manual scenario 1 against the public URL, verifying HTTPS redirect and security headers (depends on T048)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: no dependencies — start immediately
- **Foundational (Phase 2)**: depends on Setup — BLOCKS all user stories
- **US1 (Phase 3)**: depends on Foundational only
- **US2 (Phase 4)**: depends on Foundational; T038/T039/T041 build on US1's endpoints (T027, T029, T030) — schedule after US1 for incremental delivery
- **US3 (Phase 5)**: depends on Foundational; end-to-end validation (T047) exercises US1's solve loop
- **Polish (Phase 6)**: depends on all desired stories being complete

### Key Task-Level Dependencies

- T008 ← T007; T010 ← T009; T011 ← T010; T014 ← T008+T013; T015 ← T010+T014; T017 ← T015+T016
- **T022 (hostile suite) MUST be written before T023/T026 (constitution Principle V)**
- T023 ← T020+T021+T022; T026 ← T023+T024+T025; T031 ← T026+T030
- T029 ← T014+T017; T030 ← T029; T034 ← T030+T033
- T039 ← T036+T037+T038; T045 ← T044 ← T043
- T052 ← T048 (app Dockerfiles + prod compose services must exist before deploy)

### Within Each User Story

- Tests are written first and must fail before implementation (TDD, non-negotiable)
- Sandbox images/profiles → containment tests → runner → kernel → evaluate slice → API endpoints → UI
- Story checkpoint task last — validate before starting the next story

---

## Parallel Examples

```text
# Phase 1 (after T001–T002):
T003 (eslint) ║ T004 (vitest) ║ T005 (compose) ║ T006 (CI)

# Phase 2:
T007 (contracts) ║ T009 (migrator) ║ T012 (kernel) ║ T013 (platform) ║ T016 (audit)

# US1 — sandbox images together, then independent tracks:
T020 (python image) ║ T021 (node image)
T024 (verdict kernel) ║ T027 (problems slice) ║ T028 (drafts slice) ║ T032 (catalog UI)

# US2:
T036 (password reset) ║ T037 (history) ║ T040 (auth UI)

# Polish:
T048 (caddy) ║ T049 (audit test) ║ T050 (load check)
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Phase 1: Setup → Phase 2: Foundational (blocking)
2. Phase 3: US1 — sandbox + containment suite first, then worker, API slices, UI
3. **STOP and VALIDATE** at T035: hostile suite green, quickstart scenario 1 passes
4. This alone is a demoable, deployable MVP (seeded problems, solve loop, safe evaluation)

### Incremental Delivery

1. Setup + Foundational → foundation ready (auth, schema, contracts, SPA shell)
2. **US1** → validate (T035) → deploy/demo — MVP!
3. **US2** → validate (T042) → deploy/demo — accounts, history, solved status
4. **US3** → validate (T047) → deploy/demo — self-serve authoring
5. Polish → production deploy on GCP (T052)

Each story lands without breaking previous stories; every checkpoint is a working, testable increment.

---

## Notes

- [P] tasks = different files, no dependencies on incomplete tasks
- TDD applies to every task: failing test → minimal implementation → refactor; FP/immutability rules enforced by ESLint (T003)
- TDD scope exceptions (declarative artifacts with no unit-testable logic): T001–T002/T005 (scaffolding/compose), T018 (seed data), T020–T021 (Dockerfiles — behavior verified by the T022 containment suite), T048 (Dockerfiles/Caddyfile — verified by T052), T051 (docs). Everything else names its test file explicitly.
- Changes to `infra/sandbox/`, auth, or authorization are security-relevant and require security-focused review per the constitution
- Commit after each task or logical group; stop at any story checkpoint to validate independently
