# Deepmerge security patch

Based on the MIT-licensed deepmerge 4.3.1 CommonJS distribution and declarations.
Upstream has no release fixing GHSA-gcqx-w48m-w2h4.

The only algorithm change is that **every destination property write**, including
target cloning and custom-merge results, uses `Object.defineProperty` to create
an enumerable, writable, configurable own data property. This avoids invoking
the inherited `__proto__` setter, even when the target owns an enumerable
`__proto__` property or has a null prototype. The existing inherited-property
guard and merge options remain unchanged.

This is a real source patch, not an alias of the vulnerable upstream package.
Keep the regression tests when replacing it with a future patched upstream
release. License and attribution are in `LICENSE`.
