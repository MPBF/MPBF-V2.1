---
name: Order workflow scope
description: Approved audience and quantity semantics for the internal order workflow.
---

«سير العمل» is a read-only management view, approved for system administrators
and production management only, not ordinary order readers or stage operators.

**Why:** the user explicitly chose «اعتماد التصميم لمدير النظام وإدارة الإنتاج فقط».

**How to apply:** preserve the same effective-permission boundary on links,
direct navigation and APIs; do not broaden the existing administrator-only
production-monitoring module to supply this page.

Contributions describe current recorded roll data, including corrections, and
remain separate for each manufacturing stage. They are not an immutable audit
of the original operation.

**Why:** immutable production events retain original weights even after manager
corrections. Mixing those weights with corrected final output makes the workflow
internally inconsistent.

**How to apply:** film and printing contributions use their recorded input weights;
cutting uses net output. Never add contributions across stages to produce a final
quantity. Preserve final-stage-only actual-output semantics used by customer history.
