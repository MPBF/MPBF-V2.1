---
name: Security & authz patterns
description: Durable security/authorization patterns and gotchas for this codebase — apply these to avoid re-introducing known classes of bugs.
---

## Route authorization
- Every business-data route needs `requirePermission`, not just `requireAuth`. Routes that only check `requireAuth` while exposing `manage_*`/`view_*` data are privilege-escalation paths.
- General public order/customer endpoints must not return contact or tax fields. Exception: the explicitly approved per-order print capability includes printed phone and names only; see order-printing-scope.md.
- An access allow-list must gate ALL of a feature's user routes (conversations, messages, profile, document download), not just the main chat/entry route. Holding the feature permission ≠ being on the allow-list; a blocked user can otherwise reach prior artifacts via secondary endpoints.

## Webhooks
- Verifying a signature header *exists* is not verification. Validate the full HMAC (e.g. Twilio: URL + sorted param pairs, `timingSafeEqual`).
- **Why:** forged payloads can manipulate state (notification status, etc.) otherwise.
- If the signing secret is unset, emit a loud `logger.warn` per request to surface misconfiguration rather than silently accepting.

## Rate limiting
- Auth-adjacent/setup endpoints need a rate limiter (in-memory IP window, e.g. 5/15min → 429). Key on first `x-forwarded-for` IP; self-expire entries.

## AI agent / tool boundary
- The AI tool layer bypasses route-level checks, so authorize EACH tool separately (per-tool `required_permission` + `userCanUseTool`).
- AI write tools must also replicate the standard route's server-side business-rule computation; never trust model-supplied *derived* fields. E.g. production-order tools recompute final_quantity_kg/overrun via `calculateProductionQuantities(qty, product.punching)` and drop those fields from the tool schema, matching `/api/production-orders`.
- Task-level gating alone is insufficient: a tool needs its own `permission` because `ensureSeeded` only inserts tasks when the table is empty, so existing-DB task rows won't pick up a newly-added `required_permission` (update the row separately for consistency).
- AI-generated SQL: block `UPDATE`/`INSERT INTO` against sensitive tables (permissions, agent settings/knowledge, sessions); SELECT may stay allowed.
- Per-user data isolation: scope sandbox/agent data by an owner prefix (`u{userId}_`) on reads/writes/deletes; admins may wipe all, regular users only their prefix.

## MCP Twilio Voice authorization
- An active MCP key may make calls only when its creator's role has `use_twilio_voice`, `manage_twilio_voice`, or `admin`. Both direct API-key and OAuth token validation must hydrate the same role permissions before creating the MCP auth context.
- Phone-allowlist bypass stays separately gated by both the key-level bypass flag and the `manage_twilio_voice` permission; ordinary call permission never bypasses the approved-number list.
- **Why:** the production call tool originally checked only the per-key `voice_access` flag, so an authorized administrator was rejected despite their explicit role permission. Role-based access is the selected policy; inactive keys remain rejected before tools are exposed.

## Twilio Voice credential fallback
- Prefer a restricted Twilio API Key when it is configured. If it is absent, outbound calls may use the existing Account SID and Auth Token pair; the Auth Token still verifies Twilio webhooks.
- **Why:** production had working account credentials but no API Key pair, which made an otherwise authorized call fail as misconfigured. The owner explicitly chose the fallback rather than postponing service for a new restricted key.
- **How to apply:** keep `PUBLIC_BASE_URL` on the HTTPS production domain, treat account-token fallback as a compatibility path, and move back to an API Key when it is provisioned.

## Twilio Voice production configuration
- Keep callback URL and phone allowlist scoped explicitly to production (and development if needed), and re-publish after any environment or secret update. A secret name being present is not proof that a running deployment has loaded a usable value.
- **Why:** the live MCP call process reported required values missing even while the secret inventory listed their names; re-saving the affected credentials and preparing production-scoped runtime values resolves the deployment snapshot mismatch.
- **How to apply:** verify only existence statuses, never print credentials; then publish a fresh production build before retrying a voice call.

