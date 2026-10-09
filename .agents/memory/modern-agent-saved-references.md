---
name: Modern-agent saved references
description: Security boundary for long-lived files saved through the Modern AI agent.
---

Permanent files saved from the Modern AI agent must remain scoped to the administrator who saved them. They are not entries in the global agent knowledge base and must never be interpolated into the system prompt.

**Why:** Uploaded documents can contain confidential information or indirect prompt-injection text. Making them global lets one upload affect unrelated users and turns untrusted content into a persistent instruction channel.

**How to apply:** Persist owner-bound reference text separately, load only the current owner's bounded excerpts, and label/delimit it as untrusted reference data in the user-request context. Preserve server-side manager authorization for creating permanent references; temporary uploads remain request-only.