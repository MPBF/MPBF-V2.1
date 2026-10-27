---
name: Package firewall and stale lockfiles
description: Recover clean installs blocked by older transitive releases without bypassing security policy
---

A compatible parent upgrade can retain blocked transitive versions from the lockfile. Check the actual locked dependency graph against current registry metadata, not just the parent's requested version.

**Why:** Post-merge clean installation exposed more than one blocked transitive package. Updating the first did not resolve the second, and the dependency ranges already allowed patched releases.

**How to apply:** Upgrade compatible parents and resolve affected transitives to verified compatible patched releases. Keep registry integrity checks and the firewall enabled; validate a clean post-merge install and the consumers' runtime behavior. Never declare recovery based only on an incremental install.

An automatic npm audit fix can leave lockfile entries that contradict newly added overrides. Require both a clean install and a dependency-tree validity check; an updated manifest or an auto-fix summary alone is not evidence that the override took effect.

Keep npm lockfiles registry-portable: preserve exact versions and integrity hashes without baking in environment-specific tarball hosts.

**Why:** Clean installs under npm 12's remote-fetch restrictions can reject older firewall-host URLs as remote packages, even when the versions themselves are safe. Disabling the firewall or remote-fetch restrictions is not an acceptable fix.

**How to apply:** Have npm omit registry-resolved URLs when refreshing locks, so clean installs use the environment's configured registry and retain integrity verification. Check nested tooling locks too; pnpm has its own overrides and must be kept consistent independently.
