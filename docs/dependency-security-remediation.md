# Dependency security remediation

Verified on 2026-10-17. No production deployment or database changes were made.

## Inventory and scope

The initial inventory used a real `find` traversal from the project root,
pruning dependency, VCS and build-output directories **before** descending:
`node_modules`, `.git`, `vendor`, `.venv`, `venv`, `target`, `dist`, `build`,
`.next`, `.cache` and `.npm`. It searched for Node, Python, Ruby, Go, Rust,
Composer, Maven, Gradle, NuGet, Deno and Bun manifests/locks.

| Location | Classification | Action |
| --- | --- | --- |
| Root `package.json`, `package-lock.json` | npm application | Ran `npm audit fix`; updated remaining dependencies/overrides; clean-installed and audited |
| Root `pnpm-lock.yaml`, `pnpm-workspace.yaml` | Alternative pnpm dependency graph | Ran `pnpm audit --fix`; replaced its broad generated ranges with explicit compatible overrides; regenerated, clean-installed in isolation and audited |
| `packages/shared/package.json` | Dependency-free npm package | Created its missing lockfile, then ran `npm audit fix`, `npm ci` and `npm audit` |
| `.agents/skills/brainstorming/scripts/package.json` and lock | Nested npm tooling | Ran its own `npm audit fix`; replaced the unpatched brace parser; clean-installed and audited |
| `.local/custom_skills/brainstorming/scripts/package.json` and lock | Local, ignored copy of tooling | Applied the same fix and independently clean-installed/audited; these local cache files are not part of the application merge |
| `.local/skills/replit-auth/templates/lib/replit-auth-web/package.json` | Uninstantiated scaffolding template | Audit attempt returned `ENOLOCK`; `workspace:*` and `catalog:` refer to the destination workspace, not an installable standalone project. No listed affected release is pinned here |
| `.config/.vscode-server/**/package.json` and the extension's example workspace lock | Installed editor/vendor distribution | Enumerated and attempted non-mutating per-directory audit fixes. They lack installable standalone locks/workspaces; editor binaries/extensions were not rewritten or added to application source |

The final regression traversal includes both application and nested tooling
manifests, including untracked files. It prunes installed editor distributions
and generated language-server caches as vendor/build outputs, not application
dependencies. Those directories are also excluded from publish snapshots.

## Changes requiring compatibility decisions

- Upgraded affected HTTP, upload, mail, MCP, sanitization, address parsing and
  other dependencies. Both lockfile graphs now contain the patched releases.
- Kept brace-expansion overrides within their compatible 1.x, 2.x and 5.x
  lines rather than forcing one major on every consumer.
- **No upstream braces patch exists:** pinned
  `npm:@dieub/braces-depth-guard@3.0.3-pn.3` for the same CommonJS API. Inspected
  the published artifact's differences against braces 3.0.3, including parse
  limits, recursive AST-walker limits, option validation and parent-cycle
  protection. The artifact retains the upstream MIT license and has registry
  integrity/provenance metadata. Regressions exercise ordinary brace expansion,
  3,000-level brace/parenthesis inputs, direct deep AST inputs and both actual
  consumers (Chokidar and Micromatch). This is a deliberate maintained-fork
  substitution, not an upstream release or a claim that a package rename alone
  fixes a vulnerability. It avoids a disruptive Tailwind major migration.
- **No sprintf-js patch exists:** upgraded the SQL-driver dependency that used
  it and selected argparse 2.0.1 for legacy argparse consumers. The Mammoth CLI
  and real DOCX-to-HTML conversion both pass without sprintf-js.
- Scoped the XML-parser override to patched 0.8.15 for its 0.8 consumers.
  A global 0.9 override breaks Mammoth's parsing API; conversion tests now guard
  this boundary. AJV likewise uses patched fast-uri 3.x, not a forced 4.x.
- Removed SheetJS and reused the existing ExcelJS dependency for the only
  application exporter. The old CDN SheetJS 0.20.3 already exceeded the patched
  versions stated in the two advisories, but the scanner models the discontinued
  npm package as affected without an upper bound. Reusing ExcelJS removes that
  ambiguity and the extra dependency. Export remains lazy-loaded and retains
  all seven localized columns, values, sheet names and download filenames.
- The browser test's mobile status expectation was stale: existing source CSS
  specifies 28px on mobile, not 26px. Updated the assertion without changing
  application styling. The fixture now reads assets before sending headers so
  file-read failures cannot trigger a second header write.

## Verification

- Replit dependency audit: **0 critical, high, moderate, low or informational
  findings**, down from the original 100.
- `npm audit` and `pnpm audit`: zero findings.
- Root `npm ci`, isolated frozen-lockfile pnpm installation, and separate clean
  installations for the two nested tooling copies and shared package.
- `npm ls --all`: no invalid dependency problems.
- `node --test tests/dependency-security.test.cjs`: affected-version checks over
  all discovered application/tooling manifests and both lock formats, plus
  runtime security/compatibility regressions.
- `npm run check` and `npm run build`.
- `node --test tests/initial-load-budget.test.cjs`: 12 passing tests.
- `node scripts/check-initial-load-budget.cjs`: 161.19 kB initial gzip transfer,
  within the unchanged budget; ExcelJS stays on demand.
- `node scripts/check-deferred-loading.cjs`: 217 passing browser checks against
  production chunks, including real Arabic/English Excel/PDF downloads and
  receipt pagination.
- Focused HR reporting, roll-label document and administrator-permission suites:
  53 passing tests.
- Restarted the application, confirmed HTTP 200 and visually checked the public
  login page. No authenticated production session or business data was used;
  signed-in behavior above was exercised with the existing isolated fixture.
