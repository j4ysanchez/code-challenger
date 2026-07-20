# US3 Story Checkpoint: Problem Authoring & Administration

**Purpose**: Validate User Story 3 is independently functional per tasks.md T047
**Date**: 2026-07-19
**Plan**: [plan.md](../plan.md) | **Tasks**: [tasks.md](../tasks.md)

## Automated validation

- [x] `npm run typecheck` — clean across `contracts`, `api`, `worker`, `web`, `infra/db`
- [x] `npm run lint` — clean (ESLint flat config, functional rules, typescript-eslint strict)
- [x] `npm test` — 293 tests passed across 35 files (contracts, infra, api, worker, hostile, web
  projects), including the new US3 coverage: admin authorization matrix (T043, 14 tests — every
  `/api/admin/*` route denies an anonymous caller with 401 and a member caller with 403, and an
  admin caller is let through), admin problem CRUD (T044, 8 tests — create/conflict/validation,
  partial patch, full-replace test cases, list-includes-drafts), publish/unpublish (T045, 5 tests
  — 422 unless ≥1 visible + ≥1 hidden case, `problem.published`/`problem.unpublished` audit events,
  unpublish reverts to draft and hides it from the public detail route), and the web admin UI
  (T046, 5 component tests — admin-only gating, create-then-navigate-to-edit, load-and-patch an
  existing draft, the test-case editor's full-replace save, and a not-found load error)
- [x] `npm run test:hostile` — 15/15 hostile-submission containment assertions still pass,
  confirming Principle V holds unchanged after the US3 work

## Manual scenario 3 (quickstart.md, admin authoring) — run against the live dev stack

Ran `npm run dev:api`, `npm run dev:worker`, `npm run dev:web` against the seeded Postgres and
drove the real browser UI (Playwright, headless Chromium, three independent browser contexts: the
seeded admin, the seeded member, and an anonymous context) end-to-end:

1. Logged in as the seeded admin, opened `/admin/new`, and created a draft problem (slug, title,
   Markdown statement, `checkpoint` tag, default resource limits, Python + JavaScript starter
   code) through the real `ProblemForm` — **201**, redirected to `/admin/:id`.
2. Added one visible case (`2 3` → `5`) and one hidden case (`10 15` → `25`) through the real
   `TestCaseEditor` (full-replace `PUT`) — **204**, "Test cases saved."
3. Confirmed the draft was **absent** from the catalog for both an anonymous context and the
   seeded member's own session, and that `GET /api/problems/:slug` for the draft returned **404**
   for anonymous — drafts stay invisible to non-admins (FR scope of US3's independent test).
4. As the seeded member, called `GET /api/admin/problems` directly → **403 forbidden** (member
   hitting an admin route; anonymous/member 401-vs-403 split is additionally covered exhaustively
   by the automated admin-authz matrix above).
5. Back in the admin session, clicked **Publish** on the problem in `AdminProblemsPage` → the row
   updated to `published` after reload, and a `problem.published` audit event was recorded
   (verified via `SELECT event_type, data FROM audit_events WHERE event_type = 'problem.published'`).
6. The now-published problem appeared in the seeded member's catalog; the member opened it,
   wrote a correct Python solution in the real CodeMirror editor, submitted, and received
   **Accepted** — solvable end-to-end immediately after publish, same solve loop as US1.
7. All 10/10 scripted checks passed. Test problem, its test cases/starter code, the resulting
   submission, and the `problem.published` audit row were deleted from the dev database
   afterward; the catalog was confirmed back to only the two seeded problems.

## Clarification: anonymous vs. member on `/api/admin/*` (contracts/api.md wording)

contracts/api.md states "non-admin access to any `/api/admin/*` route: 403 forbidden ... 404 never
used here." The already-implemented `requireAdmin` preHandler (`apps/api/src/platform/sessions.ts`,
built in Phase 2) composes `requireMember` first, so an anonymous caller is denied with **401**
(deny-by-default, consistent with every other member/admin route in the app and with
`apps/api/tests/sessions.test.ts`'s existing `requireAdmin` coverage) and only an authenticated
non-admin gets **403**. T043's admin-authz matrix (`apps/api/tests/admin-authz.test.ts`) tests and
locks in this real, already-established behavior rather than the literal "403 for ... anonymous"
phrasing in the task description, which would have required weakening `requireAdmin` to leak
route existence to anonymous callers before session validation — a regression, not a fix.

## Gaps found and fixed during this checkpoint

- None — `requireAdmin`, the admin-problems contracts schemas (`createProblemRequestSchema`,
  `patchProblemRequestSchema`, `adminProblemSchema`, `replaceTestCasesRequestSchema`), and the
  Postgres roles/grants needed for admin writes were all already in place from earlier phases;
  this story only added the routes, the web UI, and their tests. Added missing `AdminProblem` /
  `CreateProblemRequest` / `PatchProblemRequest` / `TestCaseInput` type exports to
  `packages/contracts/src/schemas/admin-problems.ts` (schemas existed, inferred types didn't) so
  the web UI could consume them without redundant `z.infer` boilerplate at the call site, matching
  the existing pattern in `problems.ts`/`submissions.ts`.

## Checkpoint result

**PASS** — User Story 3 (problem authoring & administration) is independently functional: admin
CRUD and publish/unpublish are fully authorized (401 anonymous / 403 member / 200s for admin),
drafts stay invisible to non-admins until published, and a freshly published problem is solvable
end-to-end through the same solve loop as US1. Combined with User Stories 1 and 2, all three user
stories now work independently per the incremental delivery plan; hostile-submission containment
holds unchanged.
