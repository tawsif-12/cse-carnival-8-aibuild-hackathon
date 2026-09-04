import type { Request } from "express";
import { getSession } from "./auth";
import { db } from "./db";
import { HttpError } from "./http";

export async function authenticatedUser(request: Request) {
  const session = getSession(request);
  const user = await db.user.findUnique({ where: { id: session.id } });
  if (!user) throw new HttpError(401, "Account no longer exists");
  if (user.role !== session.role) throw new HttpError(401, "Your role changed; please sign in again");
  return user;
}

export function cohortWhere(user: { department: string | null; academic_year: number | null; semester: number | null; section?: string | null }, includeSection = false) {
  if (!user.department || !user.academic_year || !user.semester) throw new HttpError(403, "Your account needs department, year, and semester assignments");
  return { department: user.department, academic_year: user.academic_year, semester: user.semester, ...(includeSection && user.section ? { section: user.section } : {}) };
}

export async function taughtCourseCodes(userId: string) {
  return (await db.courseOffering.findMany({ where: { teacher_id: userId }, select: { code: true } })).map(course => course.code);
}

export async function assignedCourseCodes(userId: string) {
  return (await db.courseMember.findMany({ where: { user_id: userId }, select: { course: { select: { code: true } } } })).map(member => member.course.code);
}

export function audienceWhere(user: {
  department: string | null;
  academic_year: number | null;
  semester: number | null;
}) {
  return {
    AND: [
      user.department
        ? { OR: [{ department: null }, { department: user.department }] }
        : { department: null },
      user.academic_year
        ? {
            OR: [
              { academic_year: null },
              { academic_year: user.academic_year },
            ],
          }
        : { academic_year: null },
      user.semester
        ? { OR: [{ semester: null }, { semester: user.semester }] }
        : { semester: null },
    ],
  };
}
