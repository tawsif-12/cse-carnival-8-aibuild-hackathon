import { randomUUID } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { requireRoles } from "../auth";
import { authenticatedUser } from "../access";
import { db } from "../db";
import { asyncRoute, HttpError, parse } from "../http";
import { hashPassword } from "./auth";

export const portal = Router();
const courseInclude = {
  teacher: { select: { id: true, name: true, email: true } },
  lectures: { orderBy: { created_at: "desc" as const } },
  _count: { select: { members: true } },
};

portal.get(
  "/dashboard",
  asyncRoute(async (request, response) => {
    const user = await authenticatedUser(request);
    const today = new Date().toISOString().slice(0, 10);
    const cohort =
      user.department && user.academic_year && user.semester
        ? {
            department: user.department,
            academic_year: user.academic_year,
            semester: user.semester,
          }
        : null;
    const courseWhere =
      user.role === "admin"
        ? {}
        : user.role === "teacher"
          ? { teacher_id: user.id }
          : { members: { some: { user_id: user.id } } };
    const announcementWhere =
      user.role === "admin"
        ? {}
        : user.role === "teacher"
          ? { expires:{gte:today}, course:{teacher_id:user.id} }
        : cohort
          ? {
              ...cohort,
              expires: { gte: today },
              AND: [
                { OR: [{ section: null }, { section: user.section }] },
                {
                  OR: [
                    { course_id: null },
                    { course: { members: { some: { user_id: user.id } } } },
                  ],
                },
              ],
            }
          : { id: "__none__" };
    const [courses, announcements, eventCount, userCount] = await Promise.all([
      db.courseOffering.findMany({
        where: courseWhere,
        include: courseInclude,
        orderBy: { code: "asc" },
      }),
      db.cohortAnnouncement.findMany({
        where: announcementWhere,
        include: { course: { select: { code: true, title: true } } },
        orderBy: { created_at: "desc" },
      }),
      db.event.count({
        where: { status: { notIn: ["cancelled", "completed"] } },
      }),
      user.role === "admin" ? db.user.count() : Promise.resolve(0),
    ]);
    response.json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        department: user.department,
        academic_year: user.academic_year,
        semester: user.semester,
        section: user.section,
      },
      courses,
      announcements,
      metrics: {
        courses: courses.length,
        announcements: announcements.length,
        university_events: eventCount,
        users: userCount,
      },
    });
  }),
);

portal.post(
  "/courses",
  requireRoles("admin"),
  asyncRoute(async (request, response) => {
    const input = parse(
      z.object({
        code: z.string().min(2),
        title: z.string().min(2),
        department: z.string().min(2),
        academic_year: z.coerce.number().int().min(1).max(8),
        semester: z.coerce.number().int().min(1).max(3),
        section: z.string().min(1),
        teacher_id: z.string().nullable().optional(),
      }),
      request.body,
    );
    response.status(201).json(
      await db.courseOffering.create({
        data: { id: `course-${randomUUID()}`, ...input },
        include: courseInclude,
      }),
    );
  }),
);

portal.post(
  "/courses/:id/members",
  requireRoles("admin"),
  asyncRoute(async (request, response) => {
    const input = parse(z.object({ user_id: z.string() }), request.body);
    const course = await db.courseOffering.findUnique({
      where: { id: String(request.params.id) },
    });
    const member = await db.user.findUnique({ where: { id: input.user_id } });
    if (!course || !member)
      throw new HttpError(404, "Course or user not found");
    if (
      member.department !== course.department ||
      member.academic_year !== course.academic_year ||
      member.semester !== course.semester ||
      member.section !== course.section
    )
      throw new HttpError(
        409,
        "The user must belong to the course department, year, semester, and section",
      );
    response.status(201).json(
      await db.courseMember.upsert({
        where: {
          user_id_course_id: { user_id: member.id, course_id: course.id },
        },
        update: {},
        create: { user_id: member.id, course_id: course.id },
      }),
    );
  }),
);

portal.post(
  "/courses/:id/lectures",
  requireRoles("teacher", "admin"),
  asyncRoute(async (request, response) => {
    const user = await authenticatedUser(request);
    const course = await db.courseOffering.findUnique({
      where: { id: String(request.params.id) },
    });
    if (!course) throw new HttpError(404, "Course not found");
    if (user.role === "teacher" && course.teacher_id !== user.id)
      throw new HttpError(
        403,
        "Teachers can upload only to courses assigned to them",
      );
    if (!course.teacher_id)
      throw new HttpError(
        409,
        "Assign a teacher before uploading lecture content",
      );
    const input = parse(
      z.object({
        title: z.string().min(1),
        description: z.string().default(""),
        content_url: z.string().url(),
      }),
      request.body,
    );
    response.status(201).json(
      await db.courseLecture.create({
        data: {
          id: `lecture-${randomUUID()}`,
          course_id: course.id,
          teacher_id: course.teacher_id,
          ...input,
        },
      }),
    );
  }),
);

