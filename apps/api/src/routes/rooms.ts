import { randomUUID } from "node:crypto";
import { Router } from "express";
import { bookingSchema, roomSchema } from "@campus-os/contracts";
import { z } from "zod";
import { db } from "../db";
import { asyncRoute, HttpError, parse } from "../http";
import { serializeRoom } from "../serializers";
import { requireRoles } from "../auth";

export const rooms = Router();
const roomInput = roomSchema.omit({ bookings: true });
const bookingInput = bookingSchema.omit({ booking_id: true });
const include = { bookings: { orderBy: [{ date: "asc" as const }, { start_time: "asc" as const }] } };

rooms.get("/", requireRoles("admin"), asyncRoute(async (req, res) => {
  const type = typeof req.query.type === "string" ? req.query.type : undefined;
  const capacity = req.query.capacity ? parse(z.coerce.number().int().positive(), req.query.capacity) : undefined;
  const equipment = typeof req.query.equipment === "string" ? req.query.equipment.split(",").filter(Boolean) : [];
  const date = typeof req.query.date === "string" ? req.query.date : undefined;
  const start = typeof req.query.start_time === "string" ? req.query.start_time : undefined;
  const end = typeof req.query.end_time === "string" ? req.query.end_time : undefined;
  if ((start || end) && !date) throw new HttpError(400, "date is required with availability times");
  if ((start && !end) || (!start && end)) throw new HttpError(400, "both start_time and end_time are required");
  const records = await db.room.findMany({
    where: { type, capacity: capacity ? { gte: capacity } : undefined, status: req.query.available === "true" ? "available" : undefined,
      bookings: date && start && end ? { none: { date, start_time: { lt: end }, end_time: { gt: start } } } : undefined },
    include, orderBy: { room_number: "asc" },
  });
  res.json(records.map(serializeRoom).filter((room) => equipment.every((item) => room.equipment.some((value) => value.toLowerCase() === item.toLowerCase()))));
}));
rooms.post("/", requireRoles("admin"), asyncRoute(async (req, res) => {
  const data = parse(roomInput, req.body);
  const record = await db.room.create({ data: { ...data, equipment: JSON.stringify(data.equipment) }, include });
  res.status(201).json(serializeRoom(record));
}));
for (const method of ["patch", "put"] as const) rooms[method]("/:id", requireRoles("admin"), asyncRoute(async (req, res) => {
  const schema = method === "patch" ? roomInput.omit({ id: true }).partial() : roomInput.omit({ id: true });
  const data = parse(schema, req.body);
  const record = await db.room.update({ where: { id: String(req.params.id) }, data: { ...data, equipment: data.equipment ? JSON.stringify(data.equipment) : undefined }, include });
  res.json(serializeRoom(record));
}));
rooms.delete("/:id", requireRoles("admin"), asyncRoute(async (req, res) => {
  res.json(serializeRoom(await db.room.delete({ where: { id: String(req.params.id) }, include })));
}));
rooms.post("/:id/book", requireRoles("admin"), asyncRoute(async (req, res) => {
  const data = parse(bookingInput, req.body);
  if (data.start_time >= data.end_time) throw new HttpError(400, "end_time must be after start_time");
  const room = await db.$transaction(async (tx) => {
    const target = await tx.room.findUnique({ where: { id: String(req.params.id) } });
    if (!target) throw new HttpError(404, "Room not found");
    if (target.status !== "available") throw new HttpError(409, "Room is unavailable");
    const conflict = await tx.booking.findFirst({ where: { room_id: target.id, date: data.date, start_time: { lt: data.end_time }, end_time: { gt: data.start_time } } });
    if (conflict) throw new HttpError(409, "Booking overlaps an existing booking");
    await tx.booking.create({ data: { ...data, booking_id: `bk-${randomUUID()}`, room_id: target.id } });
    return tx.room.findUniqueOrThrow({ where: { id: target.id }, include });
  });
  res.status(201).json(serializeRoom(room));
}));
rooms.delete("/:id/bookings/:booking_id", requireRoles("admin"), asyncRoute(async (req, res) => {
  const booking = await db.booking.findFirst({ where: { booking_id: String(req.params.booking_id), room_id: String(req.params.id) } });
  if (!booking) throw new HttpError(404, "Booking not found for this room");
  await db.booking.delete({ where: { booking_id: booking.booking_id } });
  res.json(serializeRoom(await db.room.findUniqueOrThrow({ where: { id: String(req.params.id) }, include })));
}));
