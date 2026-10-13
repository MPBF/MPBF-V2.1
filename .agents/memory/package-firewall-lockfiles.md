---
name: Package firewall and stale lockfiles
description: Recover clean installs blocked by older transitive releases without bypassing security policy
---

A compatible parent upgrade can retain blocked transitive versions from the lockfile. Check the actual locked dependency graph against current registry metadata, not just the parent's requested version.

**Why:** Post-merge clean installation exposed more than one blocked transitive package. Updating the first did not resolve the second, and the dependency ranges already allowed patched releases.

**How to apply:** Upgrade compatible parents and resolve affected transitives to verified compatible patched releases. Keep registry integrity checks and the firewall enabled; validate a clean post-merge install and the consumers' runtime behavior. Never declare recovery based only on an incremental install.
