#!/usr/bin/env bash
set -euo pipefail
PG_BIN="$(dirname "$(command -v initdb)")"
TMP="$(mktemp -d /tmp/safe-tools-XXXXXX)"
cleanup(){ "$PG_BIN/pg_ctl" -D "$TMP/data" -m immediate -w stop >/dev/null 2>&1 || true; rm -rf "$TMP"; }
trap cleanup EXIT
"$PG_BIN/initdb" -D "$TMP/data" -U runner -A trust --no-locale >"$TMP/init.log"
"$PG_BIN/pg_ctl" -D "$TMP/data" -l "$TMP/server.log" -o "-p 55441 -h 127.0.0.1 -k $TMP" -w start
"$PG_BIN/createdb" -h 127.0.0.1 -p 55441 -U runner safe_tools_test
npx tsx scripts/test-safe-data-tools.ts --isolated
