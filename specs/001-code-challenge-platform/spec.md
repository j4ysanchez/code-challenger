# Feature Specification: Code Challenge Platform (MVP)

**Feature Branch**: `001-code-challenge-platform`

**Created**: 2026-07-16

**Status**: Draft

**Input**: User description: "Build a code challenge site like LeetCode — a secure webapp
where users browse programming problems, submit solutions, and have their code evaluated
and run safely against test cases."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Solve a Problem (Priority: P1)

A signed-in user picks a programming problem from a catalog, reads its description,
writes a solution in a supported language in an in-browser editor, submits it, and
receives a verdict (Accepted, Wrong Answer, Time Limit Exceeded, Memory Limit
Exceeded, Runtime Error, Compile Error, or System Error) with per-test-case feedback
within seconds.

**Why this priority**: This is the core value proposition of the entire product. Without
the browse → write → submit → verdict loop, nothing else on the site matters.

**Independent Test**: Can be fully tested by seeding one problem with test cases,
submitting a correct solution and several incorrect/malicious ones, and verifying each
receives the appropriate verdict without affecting platform stability.

**Acceptance Scenarios**:

1. **Given** a published problem with test cases, **When** a signed-in user submits a
   correct solution, **Then** the system returns an "Accepted" verdict showing runtime
   and test cases passed.
2. **Given** a published problem, **When** a user submits a solution that produces wrong
   output, **Then** the system returns "Wrong Answer" and identifies the first failing
   test case (input and expected output for non-hidden cases only).
3. **Given** a published problem, **When** a user submits code that loops forever,
   **Then** the run is terminated at the time limit and the user receives "Time Limit
   Exceeded" — no other user's experience is affected.
4. **Given** a published problem, **When** a user submits code that attempts to read
   system files, access the network, or exhaust memory, **Then** the attempt fails
   inside the sandbox, the user receives an appropriate error verdict, and the platform
   and other users' data remain unaffected.
5. **Given** a user is mid-editing, **When** they navigate away and return to the
   problem, **Then** their draft code is preserved.

---

### User Story 2 - Account & Submission History (Priority: P2)

A user creates an account, signs in, and can view a history of their past submissions
per problem — including verdicts, timestamps, and the code they submitted — and see
which problems they have solved.

**Why this priority**: Progress tracking is the retention hook and is required to
attribute submissions, rate-limit fairly, and audit activity. Basic registration and
sign-in ship as foundational work (FR-005 requires an authenticated user before any
execution), so P1 can be demoed with seeded accounts; this story adds submission
history, solved tracking, and password reset on top.

**Independent Test**: Can be tested by registering an account, making several
submissions, and verifying history shows the right submissions, verdicts, and solved
status — and that another user cannot see them.

**Acceptance Scenarios**:

1. **Given** a new visitor, **When** they register with email and password and sign in,
   **Then** they get a personal profile showing zero solved problems.
2. **Given** a signed-in user with past submissions, **When** they open a problem's
   submission history, **Then** they see only their own submissions with verdict,
   language, and submission time.
3. **Given** user A's submission, **When** user B attempts to view it directly (e.g., by
   guessing its identifier), **Then** access is denied.
4. **Given** a user solves a problem, **When** they return to the catalog, **Then** the
   problem is marked as solved for them.

---

### User Story 3 - Problem Authoring & Administration (Priority: P3)

An administrator creates and publishes problems: statement, difficulty, tags, starter
code per language, and a set of test cases (visible examples plus hidden cases), with
per-problem time and memory limits. Problems can be drafted, previewed, published, and
unpublished.

**Why this priority**: Needed to grow the catalog, but the MVP can launch with seeded
problems created by developers; a self-serve authoring UI is the last slice.

**Independent Test**: Can be tested by an admin creating a draft problem with test
cases, verifying it is invisible to regular users until published, then publishing it
and solving it end-to-end.

**Acceptance Scenarios**:

1. **Given** an admin account, **When** the admin creates a problem with statement, test
   cases, and limits and saves it as a draft, **Then** the problem does not appear in
   the public catalog.
2. **Given** a draft problem, **When** the admin publishes it, **Then** it appears in
   the catalog and accepts submissions.
3. **Given** a regular user account, **When** that user attempts to access authoring
   functions, **Then** access is denied.

---

### Edge Cases

- Submission of an empty file, a file exceeding the size limit, or a language not on the
  allowlist is rejected with a clear message before any execution occurs.
- Code that spawns many processes (fork bomb), allocates unbounded memory, writes
  gigabytes of output, or attempts network calls is contained and terminated by sandbox
  limits, producing a bounded, user-readable verdict.
- Malicious output (e.g., HTML/script tags printed by user code) is displayed as inert
  text everywhere it is shown, never rendered or executed by the browser.
- A burst of submissions from one user hits the per-user rate limit and receives a
  "try again shortly" response; other users' evaluations proceed normally.
- The evaluation queue backs up under load: users see a "queued/running" status and
  eventually a verdict — never a silent hang or lost submission.
- Two rapid duplicate submissions of the same code are both processed (or the second is
  rejected by rate limiting) but never produce a corrupted or merged result.
