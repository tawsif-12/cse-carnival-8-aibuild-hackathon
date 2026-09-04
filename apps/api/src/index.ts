import "dotenv/config";
import cors from "cors";
import express from "express";
import { errorHandler } from "./http";
import { announcements } from "./routes/announcements";
import { assignments } from "./routes/assignments";
import { events } from "./routes/events";
import { rooms } from "./routes/rooms";
import { schedules } from "./routes/schedules";
import { agent } from "./agent";
import { auth } from "./routes/auth";

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
app.get("/health", (_request, response) => response.json({ status: "ok" }));
app.use("/auth", auth);
app.use("/schedules", schedules);
app.use("/rooms", rooms);
app.use("/events", events);
app.use("/announcements", announcements);
app.use("/assignments", assignments);
app.use("/agent", agent);
app.use(errorHandler);

const port = Number(process.env.PORT ?? 4000);
app.listen(port, () => console.log(`CampusOS API listening on http://localhost:${port}`));
