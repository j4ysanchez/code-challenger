# Minimal, hardened sandbox image for untrusted Node.js 22 submissions.
# Runtime containment (network=none, read-only rootfs, cap-drop=ALL, non-root
# uid, pids/memory/cpu limits) is enforced by the worker at container-start
# time (contracts/sandbox-profile.md) — this image only needs to avoid adding
# attack surface: no package manager, no shell, no build tooling.
FROM node:22-alpine

# Strip the package manager and shell — the run/compile commands are invoked
# as an argv array (no shell), so neither is needed at runtime.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
    && rm -rf /sbin/apk /etc/apk /lib/apk /usr/share/apk /var/cache/apk \
    && rm -f /bin/sh /bin/ash /bin/busybox

USER 65534:65534
WORKDIR /scratch

# The upstream image's ENTRYPOINT (docker-entrypoint.sh) needs the shell we
# just removed; reset it so the worker's argv Cmd runs directly (exec form).
ENTRYPOINT []
