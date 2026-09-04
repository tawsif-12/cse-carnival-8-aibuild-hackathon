import "dotenv/config";
import cors from "cors";
import express from "express";
import { db } from "./db";
import { asyncRoute, errorHandler } from "./http";
import { announcements } from "./routes/announcements";
import { assignments } from "./routes/assignments";
import { events } from "./routes/events";
import { rooms } from "./routes/rooms";
import { schedules } from "./routes/schedules";
import { overview } from "./routes/overview";
import { workspace } from "./routes/workspace";
import { agent } from "./agent";

const app = express();
const configuredOrigins = process.env.WEB_ORIGIN?.split(",").map((origin) => origin.trim()).filter(Boolean);
const developmentOrigin = /^http:\/\/(localhost|127\.0\.0\.1):\d+$/;
app.use(cors({
  origin(origin, callback) {
    const allowed = !origin || configuredOrigins?.includes(origin) || (process.env.NODE_ENV !== "production" && developmentOrigin.test(origin));
    callback(allowed ? null : new Error(`Origin ${origin} is not allowed by CORS`), allowed);
  },
}));
app.use(express.json());
app.get("/", (_request, response) => response.json({ name: "CampusOS API", dashboard: "http://localhost:3000", health: "/health", resources: ["/overview", "/schedules", "/rooms", "/events", "/announcements", "/assignments", "/agent/chat"] }));
app.get("/health", asyncRoute(async (_request, response) => {
  await db.$queryRaw`SELECT 1`;
  response.json({ status: "ok", database: "sqlite", connected: true });
}));
app.use("/schedules", schedules);
app.use("/overview", overview);
app.use("/workspace", workspace);
app.use("/rooms", rooms);
app.use("/events", events);
app.use("/announcements", announcements);
app.use("/assignments", assignments);
app.use("/agent", agent);
app.use(errorHandler);

const port = Number(process.env.PORT ?? 4000);
let server: ReturnType<typeof app.listen>;

async function start() {
  await db.$connect();
  server = app.listen(port, () => console.log(`CampusOS API listening on http://localhost:${port}`));
}

async function shutdown() {
  if (!server) return db.$disconnect();
  server.close(async () => {
    await db.$disconnect();
    process.exit(0);
  });
}
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
start().catch(async (error) => {
  console.error("Failed to start API", error);
  await db.$disconnect();
  process.exit(1);
});
