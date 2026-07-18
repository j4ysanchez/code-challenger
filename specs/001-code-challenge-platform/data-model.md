# Data Model: Code Challenge Platform (MVP)

**Date**: 2026-07-16 | **Plan**: [plan.md](plan.md) | **Store**: PostgreSQL 16

All tables use UUID primary keys (`gen_random_uuid()`) and `timestamptz` timestamps
unless noted. Access is split across roles per plan (Principle II): `api_role`,
`worker_role`, `migrator_role`. pg-boss owns its own schema (`pgboss`) and is not
modeled here.

## Entities

### users

| Column | Type | Constraints |
|--------|------|-------------|
| id | uuid | PK |
| email | citext | UNIQUE, NOT NULL, valid-email checked at API boundary |
| password_hash | text | NOT NULL (argon2id) |
| role | text | NOT NULL, CHECK in ('member','admin'), default 'member' |
| created_at | timestamptz | NOT NULL default now() |

Access: `api_role` full CRUD; `worker_role` **none**.

### sessions

| Column | Type | Constraints |
|--------|------|-------------|
| id | uuid | PK (session token = unguessable id, sent as HttpOnly cookie) |
| user_id | uuid | FK → users, NOT NULL, ON DELETE CASCADE |
| created_at | timestamptz | NOT NULL |
| expires_at | timestamptz | NOT NULL (rolling 30-day max, validated on every request) |

Access: `api_role` only.

### password_reset_tokens

| Column | Type | Constraints |
|--------|------|-------------|
| token_hash | text | PK (sha-256 of the token; raw token only ever e-mailed) |
| user_id | uuid | FK → users, NOT NULL |
| expires_at | timestamptz | NOT NULL (1 hour) |
| used_at | timestamptz | NULL until consumed (single-use) |

Access: `api_role` only.

### problems

| Column | Type | Constraints |
|--------|------|-------------|
| id | uuid | PK |
| slug | text | UNIQUE, NOT NULL, kebab-case |
| title | text | NOT NULL |
| statement_md | text | NOT NULL (markdown, rendered sanitized) |
| difficulty | text | NOT NULL, CHECK in ('easy','medium','hard') |
| tags | text[] | NOT NULL default '{}' |
| status | text | NOT NULL, CHECK in ('draft','published'), default 'draft' |
| cpu_time_limit_ms | int | NOT NULL default 2000 |
| wall_time_limit_ms | int | NOT NULL default 10000 |
| memory_limit_mb | int | NOT NULL default 256 |
| created_at / updated_at | timestamptz | NOT NULL |

State transitions: `draft → published` (publish), `published → draft` (unpublish).
Only `status='published'` rows are visible to non-admins — enforced in every
catalog/detail/submission query.

Access: `api_role` full; `worker_role` SELECT (limits only).

### starter_code

| Column | Type | Constraints |
|--------|------|-------------|
| problem_id | uuid | FK → problems, ON DELETE CASCADE |
| language | text | CHECK in ('python','javascript') |
| code | text | NOT NULL, ≤ 100 KB |

PK (problem_id, language). Access: `api_role`.

### test_cases

| Column | Type | Constraints |
|--------|------|-------------|
| id | uuid | PK |
| problem_id | uuid | FK → problems, NOT NULL, ON DELETE CASCADE |
| position | int | NOT NULL; UNIQUE (problem_id, position) — evaluation order |
| input | text | NOT NULL (fed to stdin) |
| expected_output | text | NOT NULL (compared to stdout, trailing-whitespace-normalized) |
| visible | boolean | NOT NULL — visible cases may be revealed on failure; hidden never |

Access: `api_role` (admin slice writes; problem slice SELECTs only `visible=true`
contents); `worker_role` SELECT.

**Invariant (FR-008)**: hidden case `input`/`expected_output` never leave the
api/worker trust boundary — API responses may reference hidden cases only by index
and pass/fail.

### submissions

