import { PrismaClient } from "@prisma/client";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID, scrypt as scryptCallback } from "node:crypto";
import { promisify } from "node:util";
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
const scrypt = promisify(scryptCallback);
async function passwordHash(password: string) {
  const salt = randomUUID(),
    hash = (await scrypt(password, salt, 64)) as Buffer;
  return `${salt}:${hash.toString("hex")}`;
}
const dataDirectory = path.resolve(__dirname, "../../../data");

async function load<T>(file: string, schema: z.ZodType<T>): Promise<T[]> {
  const contents = await readFile(path.join(dataDirectory, file), "utf8");
  return z.array(schema).parse(JSON.parse(contents));
}

async function main() {
  const demoPassword = await passwordHash("CampusOS123!");
  const [
    schedules,
    rooms,
    universityRooms,
    events,
    announcements,
    assignments,
  ] = await Promise.all([
    load<Schedule>("schedules.json", scheduleSchema),
    load<Room>("rooms.json", roomSchema),
    load<Room>("university_rooms.json", roomSchema),
    load<Event>("events.json", eventSchema),
    load<Announcement>("announcements.json", announcementSchema),
    load<Assignment>("assignments.json", assignmentSchema),
  ]);

  const loaded = {
    schedules: 0,
    rooms: 0,
    events: 0,
    announcements: 0,
    assignments: 0,
  };
  await prisma.$transaction(async (tx) => {
    const demoUsers = [
      {
        id: "demo-student",
        name: "Demo Student",
        email: "student@campus.local",
        role: "student",
        department: "CSE",
        academic_year: 4,
        semester: 1,
        section: "A",
      },
      {
        id: "demo-teacher",
        name: "Dr. Demo Teacher",
        email: "teacher@campus.local",
        role: "teacher",
        department: "CSE",
        academic_year: null,
        semester: null,
        section: null,
      },
      {
        id: "demo-cr",
        name: "Demo Class Representative",
        email: "cr@campus.local",
        role: "cr",
        department: "CSE",
        academic_year: 4,
        semester: 1,
        section: "A",
      },
      {
        id: "demo-admin",
        name: "Campus Administrator",
        email: "admin@campus.local",
        role: "admin",
        department: null,
        academic_year: null,
        semester: null,
        section: null,
      },
    ];
    for (const user of demoUsers)
      await tx.user.upsert({
        where: { email: user.email },
        update: {
          name: user.name,
          role: user.role,
          department: user.department,
          academic_year: user.academic_year,
          semester: user.semester,
          section: user.section,
          password_hash: demoPassword,
        },
        create: { ...user, password_hash: demoPassword },
      });
    const teacher = await tx.user.findUniqueOrThrow({
        where: { email: "teacher@campus.local" },
      }),
      student = await tx.user.findUniqueOrThrow({
        where: { email: "student@campus.local" },
      }),
      cr = await tx.user.findUniqueOrThrow({
        where: { email: "cr@campus.local" },
      });
    const offering = await tx.courseOffering.upsert({
      where: {
        code_department_academic_year_semester_section: {
          code: "CSE 4129",
          department: "CSE",
          academic_year: 4,
          semester: 1,
          section: "A",
        },
      },
      update: { teacher_id: teacher.id },
      create: {
        id: "demo-course-cse4129",
        code: "CSE 4129",
        title: "Formal Languages and Compilers",
        department: "CSE",
        academic_year: 4,
        semester: 1,
        section: "A",
        teacher_id: teacher.id,
      },
    });
    for (const member of [student, cr])
      await tx.courseMember.upsert({
        where: {
          user_id_course_id: { user_id: member.id, course_id: offering.id },
        },
        update: {},
        create: { user_id: member.id, course_id: offering.id },
      });
    await tx.schedule.updateMany({
      where: { course: "CSE 4129" },
      data: {
        department: "CSE",
        academic_year: 4,
        semester: 1,
        section: "A",
        teacher_id: teacher.id,
      },
    });
    await tx.assignment.updateMany({
      where: { course: "CSE 4129" },
      data: {
        department: "CSE",
        academic_year: 4,
        semester: 1,
        teacher_id: teacher.id,
      },
    });
    await tx.cohortAnnouncement.upsert({
      where: { id: "demo-class-notice" },
      update: { author_id: cr.id },
      create: {
        id: "demo-class-notice",
        title: "CSE 4129 class update",
        body: "This announcement is visible only to CSE Year 4, Semester 1, Section A students assigned to this course.",
        department: "CSE",
        academic_year: 4,
        semester: 1,
        section: "A",
        course_id: offering.id,
        author_id: cr.id,
        author_name: cr.name,
        priority: "medium",
        expires: "2027-12-31",
      },
    });
    if ((await tx.schedule.count()) === 0) {
      for (const schedule of schedules)
        await tx.schedule.create({ data: schedule });
      loaded.schedules = schedules.length;
    }
    for (const room of [...rooms, ...universityRooms]) {
      if (await tx.room.findUnique({ where: { id: room.id } })) continue;
      const { bookings, equipment, ...record } = room;
      await tx.room.create({
        data: {
          ...record,
          equipment: JSON.stringify(equipment),
          bookings: { create: bookings },
        },
      });
      loaded.rooms++;
    }
    if ((await tx.event.count()) === 0)
      for (const event of events) {
        const { registrations, ...record } = event;
        await tx.event.create({
          data: { ...record, registrations: { create: registrations } },
        });
        loaded.events++;
      }
    if ((await tx.announcement.count()) === 0) {
      await tx.announcement.createMany({ data: announcements });
      loaded.announcements = announcements.length;
    }
    if ((await tx.assignment.count()) === 0) {
      await tx.assignment.createMany({ data: assignments });
      loaded.assignments = assignments.length;
    }
    if ((await tx.campusUser.count()) === 0) {
      await tx.campusUser.createMany({
        data: [
          {
            id: "student-1",
            name: "Nadia Rahman",
            email: "student@campus.local",
            role: "student",
            semester: "Fall 2026",
          },
          {
            id: "teacher-1",
            name: "Dr. N. Rahman",
            email: "teacher@campus.local",
            role: "teacher",
            semester: null,
          },
          {
            id: "cr-1",
            name: "Tawsif Ahmed",
            email: "cr@campus.local",
            role: "cr",
            semester: "Fall 2026",
          },
          {
            id: "admin-1",
            name: "Campus Administrator",
            email: "admin@campus.local",
            role: "admin",
            semester: null,
          },
        ],
      });
      await tx.course.createMany({
        data: [
          {
            id: "course-cse4129",
            code: "CSE 4129",
            title: "Formal Languages and Compilers",
            semester: "Fall 2026",
            teacher_id: "teacher-1",
          },
          {
            id: "course-cse4113",
            code: "CSE 4113",
            title: "Computer Networks",
            semester: "Fall 2026",
            teacher_id: "teacher-1",
          },
        ],
      });
      await tx.enrollment.createMany({
        data: [
          { user_id: "student-1", course_id: "course-cse4129" },
          { user_id: "student-1", course_id: "course-cse4113" },
          { user_id: "cr-1", course_id: "course-cse4129" },
          { user_id: "cr-1", course_id: "course-cse4113" },
        ],
      });
      await tx.lecture.create({
        data: {
          id: "lecture-compiler-intro",
          course_id: "course-cse4129",
          teacher_id: "teacher-1",
          title: "Introduction to Compilers",
          description: "Lecture slides and reading guide",
          content_url: "https://example.edu/content/compiler-intro.pdf",
        },
      });
      await tx.semesterAnnouncement.create({
        data: {
          id: "semester-welcome",
          title: "Welcome to Fall 2026",
          body: "Semester classes and course resources are now available.",
          semester: "Fall 2026",
          author_id: "cr-1",
          author_name: "Tawsif Ahmed",
          author_role: "cr",
          priority: "medium",
          expires: "2026-12-31",
        },
      });
    }
  });

  console.log(
    `Loaded ${loaded.schedules} schedules, ${loaded.rooms} rooms, ${loaded.events} events, ${loaded.announcements} announcements, and ${loaded.assignments} assignments.`,
  );
  if (Object.values(loaded).every((count) => count === 0))
    console.log(
      "Database already contains seed data; existing changes were preserved.",
    );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
