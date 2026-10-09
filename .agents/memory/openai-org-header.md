---
name: OpenAI org header vs Replit AI integration
description: Why new OpenAI clients 401 with mismatched_organization and how to fix
---

New `new OpenAI(...)` clients in this repo must pass `organization: null`.

**Why:** The OpenAI Node SDK defaults `organization` to `readEnv('OPENAI_ORG_ID') ?? null`, and this workspace has `OPENAI_ORG_ID` set. That org does not match the Replit AI integration proxy key (`AI_INTEGRATIONS_OPENAI_API_KEY` + `AI_INTEGRATIONS_OPENAI_BASE_URL`), so the proxy returns `401 mismatched_organization`. Passing `organization: null` overrides the env default (defaults only apply when the arg is `undefined`); the SDK's buildHeaders drops null-valued headers so no org header is sent.

**How to apply:** Any service constructing an OpenAI client against the Replit integration proxy — set `organization: null` alongside apiKey/baseURL.
