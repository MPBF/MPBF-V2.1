#!/usr/bin/env bash
# One disposable local cluster; no application or published database is used.
set -euo pipefail
PG_BIN="${PG_BIN:-$(dirname "$(command -v initdb)")}"
PG_TMP="$(mktemp -d /tmp/monitoring-isolated-XXXXXX)"
cleanup() {
  "$PG_BIN/pg_ctl" -D "$PG_TMP/data" -m immediate -w stop >/dev/null 2>&1 || true
  rm -rf "$PG_TMP"
}
trap cleanup EXIT
"$PG_BIN/initdb" -D "$PG_TMP/data" -U runner -A trust --no-locale >"$PG_TMP/init.log"
"$PG_BIN/pg_ctl" -D "$PG_TMP/data" -l "$PG_TMP/server.log" -o "-p 55439 -h 127.0.0.1 -k $PG_TMP" -w start
"$PG_BIN/createdb" -h 127.0.0.1 -p 55439 -U runner factory_isolated_test
npx tsx scripts/test-production-monitoring.ts
npx tsx scripts/test-factory-production.ts --local
