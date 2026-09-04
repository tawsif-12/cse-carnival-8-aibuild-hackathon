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

const app = express();
app.use(cors({ origin: process.env.WEB_ORIGIN ?? "http://localhost:3000" }));
app.use(express.json());
app.get("/health", (_request, response) => response.json({ status: "ok" }));
app.use("/schedules", schedules);
app.use("/rooms", rooms);
app.use("/events", events);
app.use("/announcements", announcements);
app.use("/assignments", assignments);
app.use("/agent", agent);
app.use(errorHandler);

const port = Number(process.env.PORT ?? 4000);
app.listen(port, () => console.log(`CampusOS API listening on http://localhost:${port}`));
