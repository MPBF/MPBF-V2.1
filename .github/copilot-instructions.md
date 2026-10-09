# MPBF Next - AI Coding Instructions

## Project Overview

**Modern Plastic Bag Factory (MPBF Next)** - An Arabic-first ERP system for plastic bag manufacturing with RTL design and intelligent production workflows.

## Architecture & Stack

### Tech Stack

- **Frontend**: React + TypeScript + Vite, TanStack Query v5, shadcn/ui, Tailwind CSS
- **Backend**: Express.js + TypeScript (ESM), Drizzle ORM with PostgreSQL
- **Database**: PostgreSQL (Neon Serverless) with comprehensive manufacturing schema
- **Build**: Vite (client) + esbuild (server), dual bundle output to `dist/`

### Monorepo Structure

```
├── client/src/        # React app with Arabic RTL UI
├── server/           # Express API with manufacturing logic
├── shared/           # Common schemas, validation, utilities
├── migrations/       # Drizzle database migrations
└── attached_assets/  # Business documents and test data
```

## Core Business Domain

### Manufacturing Workflow (4-Stage Process)

1. **Film Production** (Extruder) → Creates rolls with QR codes
2. **Printing** (Optional) → Adds graphics/branding to rolls
3. **Cutting** → Converts rolls to final bag products
4. **Warehouse Receipt** → Final quality control and storage

**Critical Pattern**: Each roll tracks through all stages via `rolls` table with stage progression (`film` → `for_printing` → `printing` → `for_cutting` → `cutting` → `done`).

### Key Data Relationships

- `orders` → `production_orders` (1:many) → `rolls` (1:many) → `cuts` (1:many)
- Every production operation requires valid, active machines (`machines` table)
- All operations enforce business invariants defined in `shared/schema.ts` header comments

## Development Guidelines

### Arabic-First Development

- **All UI text**: Arabic with English fallback
- **Error messages**: Always Arabic (`خطأ في...` pattern)
- **RTL Layout**: `dir="rtl"` and `lang="ar"` in HTML, RTL-aware Tailwind classes
- **Number formatting**: Arabic numerals, 2 decimals for weights

### Database & Validation Patterns

- **Schema location**: `shared/schema.ts` (3000+ lines with business rules)
- **Validation**: Zod schemas with Arabic error messages
- **Database operations**: Always use transactions for multi-table operations
- **Key constraint**: Inventory cannot go negative, production quantities cannot exceed order quantities

### API Development

- **Route structure**: RESTful with Arabic error responses
- **Authentication**: Session-based with `requireAuth` middleware
- **Query patterns**: TanStack Query with 30s refetch intervals
- **Error handling**: Comprehensive try-catch with Arabic user messages

### Component Architecture

- **shadcn/ui components**: Customized for RTL and Arabic content
- **Modal patterns**: Follow existing modal structure in `client/src/components/modals/`
- **Form validation**: React Hook Form + Zod with Arabic error display
- **State management**: TanStack Query for server state, React state for UI

## Development Commands

### Environment Setup

```bash
npm run dev          # Start development server (client + server)
npm run build        # Build for production
npm run db:push      # Push schema changes to database
npm run lint         # ESLint with Arabic-friendly rules
```

### Development Workflow

1. **Schema changes**: Update `shared/schema.ts` → run `npm run db:push`
2. **New features**: Create API endpoint in `server/routes.ts` → add React Query hooks
3. **UI components**: Follow shadcn/ui patterns with RTL adaptations

## Integration Points

### External Services

- **AI**: OpenAI integration in `server/services/openai.ts`
- **WhatsApp**: Twilio/Meta integration for production notifications
- **File Storage**: Google Cloud Storage for attachments
- **Authentication**: Dual support (traditional + Replit Auth)

### Testing & Deployment

- **Environment**: Configured for Replit deployment with Neon PostgreSQL
- **Health checks**: `/api/health` endpoint for monitoring
- **Migration**: Automatic on server startup in production
- **Security**: Password hashing validation on startup (see `server/index.ts`)

## Critical Files to Understand

- `shared/schema.ts` - Complete database schema with business rules
- `server/routes.ts` - Main API routes (6000+ lines)
- `client/src/App.tsx` - Route structure and authentication flow
- `server/storage.ts` - Database operations and business logic
- `vite.config.ts` - Build configuration with path aliases

## Common Patterns to Follow

- **Error boundaries**: Global error handling with Arabic messages
- **Loading states**: Skeleton loaders for all data fetching
- **Form validation**: Immediate feedback with Arabic error text
- **Optimistic updates**: UI updates before server confirmation
- **Cache invalidation**: Proper query key management for real-time updates

When implementing new features, always consider the manufacturing workflow context and maintain consistency with existing Arabic-first patterns.