| Column | Type | Constraints |
|--------|------|-------------|
| id | uuid | PK |
| user_id | uuid | FK → users, NOT NULL |
| problem_id | uuid | FK → problems, NOT NULL |
| language | text | NOT NULL, CHECK in ('python','javascript') |
| source_code | text | NOT NULL, ≤ 100 KB (validated pre-insert, FR-005) |
| status | text | NOT NULL, CHECK in ('queued','running','complete'), default 'queued' |
| verdict | text | NULL until complete; CHECK in ('accepted','wrong_answer','time_limit_exceeded','memory_limit_exceeded','runtime_error','compile_error','system_error') |
| tests_passed / tests_total | int | NULL until complete |
| max_runtime_ms / max_memory_kb | int | NULL until complete |
| created_at | timestamptz | NOT NULL |
| completed_at | timestamptz | NULL until complete |

State machine: `queued → running → complete` (worker-owned transitions; a crashed
job is retried by pg-boss, then dead-lettered to `verdict='system_error'`).

Indexes: (user_id, problem_id, created_at DESC) for history; (problem_id, user_id,
verdict) partial on `verdict='accepted'` for solved status.

Ownership (FR-012): every API read is scoped `WHERE user_id = session.user_id`.

Access: `api_role` INSERT/SELECT; `worker_role` SELECT/UPDATE (status/verdict fields).

### submission_test_results

| Column | Type | Constraints |
|--------|------|-------------|
| submission_id | uuid | FK → submissions, ON DELETE CASCADE |
| test_case_id | uuid | FK → test_cases |
| position | int | NOT NULL |
| passed | boolean | NOT NULL |
| runtime_ms / memory_kb | int | NOT NULL |
| actual_output | text | NULL; stored **only for visible cases**, truncated to 4 KB |

PK (submission_id, test_case_id). Access: `worker_role` INSERT; `api_role` SELECT.

### drafts

| Column | Type | Constraints |
|--------|------|-------------|
| user_id | uuid | FK → users, ON DELETE CASCADE |
| problem_id | uuid | FK → problems, ON DELETE CASCADE |
| language | text | CHECK in ('python','javascript') |
| code | text | NOT NULL, ≤ 100 KB |
| updated_at | timestamptz | NOT NULL |

PK (user_id, problem_id, language). Owner-only access via `api_role`.

### audit_events (append-only)

| Column | Type | Constraints |
|--------|------|-------------|
| id | bigint | PK, identity |
| event_type | text | NOT NULL — e.g. 'submission.created', 'submission.completed', 'auth.login', 'auth.login_failed', 'auth.password_reset', 'problem.published' |
| user_id | uuid | NULL for anonymous events |
| data | jsonb | NOT NULL — verdict, resource usage, ip, etc. **Never source code or secrets.** |
| created_at | timestamptz | NOT NULL default now() |

Append-only enforced by grants: `api_role` and `worker_role` get INSERT + SELECT
only; no UPDATE/DELETE granted to any runtime role (Principle V / FR-013).

## Relationships

```text
users 1──* sessions
users 1──* password_reset_tokens
users 1──* submissions *──1 problems
users 1──* drafts *──1 problems
problems 1──* test_cases
problems 1──* starter_code
submissions 1──* submission_test_results *──1 test_cases
users 1──* audit_events (nullable)
```

## Validation rules (enforced at API boundary via shared Zod schemas)

- email: RFC-shaped, ≤ 254 chars; password: 8–128 chars (no composition rules,
  breached-password guidance deferred post-MVP)
- language: allowlist `('python','javascript')` — single source of truth in
  `packages/contracts`
- source/draft/starter code: 1 byte – 100 KB
- slug: `^[a-z0-9]+(-[a-z0-9]+)*$`, ≤ 64 chars; title ≤ 200 chars; tags ≤ 10 × 32 chars
- resource limits (admin input): cpu 100–10000 ms, wall 1–30 s, memory 32–1024 MB
- test case input/expected_output ≤ 1 MB each; ≥ 1 visible and ≥ 1 hidden case
  required to publish a problem
