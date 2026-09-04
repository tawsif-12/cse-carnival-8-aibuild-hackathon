# CampusOS

A live campus data portal and tool-calling AI assistant. The dashboard and agent share one Express/Prisma API and one SQLite database, so dashboard edits are immediately visible to the agent.

## Stack

- Next.js 15 + React 19 frontend
- Express 5 API
- Prisma + SQLite
- OpenAI Responses API with strict function tools
- Shared Zod schemas and TypeScript contracts

## Run locally

Requirements: Node.js 20+ and an OpenAI API key for chat.

```bash
npm install
copy .env.example apps/api/.env
npm run setup
npm run dev
```

On macOS/Linux, use `cp` instead of `copy`. On Windows systems that block `npm.ps1`, run `npm.cmd` instead of `npm`.

Open:

- Dashboard: http://localhost:3000
- API: http://localhost:4000
- Health check: http://localhost:4000/health

Add your key to `apps/api/.env`:

```env
GEMINI_API_KEY=your_google_ai_studio_key
GEMINI_MODEL=gemini-3.6-flash
DATABASE_URL="file:./dev.db"
PORT=4000
WEB_ORIGIN="http://localhost:3000"
CAMPUS_TIME_ZONE="Asia/Dhaka"
```

The application works without an API key except for AI chat, which returns a clear setup message.

## Database behavior

`npm run db:seed` reads all five files in `data/`. Each entity is seeded only when its table is empty; existing records are never overwritten. Bookings and registrations are relational records and are returned in the exact nested API shape.

## API

| Resource | Endpoints |
| --- | --- |
| Schedules | `GET/POST /schedules`, `PATCH/PUT/DELETE /schedules/:id` |
| Rooms | CRUD, `POST /rooms/:id/book`, `DELETE /rooms/:id/bookings/:booking_id` |
| Events | CRUD, `POST /events/:id/register`, `DELETE /events/:id/registrations/:student_id` |
| Announcements | CRUD with priority and expiry filters |
| Assignments | CRUD with status and due-window filters |
| AI | `POST /agent/chat` |

Room booking rejects overlapping ranges. Event registration rejects duplicates and full events, and automatically marks an event `full` when capacity is reached.

## AI safety and live-data guarantees

The agent receives read tools plus room-booking and event-registration tools. It has no destructive delete tools. Every campus answer triggers live database reads. Incomplete booking requests are clarified before any action, and ambiguous event matches are not guessed.

Demo identity:

```text
student_id: my-student
name: My Student
timezone: Asia/Dhaka
```

## Useful commands

```bash
npm run dev
npm run typecheck
npm run build
npm run db:seed
```
