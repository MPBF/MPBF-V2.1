---
name: WhatsApp recipient phone normalization
description: Meta WhatsApp sends must normalize Saudi local numbers to international 966 format or Meta rejects with (#100) Invalid parameter
---

# WhatsApp recipient phone normalization

Outbound Meta WhatsApp sends must convert recipient numbers to international
format **without `+`** (e.g. `9665XXXXXXXX`). Stored user phones are often Saudi
local format (`05XXXXXXXX` or `5XXXXXXXX`).

**Rule:** strip `+`/spaces/punctuation, drop leading `00`, then `05XXXXXXXX` →
`9665XXXXXXXX` and `5XXXXXXXX` → `9665XXXXXXXX`. Reject anything not matching
`^\d{11,15}$` before calling Meta.

**Why:** Meta returns a generic `(#100) Invalid parameter` for badly-formatted
recipients. Merely stripping `+`/spaces (the old behavior) is NOT enough — a
local `05...` number passes through unchanged and Meta rejects it. This produced
recurring production errors on attendance check-in notifications.

**How to apply:** keep the SMS gateway (`taqnyat-sms.ts` formatPhoneNumber) and
the WhatsApp service (`meta-whatsapp.ts` formatRecipientPhone) normalization in
lockstep. Any new outbound channel that takes a raw user phone must normalize the
same way before hitting the provider API.
