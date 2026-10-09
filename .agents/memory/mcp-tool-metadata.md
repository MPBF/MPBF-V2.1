---
name: MCP tool metadata
description: Register ChatGPT-facing MCP tools with explicit safety metadata.
---

Use `McpServer.registerTool` with a config object for ChatGPT-facing tools. Include a concrete title, a description that accurately states the user-confirmed action boundary, the existing input schema, and tool annotations that describe read-only, idempotency, and external-world effects.

**Why:** the legacy `server.tool` API is deprecated and does not make the intended tool metadata as explicit to connector clients. Clear metadata is particularly important for tools that cause external actions, such as outbound calls.

**How to apply:** keep authorization, allowlist, and business logic in the handler unchanged. For an external non-repeatable action, use `readOnlyHint: false`, `idempotentHint: false`, and `openWorldHint: true`; for data reads, use the inverse read-only/idempotent hints and `openWorldHint: false`. Verify the emitted metadata through an actual `tools/list` request after registration.