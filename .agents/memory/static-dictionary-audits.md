---
name: Static dictionary audits
description: Keep static configuration audits consistent with runtime dictionary values.
---

Keep translation entries in literal dictionaries. Static configuration audits must fail explicitly on unsupported executable statements, rather than silently auditing only the initial value.

**Why:** A dictionary mutated after its declaration produced valid runtime translations but an incomplete audit report, while the audit incorrectly reported no dictionary errors.

**How to apply:** When extending dictionary definitions or their audit, preserve the literal-only convention and verify that unsupported mutations are rejected. Do not relax the tests to accept a mismatch between audited and runtime values.

Preserve intentional context-specific English wording instead of replacing all
occurrences of a shared Arabic label with one generic translation.

**Why:** The same Arabic label can describe distinct things (for example, an
uncovered quantity versus its portion). Presence-only coverage misses this, and
normalizing the wording globally would change unrelated screens.

**How to apply:** Match local bilingual copy exactly against the final merged
dictionary. Record contextual exceptions explicitly, keep generic translations
and merge priority intact, and reject stale exceptions when local copy moves or
changes.
