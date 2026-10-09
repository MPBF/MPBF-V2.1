---
name: Scoped transitive overrides
description: Keep security overrides compatible when a dependency tree contains multiple major versions of the same package.
---

When a security fix affects a transitive package with breaking major-version changes, scope overrides to the parent dependency's compatible major range instead of applying one global override.

**Why:** A global resolution can satisfy the scanner while changing an expected CommonJS/API shape for older consumers. A lockfile may parse and type checks may pass even though developer tooling fails at runtime.

**How to apply:** Inspect the dependency tree for each parent major, choose its newest patched compatible release, and then verify with a clean install, the consumer command (such as lint), and `npm ls` for invalid dependencies.