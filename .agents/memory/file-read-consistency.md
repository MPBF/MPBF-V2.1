---
name: File read consistency
description: Verify conflicting file-reader and shell observations before using review references.
---

If a file-reading tool disagrees with the current shell filesystem, verify the source directly in the shell before citing lines or applying changes.

**Why:** During a review, file-reader responses contained older source while shell reads and Git showed the current version. Trusting those responses would have invalidated otherwise correct findings.

**How to apply:** Use narrowly scoped shell reads and searches to confirm the relevant code whenever file lengths or cited lines unexpectedly disagree. Do not infer that another agent edited the app solely from conflicting reader output.

Large shell output passed through the code-execution callback can be incomplete
even when its truncation flag is false. Never copy a long historical source file
from that output without verifying its byte length.

**Why:** A historical source copy returned only the tail despite requesting a
large output allowance. Byte-length verification and small base64-encoded chunks
recovered the exact source without damaging Unicode characters.

**How to apply:** Prefer regular shell/file tools for large reads. If chaining
historical reads into whole-file writes, verify the expected byte length before
writing; split large output into bounded, byte-safe chunks when necessary.