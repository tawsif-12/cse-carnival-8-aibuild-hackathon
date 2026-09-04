import type { NextFunction, Request, Response } from "express";
import { ZodError, type ZodType } from "zod";

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export const asyncRoute = (handler: (request: Request, response: Response) => Promise<unknown>) =>
  (request: Request, response: Response, next: NextFunction) => { handler(request, response).catch(next); };

export function parse<T>(schema: ZodType<T>, input: unknown): T { return schema.parse(input); }

export function errorHandler(error: unknown, _request: Request, response: Response, _next: NextFunction) {
  if (error instanceof ZodError) return response.status(400).json({ error: "Validation failed", details: error.issues });
  if (error instanceof HttpError) return response.status(error.status).json({ error: error.message });
  if (typeof error === "object" && error && "status" in error && error.status === 400) return response.status(400).json({ error: "Malformed JSON body" });
  if (typeof error === "object" && error && "code" in error && error.code === "P2002") return response.status(409).json({ error: "A record with that unique value already exists" });
  if (typeof error === "object" && error && "code" in error && error.code === "P2025") return response.status(404).json({ error: "Record not found" });
  if (typeof error === "object" && error && "code" in error && error.code === "P2003") return response.status(409).json({ error: "This record is still referenced by related data" });
  console.error(error);
  return response.status(500).json({ error: "Internal server error" });
}
