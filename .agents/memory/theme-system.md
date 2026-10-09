---
name: Theme system (light/dark/blue)
description: How MPBF's three themes are wired and why blue is a separate root class, not a dark variant.
---

# Theme system

MPBF supports three opt-in themes: `light` (default), `dark`, and `blue` ("Professional Blue", high-contrast). Selection persists in `localStorage` key `mpbf_theme`. The picker lives in the Header dropdown, the Settings "Appearance" card, and the mobile drawer (MobileShell) — keep all three in sync if the option set changes.

## Rules
- Each theme maps to a root class: light=none, dark=`.dark`, blue=`.theme-blue`. Only one is applied at a time on `document.documentElement`.
- **Why blue is its own class, not a `.dark` variant:** Light and Dark must stay byte-for-byte unchanged. `.theme-blue` redefines the SAME existing CSS variable names from `:root`, so all Tailwind utilities flow through with no `tailwind.config.ts` change.
- High-contrast is an INDEPENDENT overlay (`.high-contrast` class + injected stylesheet), unrelated to the 3-theme selector. Don't conflate them.
- Theme-wide readability rules (bold text, strong borders, centered table cells/headers, colored h1–h3, dropdown sizing) live as **unlayered scoped CSS under `.theme-blue`** in `client/src/index.css`. Unlayered rules beat Tailwind `@layer utilities`, so they CAN override component layouts in blue mode — scope carefully and avoid blanket `justify-content`/`min-width: max-content` (mobile overflow). Use bounded `max-width: min(92vw, …)` for popovers.

**How to apply:** adding a 4th theme = extend `Theme` union + `THEME_CLASSES` in `ThemeContext.tsx`, add a `:root`-mirroring class block in `index.css`, and add the option to Header/Settings/MobileShell pickers.
