---
name: Prospective production mix accounting
description: Approved accounting scope and limits of machine-wide FIFO mix traceability.
---

Production monitoring is administrator-only and consumption accounting is prospective only. Do not reconstruct historical consumption or opening stock; historical production may remain visible without tracked balances.

**Why:** the user explicitly chose new-only accounting instead of historical reconstruction.

**How to apply:** preserve the permanent activation boundary on reruns or restarts; published-database activation still needs separate approval.

Allocate film kilograms from the same machine's recorded mixes oldest-first. Shortages permit successful production with a warning, and later mixes must never silently cover an earlier shortage. Do not deduct raw inventory a second time when a roll consumes a mix.

**Why:** the user chose detailed oldest-mix-first consumption while allowing uncovered production; raw stock was already deducted by mixing.

**How to apply:** preserve recorded allocations and uncovered amounts across retries and refreshes. Do not turn this into blocking inventory validation, corrections or automatic deficit reconciliation without new approval.

A/B identity is factual metadata on mixes, not a claim about physical screw or layer dosing; the eligible machine mixes form one FIFO pool.

**Why:** the user excluded physical layer models and assumed ABA ratios.

**How to apply:** expose recorded screw identity alongside linked quantities without assigning film output to inferred layers or ingredients.
