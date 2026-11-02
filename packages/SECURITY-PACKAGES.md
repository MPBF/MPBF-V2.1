# Local security packages

The two small `.tgz` files in this directory are application dependencies, not
build outputs. Their reviewed sources live alongside them:

- `deepmerge-safe`: deepmerge's merge contract with safe own-data-property writes
  fixing GHSA-gcqx-w48m-w2h4, for which upstream has no patched release.
- `minimatch-legacy`: a callable CommonJS API adapter delegating all parsing to
  patched minimatch 11.0.4. This lets older ESLint, glob, and archive consumers
  retain their API without retaining the vulnerable minimatch implementations.

Root direct file dependencies anchor the replacements; overrides reuse those
specifications. Archives avoid ambiguous nested directory links in npm.
Both npm and pnpm lockfiles pin the archive integrity. The regression suite
compares every archived file against its source.

When changing a local package, bump its version, run
`npm pack ./packages/<source-folder> --pack-destination packages`, update the
root dependency and pnpm override paths, remove the superseded archive, and
refresh both locks. Verify a clean install and the dependency regression suite.
Do not disable the package firewall or replace these with vulnerable upstream
packages merely to simplify the lockfile.
