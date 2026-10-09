
HEAD
name: frontend-design
description: Create distinctive, production-grade frontend interfaces with high design quality. Use this skill when the user asks to build web components, pages, artifacts, posters, or applications (examples include websites, landing pages, dashboards, React components, HTML/CSS layouts, or when styling/beautifying any web UI). Generates creative, polished code and UI design that avoids generic AI aesthetics.
license: Complete terms in LICENSE.txt


This skill guides creation of distinctive, production-grade frontend interfaces that avoid generic "AI slop" aesthetics. Implement real working code with exceptional attention to aesthetic details and creative choices.

The user provides frontend requirements: a component, page, application, or interface to build. They may include context about the purpose, audience, or technical constraints.

## Design Thinking

Before coding, understand the context and commit to a BOLD aesthetic direction:

- **Purpose**: What problem does this interface solve? Who uses it?
- **Tone**: Pick an extreme: brutally minimal, maximalist chaos, retro-futuristic, organic/natural, luxury/refined, playful/toy-like, editorial/magazine, brutalist/raw, art deco/geometric, soft/pastel, industrial/utilitarian, etc. There are so many flavors to choose from. Use these for inspiration but design one that is true to the aesthetic direction.
- **Constraints**: Technical requirements (framework, performance, accessibility).
- **Differentiation**: What makes this UNFORGETTABLE? What's the one thing someone will remember?

**CRITICAL**: Choose a clear conceptual direction and execute it with precision. Bold maximalism and refined minimalism both work - the key is intentionality, not intensity.

Then implement working code (HTML/CSS/JS, React, Vue, etc.) that is:

- Production-grade and functional
- Visually striking and memorable
- Cohesive with a clear aesthetic point-of-view
- Meticulously refined in every detail

## Frontend Aesthetics Guidelines

Focus on:

- **Typography**: Choose fonts that are beautiful, unique, and interesting. Avoid generic fonts like Arial and Inter; opt instead for distinctive choices that elevate the frontend's aesthetics; unexpected, characterful font choices. Pair a distinctive display font with a refined body font.
- **Color & Theme**: Commit to a cohesive aesthetic. Use CSS variables for consistency. Dominant colors with sharp accents outperform timid, evenly-distributed palettes.
- **Motion**: Use animations for effects and micro-interactions. Prioritize CSS-only solutions for HTML. Use Motion library for React when available. Focus on high-impact moments: one well-orchestrated page load with staggered reveals (animation-delay) creates more delight than scattered micro-interactions. Use scroll-triggering and hover states that surprise.
- **Spatial Composition**: Unexpected layouts. Asymmetry. Overlap. Diagonal flow. Grid-breaking elements. Generous negative space OR controlled density.
- **Backgrounds & Visual Details**: Create atmosphere and depth rather than defaulting to solid colors. Add contextual effects and textures that match the overall aesthetic. Apply creative forms like gradient meshes, noise textures, geometric patterns, layered transparencies, dramatic shadows, decorative borders, custom cursors, and grain overlays.

NEVER use generic AI-generated aesthetics like overused font families (Inter, Roboto, Arial, system fonts), cliched color schemes (particularly purple gradients on white backgrounds), predictable layouts and component patterns, and cookie-cutter design that lacks context-specific character.

Interpret creatively and make unexpected choices that feel genuinely designed for the context. No design should be the same. Vary between light and dark themes, different fonts, different aesthetics. NEVER converge on common choices (Space Grotesk, for example) across generations.

**IMPORTANT**: Match implementation complexity to the aesthetic vision. Maximalist designs need elaborate code with extensive animations and effects. Minimalist or refined designs need restraint, precision, and careful attention to spacing, typography, and subtle details. Elegance comes from executing the vision well.

Remember: Claude is capable of extraordinary creative work. Don't hold back, show what can truly be created when thinking outside the box and committing fully to a distinctive vision.

name: mpbf-replit-factory-agent
description: specialized guidance for replit agent when modifying the mpbf modern-v2 factory management app. use when working on the react/vite client, express/typescript server, drizzle/postgresql schema, production orders, rolls, machines, warehouse, maintenance, quality, hr, permissions, reports, whatsapp integrations, object storage, public quote/order pages, operator dashboards, or any safe-change review for this codebase.


# MPBF Replit Factory Agent

## Operating posture
- Treat this repository as a live industrial ERP/MES for a plastic bag factory, not a demo app.
- Prefer targeted, reversible changes. Do not perform broad rewrites unless AbuKhalid explicitly asks for redesign.
- Before editing, classify the affected area: orders, production orders, rolls, machines, warehouse, maintenance, quality, HR, permissions, reports, notifications, public quote/order pages, display screens, factory simulation, settings, or infrastructure.
- Communicate assumptions and risk in Arabic/Saudi tone when reporting back to AbuKhalid.
- Never invent business rules. Derive behavior from existing files first, especially `shared/schema.ts`, `server/storage.ts`, `server/routes.ts`, and the affected page/component.

