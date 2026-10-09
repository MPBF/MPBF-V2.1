---
name: MCP ChatGPT OAuth discovery
description: Why ChatGPT MCP connectors fail with "Client not registered" and what discovery pieces the server must expose.
---

# ChatGPT MCP connector OAuth — discovery requirements

**Symptom:** ChatGPT connector fails with "Client not registered" and `mcp_oauth_clients`
has 0 rows even though users tried to connect. That error is our own, returned from
`POST /oauth/authorize` when the presented `client_id` isn't in the DB.

**Root cause:** the connection never completes Dynamic Client Registration because OAuth
discovery is incomplete. Serving only `/.well-known/oauth-authorization-server` is not
enough for modern MCP clients.

**A compliant MCP server (for ChatGPT/Claude/Inspector) must expose:**
1. `WWW-Authenticate: Bearer resource_metadata="<base>/.well-known/oauth-protected-resource"`
   on the **401 from the MCP endpoint** (`/mcp`). This header is the trigger that starts
   client discovery — without it the client never learns where to register/authorize.
2. RFC 9728 Protected Resource Metadata at `/.well-known/oauth-protected-resource`
   returning `{ resource: "<base>/mcp", authorization_servers: ["<base>"], scopes_supported, bearer_methods_supported }`.
3. RFC 8414 AS metadata — serve it at BOTH the root path and a `/mcp`-suffixed variant
   (`/.well-known/oauth-authorization-server/mcp`); clients probe both.
4. A DCR response (`/oauth/register`) with `client_id_issued_at` and
   `client_secret_expires_at` (use `0` = never), or strict clients reject it.

**Why:** the MCP auth spec chains 401→protected-resource→auth-server→DCR→authorize→token.
Break any early link and the client silently can't register, then presents an
unknown/stale `client_id` at authorize.

**Lazy client registration:** if an unknown `client_id` reaches `/oauth/authorize`,
auto-register it (random secret, redirect_uris=[presented uri]) instead of hard-failing.
This is safe here because DCR (`/oauth/register`) is already open+unauthenticated, so it
adds no new trust boundary — the real gates are the MCP API key entered on the consent
screen + PKCE + redirect_uri binding on the code. Handles stale client_ids left over from
a DB reset too.

**How to apply:** when touching MCP OAuth, keep these four discovery pieces in lockstep;
`getBaseUrl` must honor `x-forwarded-proto`/`x-forwarded-host` so metadata URLs match the
public host behind Replit's proxy.
