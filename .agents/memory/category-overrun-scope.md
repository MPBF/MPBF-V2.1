---
name: Category production overrun scope
description: Category production percentages apply only to new production orders.
---

The user requested category percentage configuration with choices 0%, 5%, 10%, and 20%, and explicitly approved 0% as the default for existing and new categories. They subsequently requested using this percentage to calculate the final planned production quantity, explicitly choosing **new production orders only**.

**Why:** The user chose to preserve existing production orders rather than recalculate their planned quantities using current category settings.

**How to apply:** Snapshot the category percentage when creating a production order, including a new line added to an existing customer order. Do not backfill existing orders or re-rate them when category settings change. Existing quantity edits use the percentage already saved in that production order.