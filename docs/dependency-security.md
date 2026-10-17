# Dependency security verification

The application uses npm (`package.json` + `package-lock.json`); a secondary pnpm
lockfile is also retained. Security overrides must be kept equivalent in
`package.json` and `pnpm-workspace.yaml`. After changing npm resolutions, run
`pnpm import` to regenerate the secondary lockfile; do not edit integrity hashes.

## Inventory and scope

Use a real filesystem walk, not Git's tracked-file list:

```sh
find . -type d \( -name node_modules -o -name .git -o -name vendor \
  -o -name .venv -o -name venv -o -name target -o -name dist \
  -o -name build -o -name .next -o -name .cache \) -prune \
  -o -type f \( -name package.json -o -name package-lock.json \
  -o -name pnpm-lock.yaml -o -name yarn.lock \) -print
```

- Root application: npm auto-fix, then compatible upgrades and scoped overrides.
- `packages/shared`: dependency-free local package; its own npm lockfile and audit
  confirm there are no third-party dependencies.
- `.agents/skills/brainstorming/scripts`: independent npm helper; audit separately.
  Chokidar 4 removes its braces dependency while retaining the existing direct
  directory watcher API. The ignored `.local/custom_skills` installed copy was
  also audited and updated locally; the tracked helper is the durable source.
- `.config/.vscode-server`: installed editor/extension distributions, not application
  projects. Their extension manifests are not independently installable npm apps.
  The one included npm workspace lock was audited locally. These editor files are
  ignored and must not be added to the application or shipped with it. GitLens's
  bundled distribution declares MCP SDK 1.30.0; changing that manifest would not
  patch its compiled extension. Updating the editor extension is outside the
  application dependency graph, so it is discovered but not enforced by the
  project regression check.
- `.local/skills/replit-auth/templates/lib/replit-auth-web`: an uninstantiated
  generator template with `workspace:` / `catalog:` references, not an installable
  standalone project; it contains none of the reported dependencies.

The regression test discovers these nested directories too and checks project
npm lock entries and pnpm package keys against every originally reported version.
Installed editor distributions are classified separately rather than silently
omitted from discovery.

## Packages without an upstream fix

- **braces:** upstream 3.0.3 has no patched release. The application build tooling
  uses braces through micromatch and Chokidar. An exact npm alias selects
  `@dieub/braces-depth-guard@3.0.3-pn.3`, a guard-only fork with a hard nesting cap
  in parsing and recursive AST walkers. Tests exercise the actual micromatch
  dependency with ordinary patterns, deeply nested input, and attempted cap
  disabling. This is a functional mitigation, not an audit suppression.
- **sprintf-js:** no patched release. Its only application-tree consumer was
  Mammoth's argparse 1 CLI helper, whose formats are fixed internal strings.
  Upgrading to argparse 2 removes sprintf-js completely; argparse 2 retains
  deprecated aliases for the older CLI API. The CLI `--help` path is tested.
- **SheetJS:** the vendor CDN release 0.20.3 already exceeds the two advisories'
  stated fixed versions (0.19.3 and 0.20.2), but the advisory metadata treats the
  unmaintained npm package as affected at every version. Rather than suppress or
  rename the finding, the sole application use (attendance export) now uses the
  existing ExcelJS dependency. The browser test verifies seven columns, bilingual
  names, attendance values, localized headings, and lazy loading.

Brace-expansion resolutions stay within the consumer's existing major line
(1, 2, or 5), avoiding the CommonJS function/object API break across majors.
PostCSS selector parser 7 is required for the patch; the full Tailwind build and
browser checks exercise its actual consumers.

## Verification

```sh
npm ci --no-audit --no-fund
npm audit
pnpm audit
node --test tests/security-dependencies.test.cjs tests/initial-load-budget.test.cjs
npm run check
npm run build
node scripts/check-initial-load-budget.cjs
node scripts/check-deferred-loading.cjs
```

The deferred-loading check uses fixture-only HTTP responses, no real accounts or
business-data writes. Its mobile status expectation follows the existing 28px
mobile CSS rule rather than the desktop 26px rule; no app styling was changed.
