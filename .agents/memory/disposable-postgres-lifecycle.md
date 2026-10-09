---
name: Disposable PostgreSQL lifecycle
description: Keep isolated test databases alive across shell-tool calls without relying on system socket directories.
---

Run a temporary PostgreSQL server as a foreground process in a background shell
task when tests execute in a later tool call. A daemon started by `pg_ctl` in a
normal shell call can report readiness and then disappear when that call ends.
Use an available temporary Unix socket directory rather than assuming the
system PostgreSQL socket directory exists.

**Why:** ordinary shell-call child-process cleanup terminated an apparently
ready disposable server; the default system socket directory was also absent.
The persistent background task made isolated integration verification reliable.

**How to apply:** use this only for disposable test databases, keep them separate
from application databases, and stop the temporary server after verification.
