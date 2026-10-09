---
name: Publish snapshot exclusions
description: Why workspace-local caches need explicit root ignore rules before publishing.
---

Replit publish snapshots must not include workspace-only caches and tooling state such as `.cache`, `.config`, `.local`, `.pythonlibs`, logs, or nested dependency trees.

**Why:** Replit's global Git exclusions can hide these paths from `git status`, but publishing relies on project-level ignore rules. Accumulated workspace state can otherwise push the image over the 8 GiB limit even when the application build output is small.

**How to apply:** Keep generated workspace directories and nested `node_modules` explicitly excluded in the root `.gitignore`. When a build succeeds but image creation fails for size, compare workspace usage against these exclusions before changing application bundles.

The development workflow still needs the root `node_modules` directory because it runs `tsx` from the package scripts. If dependencies are removed for a publish-size cleanup, reinstall them before restarting or using the preview.