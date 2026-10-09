# Bilingual interface and compact flag language selector

## Approved direction

The user chose a compact dropdown displaying the current language's flag rather than its written name. Use the Saudi flag for Arabic and the British flag for English. Limit visual changes to the language selector, preserving the existing application layout.

## Integration

- Share one accessible flag-selector component between the public login, mandatory password-change page, and authenticated header.
- Show the flag of the effective language on the closed trigger, including when the preference follows the factory default.
- Keep Arabic and English options identifiable through localized tooltips and accessible labels. Use local SVG flag assets rather than platform-dependent emoji.
- Preserve the authenticated factory-default option, represented by a neutral factory/settings symbol with its localized accessible description.
- Retain the existing authenticated `PUT /api/me/language` contract: `ar`, `en`, or `null` for the factory default. No schema or permission changes.
- Disable the control during saving. On save failure, retain the previous preference and language, and show the existing localized error. Public switching does not require authentication or write business data.
- Retain document language, RTL/LTR direction, title, and metadata updates. Preserve the existing distinction between anonymous session language and saved user preference; do not silently introduce new persistence behavior.

## Bilingual verification and corrections

Audit translation coverage and exercise login, navigation, customers/customer profile, orders/production, administration, and representative create/edit dialogs in both languages with intercepted API fixtures. Correct interface strings and language-dependent display logic found in this review, without translating or modifying stored customer/product data.

Customer-profile category ordering must use the active language's category name and collator and reapply when switching language without reloading data. Keep category grouping, stable within-category ordering, and unclassified-last behavior. In English, do not substitute Arabic-only category names: use a neutral identifier when English is unavailable. Honor existing strict-English display guidance for dynamic names and errors.

No data migrations, authentication bypass in application code, unrelated redesigns, or writes to real customers, products, or orders.

## Acceptance and testing

- Mouse, touch, keyboard navigation, focus return, Escape dismissal, and screen-reader names work for the dropdown.
- Arabic uses RTL, English uses LTR, and the chosen flag matches the effective language. Factory-default selection, failed saving, and saved preference after reload behave correctly.
- Check phone, tablet, and desktop widths for selector/menu clipping and horizontal overflow.
- Check representative pages and dialogs for untranslated interface text, while distinguishing intentionally bilingual editable data fields from interface labels.
- Run translation coverage, type checking, relevant/full unit tests, build, and isolated browser checks; inspect the running app after restarting the workflow once.
- Be explicit about verification limitations: fixture-based authenticated UI checks do not establish that every live business record has an English translation.