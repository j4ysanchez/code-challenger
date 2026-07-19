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

Open **http://localhost:5173**.

There's no register/login page in the UI yet, so get a session cookie from the browser
devtools console on `localhost:5173` for now:

```js
await fetch('/api/auth/register', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Origin: location.origin },
  body: JSON.stringify({ email: 'you@example.com', password: 'a-fine-password' }),
});
await fetch('/api/auth/login', {
  method: 'POST',
  credentials: 'include',
  headers: { 'Content-Type': 'application/json', Origin: location.origin },
  body: JSON.stringify({ email: 'you@example.com', password: 'a-fine-password' }),
});
```

Reload the page, open a seeded problem, edit the code, and hit **Submit**.

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

**User Story 1 (solve loop) is complete and demoable**: catalog with difficulty/tag
filters, problem page with a CodeMirror editor (Python/JavaScript) and debounced draft
autosave, and submit → real sandboxed execution → verdict (accepted / wrong_answer /
time_limit_exceeded / memory_limit_exceeded / runtime_error / compile_error) with
first-failing-case detail. See
[specs/001-code-challenge-platform/checklists/us1-validation.md](specs/001-code-challenge-platform/checklists/us1-validation.md)
for the checkpoint validation record.

Not yet built: register/login/password-reset pages, submission history, solved-status
badges, and problem authoring/admin UI (Phases 4–5 of
[tasks.md](specs/001-code-challenge-platform/tasks.md)).