portal.post(
  "/announcements",
  requireRoles("teacher", "cr", "admin"),
  asyncRoute(async (request, response) => {
    const user = await authenticatedUser(request);
    const input = parse(
      z.object({
        title: z.string().min(1),
        body: z.string().min(1),
        priority: z.enum(["high", "medium", "low"]),
        expires: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        course_id: z.string().nullable().optional(),
        department: z.string().optional(),
        academic_year: z.coerce.number().int().optional(),
        semester: z.coerce.number().int().optional(),
      }),
      request.body,
    );
    const selectedCourse=input.course_id?await db.courseOffering.findUnique({where:{id:input.course_id},include:{members:true}}):null;
    if(user.role==="teacher"&&(!selectedCourse||selectedCourse.teacher_id!==user.id))throw new HttpError(403,"Teachers can announce only for courses they teach");
    const department = user.role === "admin" ? input.department : user.role==="teacher"?selectedCourse!.department:user.department;
    const academic_year = user.role === "admin" ? input.academic_year : user.role==="teacher"?selectedCourse!.academic_year:user.academic_year;
    const semester = user.role === "admin" ? input.semester : user.role==="teacher"?selectedCourse!.semester:user.semester;
    if (!department || !academic_year || !semester)
      throw new HttpError(
        400,
        "A department, academic year, and semester are required",
      );
    if (input.course_id) {
      const course = selectedCourse;
      if (
        !course ||
        course.department !== department ||
        course.academic_year !== academic_year ||
        course.semester !== semester
      )
        throw new HttpError(403, "The selected course is outside your cohort");
      if (
        user.role === "cr" &&
        !course.members.some((member) => member.user_id === user.id)
      )
        throw new HttpError(
          403,
          "CRs can announce only for their assigned courses",
        );
    }
    response.status(201).json(
      await db.cohortAnnouncement.create({
        data: {
          id: `announcement-${randomUUID()}`,
          title: input.title,
          body: input.body,
          priority: input.priority,
          expires: input.expires,
          course_id: input.course_id,
          section: user.role === "cr" ? user.section : user.role==="teacher"?selectedCourse!.section:null,
          department,
          academic_year,
          semester,
          author_id: user.id,
          author_name: user.name,
        },
      }),
    );
  }),
);

for(const method of ["patch","delete"] as const)portal[method]("/announcements/:id",requireRoles("teacher","cr","admin"),asyncRoute(async(request,response)=>{const user=await authenticatedUser(request),item=await db.cohortAnnouncement.findUnique({where:{id:String(request.params.id)}});if(!item)throw new HttpError(404,"Announcement not found");if(user.role!=="admin"&&item.author_id!==user.id)throw new HttpError(403,"You may manage only announcements you posted");if(method==="delete")return response.json(await db.cohortAnnouncement.delete({where:{id:item.id}}));const data=parse(z.object({title:z.string().min(1),body:z.string().min(1),priority:z.enum(["high","medium","low"]),expires:z.string().regex(/^\d{4}-\d{2}-\d{2}$/)}).partial(),request.body);response.json(await db.cohortAnnouncement.update({where:{id:item.id},data}))}));

portal.get(
  "/users",
  requireRoles("admin"),
  asyncRoute(async (_request, response) =>
    response.json(
      await db.user.findMany({
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          department: true,
          academic_year: true,
          semester: true,
          section: true,
        },
        orderBy: { name: "asc" },
      }),
    ),
  ),
);

const userInput = z.object({
  name: z.string().min(2),
  email: z
    .string()
    .email()
    .transform((value) => value.toLowerCase()),
  role: z.enum(["student", "teacher", "cr", "admin"]),
  department: z.string().nullable().optional(),
  academic_year: z.coerce.number().int().min(1).max(8).nullable().optional(),
  semester: z.coerce.number().int().min(1).max(3).nullable().optional(),
  section: z.string().nullable().optional(),
});
portal.post(
  "/users",
  requireRoles("admin"),
  asyncRoute(async (req, res) => {
    const input = parse(
        userInput.extend({ password: z.string().min(8) }),
        req.body,
      ),
      { password, ...profile } = input;
    res.status(201).json(
      await db.user.create({
        data: {
          id: `usr-${randomUUID()}`,
          ...profile,
          password_hash: await hashPassword(password),
        },
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          department: true,
          academic_year: true,
          semester: true,
          section: true,
        },
      }),
    );
  }),
);
portal.patch(
  "/users/:id",
  requireRoles("admin"),
  asyncRoute(async (req, res) => {
    const data = parse(
        userInput.partial().extend({ password: z.string().min(8).optional() }),
        req.body,
      ),
      { password, ...profile } = data;
    res.json(
      await db.user.update({
        where: { id: String(req.params.id) },
        data: {
          ...profile,
          password_hash: password ? await hashPassword(password) : undefined,
        },
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          department: true,
          academic_year: true,
          semester: true,
          section: true,
        },
      }),
    );
  }),
);
portal.delete(
  "/users/:id",
  requireRoles("admin"),
  asyncRoute(async (req, res) => {
    const user = await authenticatedUser(req),
      id = String(req.params.id);
    if (id === user.id)
      throw new HttpError(409, "Admins cannot delete their own active account");
    res.json(
      await db.user.delete({
        where: { id },
        select: { id: true, email: true },
      }),
    );
  }),
);
portal.patch(
  "/courses/:id",
  requireRoles("admin"),
  asyncRoute(async (req, res) => {
    const data = parse(
      z
        .object({
          code: z.string().min(2),
          title: z.string().min(2),
          department: z.string().min(2),
          academic_year: z.coerce.number().int(),
          semester: z.coerce.number().int(),
          section: z.string().min(1),
          teacher_id: z.string().nullable(),
        })
        .partial(),
      req.body,
    );
    res.json(
      await db.courseOffering.update({
        where: { id: String(req.params.id) },
        data,
        include: courseInclude,
      }),
    );
  }),
);
portal.delete(
  "/courses/:id",
  requireRoles("admin"),
  asyncRoute(async (req, res) =>
    res.json(
      await db.courseOffering.delete({ where: { id: String(req.params.id) } }),
    ),
  ),
);
portal.delete(
  "/courses/:id/members/:userId",
  requireRoles("admin"),
  asyncRoute(async (req, res) =>
    res.json(
      await db.courseMember.delete({
        where: {
          user_id_course_id: {
            course_id: String(req.params.id),
            user_id: String(req.params.userId),
          },
        },
      }),
    ),
  ),
);
