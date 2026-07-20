# Code Challenger

A LeetCode-style code challenge platform: browse problems, write solutions in an
in-browser editor (Python or JavaScript), and get verdicts from a sandboxed evaluation
worker. TypeScript monorepo — Fastify API, React SPA, and an evaluation worker that
runs each submission in a hardened, ephemeral Docker container — backed by PostgreSQL.

See [specs/001-code-challenge-platform/](specs/001-code-challenge-platform/) for the
full spec, plan, and API/sandbox contracts.

## Prerequisites

- Node.js 22 LTS and npm 10+
- Docker Engine 27+ with Compose v2 (the worker talks to the local Docker socket)
- ~2 GB free RAM (Postgres + api + worker + sandbox runs)

## Setup

```bash
npm install
cp .env.example .env                 # local secrets — never committed
npm run db:up                        # Postgres via infra/docker-compose.yml
npm run db:migrate                   # schema + per-service roles + pg-boss schema
npm run db:seed                      # seeds admin/member users + 2 sample problems
docker build -t sandbox-python312 infra/sandbox/python312
docker build -t sandbox-node22    infra/sandbox/node22
```

Seeded logins: `admin@example.com` / `admin-seed-pw` and `member@example.com` /
`member-seed-pw`.

## Run

Three services, each in its own terminal:

```bash
npm run dev:api      # Fastify API on :3000
npm run dev:worker   # evaluation worker (needs the Docker socket)
npm run dev:web      # Vite dev server on :5173, proxying /api → :3000
```

Open **http://localhost:5173** and either **Register** a new account or **Log in**
with one of the seeded logins above. Open a problem, edit the code, and hit
**Submit**. Signed-in users also get draft autosave, submission history, and
solved-status badges in the catalog.

Log in as the seeded admin to author problems: click **Admin** in the nav to create
a draft problem, add visible/hidden test cases, and publish it — see
[specs/001-code-challenge-platform/quickstart.md](specs/001-code-challenge-platform/quickstart.md)
for the full manual walkthrough of each user story.

## Validation

```bash
npm run typecheck && npm run lint    # strict TS + functional ESLint rules
npm test                             # unit + integration suites (Vitest)
npm run test:hostile                 # hostile-submission containment vs real sandboxes
```

`test:hostile` runs every fixture in the sandbox contract's containment table (infinite
loop, fork bomb, memory bomb, filesystem/network escape attempts, oversized output,
script-injection output) against the real Docker images and asserts the mapped verdict,
a bounded completion time, and that no sandbox container is left running afterward.

## Current status

All three user stories are complete and demoable:

- **User Story 1 — Solve a problem**: catalog with difficulty/tag filters, problem
  page with a CodeMirror editor (Python/JavaScript) and debounced draft autosave, and
  submit → real sandboxed execution → verdict (accepted / wrong_answer /
  time_limit_exceeded / memory_limit_exceeded / runtime_error / compile_error) with
  first-failing-case detail. See
  [us1-validation.md](specs/001-code-challenge-platform/checklists/us1-validation.md).
- **User Story 2 — Account & submission history**: register/login/logout,
  password reset (request/confirm), per-problem submission history, and
  solved-status checkmarks in the catalog, with strict cross-user ownership
  isolation on every submission/draft/history read. See
  [us2-validation.md](specs/001-code-challenge-platform/checklists/us2-validation.md).
- **User Story 3 — Problem authoring & administration**: admin-only UI to create
  draft problems, edit their statement/difficulty/tags/limits/starter code, manage
  visible and hidden test cases, and publish/unpublish — drafts stay invisible to
  non-admins until published. See
  [us3-validation.md](specs/001-code-challenge-platform/checklists/us3-validation.md).

Remaining: Phase 6 polish — production Docker Compose profile + Caddy TLS front,
an audit/rate-limit verification test, a concurrency load check, and the GCP
Compute Engine deploy (see [tasks.md](specs/001-code-challenge-platform/tasks.md)).
