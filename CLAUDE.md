@AGENTS.md

## Project Overview

**Kalanjiyam** is a household-finance + farm-management app. Multi-user multi-workspace (each user can belong to up to 3 workspaces). Each workspace tracks its own Accounts, Cards, Family members, Crops, Livestock, Leases, Workers, Wages, Loans (bank / formal hand / card-EMI), Hand loans (informal), Investments, and Reminders. All data is workspace-scoped — never cross-workspace queries.

Predecessor repo for reference only: `../kanakkan` — do not modify. See `/Users/silambu/.claude/plans/hi-similar-to-this-compressed-pine.md` for the full implementation plan.

## Commands

```bash
npm run dev          # Start dev server (localhost:3000)
npm run build        # prisma generate + next build
npm run lint         # ESLint
npm run db:generate  # Regenerate Prisma client (after schema edits)
npm run db:migrate   # Create and apply a new migration
npm run db:seed      # Seed default categories (npx tsx prisma/seed.ts)
npm run db:studio    # Open Prisma Studio GUI
```

Run `npm run db:generate` after every change to `prisma/schema.prisma`.

## Architecture

### Tech Stack
- **Next.js 16** (App Router) + **React 19** — `src/app/` with route groups `(auth)` and `(app)`
- **Prisma 7** with `@prisma/adapter-pg` — PostgreSQL via the `pg` driver. Generated client output at `src/generated/prisma/`. Datasource URL lives in `prisma.config.ts` (Prisma 7 removed it from schema.prisma).
- **NextAuth v5 (beta)** — credentials-based JWT auth; session carries `id`, `activeWorkspaceId`, workspace-scoped `role`, and workspace-scoped `permissions`
- **Tailwind CSS v4** + **shadcn/ui** components in `src/components/ui/`
- **SWR** for client-side data fetching
- **Zod** for request validation (`src/lib/validators.ts`)

### Key Patterns

**Multi-tenant by Workspace:** Every query filters by `session.user.activeWorkspaceId`. API routes call `requireWorkspace()` from `src/lib/workspace.ts` first, which returns `{ workspaceId, ownOnly }`, then scope all DB access.

**Role model:** Per-workspace. A `User` has many `WorkspaceMember` rows with `role` = `OWNER | ADMIN | MEMBER | SUPER_ADMIN`. Owner is the workspace creator and cannot be removed. Admins have full CRUD except delete-workspace / remove-Owner. Members get granular per-feature permissions via JSON on `WorkspaceMember.permissions`.

**Farm domain is user-defined:** Do NOT add enums for crop kinds or livestock kinds. Every workspace has a different farm composition. Use free-form `name` + optional `category`/`species` strings. Seeds stay domain-agnostic (only global default categories).

**API route structure:** `src/app/api/{resource}/route.ts` exports `GET`/`POST`/etc. Each handler calls `requireWorkspace` (which calls `auth()` internally), validates input with Zod, and uses `prisma` directly. No separate service layer.

**Middleware:** `src/proxy.ts` (Next 16 convention — not `middleware.ts`) checks the NextAuth session cookie on protected paths and redirects unauthenticated users to `/login`. Enforces idle-lock on `/api/*`.

**Components:** Domain components live in `src/components/{domain}/` (e.g., `transactions/`, `crops/`, `livestock/`, `workers/`, `investments/`, `loans/`). Shared UI primitives are in `src/components/ui/`.

### Path Aliases
`@/` maps to `src/` (configured in tsconfig).
