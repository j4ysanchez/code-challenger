# Sandbox Execution Contract

**Date**: 2026-07-16 | **Producer**: `apps/worker` | **Boundary**: constitution Principle I

This is the security-critical contract between the evaluation worker and the sandbox
containers that run untrusted code. Any change to this file is a security-relevant
change per the constitution's workflow rules.

## Container invocation (per test-case run)

One fresh container per submission run; never reused, force-removed afterwards.
Equivalent `docker run` profile (issued via dockerode):

```text
--network=none                     # no egress, no DNS (Principle I)
--user 65534:65534                 # non-root (nobody)
--read-only                        # immutable rootfs
--tmpfs /scratch:rw,noexec,nosuid,size=64m
--workdir /scratch
--cap-drop=ALL
--security-opt=no-new-privileges
--pids-limit=64                    # fork-bomb containment
--memory=<memory_limit_mb>m --memory-swap=<memory_limit_mb>m   # no swap escape
--cpus=1
--ulimit nofile=64:64
--ulimit fsize=8388608             # 8 MB max file writes
--init                            # zombie reaping
<language image> <run command>
```

Worker-side enforcement (outside the container):

- **Wall-clock kill**: worker force-kills the container at `wall_time_limit_ms`
  (default 10 s) regardless of container state → Time Limit Exceeded.
- **Output cap**: stdout/stderr streamed and truncated at 1 MB; exceeding →
  Runtime Error ("output limit exceeded").
- **CPU time**: measured from container stats; exceeding `cpu_time_limit_ms` → TLE.

## Language images

Built from `infra/sandbox/<lang>/Dockerfile`; minimal base, language runtime only, no
package manager, no network tooling, no shell beyond what the run command requires.
Each image directory contains `profile.json` declaring its run/compile commands and
default limits (constitution workflow rule: no runtime enabled without a profile).

| Language | Image | Compile step | Run command |
|----------|-------|--------------|-------------|
| python (3.12) | `sandbox-python312` | `python -m py_compile main.py` (syntax check → Compile Error) | `python main.py` |
| javascript (Node 22) | `sandbox-node22` | `node --check main.js` | `node main.js` |

## I/O protocol

- Source code is written by the worker to the tmpfs as `main.py` / `main.js` before
  start (bind of a worker-prepared file; the sandbox never receives DB access,
  secrets, or other users' data).
- Test case `input` is piped to the process's **stdin**.
- The process writes its answer to **stdout**; comparison is exact match after
  trailing-whitespace normalization (per line and final newline).
- **stderr** is captured (truncated 4 KB) for Runtime Error / Compile Error display,
  shown to users as inert text only.

## Exit-status → verdict mapping (per test case)

| Observation | Verdict |
|-------------|---------|
| Compile/syntax step fails | compile_error (whole submission, no cases run) |
| Exit 0, stdout matches expected | pass |
| Exit 0, stdout differs | wrong_answer |
| Non-zero exit / signal (not resource-related) | runtime_error |
| Killed by wall/cpu timer | time_limit_exceeded |
| OOM-killed (cgroup) | memory_limit_exceeded |
| Docker/daemon failure, worker crash, retries exhausted | system_error |

Submission verdict = first non-pass case verdict, evaluated in `position` order;
remaining cases after the first failure are still run for visible cases' feedback but
evaluation stops early on hidden failures (keeps p95 < 10 s under hostile load).

## Containment acceptance (hostile suite — must exist before evaluation ships)

Each fixture must yield the mapped verdict, complete within `wall_time_limit_ms + 5 s`
worker overhead, and leave host CPU/memory/disk and other submissions unaffected:

| Fixture | Expected verdict |
|---------|------------------|
| `while True: pass` | time_limit_exceeded |
| fork bomb (`os.fork` loop / `child_process` spawn loop) | runtime_error or TLE, contained by pids-limit |
| unbounded list/Buffer growth | memory_limit_exceeded |
| read `/etc/shadow`, walk `/proc`, write outside /scratch | runtime_error (EACCES/EROFS), no data returned |
| `socket.connect` / `fetch` to any host | runtime_error (network unreachable) |
| print 100 MB to stdout | runtime_error (output cap), stored output ≤ 1 MB |
| print `<script>alert(1)</script>` | wrong_answer, rendered inert in UI (FR-010) |
