---
name: System-user automation boundaries
description: Security and reliability rules for automated users reading business data and replying to internal messages.
---

Automated-user prompts may receive only data assembled from that user’s explicit source/table grants through a fixed server registry. Advanced access must never become a request-provided table or SQL identifier, and internal-message rows stay scoped to the automated user.

**Why:** A shared business context bypasses per-user grants, while dynamic table names turn a read-only feature into a data-exposure boundary failure.

**How to apply:** Any new source must define fixed safe fields and row scope in the server registry, then be included only when the bot has the matching grant.

Compatibility backfills that grant bot data access must be guarded by a durable, atomic migration marker rather than rerun at application startup.

**Why:** An unconditional idempotent insert still recreates grants after an administrator revokes them, defeating least privilege.

**How to apply:** Claim the migration marker and insert legacy grants in one database statement/transaction. New bots and later restarts must receive no implicit grants.

Reply queue execution must use an opaque token for each processing lease. Every skip or send finalization must lock the row and match both processing status and the exact token; response insertion and queue/audit finalization belong to one transaction.

**Why:** Status-only stale recovery lets an obsolete worker finish after another worker reclaims the row, producing duplicate replies.

**How to apply:** Reclaiming replaces the token. Never finalize a reply by queue ID/status alone, and never insert the reply outside the finalization transaction.

An empty reply window inherits the bot’s configured shift window in factory time (Asia/Riyadh), rather than allowing replies all day.

**Why:** Optional UI fields are meant to preserve shift-based behavior, and UTC wall-clock calculations move the operational window by three hours.

**How to apply:** Convert factory wall times to instants with the shared shift timezone utilities; handle overnight windows explicitly.