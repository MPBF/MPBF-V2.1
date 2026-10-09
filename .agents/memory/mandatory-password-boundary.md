---
name: Mandatory-password access boundary
description: Why the forced-password screen retains a narrow language-preference exception.
---

Mandatory-password enforcement is an API-wide account restriction, not an
ordinary role permission; administrator and wildcard grants must not exempt an
account. Keep exceptions narrowly scoped to session lifecycle and the
password-change screen's dependencies.

**Why:** some business endpoints use permission checks without a shared
authentication guard. Also, the password-change screen itself persists the
user's language preference; banning every write except password changes would
break that existing screen.

**How to apply:** preserve the own-language preference exception while keeping
ordinary settings and business actions blocked. Review any new exception by
both method and exact endpoint, rather than exempting a whole path prefix.
