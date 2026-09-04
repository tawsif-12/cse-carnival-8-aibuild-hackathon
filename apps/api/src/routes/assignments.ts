import { Router } from "express";
import { assignmentSchema } from "@campus-os/contracts";
import { z } from "zod";
import {
  assignedCourseCodes,
  authenticatedUser,
  cohortWhere,
  taughtCourseCodes,
} from "../access";
import { requireRoles } from "../auth";
import { db } from "../db";
import { asyncRoute, HttpError, parse } from "../http";
export const assignments = Router();
async function own(user: { id: string; role: string }, course: string) {
  if (user.role === "admin") return null;
  const offering = await db.courseOffering.findFirst({
    where: { code: course, teacher_id: user.id },
  });
  if (!offering)
    throw new HttpError(
      403,
      "Teachers can manage assignments only for courses they teach",
    );
  return offering;
}
assignments.get(
  "/",
  requireRoles("student", "teacher", "cr", "admin"),
  asyncRoute(async (req, res) => {
    const user = await authenticatedUser(req),
      status =
        typeof req.query.status === "string" ? req.query.status : undefined,
      days =
        req.query.due_within_days === undefined
          ? undefined
          : parse(
              z.coerce.number().int().nonnegative(),
              req.query.due_within_days,
            );
    const now = new Date(),
      end = new Date(now);
    if (days !== undefined) end.setUTCDate(end.getUTCDate() + days);
    let scope: any = {};
    if (user.role === "teacher")
      scope = { course: { in: await taughtCourseCodes(user.id) } };
    else if (user.role !== "admin")
      scope = {
        ...cohortWhere(user),
        course: { in: await assignedCourseCodes(user.id) },
      };
    res.json(
      await db.assignment.findMany({
        where: {
          ...scope,
          status,
          deadline:
            days === undefined
              ? undefined
              : {
                  gte: now.toISOString().slice(0, 10),
                  lte: end.toISOString().slice(0, 10),
                },
        },
        orderBy: { deadline: "asc" },
      }),
    );
  }),
);
assignments.post(
  "/",
  requireRoles("teacher", "admin"),
  asyncRoute(async (req, res) => {
    const user = await authenticatedUser(req),
      data = parse(assignmentSchema, req.body);
    const offering = await own(user, data.course);
    res.status(201).json(
      await db.assignment.create({
        data: {
          ...data,
          teacher_id: user.role === "teacher" ? user.id : data.teacher_id,
          department: offering?.department ?? data.department,
          academic_year: offering?.academic_year ?? data.academic_year,
          semester: offering?.semester ?? data.semester,
        },
      }),
    );
  }),
);
for (const method of ["patch", "put"] as const)
  assignments[method](
    "/:id",
    requireRoles("teacher", "admin"),
    asyncRoute(async (req, res) => {
      const user = await authenticatedUser(req),
        current = await db.assignment.findUnique({
          where: { id: String(req.params.id) },
        });
      if (!current) throw new HttpError(404, "Assignment not found");
      await own(user, current.course);
      const schema =
          method === "patch"
            ? assignmentSchema.omit({ id: true }).partial()
            : assignmentSchema.omit({ id: true }),
        parsed = parse(schema, req.body),
        offering = await own(user, parsed.course ?? current.course),
        data =
          user.role === "teacher"
            ? {
                ...parsed,
                teacher_id: user.id,
                department: offering!.department,
                academic_year: offering!.academic_year,
                semester: offering!.semester,
              }
            : parsed;
      res.json(await db.assignment.update({ where: { id: current.id }, data }));
    }),
  );
assignments.delete(
  "/:id",
  requireRoles("teacher", "admin"),
  asyncRoute(async (req, res) => {
    const user = await authenticatedUser(req),
      item = await db.assignment.findUnique({
        where: { id: String(req.params.id) },
      });
    if (!item) throw new HttpError(404, "Assignment not found");
    await own(user, item.course);
    res.json(await db.assignment.delete({ where: { id: item.id } }));
  }),
);
