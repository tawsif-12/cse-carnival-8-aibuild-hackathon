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
    if (await tx.campusUser.count() === 0) {
      await tx.campusUser.createMany({ data: [
        { id: "student-1", name: "Nadia Rahman", email: "student@campus.local", role: "student", semester: "Fall 2026" },
        { id: "teacher-1", name: "Dr. N. Rahman", email: "teacher@campus.local", role: "teacher", semester: null },
        { id: "cr-1", name: "Tawsif Ahmed", email: "cr@campus.local", role: "cr", semester: "Fall 2026" },
        { id: "admin-1", name: "Campus Administrator", email: "admin@campus.local", role: "admin", semester: null },
      ] });
      await tx.course.createMany({ data: [
        { id: "course-cse4129", code: "CSE 4129", title: "Formal Languages and Compilers", semester: "Fall 2026", teacher_id: "teacher-1" },
        { id: "course-cse4113", code: "CSE 4113", title: "Computer Networks", semester: "Fall 2026", teacher_id: "teacher-1" },
      ] });
      await tx.enrollment.createMany({ data: [
        { user_id: "student-1", course_id: "course-cse4129" }, { user_id: "student-1", course_id: "course-cse4113" },
        { user_id: "cr-1", course_id: "course-cse4129" }, { user_id: "cr-1", course_id: "course-cse4113" },
      ] });
      await tx.lecture.create({ data: { id: "lecture-compiler-intro", course_id: "course-cse4129", teacher_id: "teacher-1", title: "Introduction to Compilers", description: "Lecture slides and reading guide", content_url: "https://example.edu/content/compiler-intro.pdf" } });
      await tx.semesterAnnouncement.create({ data: { id: "semester-welcome", title: "Welcome to Fall 2026", body: "Semester classes and course resources are now available.", semester: "Fall 2026", author_id: "cr-1", author_name: "Tawsif Ahmed", author_role: "cr", priority: "medium", expires: "2026-12-31" } });
    }
  });

  console.log(`Loaded ${loaded.schedules} schedules, ${loaded.rooms} rooms, ${loaded.events} events, ${loaded.announcements} announcements, and ${loaded.assignments} assignments.`);
  if (Object.values(loaded).every((count) => count === 0)) console.log("Database already contains seed data; existing changes were preserved.");
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
