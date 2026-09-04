# CampusOS architecture

This repository is an npm-workspace monorepo:

- `apps/web`: Next.js App Router dashboard and chat UI (port 3000)
- `apps/api`: Express API, Prisma models, and agent tool handlers (port 4000)
- `packages/contracts`: shared Zod validation schemas and TypeScript types
- `data`: source seed JSON supplied by the hackathon

The JSON files are read only by the idempotent seed command. Runtime reads and writes go through the API and SQLite database. Bookings and registrations are relational records so later action endpoints can use database transactions and enforce uniqueness.

## Local setup

```bash
npm install
copy .env.example apps/api/.env
npm run setup
npm run dev
```

On Windows PowerShell systems that block `npm.ps1`, use `npm.cmd` in these commands.
