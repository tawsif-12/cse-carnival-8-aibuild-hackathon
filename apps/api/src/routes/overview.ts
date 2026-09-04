import { Router } from "express";
import { db } from "../db";
import { asyncRoute } from "../http";
import { serializeEvent } from "../serializers";
import { requireRoles } from "../auth";

export const overview = Router();
const week = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function campusNow() {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dhaka", weekday: "long", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return { date: `${value.year}-${value.month}-${value.day}`, day: value.weekday ?? "Sunday", time: `${value.hour}:${value.minute}` };
}

overview.get("/", requireRoles("admin"), asyncRoute(async (_request, response) => {
  const now = campusNow();
  const [schedules, dueSoon, urgent, upcoming, scheduleCount, assignmentCount, roomCount, eventCount, announcementCount] = await db.$transaction([
    db.schedule.findMany(),
    db.assignment.findMany({ where: { status: { notIn: ["submitted", "graded"] }, deadline: { gte: now.date } }, orderBy: { deadline: "asc" }, take: 3 }),
    db.announcement.findFirst({ where: { priority: "high", expires: { gte: now.date } }, orderBy: { date: "desc" } }),
    db.event.findMany({ where: { date: { gte: now.date }, status: { notIn: ["completed", "cancelled"] } }, include: { registrations: true }, orderBy: [{ date: "asc" }, { start_time: "asc" }], take: 3 }),
    db.schedule.count(), db.assignment.count(), db.room.count(), db.event.count(), db.announcement.count(),
  ]);
  const currentDay = week.indexOf(now.day);
  const nextClass = schedules.map((item) => { const targetDay = week.indexOf(item.day); let daysAhead = (targetDay - currentDay + 7) % 7; if (daysAhead === 0 && item.end_time <= now.time) daysAhead = 7; return { item, rank: daysAhead * 1440 + Number(item.start_time.slice(0, 2)) * 60 + Number(item.start_time.slice(3)) }; }).sort((a, b) => a.rank - b.rank)[0]?.item ?? null;
  response.json({ next_class: nextClass, due_soon: dueSoon, urgent_announcement: urgent, upcoming_events: upcoming.map(serializeEvent), counts: { schedules: scheduleCount, assignments: assignmentCount, rooms: roomCount, events: eventCount, announcements: announcementCount }, updated_at: new Date().toISOString() });
}));
