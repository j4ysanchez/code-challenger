# US2 Story Checkpoint: Account & Submission History

**Purpose**: Validate User Story 2 is independently functional per tasks.md T042
**Date**: 2026-07-19
**Plan**: [plan.md](../plan.md) | **Tasks**: [tasks.md](../tasks.md)

## Automated validation

- [x] `npm run typecheck` — clean across `contracts`, `api`, `worker`, `web`, `infra/db`
- [x] `npm run lint` — clean (ESLint flat config, functional rules, typescript-eslint strict)
- [x] `npm test` — 261 tests passed across 31 files (contracts, infra, api, worker, hostile, web
  projects), including the new US2 coverage: password-reset (T036, 6 tests), submission history
  (T037, 3 tests), solved-status wiring in the problems slice (T038, extends
  `problems.test.ts` to 9 tests) plus a new `optionalSession` preHandler unit test (3 tests), and
  the cross-slice authorization matrix (T039, 10 tests) proving deny-by-default and ownership
  scoping hold across every member route registered together
- [x] `npm run test:hostile` — 15/15 hostile-submission containment assertions still pass,
  confirming Principle V holds unchanged after the US2 work

## Manual scenario 2 (quickstart.md, SC-005) — run against the live dev stack

Ran `npm run dev:api`, `npm run dev:worker`, `npm run dev:web` against the seeded Postgres and
drove the real browser UI (Playwright, headless Chromium, two independent browser contexts for
two independently registered users) end-to-end:

1. **User A** registered, solved **Sum Two Numbers** with a correct Python solution submitted
   through the real CodeMirror editor → **Accepted**, and the catalog immediately showed a ✓
   next to the problem for User A's own session.
2. **User B** registered in a separate browser context (separate session cookie) and, from their
   own session, requested User A's submission directly via `GET /api/submissions/:id` →
   **404 `not_found`**, byte-identical to the response for a nonexistent id (FR-012,
   indistinguishable-from-missing ownership scoping).
3. User B's catalog view showed **no** ✓ next to Sum Two Numbers (solved status is scoped to the
   viewing session, not global to the problem).
4. User B's own submission history for that problem (`GET /api/problems/sum-two-numbers/submissions`)
   returned `{ "submissions": [] }` — never leaks User A's rows.
5. User A then submitted a deliberately wrong solution → **Wrong Answer**, 0/2 tests passed, and
   the UI rendered the first failing case's input/expected/actual in full. That first failure
   happened to be the problem's one **visible** case (position 0); the seeded problem's one
   **hidden** case never surfaced input/output in this run because the visible case failed first
   in evaluation order. Hidden-case redaction (`visible:false`, `caseIndex` only, no input/output)
   is exercised directly by the automated suite instead — `apps/api/src/features/submissions/detail.test.ts`
   (Phase 3) and the solved-status tests added this phase — since deliberately failing only the
   hidden case would require knowing its fixture data, which is intentionally never exposed to a
   client.

Test accounts created during this run (`scenario2-a-*@example.com`, `scenario2-b-*@example.com`)
were deleted from the dev database afterward.

## Gaps found and fixed during this checkpoint

- **Anonymous vs. authenticated catalog/detail reads**: `GET /api/problems` and
  `GET /api/problems/:slug` were public-only routes with no session awareness. Added an
  `optionalSession` preHandler (`apps/api/src/platform/sessions.ts`) — attaches the session user
  when a valid cookie is present but, unlike `requireMember`, never denies an anonymous request —
  and wired it into the problems slice so the `solved` field can be computed per caller without
  making the catalog/detail endpoints member-only.
- **`apps/worker/tests/platform.test.ts` shared the real production queue with any live worker**:
  `evaluation queue > delivers an enqueued job to the subscribed handler` called
  `createEvaluationQueue`/`subscribeEvaluationJobs` with no queue-name override, so it sent its
  test job to the same `evaluate-submission` pg-boss queue a real `npm run dev:worker` process
  subscribes to. Whichever subscriber pg-boss handed the job to first won the race; a live
  `dev:worker` (left running from an earlier session, then restarted for the manual scenario
  below) reliably won it, so the test's own handler never saw the job and the `.poll()` assertion
  timed out. The test's dead-letter sibling already avoided this by constructing its own
  `test-evaluate-<uuid>` queue directly — this test was the one outlier still using the shared
  name. Fixed at the source: `createEvaluationQueue`/`subscribeEvaluationJobs`
  (`apps/worker/src/platform/queue.ts`) now take optional queue-name parameters, defaulting to
  the real production names (`apps/worker/src/index.ts`, the only production call site, is
  unchanged), and the test now passes a unique per-run queue name — the same isolation pattern
  its sibling already used. Verified by running the test three times in a row with `dev:worker`
  intentionally left running (the exact condition that caused the failure) — all green — then the
  full 261-test suite, also green, under the same live-worker condition.
- **Missing `SubmissionSummary` type export**: `packages/contracts/src/schemas/submissions.ts`
  exported `submissionSummarySchema` but no corresponding inferred type, unlike its sibling
  `SubmissionDetail`/`FirstFailure`. Added `export type SubmissionSummary` for the web
  `HistoryPage` to consume without redundant `z.infer` boilerplate at the call site.

## Checkpoint result

**PASS** — User Story 2 (account & submission history) is independently functional: password
reset works end-to-end with single-use, hashed, 1-hour-expiring tokens delivered only via the
R14 log event; submission history and solved status are correctly scoped per user; the
cross-slice authorization matrix confirms deny-by-default on every member route and
indistinguishable-from-missing ownership on submissions, history, and drafts. Combined with User
Story 1, the platform now supports the full solve-loop-with-accounts increment per the
incremental delivery plan.
