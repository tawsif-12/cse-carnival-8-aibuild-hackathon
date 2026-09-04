import { createHmac, timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { HttpError } from "./http";

export const roles = ["admin", "teacher", "representative", "student"] as const;
export type Role = typeof roles[number];
export type Session = { id: string; name: string; email: string; role: Role; exp: number };

const secret = process.env.AUTH_SECRET ?? "campus-os-development-secret-change-me";
const encode = (value: string) => Buffer.from(value).toString("base64url");
const signature = (payload: string) => createHmac("sha256", secret).update(payload).digest("base64url");

export function createToken(user: { id: string; name: string; email: string; role: string }) {
  const role = user.role as Role;
  if (!roles.includes(role)) throw new HttpError(500, "Account has an invalid role");
  const payload = encode(JSON.stringify({ id: user.id, name: user.name, email: user.email, role, exp: Date.now() + 7 * 864e5 }));
  return `${payload}.${signature(payload)}`;
}

export function getSession(request: Request): Session {
  const token = request.header("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) throw new HttpError(401, "Please sign in to continue");
  const [payload, supplied] = token.split(".");
  if (!payload || !supplied) throw new HttpError(401, "Invalid session");
  const expected = signature(payload);
  if (supplied.length !== expected.length || !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) throw new HttpError(401, "Invalid session");
  try {
    const session = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Session;
    if (!roles.includes(session.role) || session.exp < Date.now()) throw new Error();
    return session;
  } catch { throw new HttpError(401, "Session expired or invalid"); }
}

export function getRole(request: Request): Role { return getSession(request).role; }

export function requireRoles(...allowed: Role[]) {
  return (request: Request, _response: Response, next: NextFunction) => {
    try {
      const role = getRole(request);
      if (!allowed.includes(role)) throw new HttpError(403, `The ${role} role cannot perform this action`);
      next();
    } catch (error) { next(error); }
  };
}
