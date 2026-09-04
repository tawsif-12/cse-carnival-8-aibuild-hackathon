import { Router } from "express";
import { scheduleSchema } from "@campus-os/contracts";
import { db } from "../db";
import { asyncRoute, HttpError, parse } from "../http";
import { requireRoles } from "../auth";

export const schedules = Router();
schedules.get("/", asyncRoute(async (req, res) => {
  const day = typeof req.query.day === "string" ? req.query.day : undefined;
  const course = typeof req.query.course === "string" ? req.query.course : undefined;
  res.json(await db.schedule.findMany({ where: { day, course: course ? { contains: course } : undefined }, orderBy: [{ day: "asc" }, { start_time: "asc" }] }));
}));
schedules.post("/", requireRoles("admin"), asyncRoute(async (req, res) => res.status(201).json(await db.schedule.create({ data: parse(scheduleSchema, req.body) }))));
schedules.patch("/:id", requireRoles("admin"), asyncRoute(async (req, res) => res.json(await db.schedule.update({ where: { id: String(req.params.id) }, data: parse(scheduleSchema.omit({ id: true }).partial(), req.body) }))));
schedules.put("/:id", requireRoles("admin"), asyncRoute(async (req, res) => {
  const data = parse(scheduleSchema, { ...req.body, id: String(req.params.id) });
  res.json(await db.schedule.update({ where: { id: String(req.params.id) }, data }));
}));
schedules.delete("/:id", requireRoles("admin"), asyncRoute(async (req, res) => res.json(await db.schedule.delete({ where: { id: String(req.params.id) } }))));
