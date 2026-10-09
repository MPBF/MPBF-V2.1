---
name: Static dictionary audits
description: Keep static configuration audits consistent with runtime dictionary values.
---

Keep translation entries in literal dictionaries. Static configuration audits must fail explicitly on unsupported executable statements, rather than silently auditing only the initial value.

**Why:** A dictionary mutated after its declaration produced valid runtime translations but an incomplete audit report, while the audit incorrectly reported no dictionary errors.

**How to apply:** When extending dictionary definitions or their audit, preserve the literal-only convention and verify that unsupported mutations are rejected. Do not relax the tests to accept a mismatch between audited and runtime values.