## Private knowledge non-disclosure (must be server-side, not prompt-only)
- Prompt instructions ("never quote verbatim") are NOT a control. Use a deterministic substring leak detector that normalizes private content and checks it against any user-visible output.
- Windowing: `win = min(60, content.length)`, step ~20, PLUS an always-checked trailing window `content.slice(-win)`. A fixed `win=60` silently skips secrets of length 40–59 (loop never runs) and skips the tail — both exploitable.
- Apply to BOTH the final reply AND generated documents (concatenate title/intro/sections/table cells/footer before checking). Reply-only checks are bypassed by asking the agent to put the secret in a downloadable PDF/Word doc.
- Fetch private contents once per request, pass into every tool's context, reuse for the final reply check. On a hit, return an error and write no file.

## Agent-generated document IDOR
- Bind temp-file docs to their creator via filename prefix `u{userId}-`; download route enforces `ownerId === req.user.id || isManager`.

## Order-number generation under concurrency
- `SELECT MAX(...)+1` then insert is racy. Wrap in a bounded retry loop: on unique-violation (`23505`) recompute and retry with the next number; rethrow non-dup errors; give up after N attempts with a deterministic error.
- `storage` wraps DB errors in `DatabaseError` but preserves `.code` from the original pg error, so `e.code === "23505"` is detectable downstream.

## Type-safety gotchas
- `SafeUser = Omit<User, "password">`: any `db.select({...})` typed to return `SafeUser` must list EVERY non-password user column (esp. `must_change_password`), or tsc errors and the field is silently undefined at runtime.
- `orders` has no `priority` column — `priority` lives on `user_requests`.
- A storage-side interface mirroring a real service class must match its exact signature; a `[key: string]: unknown` index signature blocks assigning the real instance.

## Session config
- `resave: false` when middleware already calls `req.session.save()` manually; `resave: true` causes an extra write on every session-touching request.

## Silent catch blocks
- Replace `catch {}` with `logger.warn` so fs/IO errors surface. When adding `logger.*` to a file, confirm `import { logger } from "./lib/logger"` exists or the call throws `ReferenceError` on the error path.

## Scoped reports and auditable mutations
- Own-scoped reporting must apply the ownership predicate to rows **and** every aggregate (total, breakdowns, averages); a reports permission alone must not imply global data access.
  - **Why:** scoping only the list, or forgetting reports entirely, leaks other users' records through rows or aggregate values.
  - **How to apply:** build one shared scoped filter first, append user filters to it, and reuse the resulting condition for every query in the report handler.
- When a feature promises an audit trail, lock the current row and commit the mutation plus activity rows in the same transaction; audit inserts must never be best-effort.
  - **Why:** post-commit logging can silently lose audit entries, while concurrent edits otherwise record stale “from” values.
  - **How to apply:** `SELECT ... FOR UPDATE`, authorize against the locked row, calculate actual old/new deltas, update, and insert audit entries before commit; send notifications afterward.

## PDF template path traversal / arbitrary file read
- `/api/pdf/generate` accepts `templateName` and `templatePath`; both must resolve within `server/services/adobe-pdf/templates` and reject anything escaping it (`path.resolve` then `startsWith(dir + sep)`), else any authed user can read arbitrary server files (fed to Adobe docx merge).
- `templatePath` branch has no frontend caller — safe to keep constrained (or remove entirely).

- Production mutation routes (roll/cut creation, machine-queue assign, production settings) must carry requirePermission gates, not bare requireAuth; requireAuth-only mutations are recurring privilege-escalation findings — check new production endpoints against this pattern.

- Perf: populateUserFromSession is scoped to /api & /mcp paths and resolveUserById has a 30s in-memory user cache (invalidateUserCache on user/role mutations); session extension DB save is throttled to once per 5 min per session. Don't reintroduce per-request DB lookups/writes in these middlewares.
