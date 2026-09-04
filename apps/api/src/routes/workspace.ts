import { randomUUID } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { db } from "../db";
import { asyncRoute, HttpError, parse } from "../http";

export const workspace = Router();
const roles = ["student", "teacher", "cr", "sr", "admin"] as const;

async function actor(request: { headers: Record<string, unknown> }) {
  const id = String(request.headers["x-user-id"] ?? "");
  if (!id) throw new HttpError(401, "Choose a campus user");
  const user = await db.campusUser.findUnique({ where: { id } });
  if (!user) throw new HttpError(401, "Campus user not found");
  return user;
}
function allow(role: string, accepted: string[]) { if (!accepted.includes(role)) throw new HttpError(403, "You do not have permission for this action"); }

workspace.get("/users", asyncRoute(async (_req, res) => res.json(await db.campusUser.findMany({ orderBy: [{ role: "asc" }, { name: "asc" }] }))));
workspace.get("/me", asyncRoute(async (req, res) => {
  const user = await actor(req as never), today = new Date().toISOString().slice(0, 10);
  const courseWhere = user.role === "admin" ? {} : user.role === "teacher" ? { teacher_id: user.id } : { enrollments: { some: { user_id: user.id } } };
  const [courses, announcements, users, rooms, events] = await Promise.all([
    db.course.findMany({ where: courseWhere, include: { teacher: { select: { id: true, name: true } }, lectures: { orderBy: { created_at: "desc" } }, _count: { select: { enrollments: true } } }, orderBy: { code: "asc" } }),
    db.semesterAnnouncement.findMany({ where: user.role === "admin" ? {} : { semester: user.semester ?? "" , expires: { gte: today } }, orderBy: { created_at: "desc" } }),
    user.role === "admin" ? db.campusUser.findMany({ orderBy: { name: "asc" } }) : Promise.resolve([]), db.room.count(), db.event.count(),
  ]);
  res.json({ user, courses, announcements, admin_users: users, metrics: { users: users.length, courses: courses.length, rooms, events } });
}));

workspace.post("/courses/:id/lectures", asyncRoute(async (req, res) => {
  const user = await actor(req as never);allow(user.role, ["teacher", "admin"]);
  const course = await db.course.findUnique({ where: { id: String(req.params.id) } });
  if (!course) throw new HttpError(404, "Course not found");
  if (user.role === "teacher" && course.teacher_id !== user.id) throw new HttpError(403, "Teachers may upload only to their own courses");
  const input = parse(z.object({ title: z.string().min(1), description: z.string().default(""), content_url: z.string().url() }), req.body);
  res.status(201).json(await db.lecture.create({ data: { id: `lecture-${randomUUID()}`, course_id: course.id, teacher_id: user.role === "admin" ? course.teacher_id : user.id, ...input } }));
}));

workspace.delete("/lectures/:id", asyncRoute(async (req, res) => {
  const user = await actor(req as never);allow(user.role, ["teacher", "admin"]);const lecture = await db.lecture.findUnique({ where: { id: String(req.params.id) } });
  if (!lecture) throw new HttpError(404, "Lecture not found");if (user.role === "teacher" && lecture.teacher_id !== user.id) throw new HttpError(403, "Teachers may remove only their own lectures");
  res.json(await db.lecture.delete({ where: { id: lecture.id } }));
}));

workspace.post("/announcements", asyncRoute(async (req, res) => {
  const user = await actor(req as never);allow(user.role, ["cr", "sr", "admin"]);
  const input = parse(z.object({ title: z.string().min(1), body: z.string().min(1), semester: z.string().min(1), priority: z.enum(["high", "medium", "low"]), expires: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }), req.body);
  if (user.role !== "admin" && input.semester !== user.semester) throw new HttpError(403, "CR/SR announcements must target their own semester");
  res.status(201).json(await db.semesterAnnouncement.create({ data: { id: `semester-ann-${randomUUID()}`, author_id: user.id, author_name: user.name, author_role: user.role, ...input } }));
}));

workspace.delete("/announcements/:id", asyncRoute(async (req, res) => {
  const user=await actor(req as never);allow(user.role,["cr","sr","admin"]);const item=await db.semesterAnnouncement.findUnique({where:{id:String(req.params.id)}});if(!item)throw new HttpError(404,"Announcement not found");
  if(user.role!=="admin"&&(item.author_id!==user.id||item.semester!==user.semester))throw new HttpError(403,"CR/SR users may remove only their own semester announcements");res.json(await db.semesterAnnouncement.delete({where:{id:item.id}}));
}));

workspace.patch("/users/:id/role", asyncRoute(async (req, res) => {
  const user = await actor(req as never);allow(user.role, ["admin"]);const input = parse(z.object({ role: z.enum(roles), semester: z.string().nullable().optional() }), req.body);
  res.json(await db.campusUser.update({ where: { id: String(req.params.id) }, data: input }));
}));
