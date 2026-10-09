---
name: Punching hook/banana overrun detection
description: How punching types map to overrun % and why new hook variants auto-inherit rules
---

Overrun % is derived from `customer_products.punching` in `shared/quantity-utils.ts` via case-insensitive **substring** matching, not exact equality:
- Hook = 20%: value contains `hook`, `علاقي`, or `t-shirt`
- Banana = 10%: value contains `banana` or `بنانة`
- Everything else = 5% (empty = 5%)

**Why:** Any new hook-family Arabic label that contains `علاقي` (e.g. `علاقي هوك` / "T-Shirt\H") automatically inherits the 20% hook rule with no code change. There are NO exact `=== "علاقي"` comparisons anywhere and no zod enum on `punching` (just `varchar(20)`), so new dropdown values are accepted and treated consistently.

**How to apply:** To add a hook-type punching variant, just add the SelectItem in `definitions.tsx` (dropdown is category-gated: hook options only show for category `أكياس علاقي`). Schema comment convention: بدون=NON, علاقي=T-Shirt/Hook, بنانة=Banana. If a variant must NOT be hook, avoid the substring — but current design assumes substring inheritance.
