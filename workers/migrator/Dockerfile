# #1051 — one-shot Atlas migration container (Migration Executor).
#
# Alpine base (shell-capable) plus the committed Neon migrations directory.
# The agent image is untouched (owner decision Q2): this is a separate, small,
# ephemeral batch image. Its only capability is "apply the committed chain";
# there is no schema drop, no arbitrary SQL, no down-migration.
#
# Version-aligned with the pinned Atlas CLI the deploy lanes used (v0.30.0),
# so the container's Atlas matches what CI previously invoked. We deliberately
# build on Alpine rather than the arigaio/atlas:0.30.0 image: that base is a
# Google Distroless image (no /bin/sh), which would make the /entrypoint.sh
# wrapper unexeccutable (exec "/entrypoint.sh": no such file or directory).
# Instead we ADD the pinned standalone binary with a checksum and run it in a
# tiny shell-capable image (AC3: the migrator image must actually apply the chain).
FROM alpine:3.20

# The committed Neon migrations (the single Atlas authority).
COPY migrations/neon /migrations

# Bring in the PINNED Atlas binary (not the base image's atlas). SHA-256 is the
# single source of truth from the `version:` CI pins on ariga/setup-atlas.
ADD --checksum=sha256:dbaaf350634304d4bf92753559261a67afb399fe4ff0ea6ae5bb5d1ce6e0011a \
    https://release.ariga.io/atlas/atlas-community-linux-amd64-v0.30.0 \
    /usr/local/bin/atlas
RUN chmod +x /usr/local/bin/atlas \
    && atlas version

# Wrapper: append search_path=public to the DSN (the release promotion
# adapter documents why — stray schemas like neon_auth / an
# orphaned atlas_schema_revisions schema must not trip Atlas's
# "database is not clean" check) and run the pinned apply to head.
# Build context is the monorepo root (image_build_context = "../../"), so the
# entrypoint is copied from the worker's docker dir under that root context.
COPY --chmod=0755 workers/migrator/docker/entrypoint.sh /entrypoint.sh
COPY --chmod=0755 workers/migrator/docker/dsn.sh /dsn.sh

# docker:S6471 — non-root runtime user. Alpine ships adduser/addgroup, so we
# create a dedicated service account instead of reusing a Distroless nonroot
# id. The container only needs read access to /migrations (COPY'd 0644 files
# under a 0755 dir, world-readable, so the non-root user can traverse and read
# every migration) and Atlas lock/tmp files. Alpine's default /tmp is already
# mode 1777 (world-writable, sticky bit), so the non-root user can spill temp
# and lock files there without an extra mount.
RUN addgroup -S atlas && adduser -S -G atlas atlas

USER atlas

ENTRYPOINT ["/entrypoint.sh"]
