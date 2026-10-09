#!/usr/bin/env bash
# All records go to a temporary local PostgreSQL cluster, never the app DB.
set -euo pipefail
if [[ -z "${PG_BIN:-}" ]]; then
  if command -v initdb >/dev/null; then
    PG_BIN="$(dirname "$(command -v initdb)")"
  else
    PG_BIN="$(find /nix/store -maxdepth 3 -path '*postgresql-16*/bin/initdb' -print -quit 2>/dev/null | xargs -r dirname)"
  fi
fi
if [[ ! -x "$PG_BIN/initdb" ]]; then
  echo "PostgreSQL binaries missing. Set PG_BIN to an installed PostgreSQL bin directory." >&2
  exit 1
fi
PG_TMP="$(mktemp -d /tmp/factory-isolated-XXXXXX)"
cleanup() {
  "$PG_BIN/pg_ctl" -D "$PG_TMP/data" -m immediate -w stop >/dev/null 2>&1 || true
  rm -rf "$PG_TMP"
}
trap cleanup EXIT
"$PG_BIN/initdb" -D "$PG_TMP/data" -U runner -A trust --no-locale >"$PG_TMP/init.log"
"$PG_BIN/pg_ctl" -D "$PG_TMP/data" -l "$PG_TMP/server.log" -o "-p 55439 -h 127.0.0.1 -k $PG_TMP" -w start
"$PG_BIN/createdb" -h 127.0.0.1 -p 55439 -U runner factory_isolated_test
npx tsx scripts/test-factory-production.ts --local "$@"