- An evaluation worker crashes mid-run: the submission is retried or marked as a system
  error and the user is informed, without losing the submission record.

## Requirements *(mandatory)*

### Functional Requirements

**Problem catalog & solving**

- **FR-001**: System MUST display a catalog of published problems with title,
  difficulty, tags, and the user's solved status, filterable by difficulty and tag.
- **FR-002**: System MUST display a problem detail page with statement, visible example
  test cases, constraints, and per-language starter code.
- **FR-003**: Users MUST be able to write code in an in-browser editor with syntax
  highlighting for each supported language, with drafts preserved per problem.
- **FR-004**: System MUST support at least two programming languages at launch (Python
  and JavaScript), each with a declared version visible to users.

**Submission & evaluation**

- **FR-005**: System MUST validate every submission before execution: authenticated
  user, allowlisted language, and source size within limit (100 KB); invalid submissions
  are rejected without executing any code.
- **FR-006**: System MUST execute each submission in an isolated, ephemeral sandbox with
  no network access, no access to other users' data or platform internals, and enforced
  per-problem CPU time, wall-clock, memory, process-count, and output-size limits (per
  constitution Principles I and IV).
- **FR-007**: System MUST evaluate submissions against the problem's test cases and
  return one verdict: Accepted, Wrong Answer, Time Limit Exceeded, Memory Limit
  Exceeded, Runtime Error, Compile Error, or System Error.
- **FR-008**: System MUST show per-submission results including verdict, tests
  passed/total, runtime, and — for failures on non-hidden cases — the failing input,
  expected output, and actual output; hidden test case contents MUST never be revealed.
- **FR-009**: System MUST process submissions through a queue with bounded concurrency,
  showing users a pending/running status, and MUST rate-limit submissions per user and
  per IP.
- **FR-010**: System MUST render all user-produced content (submitted code, program
  output, and any other user-supplied text; the MVP has no user-editable profile
  fields) as inert text in every view.

**Accounts & access control**

- **FR-011**: Users MUST be able to register with email and password, sign in, sign
  out, and reset a forgotten password; passwords are stored only in hashed form.
- **FR-012**: System MUST restrict submission history and drafts to their owner and
  restrict authoring/administration to admin-role accounts; all access checks are
  enforced server-side, deny-by-default.
- **FR-013**: System MUST record an audit entry for every submission (user, problem,
  language, verdict, resource usage, timestamp) and for authentication events.

**Problem administration**

- **FR-014**: Admins MUST be able to create, edit, publish, and unpublish problems,
  including statement, difficulty, tags, starter code, visible and hidden test cases,
  and per-problem resource limits; drafts are invisible to non-admins.

### Key Entities

- **User**: A registered person; has credentials, role (member or admin), profile, and
  solved-problem status. Owns submissions and drafts.
- **Problem**: A programming challenge; has statement, difficulty, tags, starter code
  per language, resource limits, publication state, and an ordered set of test cases.
- **Test Case**: An input/expected-output pair belonging to a problem; flagged visible
  (shown as example, may be revealed on failure) or hidden (never revealed).
- **Submission**: One evaluation attempt; belongs to a user and problem; has source
  code, language, timestamps, status (queued/running/complete), verdict, and per-test
  results with resource usage.
- **Draft**: A user's in-progress code for a problem and language, private to the user.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 95% of submissions receive a final verdict within 10 seconds of
  submission under normal load.
- **SC-002**: A new visitor can register, open a problem, and receive a verdict on
  their first submission in under 5 minutes without assistance.
- **SC-003**: The platform sustains 100 concurrent users submitting solutions with no
  lost submissions and no cross-user interference.
- **SC-004**: 100% of a standard suite of hostile submissions (infinite loop, fork
  bomb, memory exhaustion, file-system probing, network calls, oversized output,
  script-injection output) are contained: each receives a bounded verdict and none
  affects the platform or other users.
- **SC-005**: Zero incidents of a user viewing another user's submissions, drafts, or
  hidden test case contents in acceptance testing.
- **SC-006**: Every submission in acceptance testing has a corresponding complete audit
  record.

## Assumptions

- The MVP launches with developer-seeded problems; the admin authoring UI (User Story 3)
  can ship after the solving loop is live.
- Launch languages are Python and JavaScript; adding a language is expected to be a
  configuration-plus-sandbox-profile exercise per the constitution, not a redesign.
- Authentication is email/password with standard session management; social login (OAuth)
  is out of scope for the MVP.
- The MVP has no outbound email service: password-reset tokens are surfaced through a
  structured server log for an operator to relay, not emailed. Introducing an email
  provider later changes only the delivery mechanism, not the reset flow.
- Contests, leaderboards, discussion forums, code comments/solutions sharing, premium
  tiers, and mobile-native apps are out of scope for the MVP.
- Default resource limits apply when a problem does not override them (e.g., a few
  seconds of CPU time and a few hundred MB of memory per run); exact defaults are set
  during planning.
- Users access the site from modern desktop browsers over the public internet.
- Submission records and audit logs are retained indefinitely for the MVP; a retention
  policy can be introduced later without changing user-facing behavior.
