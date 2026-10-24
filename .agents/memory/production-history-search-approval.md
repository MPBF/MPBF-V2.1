---
name: Production history search approval
description: Approval and privacy boundaries for archive-search performance work
---

Search-performance work must use disposable local synthetic data. Obtain separate
approval before adding any index or changing a schema, including local index
experiments, and before any change to the published production database. Never
record user search phrases or customer data.

**Why:** The user explicitly set these boundaries for investigating archive
search. The general permission to improve development schemas does not override
this narrower approval requirement.

**How to apply:** Compare schema-free SQL alternatives first. Present measurements
and trade-offs before requesting approval for a specific indexed experiment;
local experiment approval is not permission to change the published database.
