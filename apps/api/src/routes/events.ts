import { Router } from "express";
import { eventSchema, registrationSchema } from "@campus-os/contracts";
import { db } from "../db";
import { asyncRoute, HttpError, parse } from "../http";
import { serializeEvent } from "../serializers";

export const events = Router();
const eventInput = eventSchema.omit({ registrations: true });
const include = { registrations: { orderBy: { name: "asc" as const } } };
events.get("/", asyncRoute(async (req, res) => {
  const date = typeof req.query.date === "string" ? req.query.date : undefined;
  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  res.json((await db.event.findMany({ where: { date, status }, include, orderBy: [{ date: "asc" }, { start_time: "asc" }] })).map(serializeEvent));
}));
events.post("/", asyncRoute(async (req, res) => {
  const data = parse(eventInput, req.body);
  if (data.registered !== 0) throw new HttpError(400, "New events must start with registered = 0");
  res.status(201).json(serializeEvent(await db.event.create({ data, include })));
}));
for (const method of ["patch", "put"] as const) events[method]("/:id", asyncRoute(async (req, res) => {
  const schema = method === "patch" ? eventInput.omit({ id: true, registered: true }).partial() : eventInput.omit({ id: true, registered: true });
  res.json(serializeEvent(await db.event.update({ where: { id: String(req.params.id) }, data: parse(schema, req.body), include })));
}));
events.delete("/:id", asyncRoute(async (req, res) => {
  res.json(serializeEvent(await db.event.delete({ where: { id: String(req.params.id) }, include })));
}));
events.post("/:id/register", asyncRoute(async (req, res) => {
  const registration = parse(registrationSchema, req.body);
  const event = await db.$transaction(async (tx) => {
    const eventId = String(req.params.id);
    const target = await tx.event.findUnique({ where: { id: eventId } });
    if (!target) throw new HttpError(404, "Event not found");
    const existing = await tx.registration.findUnique({ where: { event_id_student_id: { event_id: eventId, student_id: registration.student_id } } });
    if (["cancelled", "completed"].includes(target.status)) throw new HttpError(409, `Cannot register for a ${target.status} event`);
    if (target.registered >= target.capacity) throw new HttpError(409, "Event is full");
    if (existing) throw new HttpError(409, "Student is already registered");
    await tx.registration.create({ data: { ...registration, event_id: target.id } });
    const registered = target.registered + 1;
    await tx.event.update({ where: { id: target.id }, data: { registered, status: registered >= target.capacity ? "full" : target.status } });
    return tx.event.findUniqueOrThrow({ where: { id: target.id }, include });
  });
  res.status(201).json(serializeEvent(event));
}));
events.delete("/:id/registrations/:student_id", asyncRoute(async (req, res) => {
  const event = await db.$transaction(async (tx) => {
    const eventId = String(req.params.id);
    const registration = await tx.registration.findUnique({ where: { event_id_student_id: { event_id: eventId, student_id: String(req.params.student_id) } } });
    if (!registration) throw new HttpError(404, "Registration not found");
    await tx.registration.delete({ where: { id: registration.id } });
    const target = await tx.event.findUniqueOrThrow({ where: { id: eventId } });
    const registered = Math.max(0, target.registered - 1);
    await tx.event.update({ where: { id: target.id }, data: { registered, status: target.status === "full" ? "upcoming" : target.status } });
    return tx.event.findUniqueOrThrow({ where: { id: target.id }, include });
  });
  res.json(serializeEvent(event));
}));
