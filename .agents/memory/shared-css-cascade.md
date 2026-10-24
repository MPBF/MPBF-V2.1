---
name: Shared CSS cascade
description: Preserve accessibility overrides when deduplicating styles across lazy-loaded components.
---

Keep reduced-motion overrides after the local animation shorthands they override.
Do not move them into a shared stylesheet imported before each component's CSS.

**Why:** An identical declaration can still change behavior when moved. A later
`animation` shorthand resets `animation-duration`; a shared stylesheet is loaded
only once, so importing it again from another lazy component cannot restore its
priority.

**How to apply:** Share identical base rules while retaining order-sensitive
exceptions locally. Preserve selector specificity and media contexts, and verify
both the expanded declarations and rendered components after extraction.
