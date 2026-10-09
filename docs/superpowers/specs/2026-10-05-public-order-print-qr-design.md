# Public order-print QR

The user explicitly approved the complete print copy without system login,
including printed customer phone, notes and employee names. Only possession
of a hard-to-guess per-order link grants this read-only print access.

## Boundary

Keep the internal print preview and all ordinary order APIs authenticated.
Add a public print page and a signed read-only API, never a public order list
or editing operation. Project only the fields consumed by the print sheet;
omit tax identifiers, addresses, authentication fields and unrelated product
or execution data absent from the print copy.

## Links

An authenticated order reader obtains a print link from a read-only endpoint.
Use a domain-separated SHA-256 HMAC over the canonical order ID with the existing
SESSION_SECRET; verify with constant-time comparison. Tokens have no expiry
because printed paper should remain usable. Changing the secret invalidates
previous links. If the secret is missing, fail closed. No secret values enter
the browser. No database migration or token writes are needed.

The public API validates ID and signature before reading an order. Invalid,
missing, modified and nonexistent links return a generic 404 without order
data. Public HTML/API responses use no-store, no-referrer and robots exclusion.

## UI

Reuse the existing print sheet, A4 layout and print readiness/error handling.
Recognize the public route before the login gate, without removing that gate
from other routes. Public loading does not require a user cookie.
The QR encodes the public path at the app's current origin. Old printed QR
images cannot change and require reprinting, as explained to the user.

## Verification

Test signature stability, cross-order tampering, missing/config-invalid links,
projection privacy and anonymous HTTP behavior. Exercise public visitor flows
with browser fixtures, including invalid links, printing and the unchanged
login requirement on internal routes. Check types and the running preview.
