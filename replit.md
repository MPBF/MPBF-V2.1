# MPBF - Manufacturing Planning for Plastic Bag Factory

An MRP system for plastic bag manufacturing, managing the entire production lifecycle from orders to delivery, with an Arabic-first interface.

## Run & Operate

- **Run**: `npm run dev` (starts Express server on port 5000/8000, serving API and Vite frontend)
- **Environment Variables**:
    - `DATABASE_URL`: PostgreSQL connection string
    - `SESSION_SECRET`: Express session secret
    - `META_WHATSAPP_TOKEN`, `META_WHATSAPP_PHONE_ID`: WhatsApp API credentials
    - `TAQNYAT_API_KEY`, `TAQNYAT_SENDER_NAME`: SMS gateway
    - `ADOBE_CLIENT_ID`, `ADOBE_CLIENT_SECRET`: Adobe PDF service
    - `OPENAI_API_KEY`: AI integration key
    - `SESSION_SECRET_PREVIOUS` (optional): previous SESSION_SECRET, kept only during a rotation
    - `EXTERNAL_DB_KEY_VERSION` (optional): current external-DB credential key version (default 1; bump on rotation)

### Secrets rotation (external DB credentials)

External SQL Server passwords are encrypted at rest with a key derived from `SESSION_SECRET` (`server/external-db/crypto.ts`). Every ciphertext is tagged with the key version that produced it (`v<N>:iv:tag:ct`) and each row records its `key_version`, so a `SESSION_SECRET` change does not silently break stored connections. To rotate `SESSION_SECRET` safely:

1. Move the current `SESSION_SECRET` value into `SESSION_SECRET_PREVIOUS`.
2. Set `SESSION_SECRET` to the new value.
3. Increment `EXTERNAL_DB_KEY_VERSION` (e.g. `1` → `2`).
4. Restart the app, then (as a `manage_settings` user) call `POST /api/external-db/rotate-key` to re-encrypt all stored credentials with the new key. The response reports `migrated`, `alreadyCurrent`, and any `failed` connections.
5. Once migration reports no failures, remove `SESSION_SECRET_PREVIOUS`.

If a credential still can't be decrypted (e.g. the previous secret was lost), connection/test/query routes return a clear "re-enter the password" message; fix it by editing that connection and saving a new password.

## Stack

- **Frontend**: React 18, TypeScript, Vite, TanStack Query v5, Tailwind CSS, shadcn/ui, Recharts, Three.js
- **Backend**: Node.js, Express.js, TypeScript (tsx)
- **Database**: PostgreSQL (Neon Serverless)
- **ORM**: Drizzle ORM
- **Authentication**: Session-based (Passport.js), Replit Auth (OpenID Connect), Mobile Bearer tokens
- **Validation**: Zod
- **Build Tool**: Vite

## Where things live

- **Frontend**: `client/`
    - Pages: `client/src/pages/<feature>/` (feature folders — see `client/src/pages/README.md`)
    - Shared root components: `client/src/components/shared/`
    - UI Components: `client/src/components/ui/`
    - API Request/Query Client: `client/src/lib/queryClient.ts`
    - Internationalization: `client/src/i18n/locales/`
    - Navigation Configuration: `client/src/config/navigationConfig.ts`
- **Backend**: `server/`
    - Entry Point: `server/index.ts`
    - API Routes: `server/routes/<domain>.ts` (orchestrated by `server/routes.ts`; shared helpers in `server/routes/shared.ts` — see `server/routes/README.md`)
    - Database Access Layer: `server/storage/<domain>.ts` (inheritance chain; `server/storage.ts` is a re-export shim — see `server/storage/README.md`)
    - Middleware: `server/middleware/`
    - Shared Services: `server/services/`
- **Shared Code (Frontend/Backend)**: `shared/`
    - DB Schema: `shared/schema.ts`
    - Permissions: `shared/permissions.ts`
- **Migrations**: `migrations/`
- **Static Assets/PWA**: `public/`
- **Mobile App API Contract**: `attached_assets/MOBILE_APP_API_CONTRACT.md`

## Architecture decisions

