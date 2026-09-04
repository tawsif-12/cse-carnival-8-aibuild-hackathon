import { Router } from "express";
import { eventSchema } from "@campus-os/contracts";
import { audienceWhere, authenticatedUser } from "../access";
import { requireRoles } from "../auth";
import { db } from "../db";
import { asyncRoute, HttpError, parse } from "../http";
import { serializeEvent } from "../serializers";
export const events = Router();
const eventInput = eventSchema.omit({ registrations: true }),
  include = { registrations: { orderBy: { name: "asc" as const } } };
events.get(
  "/",
  requireRoles("student", "teacher", "cr", "admin"),
  asyncRoute(async (req, res) => {
    const user = await authenticatedUser(req),
      date = typeof req.query.date === "string" ? req.query.date : undefined,
      status =
        typeof req.query.status === "string" ? req.query.status : undefined;
    const scope: any = user.role === "admin" ? {} : audienceWhere(user);
    res.json(
      (
        await db.event.findMany({
          where: { ...scope, date, status },
          include,
          orderBy: [{ date: "asc" }, { start_time: "asc" }],
        })
      ).map(event=>serializeEvent({...event,registrations:user.role==="admin"?event.registrations:event.registrations.filter(registration=>registration.student_id===user.id)})),
    );
  }),
);
events.post(
  "/",
  requireRoles("admin"),
  asyncRoute(async (req, res) => {
    const data = parse(eventInput, req.body);
    if (data.registered !== 0)
      throw new HttpError(400, "New events must start empty");
    res
      .status(201)
      .json(serializeEvent(await db.event.create({ data, include })));
  }),
);
for (const method of ["patch", "put"] as const)
  events[method](
    "/:id",
    requireRoles("admin"),
    asyncRoute(async (req, res) => {
      const schema =
        method === "patch"
          ? eventInput.omit({ id: true, registered: true }).partial()
          : eventInput.omit({ id: true, registered: true });
      res.json(
        serializeEvent(
          await db.event.update({
            where: { id: String(req.params.id) },
            data: parse(schema, req.body),
            include,
          }),
        ),
      );
    }),
  );
events.delete(
  "/:id",
  requireRoles("admin"),
  asyncRoute(async (req, res) =>
    res.json(
      serializeEvent(
        await db.event.delete({
          where: { id: String(req.params.id) },
          include,
        }),
      ),
    ),
  ),
);
events.post(
  "/:id/register",
  requireRoles("student", "teacher", "cr", "admin"),
  asyncRoute(async (req, res) => {
    const user = await authenticatedUser(req),
      eventId = String(req.params.id);
    const event = await db.$transaction(async (tx) => {
      const target = await tx.event.findUnique({ where: { id: eventId } });
      if (!target) throw new HttpError(404, "Event not found");
      const studentId =
          user.role === "admin" && typeof req.body.student_id === "string"
            ? req.body.student_id
            : user.id,
        name =
          user.role === "admin" && typeof req.body.name === "string"
            ? req.body.name
            : user.name;
      const existing = await tx.registration.findUnique({
        where: {
          event_id_student_id: { event_id: eventId, student_id: studentId },
        },
      });
      if (existing) throw new HttpError(409, "Already registered");
      if (
        ["cancelled", "completed", "full"].includes(target.status) ||
        target.registered >= target.capacity
      )
        throw new HttpError(409, "Event is not accepting registrations");
      await tx.registration.create({
        data: { event_id: eventId, student_id: studentId, name },
      });
      const registered = target.registered + 1;
      await tx.event.update({
        where: { id: eventId },
        data: {
          registered,
          status: registered >= target.capacity ? "full" : target.status,
        },
      });
      return tx.event.findUniqueOrThrow({ where: { id: eventId }, include });
    });
    res.status(201).json(serializeEvent(event));
  }),
);
events.delete(
  "/:id/registrations/:student_id",
  requireRoles("student", "teacher", "cr", "admin"),
  asyncRoute(async (req, res) => {
    const user = await authenticatedUser(req),
      studentId = String(req.params.student_id);
    if (user.role !== "admin" && studentId !== user.id)
      throw new HttpError(403, "You can cancel only your own registration");
    const event = await db.$transaction(async (tx) => {
      const eventId = String(req.params.id),
        registration = await tx.registration.findUnique({
          where: {
            event_id_student_id: { event_id: eventId, student_id: studentId },
          },
        });
      if (!registration) throw new HttpError(404, "Registration not found");
      await tx.registration.delete({ where: { id: registration.id } });
      const target = await tx.event.findUniqueOrThrow({
          where: { id: eventId },
        }),
        registered = Math.max(0, target.registered - 1);
      await tx.event.update({
        where: { id: eventId },
        data: {
          registered,
          status: target.status === "full" ? "upcoming" : target.status,
        },
      });
      return tx.event.findUniqueOrThrow({ where: { id: eventId }, include });
    });
    res.json(serializeEvent(event));
  }),
);
