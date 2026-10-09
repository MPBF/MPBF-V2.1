---
name: Order delivery calendar days
description: Why delivery periods use the order's original Riyadh date and why historical planned dates remain editable
---

An order's delivery period means calendar days from its original creation date in Asia/Riyadh, including when the order is edited later. The server computes and persists the resulting planned date rather than trusting a browser-supplied date.

**Why:** Recalculating from the edit day silently postpones existing commitments. A database check requiring planned dates to remain in the future also makes historical orders impossible to edit after their planned date passes, even for unrelated item changes.

**How to apply:** Keep the displayed preview and server calculation aligned on the original order day. Validate new periods as positive bounded integers, but permit historical computed dates on existing orders. If another environment still has a current-date delivery check, apply the narrow migration before expecting edits of older orders to work.