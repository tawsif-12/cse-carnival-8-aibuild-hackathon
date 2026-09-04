import { Router } from "express";
import { announcementSchema } from "@campus-os/contracts";
import {
  assignedCourseCodes,
  audienceWhere,
  authenticatedUser,
  cohortWhere,
  taughtCourseCodes,
} from "../access";
import { requireRoles } from "../auth";
import { db } from "../db";
import { asyncRoute, HttpError, parse } from "../http";
export const announcements = Router();
async function canManage(
  user: {
    id: string;
    role: string;
    department: string | null;
    academic_year: number | null;
    semester: number | null;
    section: string | null;
  },
  item: {
    author_id: string | null;
    department: string | null;
    academic_year: number | null;
    semester: number | null;
    section: string | null;
    course: string | null;
  },
) {
  if (user.role === "admin") return;
  if (item.author_id !== user.id)
    throw new HttpError(403, "You may manage only announcements you posted");
  if (user.role === "teacher") {
    if (
      !item.course ||
      !(await taughtCourseCodes(user.id)).includes(item.course)
    )
      throw new HttpError(403, "Course is outside your teaching assignment");
    return;
  }
  const cohort = cohortWhere(user, user.role === "cr");
  if (
    item.department !== cohort.department ||
    item.academic_year !== cohort.academic_year ||
    item.semester !== cohort.semester ||
    (user.role === "cr" && item.section !== user.section)
  )
    throw new HttpError(403, "Announcement is outside your permitted scope");
}
announcements.get(
  "/",
  requireRoles("student", "teacher", "cr", "admin"),
  asyncRoute(async (req, res) => {
    const user = await authenticatedUser(req),
      priority =
        typeof req.query.priority === "string" ? req.query.priority : undefined,
      includeExpired = req.query.include_expired === "true",
      today = new Date().toISOString().slice(0, 10);
    let scope: any = {};
    if (user.role !== "admin") {
      const courses =
        user.role === "teacher"
          ? await taughtCourseCodes(user.id)
          : await assignedCourseCodes(user.id);
      if (user.role === "teacher")
        scope = {
          OR: [
            audienceWhere(user),
            { course: { in: courses } },
          ],
        };
      else {
        scope = {
          AND: [
            audienceWhere(user),
            { OR: [{ section: null }, { section: user.section }] },
            { OR: [{ course: null }, { course: { in: courses } }] },
          ],
        };
      }
    }
    res.json(
      await db.announcement.findMany({
        where: {
          ...scope,
          priority,
          expires: includeExpired ? undefined : { gte: today },
        },
        orderBy: { date: "desc" },
      }),
    );
  }),
);
announcements.post(
  "/",
  requireRoles("teacher", "cr", "admin"),
  asyncRoute(async (req, res) => {
    const user = await authenticatedUser(req),
      input = parse(announcementSchema, req.body);
    let data: any = { ...input, author_id: user.id, posted_by: user.name };
    if (user.role !== "admin") {
      if (user.role === "teacher") {
        if (!input.course)
          throw new HttpError(400, "Choose one of your taught courses");
        const offering = await db.courseOffering.findFirst({
          where: { code: input.course, teacher_id: user.id },
        });
        if (!offering)
          throw new HttpError(403, "Choose one of your taught courses");
        data = {
          ...data,
          department: offering.department,
          academic_year: offering.academic_year,
          semester: offering.semester,
          section: offering.section,
        };
      } else {
        const cohort = cohortWhere(user, true);
        data = { ...data, ...cohort };
      }
    }
    res.status(201).json(await db.announcement.create({ data }));
  }),
);
for (const method of ["patch", "put"] as const)
  announcements[method](
    "/:id",
    requireRoles("teacher", "cr", "admin"),
    asyncRoute(async (req, res) => {
      const user = await authenticatedUser(req),
        current = await db.announcement.findUnique({
          where: { id: String(req.params.id) },
        });
      if (!current) throw new HttpError(404, "Announcement not found");
      await canManage(user, current);
      const schema =
        method === "patch"
          ? announcementSchema.omit({ id: true }).partial()
          : announcementSchema.omit({ id: true });
      res.json(
        await db.announcement.update({
          where: { id: current.id },
          data: parse(schema, req.body),
        }),
      );
    }),
  );
announcements.delete(
  "/:id",
  requireRoles("teacher", "cr", "admin"),
  asyncRoute(async (req, res) => {
    const user = await authenticatedUser(req),
      item = await db.announcement.findUnique({
        where: { id: String(req.params.id) },
      });
    if (!item) throw new HttpError(404, "Announcement not found");
    await canManage(user, item);
    res.json(await db.announcement.delete({ where: { id: item.id } }));
  }),
);
