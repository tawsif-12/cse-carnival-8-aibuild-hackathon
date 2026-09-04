import { Router } from "express";
import { assignmentSchema } from "@campus-os/contracts";
import { z } from "zod";
import { db } from "../db";
import { asyncRoute, parse } from "../http";
import { requireRoles } from "../auth";

export const assignments = Router();
assignments.get("/", asyncRoute(async (req, res) => {
  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  const days = req.query.due_within_days === undefined ? undefined : parse(z.coerce.number().int().nonnegative(), req.query.due_within_days);
  const now = new Date(); const end = new Date(now); if (days !== undefined) end.setUTCDate(end.getUTCDate() + days);
  res.json(await db.assignment.findMany({ where: { status, deadline: days === undefined ? undefined : { gte: now.toISOString().slice(0, 10), lte: end.toISOString().slice(0, 10) } }, orderBy: { deadline: "asc" } }));
}));
assignments.post("/", requireRoles("admin"), asyncRoute(async (req, res) => res.status(201).json(await db.assignment.create({ data: parse(assignmentSchema, req.body) }))));
for (const method of ["patch", "put"] as const) assignments[method]("/:id", requireRoles("admin"), asyncRoute(async (req, res) => {
  const schema = method === "patch" ? assignmentSchema.omit({ id: true }).partial() : assignmentSchema.omit({ id: true });
  res.json(await db.assignment.update({ where: { id: String(req.params.id) }, data: parse(schema, req.body) }));
}));
assignments.delete("/:id", requireRoles("admin"), asyncRoute(async (req, res) => res.json(await db.assignment.delete({ where: { id: String(req.params.id) } }))));
