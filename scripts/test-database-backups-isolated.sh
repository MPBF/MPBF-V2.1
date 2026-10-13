#!/usr/bin/env bash
set -euo pipefail
# Disposable PostgreSQL only. Never use the application's DATABASE_URL.
if [[ -z "${PG_BIN:-}" ]]; then
  if command -v initdb >/dev/null; then
    PG_BIN="$(dirname "$(command -v initdb)")"
  else
    for candidate in /nix/store/*postgresql-16*/bin/initdb; do
      if [[ -x "$candidate" ]]; then PG_BIN="$(dirname "$candidate")"; break; fi
    done
  fi
fi
PG_BIN="${PG_BIN:-}"
[[ -x "$PG_BIN/initdb" ]] || { echo "PostgreSQL binaries unavailable"; exit 1; }
PG_TMP="$(mktemp -d /tmp/backups-isolated-XXXXXX)"
cleanup() {
  "$PG_BIN/pg_ctl" -D "$PG_TMP/data" -m immediate -w stop >/dev/null 2>&1 || true
  rm -rf "$PG_TMP"
}
trap cleanup EXIT
"$PG_BIN/initdb" -D "$PG_TMP/data" -U runner -A trust --no-locale >"$PG_TMP/init.log"
"$PG_BIN/pg_ctl" -D "$PG_TMP/data" -l "$PG_TMP/server.log" -o "-p 55443 -h 127.0.0.1 -k $PG_TMP" -w start
"$PG_BIN/createdb" -h 127.0.0.1 -p 55443 -U runner backups_isolated_test
npx tsx scripts/test-database-backups.ts --isolated
