# Legacy minimatch API adapter

Minimatch 11.0.4 fixes GHSA-g3hv-75wg-m249, but old ESLint plugins,
glob 7, and test-exclude expect a callable CommonJS export. This adapter
delegates all matching and parsing to the patched upstream implementation and
preserves its helpers, `Minimatch`, `GLOBSTAR`, and callable `defaults()`.
For glob 7 traversal, parsed wildcard components expose `_glob` and
`Symbol.match`, delegating matching to upstream's nonrecursive `Matcher.test`.
The upstream matcher objects and their safe parsing remain intact.

Only minimatch 3/5 consumers receive this adapter. Modern consumers receive
upstream minimatch directly. No vulnerable legacy matcher is copied here.
