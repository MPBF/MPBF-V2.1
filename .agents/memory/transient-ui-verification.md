---
name: Transient UI verification
description: Avoid false browser-test failures when a loading element disappears between protocol calls.
---
Capture a transient loading element's text in the same browser evaluation
that confirms the element exists.

**Why:** a lazy-loaded screen can replace its loading element between two
browser-protocol calls. A test observed the loader, checked another control,
then failed on the missing loader even though the screen loaded correctly.

**How to apply:** poll for the required loading state and snapshot its text
atomically, then assert that snapshot and the eventual loaded screen separately.
Do not remove the loading assertion, weaken its expected translation, or add
long arbitrary delays merely to keep the element around.
