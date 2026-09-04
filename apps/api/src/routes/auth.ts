import { randomUUID, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { Router } from "express";
import { z } from "zod";
import { createToken, getSession, roles } from "../auth";
import { db } from "../db";
import { asyncRoute, HttpError, parse } from "../http";

const scrypt = promisify(scryptCallback);
const credentials = z.object({ email: z.string().email().transform(value => value.toLowerCase()), password: z.string().min(8).max(128) });
const signup = credentials
  .extend({
    name: z.string().min(2).max(80),
    role: z.enum(["student", "teacher", "cr"]),
    department: z.string().min(2).max(30).optional(),
    academic_year: z.coerce.number().int().min(1).max(8).optional(),
    semester: z.coerce.number().int().min(1).max(3).optional(),
    section: z.string().min(1).max(10).optional(),
  })
  .superRefine((value, context) => {
    if (
      (value.role === "student" || value.role === "cr") &&
      (!value.department ||
        !value.academic_year ||
        !value.semester ||
        !value.section)
    )
      context.addIssue({
        code: "custom",
        message:
          "Department, academic year, semester, and section are required for students and class representatives",
      });
  });
export const auth = Router();
type StoredUser = { id: string; name: string; email: string; role: string; password_hash: string; department: string | null; academic_year: number | null; semester: number | null; section: string | null };

export async function hashPassword(password: string) {
  const salt = randomUUID();
  const hash = await scrypt(password, salt, 64) as Buffer;
  return `${salt}:${hash.toString("hex")}`;
}
async function verifyPassword(password: string, stored: string) {
  const [salt, expectedHex] = stored.split(":");
  if (!salt || !expectedHex) return false;
  const actual = await scrypt(password, salt, 64) as Buffer;
  const expected = Buffer.from(expectedHex, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
const publicUser = (user: StoredUser) => ({ id: user.id, name: user.name, email: user.email, role: user.role, department: user.department, academic_year: user.academic_year, semester: user.semester, section: user.section });

auth.post("/signup", asyncRoute(async (request, response) => {
  const input = parse(signup, request.body);
  const existing = await db.$queryRaw<StoredUser[]>`SELECT * FROM User WHERE email = ${input.email} LIMIT 1`;
  if (existing.length) throw new HttpError(409, "An account with this email already exists");
  const user: StoredUser = {
    id: `usr-${randomUUID()}`,
    name: input.name,
    email: input.email,
    role: input.role,
    password_hash: await hashPassword(input.password),
    department: input.department ?? null,
    academic_year: input.academic_year ?? null,
    semester: input.semester ?? null,
    section: input.section ?? null,
  };
  await db.$executeRaw`INSERT INTO User (id, name, email, password_hash, role, department, academic_year, semester, section) VALUES (${user.id}, ${user.name}, ${user.email}, ${user.password_hash}, ${user.role}, ${user.department}, ${user.academic_year}, ${user.semester}, ${user.section})`;
  response.status(201).json({ user: publicUser(user), token: createToken(user) });
}));
auth.post("/login", asyncRoute(async (request, response) => {
  const input = parse(credentials.extend({ role: z.enum(roles) }), request.body);
  const [user] = await db.$queryRaw<StoredUser[]>`SELECT * FROM User WHERE email = ${input.email} LIMIT 1`;
  if (!user || user.role !== input.role || !await verifyPassword(input.password, user.password_hash)) throw new HttpError(401, "Email, password, or role is incorrect");
  response.json({ user: publicUser(user), token: createToken(user) });
}));
auth.get("/me", asyncRoute(async (request, response) => {
  const session = getSession(request);
  const [user] = await db.$queryRaw<StoredUser[]>`SELECT * FROM User WHERE id = ${session.id} LIMIT 1`;
  if (!user) throw new HttpError(401, "Account no longer exists");
  response.json(publicUser(user));
}));
