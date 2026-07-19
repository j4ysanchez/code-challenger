# US1 Story Checkpoint: Solve a Problem (MVP)

**Purpose**: Validate User Story 1 is independently functional and deployable per tasks.md T035
**Date**: 2026-07-18
**Plan**: [plan.md](../plan.md) | **Tasks**: [tasks.md](../tasks.md)

## Automated validation

- [x] `npm run typecheck` — clean across `contracts`, `api`, `worker`, `web`, `infra/db`
- [x] `npm run lint` — clean (ESLint flat config, functional rules, typescript-eslint strict)
- [x] `npm test` — 224 tests passed across 25 files (contracts, infra, api, worker, hostile, web projects)
- [x] `npm run test:hostile` — 15/15 hostile-submission containment assertions pass:
  infinite loop, fork bomb, memory bomb, filesystem probe, network probe, 100 MB output,
  and script-injection output, each for both `python` and `javascript` sandboxes, plus a
  final check that no sandbox containers are left running on the host afterward
- [x] `apps/api/tests/solve-loop.e2e.test.ts` — real API + real worker + real Docker
  sandboxes: correct solution → accepted, wrong-output solution → wrong_answer with the
  first failing visible case, infinite loop → time_limit_exceeded

## Manual scenario 1 (quickstart.md, SC-001/SC-004) — run against the live dev stack

Ran `npm run dev:api`, `npm run dev:worker`, `npm run dev:web` against the seeded
Postgres (`npm run db:migrate && npm run db:seed`) and drove the real browser UI
(Playwright, headless Chromium) end-to-end:

1. Registered a user, opened the seeded **Sum Two Numbers** problem.
2. Submitted the correct solution → **Accepted**, 2/2 tests passed, runtime shown —
   **4.3 s** end-to-end (well under the 10 s target, SC-001).
3. Submitted a wrong-output variant → **Wrong Answer**, first failing visible case's
   input/expected/actual shown — **4.3 s**.
4. Submitted `while True: pass` → **Time Limit Exceeded** — **8.4 s** (bounded by the
   problem's 10 s wall-time limit, as expected for a genuine timeout) — a second,
   independent browser context loaded the catalog successfully while the first
   submission was still being evaluated, confirming the site stays responsive under a
   running hostile submission (SC-004).
5. No page or console errors beyond the expected pre-login 401 on session restore.

## CI hostile-containment job (T006)

- [x] `infra/sandbox/python312/` and `infra/sandbox/node22/` now exist, so the
  `hostile-containment` job in `.github/workflows/ci.yml` no longer short-circuits and
  will build both sandbox images and run `npm run test:hostile` on every push/PR.

## Gaps found and fixed during this checkpoint

- **pg-boss schema ownership**: `apps/api`'s real enqueue path (`createEnqueueClient`)
  had never been exercised end-to-end before this checkpoint (route tests inject a fake
  `enqueue`). Running the real `dev:api` server surfaced `permission denied for table
  version` — whichever of `api_role`/`worker_role` called `pg-boss`'s `boss.start()`
  first ended up owning its tables, leaving the other role without access. Fixed by
  having `infra/db/migrations/0002_roles_grants.ts` construct the pg-boss schema itself
  (via pg-boss's own `getConstructionPlans('pgboss')`) as `migrator_role`, so the
  already-granted default privileges cover it for both roles regardless of which
  service starts first.
- **worker entrypoint**: `apps/worker/src/index.ts` was still the Phase 2 placeholder;
  nothing wired `evaluateSubmission`/the dead-letter handler to the real queue for
  `npm run dev:worker` to do anything. Added the real startup wiring plus a
  `markSubmissionAsSystemError` dead-letter handler (with a test) that marks a
  submission `system_error` if its job exhausts every pg-boss retry.
- **sandbox tmpfs permissions**: the worker-owned `/scratch` tmpfs mounted root-owned
  0755 by default, so the sandbox's non-root uid 65534 couldn't `mkdir` (e.g. Python's
  `__pycache__`) inside its own scratch space. Fixed via explicit
  `uid=65534,gid=65534,mode=0755` tmpfs mount options in `apps/worker/src/platform/docker.ts`.
- **dockerode attach() body-injection bug**: `container.attach({hijack:true, stdin:true, ...})`
  leaked its own JSON-stringified options onto the hijacked stdin stream (a
  docker-modem quirk), corrupting program input. Worked around by attaching over a raw
  HTTP request to the same Docker Engine endpoint instead of dockerode's wrapper.

## Checkpoint result

**PASS** — User Story 1 (solve loop) is independently functional, hostile-submission
containment holds, and the story is a demoable, deployable MVP per the incremental
delivery plan.
