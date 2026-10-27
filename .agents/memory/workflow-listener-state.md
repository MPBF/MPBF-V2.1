---
name: Workflow listener state
description: A failed or stopped workflow can leave its development server alive on port 5000.
---

Do not infer successful workflow recovery from an HTTP 200 alone: verify both
the managed workflow state and its open port.

**Why:** this workspace has reported a failed startup while the earlier Node
process continued serving requests. Stopping the failed workflow did not stop
that leftover process, so a new launch could encounter EADDRINUSE.

**How to apply:** inspect the listener and its process ancestry after stopping
the failed workflow. Terminate only a verified leftover application process;
never kill every Node process or move the app to a different port. Confirm that
the managed workflow is running on port 5000 as well as checking the preview.