## Codebase facts
- Runtime is Node/TypeScript. `npm run dev` launches `server/index.ts` through `tsx`.
- Production build runs `vite build` then bundles `server/index.ts` with esbuild into `dist`.
- Frontend is React 18 + Vite under `client/src`, with Wouter routing, TanStack Query, Tailwind, Radix/shadcn-style UI components, i18next, and lazy route loading.
- Backend is Express under `server`, with middleware for sessions, performance, memory monitoring, body-size controls, webhook raw body capture, and static/PWA assets.
- Database is PostgreSQL through Drizzle ORM. Main schema is `shared/schema.ts`; migrations output to `migrations`.
- Shared domain utilities and validations live under `shared`, including permissions, shifts, number formatting, validation utilities, and ID generation.
- Storage/domain operations are concentrated in `server/storage.ts`; prefer using or extending existing storage methods rather than duplicating raw SQL in routes.
- Important integrations include Replit Auth/session auth, OpenAI, Meta WhatsApp, Taqnyat, Twilio, Adobe PDF services, object storage, Excel/PDF/QR/barcode generation, PWA/service worker, and monitoring.

## Core app modules and route map
Use these route/module concepts when adding or reviewing features:
- `/orders`: customer orders, production-order tab, roll search redirect, production reports redirect, order create/edit/delete/status logic.
- `/production-dashboard`: unified operator dashboard. Old `/film-operator`, `/printing-operator`, and `/cutting-operator` redirect here.
- `/production-monitoring`: production monitoring.
- `/production-queues`: production queues.
- `/warehouse`: warehouse, stock, vouchers, inventory movements, receipts.
- `/maintenance`: maintenance requests, actions, reports, negligence, spare parts, consumable parts.
- `/quality`: quality issues, inspections, responsible parties, actions, reports, settings.
- `/hr`: attendance, withdrawals, shifts, leave, training, performance, rewards, custody, traits, wages.
- `/definitions`: master data such as customers, customer products, items, machines, sections, categories, master batch, suppliers.
- `/reports`: reporting modules.
- `/settings`: system settings, system monitoring, MCP settings, roles/permissions as applicable.
- `/modern-agent`, `/tools`, `/admin-tools`: internal tooling.
- Public routes: `/mpbf` for bag quote/configuration and `/view/order/:id` for QR-based public order viewing.
- Display/factory visualization routes: `/display-control`, `/display-screen`, `/factory-simulation`, `/factory-floor`.

## Manufacturing invariants that must not be broken
Maintain these rules when changing schema, APIs, storage, or UI:
1. Order production quantity: sum of production-order quantities must not exceed order total quantity plus allowed tolerance.
2. Production roll quantity: sum of roll weights must not exceed the production order final quantity plus tolerance.
3. Inventory must never go negative. Validate stock movement before commit.
4. Valid state transitions:
   - Orders: `waiting -> in_production -> completed/cancelled`.
   - Production orders: `pending -> active -> completed/cancelled`.
   - Rolls: `film -> printing -> cutting -> done`.
   - Machines: `active <-> maintenance <-> down`.
5. Rolls and production operations require a valid active machine.
6. Preserve foreign-key integrity and do not orphan child records.
7. Preserve temporal consistency: delivery dates, production timestamps, and roll stage dates must remain logical.
8. Waste values must be positive when recorded; quality scores must stay in valid ranges; waste must not exceed related production quantities.
9. Multi-table operations that affect stock, production, roll state, order state, or warehouse movement must use transactions or existing safe storage methods.
10. Errors shown to operators must be clear and Arabic-friendly.

## Production-dashboard rules
- `ProductionDashboard` is permission-gated by three dashboard permissions: `view_film_dashboard`, `view_printing_dashboard`, and `view_cutting_dashboard`.
- A film-only line operator who lacks `manage_production`, `manage_production_hall`, and `admin` sees `OperatorFocusView` instead of the full tabbed dashboard.
- Preserve this simplified operator mode. It is designed for fast factory-floor roll entry and should not be cluttered with manager-only controls.
- The production dashboard tabs are film, printing, and cutting. Do not reintroduce separate operator routes unless explicitly requested.

## OperatorFocusView rules
- Machine selection persists in localStorage key `operator_focus_machine_id`.
- Production-order selection persists in localStorage key `operator_focus_order_id`.
- Film machine picker fetches `/api/machines` and currently filters machines where `type` is `extruder` or `film`, excluding `retired`.
- Active film production orders come from `/api/production-orders/active-for-operator` and refetch every 30 seconds.
- Creating a normal roll posts to `/api/rolls/create-with-timing`.
- Creating the final roll posts to `/api/rolls/create-final` and the UI text states that this closes the film stage automatically.
- Roll payload includes `production_order_id`, `film_machine_id`, `machine_id`, `weight_kg`, `is_last_roll`, and `stage: "film"`.
- Do not weaken validation: machine is required; weight must be numeric and greater than zero; server-side limits must remain authoritative.
- Keep this view mobile-friendly, high-contrast, Arabic-friendly, and fast for operators.

