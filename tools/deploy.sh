#!/usr/bin/env bash
# Upload a built release to a dedicated Incus container on an SSH host.
set -euo pipefail
cd "$(dirname "$0")/.."
if [ -f ops/deploy.local.env ]; then source ops/deploy.local.env; fi
: "${DOKE_HOST:?Set DOKE_HOST or copy ops/deploy.env.example to ops/deploy.local.env.}"
DOKE_CONTAINER="${DOKE_CONTAINER:-doke}"
DOKE_ROOT="${DOKE_ROOT:-/opt/doke}"
DOKE_HEALTH_PORT="${DOKE_HEALTH_PORT:-8089}"
# These values enter remote shell commands. Accept only the needed syntax.
[[ "$DOKE_HOST" =~ ^[a-zA-Z0-9_][a-zA-Z0-9_.@-]*$ ]] || { echo 'Invalid SSH host.' >&2; exit 1; }
[[ "$DOKE_CONTAINER" =~ ^[a-zA-Z0-9][a-zA-Z0-9_-]*$ ]] || { echo 'Invalid container name.' >&2; exit 1; }
[[ "$DOKE_ROOT" =~ ^/opt/[a-zA-Z0-9_-]+$ ]] || { echo 'DOKE_ROOT must be /opt/<name>.' >&2; exit 1; }
[[ "$DOKE_HEALTH_PORT" =~ ^[1-9][0-9]{0,4}$ ]] && (( DOKE_HEALTH_PORT <= 65535 )) || { echo 'Invalid health port.' >&2; exit 1; }
[ -f public/release.json ] || { echo 'Run bash tools/build.sh first.' >&2; exit 1; }
DOKE_RELEASE="$(date -u +%Y%m%dT%H%M%SZ)"
DOKE_TEMP="$(mktemp -d "${TMPDIR:-/tmp}/doke-deploy.XXXXXX")"
trap 'rm -rf "$DOKE_TEMP"' EXIT
sed "s|/opt/doke/current|$DOKE_ROOT/current|" ops/nginx.conf > "$DOKE_TEMP/nginx.conf"
COPYFILE_DISABLE=1 tar -cf "$DOKE_TEMP/release.tar" -C public .
scp -q "$DOKE_TEMP/release.tar" "$DOKE_HOST:/tmp/doke-$DOKE_RELEASE.tar"
scp -q "$DOKE_TEMP/nginx.conf" "$DOKE_HOST:/tmp/doke-$DOKE_RELEASE.conf"
ssh "$DOKE_HOST" bash -s -- "$DOKE_CONTAINER" "$DOKE_ROOT" "$DOKE_RELEASE" "$DOKE_HEALTH_PORT" <<'REMOTE'
set -euo pipefail
container="$1"; root="$2"; release="$3"; port="$4"
trap 'rm -f "/tmp/doke-$release.tar" "/tmp/doke-$release.conf"' EXIT
incus file push -q "/tmp/doke-$release.tar" "$container/tmp/doke-release.tar"
incus exec "$container" --disable-stdin -- mkdir -p "$root/releases/$release"
incus exec "$container" --disable-stdin -- tar -xf /tmp/doke-release.tar -C "$root/releases/$release"
incus exec "$container" --disable-stdin -- ln -sfn "$root/releases/$release" "$root/current"
incus file push -q "/tmp/doke-$release.conf" "$container/etc/nginx/sites-enabled/default"
incus exec "$container" --disable-stdin -- nginx -t
incus exec "$container" --disable-stdin -- rm -f /tmp/doke-release.tar
incus restart "$container"
for attempt in {1..30}; do
  if curl --fail --silent "http://127.0.0.1:$port/health"; then exit 0; fi
  sleep 1
done
exit 1
REMOTE
printf 'Deployed doke release %s.\n' "$DOKE_RELEASE"
