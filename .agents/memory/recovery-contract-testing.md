---
name: Recovery contract testing
description: Test uncertain-write recovery honestly and keep automatic read retries separate from write replay.
---

Queue fixtures must enforce the server's expected **current** positions, not
merely return success. Verify captured UI-generated positions against the real
server contract in a disposable schema.

Recovered-write tests must simulate a committed operation whose response is
lost, verify the same operation key and one committed result, and check that
success clears the submitted draft while preserving later edits and other drafts.

**Why:** permissive write fixtures concealed reversed queue positions, and
checking UUID reuse alone missed populated forms that could submit duplicates
after a successful retry.

**How to apply:** use an idempotent fixture ledger and transport interruption
after commitment. Exercise both initial submission and retry through the same
success lifecycle, including film, receipts and location forms.

## Read retries versus uncertain writes

Automatic network recovery must be bounded and restricted to safe reads. Do not
automatically repeat employee punches, message sends, or other writes unless
their API already has a durable idempotency contract. After an uncertain write,
tell the user to refresh state before repeating it.

**Why:** a lost response does not prove the server rejected the operation.
Replaying a write can record attendance or send a message twice. Conversely,
read errors can remain visible after a temporary restart if the page never
tries loading again.

**How to apply:** test actual browser transport failures, not only JSON error
responses. Verify bounded read attempts, recovery after connectivity returns,
deduplication of simultaneous recovery events, cancellation of obsolete page
loads, and exactly one attempt for writes without idempotency keys. Authentication
and validation failures are not transient network errors and must not be retried.