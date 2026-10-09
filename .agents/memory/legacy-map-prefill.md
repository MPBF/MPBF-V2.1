---
name: Legacy→new product prefill (mapping) guard
description: How to prefill the new customer-product form from legacy DB rows without reactive auto-calc effects clobbering the prefilled values.
---

The Definitions page customer-product dialog has reactive useEffects that auto-set/clear `cutting_length_cm` from the chosen category and printing_cylinder (new-DB derived-field rules). When prefilling that form from a legacy row ("Map/ربط" button), those effects will erase the prefilled length.

**Pattern:** use a `legacyMapRef` (useRef boolean), set true when prefilling, and:
- Do NOT release it on category selection. Instead the category effect must PRESERVE `cutting_length_cm` while the ref is true (in both the `category==="none"` branch and the non-sufra branch) while still setting punching/cutting_unit. This is required because the user must pick a category, and that's exactly when length got wiped.
- The cylinder effect early-returns while the ref is true.
- Release the ref (set false) only on genuine user intent that should re-engage derived rules: changing the printing_cylinder Select, or manually editing the cutting_length input.
- Reset the ref deterministically with `useEffect(()=>{ if(!isDialogOpen) ref.current=false }, [isDialogOpen])` so it can't leak stale-true into later normal Add/Clone/Edit opens. Programmatic `setIsDialogOpen(false)` from Cancel/mutation-success does NOT fire the Dialog `onOpenChange`, so don't rely on onOpenChange for the reset.

**Why:** releasing the guard on category change let the category effect run and clear the prefilled length immediately; relying on onOpenChange missed Cancel/mutation close paths and left the ref stale-true.

**How to apply:** any "prefill a reactive form then let the user finish" flow on this page — guard the destructive effects, preserve (don't skip-everything) where other side effects are still wanted, and reset on dialog-close via the open-state effect.
