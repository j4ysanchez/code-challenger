# Minimal, hardened sandbox image for untrusted Python 3.12 submissions.
# Runtime containment (network=none, read-only rootfs, cap-drop=ALL, non-root
# uid, pids/memory/cpu limits) is enforced by the worker at container-start
# time (contracts/sandbox-profile.md) — this image only needs to avoid adding
# attack surface: no package manager, no shell, no build tooling.
FROM python:3.12-alpine

# Strip the package manager and shell — the run/compile commands are invoked
# as an argv array (no shell), so neither is needed at runtime.
RUN rm -rf /sbin/apk /etc/apk /lib/apk /usr/share/apk /var/cache/apk \
    && rm -f /bin/sh /bin/ash /bin/busybox

USER 65534:65534
WORKDIR /scratch