- **Arabic-First RTL Design**: Primary interface is Arabic (RTL) with English fallback, ensuring culturally appropriate user experience.
- **Comprehensive AI Agent**: The AI agent acts as a full executive digital assistant with extensive system capabilities, including document generation, database interaction (safe queries), and knowledge base management.
- **Robust Authentication**: Implements a dual authentication system (session for web, token for mobile) with granular permission control and role-based access to ensure secure operations.
- **Offline-First Mobile Support**: The native Expo app includes mechanisms for offline attendance syncing and action queuing, enhancing usability in environments with intermittent connectivity.
- **Strict Data Integrity**: Enforces business rules at the database level and through transaction wrappers, coupled with sequential stage transitions for production orders, to maintain data consistency.

## Product

- **Manufacturing Lifecycle Management**: Handles customer orders, multi-stage production (film, printing, cutting), warehouse inventory, and quality control.
- **Real-time Monitoring**: Provides real-time factory monitoring, machine status, and production progress dashboards.
- **HR & Admin**: Manages HR functions (attendance, leaves, performance), machine maintenance, and system administration.
- **AI-Powered Assistance**: Features an AI agent for chat, knowledge base access, document generation, and database queries.
- **Multi-channel Notifications**: Integrates with Meta WhatsApp Business API, Taqnyat SMS, and Twilio WhatsApp for alerts and customer communication.
- **PWA & Mobile Apps**: Offers a Progressive Web App (PWA) and a native Expo mobile application for enhanced accessibility and offline capabilities.

## Development-stage data policy

- Until the project owner says development is complete, the system architecture and database schema may be changed as needed for development; existing structures are not a reason to avoid necessary improvements.
- Existing records are test data **except** records for **customers, customer products, categories, and items**. Preserve those four datasets through refactors and migrations: do not delete, reset, or overwrite them. Schema changes affecting them must retain their data.
- This policy is not a request to delete test records proactively. Scope any cleanup to the task at hand and confirm the target environment before a destructive database operation.

## User preferences

- Language: Arabic (RTL) primary, English fallback
- Error messages: Always in Arabic for end users
- Number formatting: Arabic numerals, 2 decimal places for weight, 1-2 for percentages
- Logging: Comprehensive server-side, never log sensitive data (passwords, tokens)

## Gotchas

- **Do Not Modify**: `vite.config.ts`, `server/vite.ts`, `drizzle.config.ts`, `package.json` should not be manually edited.
- **Mobile API Contract**: Do not change field names, data types, or remove fields without updating `attached_assets/MOBILE_APP_API_CONTRACT.md`.
- **AI Agent SQL**: `DROP`, `DELETE`, `TRUNCATE`, `ALTER` are blocked for safety in `execute_database_query`.
- **Database Auto-Migration**: On startup, `drizzle-kit push --force` is run for new databases (0 tables), or to add missing critical tables. This creates new tables but **never drops or modifies existing data**.

## Pointers

- **TanStack Query**: [https://tanstack.com/query/latest](https://tanstack.com/query/latest)
- **Drizzle ORM**: [https://orm.drizzle.team/](https://orm.drizzle.team/)
- **Zod**: [https://zod.dev/](https://zod.dev/)
- **shadcn/ui**: [https://ui.shadcn.com/](https://ui.shadcn.com/)
- **Recharts**: [https://recharts.org/en-US/](https://recharts.org/en-US/)
- **Three.js**: [https://threejs.org/](https://threejs.org/)
- **i18next**: [https://www.i18next.com/](https://www.i18next.com/)

## Factory production module

- Factory execution lives in `server/production/`, with authenticated views under `/production` and shared contracts in `shared/production.ts`.
- Apply the reviewed additive migration `migrations/0011_factory_roll_production.sql` before using these views. It does not backfill historical plans. Published database changes require separate approval; development verification is not a production migration.
- Production rights are explicit role-tree permissions. Never grant new permissions automatically or infer administrator access from a role number.
- Manufacturing completion and partial warehouse receipt are independent. QR records remain authenticated and permission-checked.
- `npx tsx scripts/test-factory-production.ts` verifies transactions in a disposable development schema. Never run it against production.
- `node scripts/check-factory-production.cjs` checks responsive views and permissions using browser-only API fixtures, without real sign-in or business writes.
- For the combined UI/server queue contract check, run the browser script first, then `npx tsx scripts/test-factory-production.ts --ui-requests=/tmp/factory-ui-requests.json`. The captured requests contain synthetic fixtures only.