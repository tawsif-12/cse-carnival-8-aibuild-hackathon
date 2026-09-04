import { randomUUID } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { getSession, requireRoles } from "../auth";
import { db } from "../db";
import { asyncRoute, HttpError, parse } from "../http";

export const portal = Router();
const courseInclude = { teacher: { select: { id: true, name: true, email: true } }, lectures: { orderBy: { created_at: "desc" as const } }, _count: { select: { members: true } } };

async function currentUser(request: Parameters<typeof getSession>[0]) {
  const session = getSession(request);
  const user = await db.user.findUnique({ where: { id: session.id } });
  if (!user) throw new HttpError(401, "Account no longer exists");
  return user;
}

portal.get("/dashboard", asyncRoute(async (request, response) => {
  const user = await currentUser(request);
  const today = new Date().toISOString().slice(0, 10);
  const cohort = user.department && user.academic_year && user.semester ? { department: user.department, academic_year: user.academic_year, semester: user.semester } : null;
  const courseWhere = user.role === "admin" ? {} : user.role === "teacher" ? { teacher_id: user.id } : { members: { some: { user_id: user.id } } };
  const announcementWhere = user.role === "admin" ? {} : cohort ? { ...cohort, expires: { gte: today }, OR: [{ course_id: null }, { course: { members: { some: { user_id: user.id } } } }] } : { id: "__none__" };
  const [courses, announcements, eventCount, userCount] = await Promise.all([
    db.courseOffering.findMany({ where: courseWhere, include: courseInclude, orderBy: { code: "asc" } }),
    db.cohortAnnouncement.findMany({ where: announcementWhere, include: { course: { select: { code: true, title: true } } }, orderBy: { created_at: "desc" } }),
    db.event.count({ where: { status: { notIn: ["cancelled", "completed"] } } }),
    user.role === "admin" ? db.user.count() : Promise.resolve(0),
  ]);
  response.json({ user: { id: user.id, name: user.name, email: user.email, role: user.role, department: user.department, academic_year: user.academic_year, semester: user.semester }, courses, announcements, metrics: { courses: courses.length, announcements: announcements.length, university_events: eventCount, users: userCount } });
}));

portal.post("/courses", requireRoles("admin"), asyncRoute(async (request, response) => {
  const input = parse(z.object({ code: z.string().min(2), title: z.string().min(2), department: z.string().min(2), academic_year: z.coerce.number().int().min(1).max(8), semester: z.coerce.number().int().min(1).max(3), teacher_id: z.string().nullable().optional() }), request.body);
  response.status(201).json(await db.courseOffering.create({ data: { id: `course-${randomUUID()}`, ...input }, include: courseInclude }));
}));

portal.post("/courses/:id/members", requireRoles("admin"), asyncRoute(async (request, response) => {
  const input = parse(z.object({ user_id: z.string() }), request.body);
  const course = await db.courseOffering.findUnique({ where: { id: String(request.params.id) } });
  const member = await db.user.findUnique({ where: { id: input.user_id } });
  if (!course || !member) throw new HttpError(404, "Course or user not found");
  if (member.department !== course.department || member.academic_year !== course.academic_year || member.semester !== course.semester) throw new HttpError(409, "The user must belong to the course department, year, and semester");
  response.status(201).json(await db.courseMember.upsert({ where: { user_id_course_id: { user_id: member.id, course_id: course.id } }, update: {}, create: { user_id: member.id, course_id: course.id } }));
}));

portal.post("/courses/:id/lectures", requireRoles("teacher", "admin"), asyncRoute(async (request, response) => {
  const user = await currentUser(request);
  const course = await db.courseOffering.findUnique({ where: { id: String(request.params.id) } });
  if (!course) throw new HttpError(404, "Course not found");
  if (user.role === "teacher" && course.teacher_id !== user.id) throw new HttpError(403, "Teachers can upload only to courses assigned to them");
  if (!course.teacher_id) throw new HttpError(409, "Assign a teacher before uploading lecture content");
  const input = parse(z.object({ title: z.string().min(1), description: z.string().default(""), content_url: z.string().url() }), request.body);
  response.status(201).json(await db.courseLecture.create({ data: { id: `lecture-${randomUUID()}`, course_id: course.id, teacher_id: course.teacher_id, ...input } }));
}));

portal.post("/announcements", requireRoles("representative", "admin"), asyncRoute(async (request, response) => {
  const user = await currentUser(request);
  const input = parse(z.object({ title: z.string().min(1), body: z.string().min(1), priority: z.enum(["high", "medium", "low"]), expires: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), course_id: z.string().nullable().optional(), department: z.string().optional(), academic_year: z.coerce.number().int().optional(), semester: z.coerce.number().int().optional() }), request.body);
  const department = user.role === "admin" ? input.department : user.department;
  const academic_year = user.role === "admin" ? input.academic_year : user.academic_year;
  const semester = user.role === "admin" ? input.semester : user.semester;
  if (!department || !academic_year || !semester) throw new HttpError(400, "A department, academic year, and semester are required");
  if (input.course_id) {
    const course = await db.courseOffering.findUnique({ where: { id: input.course_id }, include: { members: true } });
    if (!course || course.department !== department || course.academic_year !== academic_year || course.semester !== semester) throw new HttpError(403, "The selected course is outside your cohort");
    if (user.role === "representative" && !course.members.some(member => member.user_id === user.id)) throw new HttpError(403, "Representatives can announce only for their assigned courses");
  }
  response.status(201).json(await db.cohortAnnouncement.create({ data: { id: `announcement-${randomUUID()}`, title: input.title, body: input.body, priority: input.priority, expires: input.expires, course_id: input.course_id, department, academic_year, semester, author_id: user.id, author_name: user.name } }));
}));

portal.get("/users", requireRoles("admin"), asyncRoute(async (_request, response) => response.json(await db.user.findMany({ select: { id: true, name: true, email: true, role: true, department: true, academic_year: true, semester: true }, orderBy: { name: "asc" } }))));
