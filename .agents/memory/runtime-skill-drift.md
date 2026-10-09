---
name: Skill and runtime capability drift
description: Installed skill documentation can describe a worker variant that the current runtime does not support.
---

Treat documented worker variants as capabilities to verify, not guarantees that the current runtime registers them.

**Why:** The installed testing skill described a specialized testing worker, but the runtime rejected that worker kind. Browser verification was still possible using a supported general worker and existing browser tooling, without installing application dependencies or touching real account data.

**How to apply:** On an explicit unsupported-kind error, use a supported worker and available tools rather than repeatedly retrying the same variant. Keep browser validation isolated from the user's browser session and intercept synthetic test traffic when real data must remain unchanged.