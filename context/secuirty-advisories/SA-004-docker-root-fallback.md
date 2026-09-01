# SA-004 — Container falls back to running as root

**Severity:** Medium
**Category:** Execution with unnecessary privileges (CWE-250)
**Status:** Open
**Affected files:** `docker-entrypoint.sh:35-55`, `Dockerfile`, `Dockerfile-base`

## Summary

`docker-entrypoint.sh` drops privileges to the workspace owner's UID/GID via
`setpriv`, but **falls back to `exec "$@"` as root** whenever the resolved
target UID is 0. That happens in common configurations:

- no writable `/workspace` mount, or a root-owned mount;
- Docker Desktop on macOS/Windows, where bind-mount ownership is virtualized
  and typically appears as UID 0 inside the container (the entrypoint's own
  comment documents this);
- `setpriv` missing from the image.

In those cases the server — which **executes untrusted workspace build code**
(`cargo build`/`build.rs`, npm lifecycle scripts, proc-macros; see `index.md`
threat model and SA-001) — runs that code as **root inside the container**.
Scope note: container root is not host root by itself, but it maximizes blast
radius — full write access to the container filesystem and to whatever is bind-
mounted, and a strictly stronger position for any container-escape primitive.

## Where it is

```sh
if [ "$(id -u)" = "0" ] && [ "$target_uid" != "0" ] && command -v setpriv ...; then
  ...
  exec setpriv --reuid="$target_uid" --regid="$target_gid" --clear-groups "$@"
fi
exec "$@"          # <-- runs as root when target_uid resolved to 0
```

## Constraint the fix MUST respect

**Do NOT add `USER app` to the Dockerfile as a one-line fix.** The entrypoint's
privilege-drop machinery *requires starting as root*: it must `stat` the mount,
`mkdir`/`chmod`/`chown` the per-UID `$HOME` (`/tmp/home-<uid>`), and call
`setpriv`. With a non-root `USER`, `id -u` is already nonzero, that whole branch
is skipped, the per-UID home is never prepared, and a root-owned `/workspace`
becomes unwritable. The container must **start** as root and the fix is to make
the **fallback** land on a prepared non-root account instead of staying root.

## Remediation

1. **Bake an unprivileged fallback user into the image** (in `Dockerfile-base`
   or `Dockerfile`), but do *not* set `USER`:
   ```dockerfile
   RUN groupadd -g 10001 fastedge && \
       useradd -u 10001 -g 10001 -m -d /home/fastedge fastedge
   ```
2. **Change the entrypoint fallback**: when the resolved `target_uid` is 0
   (workspace root-owned / absent / virtualized), drop to the baked user
   instead of staying root, reusing the existing home-prep + `setpriv` path:
   ```sh
   if [ "$target_uid" = "0" ]; then
     target_uid=10001
     target_gid=10001
   fi
   ```
   Place this after the owner-resolution block, before the `setpriv` branch.
   The existing per-UID `HOME=/tmp/home-<uid>` preparation then covers the
   fallback user too. Keep a genuine last-resort `exec "$@"` only for the
   `setpriv`-missing case, and log a loud warning there.
3. **Behavior change to flag to the operator:** on Docker Desktop (virtualized
   mounts appearing as UID 0), files written to `/workspace` will now be owned
   by UID 10001 instead of root. On Docker Desktop specifically the host-side
   ownership mapping is virtualized anyway, so host access is typically
   unaffected — but note it in `STANDALONE-SETUP.md` and the CHANGELOG, and
   document `HOST_UID`/`HOST_GID` as the explicit override for anyone this
   breaks.
4. Also document in `STANDALONE-SETUP.md`: running with
   `-e HOST_UID=$(id -u) -e HOST_GID=$(id -g)` (or a user-owned mount) is the
   recommended setup.

## Test

Build the image and assert the fallback is non-root:

```bash
# no mount → previously root, now 10001
docker run --rm <image> id -u          # expect 10001 (via entrypoint)
# user-owned mount → unchanged behavior
docker run --rm -v "$PWD:/workspace" <image> id -u   # expect $(id -u)
```

## Related

- SA-001 / SA-007 — untrusted build code is the payload that makes root
  execution matter; SA-002's ownership fix assumes this UID resolution.
