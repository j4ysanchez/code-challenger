# API Contract: Code Challenge Platform (MVP)

**Date**: 2026-07-16 | **Consumers**: React SPA (`apps/web`) | **Producer**: `apps/api`

All endpoints are under `/api`, exchange JSON, and are defined as Zod schemas in
`packages/contracts` (this document is the human-readable form; the schemas are the
source of truth). Authentication is a session cookie (`sid`, HttpOnly, Secure,
SameSite=Lax). All state-changing requests additionally require a valid `Origin`
header matching the site origin.

## Conventions

- **Error shape** (all non-2xx):
  `{ "error": { "code": "string", "message": "human-readable" } }`
  Codes: `validation_failed`, `unauthorized`, `forbidden`, `not_found`,
  `rate_limited`, `conflict`, `internal`. Internal details/stack traces never appear.
- **Auth levels**: `public`, `member` (valid session), `admin` (session + admin role).
  Authorization is deny-by-default; ownership checks apply on top (FR-012).
- **Rate limits**: global per-IP baseline; `POST /api/problems/:slug/submissions`
  additionally limited per-user (default 6/min). Exceeding returns 429
  `rate_limited` with `Retry-After`.

## Auth slice

| Method & Path | Auth | Request | Response |
|---|---|---|---|
| POST `/api/auth/register` | public | `{ email, password }` | 201 `{ user: { id, email, role } }`; 409 `conflict` if email taken |
| POST `/api/auth/login` | public | `{ email, password }` | 200 `{ user }` + sets `sid` cookie; 401 on bad credentials (same message for unknown email vs wrong password) |
| POST `/api/auth/logout` | member | — | 204, session revoked server-side |
| GET `/api/auth/me` | member | — | 200 `{ user }`; 401 if no valid session |
| POST `/api/auth/password-reset/request` | public | `{ email }` | 202 always (no account enumeration) |
| POST `/api/auth/password-reset/confirm` | public | `{ token, newPassword }` | 204; 400 if token invalid/expired/used |

Audit: login, login_failed, logout, register, password_reset events (FR-013).

## Problems slice

| Method & Path | Auth | Request | Response |
|---|---|---|---|
| GET `/api/problems` | public | query: `difficulty?`, `tag?` | 200 `{ problems: [{ id, slug, title, difficulty, tags, solved }] }` — `solved` false/absent when anonymous; published problems only |
| GET `/api/problems/:slug` | public | — | 200 `{ problem: { id, slug, title, statementMd, difficulty, tags, limits, starterCode: { python, javascript }, visibleTestCases: [{ input, expectedOutput }] } }`; 404 for drafts/unknown |

Hidden test cases are never present in any problems-slice response.

## Drafts slice

| Method & Path | Auth | Request | Response |
|---|---|---|---|
| GET `/api/problems/:slug/draft?language=` | member | — | 200 `{ draft: { code, updatedAt } \| null }` (owner's only) |
| PUT `/api/problems/:slug/draft` | member | `{ language, code }` (≤100 KB) | 204 upsert |

## Submissions slice

| Method & Path | Auth | Request | Response |
|---|---|---|---|
| POST `/api/problems/:slug/submissions` | member | `{ language, source }` | 202 `{ submission: { id, status: "queued" } }`; 422 `validation_failed` (size/language) before any execution; 429 when rate-limited |
| GET `/api/submissions/:id` | member (owner) | — | 200 `{ submission }` (below); 404 for non-owner (indistinguishable from missing) |
| GET `/api/problems/:slug/submissions` | member | — | 200 `{ submissions: [summary] }` — caller's own only, newest first |

**Submission detail shape** (owner only):

```jsonc
{
  "submission": {
    "id": "…",
    "problemSlug": "two-sum",
    "language": "python",
    "status": "complete",            // queued | running | complete
    "verdict": "wrong_answer",       // null until complete
    "testsPassed": 3, "testsTotal": 5,
    "maxRuntimeMs": 41, "maxMemoryKb": 12040,
    "createdAt": "…", "completedAt": "…",
    "sourceCode": "…",               // rendered as inert text by clients (FR-010)
    "firstFailure": {                // only when verdict = wrong_answer/runtime_error
      "caseIndex": 4,
      "visible": true,
      "input": "…", "expectedOutput": "…", "actualOutput": "…"  // ONLY if visible
    }
  }
}
```

For a hidden failing case, `firstFailure` contains `caseIndex` and `visible: false`
only — no input/output fields (FR-008). Clients poll `GET /api/submissions/:id`
(2 s interval) while status ≠ complete.

## Admin problems slice (auth: admin)

| Method & Path | Request | Response |
|---|---|---|
| POST `/api/admin/problems` | problem fields + starterCode | 201 `{ problem }` (status: draft) |
| PATCH `/api/admin/problems/:id` | partial problem fields | 200 `{ problem }` |
| PUT `/api/admin/problems/:id/test-cases` | `{ testCases: [{ input, expectedOutput, visible }] }` (full replace, ordered) | 204 |
| POST `/api/admin/problems/:id/publish` | — | 204; 422 unless ≥1 visible and ≥1 hidden case and all fields valid |
| POST `/api/admin/problems/:id/unpublish` | — | 204 |
| GET `/api/admin/problems` | — | 200 all problems incl. drafts |

Non-admin access to any `/api/admin/*` route: 403 `forbidden` (404 never used here;
the route prefix itself is not secret). Audit: `problem.published` etc.
