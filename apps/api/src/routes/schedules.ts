import { Router } from "express";
import { scheduleSchema } from "@campus-os/contracts";
import { authenticatedUser, cohortWhere, taughtCourseCodes } from "../access";
import { requireRoles } from "../auth";
import { db } from "../db";
import { asyncRoute, HttpError, parse } from "../http";
export const schedules = Router();
async function validate(
  data: { day?: string; start_time?: string; end_time?: string; room?: string },
  excludeId?: string,
) {
  if (data.start_time && data.end_time && data.start_time >= data.end_time)
    throw new HttpError(400, "end_time must be after start_time");
  if (!data.day || !data.start_time || !data.end_time || !data.room) return;
  const room = await db.room.findFirst({ where: { room_number: data.room } });
  if (!room) throw new HttpError(400, "Selected room does not exist");
  const conflict = await db.schedule.findFirst({
    where: {
      id: excludeId ? { not: excludeId } : undefined,
      day: data.day,
      room: data.room,
      start_time: { lt: data.end_time },
      end_time: { gt: data.start_time },
    },
  });
  if (conflict)
    throw new HttpError(409, `Room ${data.room} is already occupied`);
}
async function teacherScope(
  user: { id: string; role: string },
  course: string,
) {
  if (user.role === "admin") return null;
  const offering = await db.courseOffering.findFirst({
    where: { code: course, teacher_id: user.id },
  });
  if (!offering)
    throw new HttpError(
      403,
      "Teachers can manage schedules only for courses they teach",
    );
  return offering;
}
schedules.get(
  "/",
  requireRoles("student", "teacher", "cr", "admin"),
  asyncRoute(async (req, res) => {
    const user = await authenticatedUser(req);
    const day = typeof req.query.day === "string" ? req.query.day : undefined,
      queryCourse =
        typeof req.query.course === "string" ? req.query.course : undefined;
    let scope: any = {};
    if (user.role === "teacher")
      scope = { course: { in: await taughtCourseCodes(user.id) } };
    else if (user.role !== "admin") scope = cohortWhere(user, true);
    res.json(
      await db.schedule.findMany({
        where: {
          ...scope,
          day,
          course: queryCourse ? { contains: queryCourse } : scope.course,
        },
        orderBy: [{ day: "asc" }, { start_time: "asc" }],
      }),
    );
  }),
);
schedules.post(
  "/",
  requireRoles("teacher", "admin"),
  asyncRoute(async (req, res) => {
    const user = await authenticatedUser(req),
      data = parse(scheduleSchema, req.body);
    const offering = await teacherScope(user, data.course);
    await validate(data);
    res.status(201).json(
      await db.schedule.create({
        data: {
          ...data,
          teacher_id: user.role === "teacher" ? user.id : data.teacher_id,
          department: offering?.department ?? data.department,
          academic_year: offering?.academic_year ?? data.academic_year,
          semester: offering?.semester ?? data.semester,
          section: offering?.section ?? data.section,
        },
      }),
    );
  }),
);
schedules.patch(
  "/:id",
  requireRoles("teacher", "admin"),
  asyncRoute(async (req, res) => {
    const user = await authenticatedUser(req),
      id = String(req.params.id),
      current = await db.schedule.findUnique({ where: { id } });
    if (!current) throw new HttpError(404, "Schedule not found");
    await teacherScope(user, current.course);
    const parsed = parse(scheduleSchema.omit({ id: true }).partial(), req.body);
    const offering = await teacherScope(user, parsed.course ?? current.course);
    const data =
      user.role === "teacher"
        ? {
            ...parsed,
            teacher_id: user.id,
            department: offering!.department,
            academic_year: offering!.academic_year,
            semester: offering!.semester,
            section: offering!.section,
          }
        : parsed;
    await validate({ ...current, ...data }, id);
    res.json(await db.schedule.update({ where: { id }, data }));
  }),
);
schedules.put(
  "/:id",
  requireRoles("teacher", "admin"),
  asyncRoute(async (req, res) => {
    const user = await authenticatedUser(req),
      id = String(req.params.id),
      current = await db.schedule.findUnique({ where: { id } });
    if (!current) throw new HttpError(404, "Schedule not found");
    await teacherScope(user, current.course);
    const parsed = parse(scheduleSchema, { ...req.body, id });
    const offering = await teacherScope(user, parsed.course);
    const data =
      user.role === "teacher"
        ? {
            ...parsed,
            teacher_id: user.id,
            department: offering!.department,
            academic_year: offering!.academic_year,
            semester: offering!.semester,
            section: offering!.section,
          }
        : parsed;
    await validate(data, id);
    res.json(await db.schedule.update({ where: { id }, data }));
  }),
);
schedules.delete(
  "/:id",
  requireRoles("teacher", "admin"),
  asyncRoute(async (req, res) => {
    const user = await authenticatedUser(req),
      item = await db.schedule.findUnique({
        where: { id: String(req.params.id) },
      });
    if (!item) throw new HttpError(404, "Schedule not found");
    await teacherScope(user, item.course);
    res.json(await db.schedule.delete({ where: { id: item.id } }));
  }),
);
