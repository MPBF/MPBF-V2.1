---
name: AI agent vs MCP separation
description: The "الوكيل الذكي" in-app AI agent and the MCP system are independent; removing/replacing one must not touch the other.
---

# AI agent and MCP are separate systems

The old in-app AI agent ("الوكيل الذكي") and the MCP integration system are **independent** despite both sounding "AI-related". The agent was fully removed; MCP was deliberately kept intact.

**Why:** Conflating them risks breaking MCP while working on the agent (or vice versa).

**How to apply:**
- When removing/replacing the AI agent, never touch the MCP routes/OAuth, `view_mcp_settings`, or the `mcp` settings tab.
- The mobile capabilities feature list in `server/routes.ts` intentionally keeps an `"ai_agent"` capability string (mobile API contract) — leave it during agent cleanup.
- `migrations/` snapshots are historical and are NOT regenerated when tables are dropped; don't hand-edit them to chase removed tables.
- Before destructively dropping feature tables, export them to `backups/` first (drops are irreversible).

## Gotcha: the agent routes file held unrelated business routes
The old monolithic agent routes file also registered the **quote** and **quote-template** APIs (list/detail/PDF/templates CRUD), still consumed by the frontend dashboard. Deleting the whole file silently 404'd those.
**Lesson:** before deleting a large "feature" routes file, grep the frontend for every endpoint it registers (not just the obviously-related ones) and relocate any still-used routes. The quote PDF generator was also coupled to the agent's runtime config for VAT rate — decouple such shared helpers (VAT defaults to 0.15) when extracting.
