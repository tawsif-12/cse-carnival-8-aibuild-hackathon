# CampusOS

A live campus data portal and tool-calling AI assistant. The dashboard and agent share one Express/Prisma API and one SQLite database, so dashboard edits are immediately visible to the agent.

## Stack

- Next.js 15 + React 19 frontend
- Express 5 API
- Prisma + SQLite
- Gemini API with role-filtered function tools
- Shared Zod schemas and TypeScript contracts

## Run locally

Requirements: Node.js 20+ and a Gemini API key for chat.

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

## Demo accounts

Run `npm run db:seed`, then sign in with any account below. All demo accounts use password `CampusOS123!`.

| Role | Email | Scope |
| --- | --- | --- |
| Student | `student@campus.local` | CSE, Year 4, Semester 1, Section A |
| Teacher | `teacher@campus.local` | Assigned CSE courses |
| CR | `cr@campus.local` | CSE, Year 4, Semester 1, Section A |
| Admin | `admin@campus.local` | University-wide |

Public signup creates student accounts only. Admins create privileged accounts and assign roles/cohorts from the Admin dashboard.

## Role-based access

- Students receive only their cohort schedule, enrolled-course assignments, scoped announcements, visible events, read-only rooms, and self event registration.
- Teachers manage schedules, assignments, announcements, lectures, and bookings only for assigned courses.
- CRs receive student access plus section-scoped class announcements and room-booking requests.
- Admins have unrestricted entity CRUD plus user, role, cohort, course, teacher, and enrollment management.
- Permissions are checked by the API. The AI receives a role-filtered tool list and scoped database results.

## API

| Resource | Endpoints |
| --- | --- |
| Schedules | `GET/POST /schedules`, `PATCH/PUT/DELETE /schedules/:id` |
| Rooms | CRUD, `POST /rooms/:id/book`, `DELETE /rooms/:id/bookings/:booking_id` |
| Events | CRUD, `POST /events/:id/register`, `DELETE /events/:id/registrations/:student_id` |
| Announcements | CRUD with priority and expiry filters |
| Assignments | CRUD with status and due-window filters |
| Auth | `POST /auth/login`, student-only `POST /auth/signup`, `GET /auth/me` |
| RBAC portal | `/portal/dashboard`, admin users/courses/members, teacher lectures, CR announcements |
| AI | role-scoped `POST /agent/chat` |

Room booking rejects overlapping ranges. Event registration rejects duplicates and full events, and automatically marks an event `full` when capacity is reached.

## AI safety and live-data guarantees

The agent receives only tools permitted for the authenticated role. Students never receive room-booking tools; teachers and CRs can book/request rooms, and event registration always uses the signed-in user's identity. Campus reads are filtered by cohort and assigned or taught courses.

## Useful commands

```bash
npm run dev
npm run typecheck
npm run build
npm run db:seed
```
