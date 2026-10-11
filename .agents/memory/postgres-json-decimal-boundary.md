---
name: PostgreSQL decimal JSON boundary
description: Direct NUMERIC columns and nested JSONB aggregates do not produce the same JavaScript quantity type.
---
Keep exact decimal quantities as text when constructing nested PostgreSQL
JSONB responses whose API contract declares those quantities as strings.

**Why:** a direct PostgreSQL NUMERIC result is normally returned as text,
but the same column inside a JSONB aggregate is decoded as a JavaScript
number. That difference caused saved receipt printing to fail and can also
lose decimal precision for large quantities.

**How to apply:** cast the decimal field to text inside the JSON construction,
not after JSON decoding. Read-only formatters should also tolerate valid numeric
values from older cached responses. Preserve exact decimal arithmetic, reject
invalid values explicitly, and do not substitute zero for missing quantities
or change the global database parser to fix one endpoint.
