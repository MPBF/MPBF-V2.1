---
name: gpt-5 temperature constraint
description: gpt-5 family rejects custom temperature; only the default is allowed
---

# gpt-5 only supports default temperature

When switching any chat.completions call to a `gpt-5*` model, you must NOT
send a custom `temperature` (e.g. 0.3). The model returns HTTP 400:
"Unsupported value: 'temperature' does not support 0.3 with this model.
Only the default (1) value is supported." Verified against the Replit AI
integration (AI_INTEGRATIONS_OPENAI_* / modelfarm) on 2026-06-14.

**Why:** gpt-4.x accepted arbitrary temperatures; gpt-5 locks it to 1. Code
that hardcoded or passed a stored temperature broke immediately after the
model swap.

**How to apply:** Gate the `temperature` param on the model — only include
it when the model is NOT in the gpt-5 family (e.g. `!model.startsWith("gpt-5")`),
otherwise omit it entirely so the API uses the default. The same applies to
other newer reasoning models if they enforce the same restriction. Note the
agent's configured model is read from the `modern_agent_settings` DB row, so
a model swap also requires updating that row, not just code defaults.
