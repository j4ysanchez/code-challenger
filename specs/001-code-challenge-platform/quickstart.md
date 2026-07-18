# Quickstart & Validation Guide: Code Challenge Platform (MVP)

**Date**: 2026-07-16 | **Plan**: [plan.md](plan.md)

How to run the platform locally and prove the feature works end-to-end. Details of
shapes and limits live in [data-model.md](data-model.md),
[contracts/api.md](contracts/api.md), and
[contracts/sandbox-profile.md](contracts/sandbox-profile.md) — not duplicated here.

## Prerequisites

- Node.js 22 LTS and npm 10+
- Docker Engine 27+ with Compose v2 (the worker talks to the local Docker socket)
- ~2 GB free RAM (Postgres + api + worker + 2 sandbox runs)

## Setup

```bash
npm install                          # workspace install
cp .env.example .env                 # local secrets (never committed)
docker compose -f infra/docker-compose.yml up -d postgres
npm run db:migrate                   # kysely migrations + role grants (infra/db)
npm run db:seed                      # seed admin user + 2 sample problems
docker build -t sandbox-python312 infra/sandbox/python312
docker build -t sandbox-node22    infra/sandbox/node22
```

## Run

```bash
npm run dev:api      # Fastify on :3000
npm run dev:worker   # evaluation worker (needs Docker socket)
npm run dev:web      # Vite dev server on :5173, proxying /api → :3000
```

## Automated validation

```bash
npm run typecheck && npm run lint    # strict TS + functional ESLint rules
npm test                             # Vitest unit + slice integration suites
npm run test:hostile                 # containment suite vs real sandboxes
```

Expected: all green. `test:hostile` runs every fixture in the sandbox contract's
containment table and asserts verdict + host-unaffected; it MUST fail if any
hardening flag in the sandbox profile is removed (that failure mode is itself
tested).

## Manual end-to-end scenarios

### 1. Solve loop (User Story 1 / SC-002)

1. Open `http://localhost:5173`, register a user, open a seeded problem.
2. Submit the seeded correct Python solution → status `queued → running →
   complete`, verdict **Accepted**, runtime shown, within 10 s (SC-001).
3. Submit a wrong-output variant → **Wrong Answer** with first failing visible
   case's input/expected/actual.
4. Submit `while True: pass` → **Time Limit Exceeded**; site stays responsive in a
   second browser tab throughout (SC-004).

### 2. Isolation & ownership (User Story 2 / SC-005)

1. Register a second user; from their session request the first user's submission id
   via `GET /api/submissions/:id` → 404.
2. Confirm solved checkmark appears in catalog only for the solving user.
3. Verify hidden-case failure shows only case index — no input/output.

### 3. Authoring (User Story 3)

1. Log in as seeded admin, create a draft problem with 1 visible + 1 hidden case.
2. Confirm draft is absent from the public catalog (anonymous + member sessions).
3. Publish → appears in catalog; solve it end-to-end.
4. As a member, call any `/api/admin/*` route → 403.

### 4. Audit & limits (FR-009, FR-013)

1. Submit 7 times inside a minute → 7th returns 429 with `Retry-After`.
2. `SELECT event_type, count(*) FROM audit_events GROUP BY 1;` — every submission
   and auth action from the scenarios above has a row.
3. As `api_role`, attempt `UPDATE audit_events …` → permission denied (append-only).

## Production deploy (GCP Compute Engine, Always Free)

One-time VM setup (see [research.md R3](research.md#r3-deployment-target) for the
free-tier constraints this respects — region choice, amd64-only, disk/egress caps):

```bash
gcloud compute instances create code-challenger \
  --zone=us-central1-a \
  --machine-type=e2-micro \
  --image-family=debian-12 --image-project=debian-cloud \
  --boot-disk-size=30GB --boot-disk-type=pd-standard \
  --tags=http-server,https-server

gcloud compute firewall-rules create allow-http-https \
  --allow=tcp:80,tcp:443 --target-tags=http-server,https-server

gcloud compute addresses create code-challenger-ip --region=us-central1
# attach the reserved static IP to the instance, then point DNS at it
```

Deploy (on the VM, after installing Docker Engine + Compose v2):

```bash
docker compose -f infra/docker-compose.yml --profile prod up -d
```

TLS via a Caddy front container (auto-HTTPS) serving the built SPA and proxying
`/api`. Verify after deploy: run Manual scenario 1 against the public URL, confirm
HTTP→HTTPS redirect and security headers per the constitution's Security
Requirements.
