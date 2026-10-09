#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

# Keep dependency installs repeatable without reinstalling on every merge.
# npm ci removes node_modules, so store the stamp inside that directory.
lock_stamp="node_modules/.post-merge-package-lock.sha256"
if [ ! -x node_modules/.bin/tsx ] ||
   [ ! -x node_modules/.bin/vite ] ||
   [ ! -f "$lock_stamp" ] ||
   ! sha256sum -c "$lock_stamp" --status; then
  npm ci --no-audit --no-fund
  sha256sum package-lock.json > "$lock_stamp"
fi

npm run check
npm run build

# Migrations are deliberately not automatic: some require manual review and
# can remove existing production data.