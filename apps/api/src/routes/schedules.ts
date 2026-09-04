import { Router } from "express";
import { scheduleSchema } from "@campus-os/contracts";
import { db } from "../db";
import { asyncRoute, HttpError, parse } from "../http";

export const schedules = Router();
async function validateSchedule(data: { day?: string; start_time?: string; end_time?: string; room?: string }, excludeId?: string) {
  if (data.start_time && data.end_time && data.start_time >= data.end_time) throw new HttpError(400, "end_time must be after start_time");
  if (!data.day || !data.start_time || !data.end_time || !data.room) return;
  const room = await db.room.findFirst({ where: { room_number: data.room } });
  if (!room) throw new HttpError(400, "Selected room does not exist");
  if (room.status !== "available") throw new HttpError(409, "Selected room is unavailable");
  const conflict = await db.schedule.findFirst({ where: { id: excludeId ? { not: excludeId } : undefined, day: data.day, room: data.room, start_time: { lt: data.end_time }, end_time: { gt: data.start_time } } });
  if (conflict) throw new HttpError(409, `Room ${data.room} is already used by ${conflict.course} during that time`);
}
schedules.get("/", asyncRoute(async (req, res) => {
  const day = typeof req.query.day === "string" ? req.query.day : undefined;
  const course = typeof req.query.course === "string" ? req.query.course : undefined;
  res.json(await db.schedule.findMany({ where: { day, course: course ? { contains: course } : undefined }, orderBy: [{ day: "asc" }, { start_time: "asc" }] }));
}));
schedules.post("/", asyncRoute(async (req, res) => { const data=parse(scheduleSchema,req.body);await validateSchedule(data);res.status(201).json(await db.schedule.create({data})) }));
schedules.patch("/:id", asyncRoute(async (req, res) => { const id=String(req.params.id),patch=parse(scheduleSchema.omit({id:true}).partial(),req.body),current=await db.schedule.findUnique({where:{id}});if(!current)throw new HttpError(404,"Schedule not found");const data={...current,...patch};await validateSchedule(data,id);res.json(await db.schedule.update({where:{id},data:patch})) }));
schedules.put("/:id", asyncRoute(async (req, res) => {
  const data = parse(scheduleSchema, { ...req.body, id: String(req.params.id) });
  await validateSchedule(data, String(req.params.id));
  res.json(await db.schedule.update({ where: { id: String(req.params.id) }, data }));
}));
schedules.delete("/:id", asyncRoute(async (req, res) => res.json(await db.schedule.delete({ where: { id: String(req.params.id) } }))));
