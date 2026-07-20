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

Log in as the seeded admin to author problems — see **Authoring a problem** below.

## Authoring a problem

Draft, test, and publish a new problem entirely through the admin UI:

1. Log in as `admin@example.com` / `admin-seed-pw` (or any account with the `admin`
   role). An **Admin** link appears in the nav.
2. Click **Admin**, then **New problem**. Fill in the form and click **Save**:
   - **Slug** — URL-safe id, e.g. `two-sum` (kebab-case, must be unique)
   - **Title**, **Statement (Markdown)**, **Difficulty**, **Tags** (comma-separated)
   - **CPU/wall time limit** and **memory limit** — defaults (2000 ms / 10000 ms /
     256 MB) are fine for most problems
   - **Python starter code** / **JavaScript starter code** — what solvers see
     pre-filled in the editor
   - Saving creates the problem with `status: draft` and takes you to its edit page.
3. On the edit page, use the **Test cases** section to add at least one **visible**
   case (shown to solvers, and revealed on a failing submission) and at least one
   **hidden** case (used for grading, never shown). Fill **Input** / **Expected
   output** per case, toggle **Visible** off for hidden cases, use **Add test case**
   for more rows, then click **Save test cases** — this fully replaces the problem's
   test cases each time.
4. A draft is invisible in the public catalog and its detail page 404s for everyone
   but admins. Back on **Admin**, click **Publish** on the problem's row once you
   have ≥1 visible and ≥1 hidden case — publishing fails with a 422 otherwise. The
   row updates to `published` and the problem now appears in the catalog and is
   solvable end-to-end.
5. **Unpublish** on the same row reverts it to `draft`, hiding it again without
   deleting its test cases or starter code.

Only admins can reach `/api/admin/*` — a member gets 403, an anonymous caller gets
401. See
[checklists/us3-validation.md](specs/001-code-challenge-platform/checklists/us3-validation.md)
for a full end-to-end run of this workflow (including the isolation checks above),
and
[specs/001-code-challenge-platform/quickstart.md](specs/001-code-challenge-platform/quickstart.md)
for the manual scenarios covering every user story.

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
