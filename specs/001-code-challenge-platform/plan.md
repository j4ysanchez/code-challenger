# Implementation Plan: Code Challenge Platform (MVP)

**Branch**: `main` | **Date**: 2026-07-16 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/001-code-challenge-platform/spec.md`

## Summary

A LeetCode-style platform: users browse problems, write solutions in an in-browser
editor (Python or JavaScript), and receive verdicts from a secure evaluation pipeline.
Approach: a TypeScript monorepo with three deployables — a Fastify JSON API, a React
SPA, and an evaluation worker that runs each submission in an ephemeral hardened
Docker container — all on one GCP Compute Engine VM via Docker Compose, with PostgreSQL providing
storage, the job queue, and the append-only audit log. Code is organized in vertical
slices, written test-first in disciplined pure-functional TypeScript.

## Technical Context

**Language/Version**: TypeScript 5.x on Node.js 22 LTS (all services); sandbox
runtimes Python 3.12 and Node.js 22

**Primary Dependencies**: Fastify, Zod, Kysely + pg, pg-boss, dockerode, argon2,
pino, React 19 + Vite, CodeMirror 6, Vitest, eslint-plugin-functional

**Storage**: PostgreSQL 16 (relational data + pg-boss job queue + append-only
`audit_events`)

**Testing**: Vitest (unit + integration via `fastify.inject`); hostile-submission
containment suite against real sandbox containers; GitHub Actions CI (typecheck,
lint, tests, `npm audit`, CodeQL)

**Target Platform**: Single GCP Compute Engine `e2-micro` VM (amd64), Always Free
tier ($0), one of `us-west1` / `us-central1` / `us-east1`, running Docker Compose

**Project Type**: Web application — SPA frontend + JSON API + background evaluation
worker

**Performance Goals**: 95% of submissions receive a final verdict within 10 s
(SC-001); 100 concurrent users without lost submissions (SC-003)

**Constraints**: Minimal spend (one free-tier Compute Engine VM, no managed
services); 1 vCPU / 1 GB RAM budget shared across Postgres + api + worker + sandbox
runs; sandboxes have no
network and hard CPU/memory/pids/output limits; 100 KB max source size; pure-FP +
immutability + TDD per constitution v1.2.0

**Scale/Scope**: MVP — ~100 concurrent users, 2 launch languages, 3 user stories
(solve, history, authoring)

## Constitution Check

*GATE: evaluated against constitution v1.2.0 before Phase 0; re-checked after Phase 1
design — result: PASS, no Complexity Tracking entries required.*

| Principle | Design compliance |
|-----------|-------------------|
| I. Sandboxed Execution Isolation | One ephemeral hardened Docker container per run: `--network=none`, non-root, `--read-only` + tmpfs scratch, `--cap-drop=ALL`, no-new-privileges, seccomp, never reused. Worker↔sandbox interface is stdin/stdout/files only ([contracts/sandbox-profile.md](contracts/sandbox-profile.md)). Kernel-sharing trade-off and gVisor upgrade path documented in research R2. |
| II. Least Privilege | Docker socket mounted only in the worker container; API cannot spawn processes. Per-service Postgres roles: `api_role`, `worker_role` (no access to users/sessions), `migrator_role`. Secrets via env injection, never committed (research R13). |
| III. All Input Is Untrusted | Zod validation on every endpoint at the boundary; Kysely = parameterized-only SQL; React escapes output by default and program output/code rendered as text nodes only; submission size/language allowlist checked before enqueue (FR-005). |
| IV. Resource Limits & Abuse Prevention | Per-run cgroup CPU/memory/pids caps + wall-clock kill + output-size cap; pg-boss queue with bounded concurrency; `@fastify/rate-limit` per-IP + per-user submission limiter (research R6, R7). |
| V. Security Testing & Observability | Hostile-submission suite (TDD, ships before evaluation feature); pino structured logs without secrets/source; `audit_events` table with INSERT/SELECT-only grants; auth events logged; SCA + SAST in CI (research R11, R12). |
| VI. Vertical Slice Architecture | `features/<name>/` directories own route+validation+domain+data per slice; cross-slice sharing only via `packages/contracts` and `kernel/` primitives; each slice tested end-to-end via `fastify.inject` (structure below). |
| Workflow: FP / Immutability / TDD | Disciplined plain TS: readonly types, `Result<T,E>`, effects confined to `platform/`; enforced by eslint-plugin-functional + strict tsconfig; TDD required for every task (research R8, R11). |

## Project Structure

### Documentation (this feature)

```text
specs/001-code-challenge-platform/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/
│   ├── api.md           # JSON API contract (SPA ↔ API)
│   └── sandbox-profile.md  # Worker ↔ sandbox execution contract
└── tasks.md             # Phase 2 output (/speckit-tasks — not created here)
```

### Source Code (repository root)

```text
package.json                 # npm workspaces monorepo
packages/
└── contracts/               # Zod schemas + types shared api/web/worker
    └── src/                 # (verdicts, request/response shapes, language ids)

apps/
├── api/                     # Fastify JSON API (no Docker socket)
│   ├── src/
│   │   ├── features/        # vertical slices (route+validation+domain+data each)
│   │   │   ├── auth/            # register, login, logout, password reset
│   │   │   ├── problems/        # catalog list + detail (published only)
│   │   │   ├── drafts/          # per-user draft save/load
│   │   │   ├── submissions/     # create (validate→enqueue), status, history
│   │   │   └── admin-problems/  # draft/publish CRUD, test cases (admin role)
│   │   ├── kernel/          # pure shared primitives: Result, ids, verdict types
│   │   └── platform/        # effect edges: db, sessions, queue, clock, logger
│   └── tests/               # cross-slice integration (authz matrix, rate limits)
├── worker/                  # evaluation service (only holder of Docker socket)
│   ├── src/
│   │   ├── features/
│   │   │   └── evaluate/    # job consumer, compile/run per test, verdict fold
│   │   ├── kernel/          # pure verdict/aggregation logic
│   │   └── platform/        # docker (dockerode), db, queue subscriptions
│   └── tests/               # hostile-submission containment suite
└── web/                     # React SPA (Vite)
    └── src/
        ├── features/        # catalog, problem+editor, submissions, auth, admin
        └── platform/        # api client (from contracts), session state

infra/
├── docker-compose.yml       # postgres, api, worker, web (static), migrations
├── sandbox/
│   ├── python312/           # Dockerfile + profile.json (limits)
│   └── node22/              # Dockerfile + profile.json
└── db/                      # role grants (api/worker/migrator), init scripts
```

**Structure Decision**: npm-workspaces monorepo with three deployables (`apps/api`,
`apps/worker`, `apps/web`) and one shared contracts package. Slices live under each
app's `src/features/`; `packages/contracts` is the only cross-app sharing surface,
and `kernel/` vs `platform/` separates pure domain code from effectful edges per the
FP mandate. The api/worker split is a constitutional trust boundary (Principle II),
not a layering choice.

## Complexity Tracking

No constitution violations to justify — table intentionally empty.
