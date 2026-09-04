import { Router } from "express";
import { announcementSchema } from "@campus-os/contracts";
import { db } from "../db";
import { asyncRoute, parse } from "../http";
import { requireRoles } from "../auth";

export const announcements = Router();
announcements.get("/", asyncRoute(async (req, res) => {
  const priority = typeof req.query.priority === "string" ? req.query.priority : undefined;
  const includeExpired = req.query.include_expired === "true";
  const today = new Date().toISOString().slice(0, 10);
  res.json(await db.announcement.findMany({ where: { priority, expires: includeExpired ? undefined : { gte: today } }, orderBy: { date: "desc" } }));
}));
announcements.post("/", requireRoles("admin", "representative"), asyncRoute(async (req, res) => res.status(201).json(await db.announcement.create({ data: parse(announcementSchema, req.body) }))));
for (const method of ["patch", "put"] as const) announcements[method]("/:id", requireRoles("admin", "representative"), asyncRoute(async (req, res) => {
  const schema = method === "patch" ? announcementSchema.omit({ id: true }).partial() : announcementSchema.omit({ id: true });
  res.json(await db.announcement.update({ where: { id: String(req.params.id) }, data: parse(schema, req.body) }));
}));
announcements.delete("/:id", requireRoles("admin"), asyncRoute(async (req, res) => res.json(await db.announcement.delete({ where: { id: String(req.params.id) } }))));
