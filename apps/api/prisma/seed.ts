import { PrismaClient } from "@prisma/client";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  announcementSchema,
  assignmentSchema,
  eventSchema,
  roomSchema,
  scheduleSchema,
  type Announcement,
  type Assignment,
  type Event,
  type Room,
  type Schedule,
} from "@campus-os/contracts";
import { z } from "zod";

const prisma = new PrismaClient();
const dataDirectory = path.resolve(__dirname, "../../../data");

async function load<T>(file: string, schema: z.ZodType<T>): Promise<T[]> {
  const contents = await readFile(path.join(dataDirectory, file), "utf8");
  return z.array(schema).parse(JSON.parse(contents));
}

async function main() {
  const [schedules, rooms, universityRooms, events, announcements, assignments] = await Promise.all([
    load<Schedule>("schedules.json", scheduleSchema),
    load<Room>("rooms.json", roomSchema),
    load<Room>("university_rooms.json", roomSchema),
    load<Event>("events.json", eventSchema),
    load<Announcement>("announcements.json", announcementSchema),
    load<Assignment>("assignments.json", assignmentSchema),
  ]);

  const loaded = { schedules: 0, rooms: 0, events: 0, announcements: 0, assignments: 0 };
  await prisma.$transaction(async (tx) => {
    if (await tx.schedule.count() === 0) {
      for (const schedule of schedules) await tx.schedule.create({ data: schedule });
      loaded.schedules = schedules.length;
    }
    for (const room of [...rooms, ...universityRooms]) {
      if (await tx.room.findUnique({ where: { id: room.id } })) continue;
      const { bookings, equipment, ...record } = room;
      await tx.room.create({ data: { ...record, equipment: JSON.stringify(equipment), bookings: { create: bookings } } });
      loaded.rooms++;
    }
    if (await tx.event.count() === 0) for (const event of events) {
      const { registrations, ...record } = event;
      await tx.event.create({ data: { ...record, registrations: { create: registrations } } });
      loaded.events++;
    }
    if (await tx.announcement.count() === 0) {
      await tx.announcement.createMany({ data: announcements });
      loaded.announcements = announcements.length;
    }
    if (await tx.assignment.count() === 0) {
      await tx.assignment.createMany({ data: assignments });
      loaded.assignments = assignments.length;
    }
  });

  console.log(`Loaded ${loaded.schedules} schedules, ${loaded.rooms} rooms, ${loaded.events} events, ${loaded.announcements} announcements, and ${loaded.assignments} assignments.`);
  if (Object.values(loaded).every((count) => count === 0)) console.log("Database already contains seed data; existing changes were preserved.");
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