## Orders workflow rules
- `/orders` uses tabs controlled by query string. `?tab=production-orders` opens production orders; other tabs should preserve this pattern.
- `?search=` pre-fills search fields for orders or production orders depending on active tab.
- `?create=1` or `?create=true` opens the create-order dialog and then removes the parameter from the URL.
- New order creation first creates the order using `/api/orders`, then creates production orders through `/api/production-orders/batch`.
- Production-order `overrun_percentage` and `final_quantity_kg` are calculated server-side for security; do not move this authority to the client.
- Editing an order currently updates the order, deletes existing production orders for that order, then recreates the valid submitted production orders. Treat edits here as high-risk and verify child record behavior before changing it.
- Order mutations invalidate `/api/orders`, `/api/production-orders`, `/api/production/hierarchical-orders`, and `/api/dashboard/stats`. Preserve or expand invalidation as needed.
- Destructive order actions are admin-gated in the UI; still enforce sensitive permissions server-side.

## Permission and access rules
- Check `shared/permissions.ts` before adding new routes, buttons, destructive actions, navigation entries, or API capabilities.
- Do not expose protected operational pages without `ProtectedRoute` on the client and an auth/permission check on the API side where applicable.
- When adding a module to navigation, update `client/src/config/navigationConfig.ts` and ensure route access aligns with `roleUtils` and permission keys.
- Do not treat UI hiding as sufficient security. Server routes must validate authorization for sensitive operations.
- If adding a permission, update the central permission registry, role mapping/defaults if present, and the relevant UI access checks.

## Frontend conventions
- Preserve lazy-loaded route style in `client/src/App.tsx` for page-level modules.
- Use existing components from `client/src/components/ui` and existing layout components before creating new UI primitives.
- Use TanStack Query query keys consistently. Invalidate related queries after mutations; avoid full-page reloads unless current code already uses reload for chunk recovery.
- Respect Arabic/English i18n and RTL through existing contexts/utilities. Operator-facing text should be Arabic-friendly.
- For factory-floor screens, use large controls, clear status, minimal typing, strong validation feedback, and no hidden manager-only complexity.
- Keep `data-testid` attributes where existing tests or stable UI automation may rely on them.

## Backend and database conventions
- Use Drizzle schema types and Zod insert schemas from `shared/schema.ts` when adding or validating records.
- Use `parseIntSafe`, `parseFloatSafe`, `coercePositiveInt`, `coerceNonNegativeInt`, `extractNumericId`, or existing validation helpers for numeric route params and payloads.
- Avoid editing `shared/schema.ts` casually. If schema changes are required, explain affected tables, migration/push impact, existing-data risk, and rollback concern.
- Keep body-size limits aligned with `server/index.ts`: standard endpoints small; heavy upload/import/webhook routes explicitly carved out.
- Preserve raw-body capture for webhook routes that need signature verification.
- Do not log secrets, passwords, tokens, full webhook payloads, session data, or large request bodies.
- Prefer existing storage methods and transactions for multi-table operations, especially production, rolls, inventory, orders, vouchers, and maintenance.

## Factory domain references for MPBF
Use these as domain context, but verify against database records before hard-coding:
- MPBF is a plastic-bag manufacturing operation using HDPE and film extrusion.
- Production stages commonly include film/extrusion, printing, cutting, and finished goods/warehouse.
- Known machine context from AbuKhalid: machines A, B, C, D, and M are ABA extruder-related machines; A/B/C/M can be converted HD/LD; A and B have 1100 mm layflat, C about 900 mm, M about 1500 mm. Do not hard-code these unless the feature is explicitly about factory master data.
- The system should remain practical for 24-hour shift operations and factory-floor operators.

## Safe-change checklist before finishing
Always perform or recommend the relevant checks:
1. `npm run check` for TypeScript.
2. `npm run lint` if imports, style, or formatting changed.
3. `npm run build` before deployment-sensitive or routing changes.
4. Test at least one happy path and one validation/error path for the affected module.
5. For DB changes, verify `DATABASE_URL` is present before any Drizzle push and avoid destructive schema changes unless explicitly approved.
6. For production/roll changes, test normal roll, final roll, invalid weight, missing machine, and quantity-overrun behavior.
7. For orders changes, test create order, edit order, batch production order creation, status update, and query invalidation.
8. For permissions changes, test both allowed and blocked users.

## Response format to AbuKhalid after a change
Respond in Arabic/Saudi tone with:
- **وش تغير:** concise list of changed behavior/files.
- **ليش:** business reason.
- **المخاطر:** any risk, especially database, permissions, production flow, inventory, or destructive edits.
- **اختبار سريع:** exact screens/API paths to test.
- **ملاحظة مهمة:** any assumption, missing confirmation, or item not tested.

## Hard stops
Do not proceed silently if a requested change would:
- delete, reset, archive in bulk, or rewrite production data,
- bypass authentication or permissions,
- allow negative inventory,
- create rolls without active machine validation,
- move production quantity/overrun authority from server to client,
- change final-roll stage-closing semantics without approval,
- change webhook signature verification or raw-body handling,
- remove Arabic/RTL support from operator-facing screens,
- expose secrets or environment values in frontend code,
- perform destructive schema changes or Drizzle push without explicit approval.

Ask for explicit confirmation before doing any of the above.
b88bd15e18959f5592583944729469c689e191ed
