---
name: WhatsApp 24h window requires approved templates
description: Why business-initiated WhatsApp notifications silently fail to deliver and the delivery rule the code must follow.
---

# WhatsApp 24h customer-service window vs templates

Meta WhatsApp Business API only delivers **free-form text** messages if the recipient messaged the business within the last **24 hours**. Outside that window, Meta **accepts** a free-form text send (returns a wamid, status logs as `sent`) but **never delivers** it — no error, no `delivered`/`read` webhook. So "تم الإرسال / sent" is NOT proof of delivery.

**The rule:** any message the *system* initiates (notifications, alerts, attendance, event triggers, owner alerts) must go through an **approved template**. Free-form text is valid only as a reply inside a live 24h conversation (explicit `useTemplate:false`).

**Why:** this was the root cause of "رسائل الواتس اب لا تعمل" — dozens of notifications stuck at `sent` and zero ever reaching `delivered`.

**How to apply:**
- `notificationService.sendWhatsAppMessage` defaults to a template (general `system_notification`, one body var = the message) for the Meta path; callers pass `templateName` + `templateVariables` for structured templates (e.g. `attendance_update`).
- Do **not** fall back to free-form text when a template send fails. The fallback re-creates the silent-non-delivery bug AND suppresses `deliverExternalAlert`'s SMS fallback (which only fires when the WhatsApp send returns failure). Return the failure explicitly.
- Template **body params cannot contain newlines/tabs or >4 consecutive spaces** → flatten to one line before sending.
- A template variable **cannot sit at the very start or end** of the template body; surround `{{1}}` with fixed text.
- Templates need Meta approval (PENDING → APPROVED, minutes to ~1 day). During PENDING, template sends fail; that's expected — SMS fallback covers external alerts meanwhile.
- Any request route that forwards template variables must include them in its Zod schema (`commonSchemas.whatsappMessage`), or `z.object` strips them silently.
