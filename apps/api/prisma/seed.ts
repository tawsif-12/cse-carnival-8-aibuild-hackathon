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

function relativeDate(daysFromToday: number) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + daysFromToday);
  return date.toISOString().slice(0, 10);
}

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
      {
        id: "demo-teacher-2",
        name: "Dr. Farhana Islam",
        email: "farhana.teacher@campus.local",
        role: "teacher",
        department: "CSE",
        academic_year: null,
        semester: null,
        section: null,
      },
      {
        id: "demo-student-2",
        name: "Nadia Rahman",
        email: "nadia.student@campus.local",
        role: "student",
        department: "CSE",
        academic_year: 4,
        semester: 1,
        section: "A",
      },
      {
        id: "demo-student-3",
        name: "Rafi Hossain",
        email: "rafi.student@campus.local",
        role: "student",
        department: "CSE",
        academic_year: 4,
        semester: 1,
        section: "A",
      },
      {
        id: "demo-student-other-cohort",
        name: "Samia Ahmed",
        email: "samia.student@campus.local",
        role: "student",
        department: "EEE",
        academic_year: 3,
        semester: 2,
        section: "B",
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

    // Keep the authenticated role dashboards populated even when the legacy
    // JSON tables already contain data. These stable IDs make the seed safe to
    // run repeatedly while the rolling dates keep the demo content current.
    const teacherTwo = await tx.user.findUniqueOrThrow({
        where: { email: "farhana.teacher@campus.local" },
      }),
      studentTwo = await tx.user.findUniqueOrThrow({
        where: { email: "nadia.student@campus.local" },
      }),
      studentThree = await tx.user.findUniqueOrThrow({
        where: { email: "rafi.student@campus.local" },
      }),
      admin = await tx.user.findUniqueOrThrow({
        where: { email: "admin@campus.local" },
      });

    const courseSpecs = [
      {
        id: "demo-course-cse4129",
        code: "CSE 4129",
        title: "Formal Languages and Compilers",
        teacher_id: teacher.id,
      },
      {
        id: "demo-course-cse4113",
        code: "CSE 4113",
        title: "Pattern Recognition and Machine Learning",
        teacher_id: teacherTwo.id,
      },
      {
        id: "demo-course-cse4137",
        code: "CSE 4137",
        title: "Soft Computing",
        teacher_id: teacherTwo.id,
      },
      {
        id: "demo-course-cse4173",
        code: "CSE 4173",
        title: "Cyber Security",
        teacher_id: teacher.id,
      },
      {
        id: "demo-course-cse4130",
        code: "CSE 4130",
        title: "Formal Languages and Compilers Lab",
        teacher_id: teacher.id,
      },
    ];
    const demoCourses = new Map<string, string>();
    for (const spec of courseSpecs) {
      const course = await tx.courseOffering.upsert({
        where: {
          code_department_academic_year_semester_section: {
            code: spec.code,
            department: "CSE",
            academic_year: 4,
            semester: 1,
            section: "A",
          },
        },
        update: { title: spec.title, teacher_id: spec.teacher_id },
        create: {
          ...spec,
          department: "CSE",
          academic_year: 4,
          semester: 1,
          section: "A",
        },
      });
      demoCourses.set(spec.code, course.id);
    }
    for (const courseId of demoCourses.values())
      for (const member of [student, studentTwo, studentThree, cr])
        await tx.courseMember.upsert({
          where: {
            user_id_course_id: { user_id: member.id, course_id: courseId },
          },
          update: {},
          create: { user_id: member.id, course_id: courseId },
        });

    const lectureSpecs = [
      {
        id: "demo-lecture-compilers-1",
        course: "CSE 4129",
        teacher_id: teacher.id,
        title: "Compiler phases and architecture",
        description: "Slides covering scanning, parsing, and code generation.",
        content_url: "https://en.wikipedia.org/wiki/Compiler",
      },
      {
        id: "demo-lecture-compilers-2",
        course: "CSE 4129",
        teacher_id: teacher.id,
        title: "Context-free grammars",
        description: "Reading material and examples for CFG derivations.",
        content_url: "https://en.wikipedia.org/wiki/Context-free_grammar",
      },
      {
        id: "demo-lecture-ml-1",
        course: "CSE 4113",
        teacher_id: teacherTwo.id,
        title: "Introduction to machine learning",
        description: "Lecture notes on supervised and unsupervised learning.",
        content_url:
          "https://en.wikipedia.org/wiki/Supervised_learning",
      },
      {
        id: "demo-lecture-soft-1",
        course: "CSE 4137",
        teacher_id: teacherTwo.id,
        title: "Fuzzy sets and membership functions",
        description: "Worked examples for the first Soft Computing module.",
        content_url: "https://en.wikipedia.org/wiki/Fuzzy_set",
      },
      {
        id: "demo-lecture-security-1",
        course: "CSE 4173",
        teacher_id: teacher.id,
        title: "Security principles and the CIA triad",
        description: "Core confidentiality, integrity, and availability notes.",
        content_url: "https://en.wikipedia.org/wiki/Information_security",
      },
      {
        id: "demo-lecture-lab-1",
        course: "CSE 4130",
        teacher_id: teacher.id,
        title: "Building a lexical analyzer",
        description: "Lab guide for tokens, patterns, and scanner rules.",
        content_url: "https://en.wikipedia.org/wiki/Lexical_analysis",
      },
    ];
    for (const lecture of lectureSpecs) {
      const { course, ...content } = lecture,
        courseId = demoCourses.get(course)!;
      await tx.courseLecture.upsert({
        where: { id: lecture.id },
        update: { ...content, course_id: courseId },
        create: { ...content, course_id: courseId },
      });
    }

    const demoSchedules = [
      ["demo-sch-01", "CSE 4129", "Sunday", "09:00", "09:50", "7A05"],
      ["demo-sch-02", "CSE 4113", "Sunday", "11:00", "11:50", "7A07"],
      ["demo-sch-03", "CSE 4137", "Monday", "10:00", "10:50", "7A03"],
      ["demo-sch-04", "CSE 4173", "Monday", "13:00", "13:50", "7A04"],
      ["demo-sch-05", "CSE 4130", "Tuesday", "09:00", "10:40", "7B06"],
      ["demo-sch-06", "CSE 4113", "Tuesday", "13:00", "13:50", "7A07"],
      ["demo-sch-07", "CSE 4129", "Wednesday", "10:00", "10:50", "7A05"],
      ["demo-sch-08", "CSE 4137", "Wednesday", "14:00", "14:50", "7A03"],
      ["demo-sch-09", "CSE 4173", "Thursday", "11:00", "11:50", "7A04"],
      ["demo-sch-10", "CSE 4129", "Thursday", "13:00", "13:50", "7A06"],
    ] as const;
    for (const [id, code, day, start_time, end_time, room] of demoSchedules) {
      const spec = courseSpecs.find((item) => item.code === code)!;
      const data = {
        id,
        course: code,
        title: spec.title,
        day,
        start_time,
        end_time,
        room,
        instructor:
          spec.teacher_id === teacher.id ? teacher.name : teacherTwo.name,
        section: "A",
        department: "CSE",
        academic_year: 4,
        semester: 1,
        teacher_id: spec.teacher_id,
      };
      await tx.schedule.upsert({ where: { id }, update: data, create: data });
    }

    const demoAssignments = [
      {
        id: "demo-asgn-01",
        course: "CSE 4129",
        title: "DFA and NFA construction",
        description:
          "Construct automata for five languages and include transition diagrams.",
        deadline: relativeDate(3),
        marks: 10,
        platform: "Google Classroom",
      },
      {
        id: "demo-asgn-02",
        course: "CSE 4113",
        title: "Naive Bayes classifier",
        description:
          "Implement a classifier from scratch and submit a short evaluation report.",
        deadline: relativeDate(6),
        marks: 15,
        platform: "Moodle",
      },
      {
        id: "demo-asgn-03",
        course: "CSE 4137",
        title: "Fuzzy controller design",
        description:
          "Design membership functions and rules for a smart room controller.",
        deadline: relativeDate(9),
        marks: 20,
        platform: "Google Classroom",
      },
      {
        id: "demo-asgn-04",
        course: "CSE 4173",
        title: "Threat-model case study",
        description:
          "Prepare a threat model for a university course-registration system.",
        deadline: relativeDate(12),
        marks: 15,
        platform: "Moodle",
      },
      {
        id: "demo-asgn-05",
        course: "CSE 4130",
        title: "Flex lexical analyzer",
        description:
          "Build and test a scanner for identifiers, numbers, and operators.",
        deadline: relativeDate(5),
        marks: 10,
        platform: "Lab submission portal",
      },
    ];
    for (const assignment of demoAssignments) {
      const spec = courseSpecs.find(
        (item) => item.code === assignment.course,
      )!;
      const data = {
        id: assignment.id,
        course: assignment.course,
        course_title: spec.title,
        title: assignment.title,
        description: assignment.description,
        assigned_date: relativeDate(-2),
        deadline: assignment.deadline,
        submission_platform: assignment.platform,
        status: "pending",
        marks: assignment.marks,
        department: "CSE",
        academic_year: 4,
        semester: 1,
        teacher_id: spec.teacher_id,
      };
      await tx.assignment.upsert({ where: { id: data.id }, update: data, create: data });
    }

    const cohortNotices = [
      {
        id: "demo-notice-class-routine",
        title: "Updated class routine is active",
        body: "The revised weekly routine is now visible in Schedule. Please check room numbers before each class.",
        priority: "high",
        course: null,
        author_id: cr.id,
        author_name: cr.name,
      },
      {
        id: "demo-notice-compiler-quiz",
        title: "Compiler quiz next week",
        body: "The quiz will cover regular expressions, finite automata, and lexical analysis.",
        priority: "high",
        course: "CSE 4129",
        author_id: teacher.id,
        author_name: teacher.name,
      },
      {
        id: "demo-notice-ml-resource",
        title: "Machine learning practice notebook",
        body: "A starter notebook and sample dataset have been added to the lecture resources.",
        priority: "medium",
        course: "CSE 4113",
        author_id: teacherTwo.id,
        author_name: teacherTwo.name,
      },
      {
        id: "demo-notice-security-lab",
        title: "Cybersecurity lab groups published",
        body: "Check your group number before the lab and bring a laptop with Wireshark installed.",
        priority: "medium",
        course: "CSE 4173",
        author_id: cr.id,
        author_name: cr.name,
      },
    ];
    for (const notice of cohortNotices) {
      const data = {
        id: notice.id,
        title: notice.title,
        body: notice.body,
        department: "CSE",
        academic_year: 4,
        semester: 1,
        section: "A",
        course_id: notice.course ? demoCourses.get(notice.course)! : null,
        author_id: notice.author_id,
        author_name: notice.author_name,
        priority: notice.priority,
        expires: relativeDate(30),
      };
      await tx.cohortAnnouncement.upsert({
        where: { id: data.id },
        update: data,
        create: data,
      });
    }

    const officialNotices = [
      {
        id: "demo-official-01",
        title: "Fall semester academic calendar published",
        body: "The updated academic calendar, examination weeks, and holiday schedule are now available.",
        priority: "high",
        department: null,
      },
      {
        id: "demo-official-02",
        title: "Library digital resources orientation",
        body: "Join the library team for a short session on journals, e-books, and remote database access.",
        priority: "medium",
        department: null,
      },
      {
        id: "demo-official-03",
        title: "CSE project showcase registration",
        body: "CSE students can register a software, hardware, or research project for the upcoming showcase.",
        priority: "medium",
        department: "CSE",
      },
      {
        id: "demo-official-04",
        title: "Campus transport schedule updated",
        body: "Evening bus departure times have been adjusted for the current semester.",
        priority: "low",
        department: null,
      },
    ];
    for (const notice of officialNotices) {
      const data = {
        ...notice,
        date: relativeDate(-1),
        posted_by: admin.name,
        expires: relativeDate(45),
        academic_year: null,
        semester: null,
        section: null,
        course: null,
        author_id: admin.id,
      };
      await tx.announcement.upsert({
        where: { id: data.id },
        update: data,
        create: data,
      });
    }

    const demoEvents = [
      {
        id: "demo-event-01",
        name: "AUST AI Build Hackathon",
        description:
          "A university-wide team competition for building useful AI products in 24 hours.",
        date: relativeDate(7),
        start_time: "09:00",
        end_time: "18:00",
        venue: "AUST Auditorium",
        organizer: "AUST Innovation Club",
        capacity: 200,
      },
      {
        id: "demo-event-02",
        name: "Career talk: Engineering the future",
        description:
          "Alumni and industry leaders share practical guidance on internships and early careers.",
        date: relativeDate(11),
        start_time: "14:00",
        end_time: "16:00",
        venue: "Seminar Hall 7C06",
        organizer: "Career Development Center",
        capacity: 120,
      },
      {
        id: "demo-event-03",
        name: "Inter-department programming contest",
        description:
          "A beginner-friendly onsite contest open to students from every department.",
        date: relativeDate(16),
        start_time: "10:00",
        end_time: "14:00",
        venue: "Computer Labs 7B01-7B04",
        organizer: "AUST Programming Club",
        capacity: 100,
      },
      {
        id: "demo-event-04",
        name: "University cultural evening",
        description:
          "Music, theatre, photography, and student performances from across campus.",
        date: relativeDate(22),
        start_time: "16:00",
        end_time: "20:00",
        venue: "AUST Plaza",
        organizer: "Cultural Club",
        capacity: 350,
      },
    ];
    for (const event of demoEvents) {
      const data = {
        ...event,
        end_date: event.date,
        registered: 3,
        status: "upcoming",
        department: null,
        academic_year: null,
        semester: null,
      };
      await tx.event.upsert({
        where: { id: event.id },
        update: data,
        create: data,
      });
      for (const attendee of [student, studentTwo, studentThree])
        await tx.registration.upsert({
          where: {
            event_id_student_id: {
              event_id: event.id,
              student_id: attendee.id,
            },
          },
          update: { name: attendee.name },
          create: {
            event_id: event.id,
            student_id: attendee.id,
            name: attendee.name,
          },
        });
    }

    const demoRoom = await tx.room.findUnique({
      where: { room_number: "7A06" },
    });
    if (demoRoom) {
      const bookings = [
        {
          booking_id: "demo-booking-teacher",
          booked_by: teacher.name,
          user_id: teacher.id,
          status: "approved",
          date: relativeDate(2),
          start_time: "15:00",
          end_time: "16:00",
          purpose: "Compiler project consultation",
        },
        {
          booking_id: "demo-booking-cr",
          booked_by: cr.name,
          user_id: cr.id,
          status: "requested",
          date: relativeDate(4),
          start_time: "16:00",
          end_time: "17:00",
          purpose: "Section A study circle",
        },
      ];
      for (const booking of bookings)
        await tx.booking.upsert({
          where: { booking_id: booking.booking_id },
          update: { ...booking, room_id: demoRoom.id },
          create: { ...booking, room_id: demoRoom.id },
        });
    }
  });

  const [
    users,
    courses,
    lectures,
    schedulesTotal,
    roomsTotal,
    eventsTotal,
    announcementsTotal,
    cohortNotices,
    assignmentsTotal,
  ] = await prisma.$transaction([
    prisma.user.count(),
    prisma.courseOffering.count(),
    prisma.courseLecture.count(),
    prisma.schedule.count(),
    prisma.room.count(),
    prisma.event.count(),
    prisma.announcement.count(),
    prisma.cohortAnnouncement.count(),
    prisma.assignment.count(),
  ]);
  console.log(
    `Demo database ready: ${users} users, ${courses} courses, ${lectures} lectures, ${schedulesTotal} schedules, ${roomsTotal} rooms, ${eventsTotal} events, ${announcementsTotal} official announcements, ${cohortNotices} class announcements, and ${assignmentsTotal} assignments.`,
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
