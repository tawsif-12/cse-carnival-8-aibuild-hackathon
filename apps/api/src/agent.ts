import { randomUUID } from "node:crypto";
import { Router } from "express";
import OpenAI from "openai";
import { z } from "zod";
import { db } from "./db";
import { asyncRoute, HttpError, parse } from "./http";
import { serializeEvent, serializeRoom } from "./serializers";
import { requireRoles } from "./auth";
import {
  assignedCourseCodes,
  audienceWhere,
  authenticatedUser,
  cohortWhere,
  taughtCourseCodes,
} from "./access";
import type { User } from "@prisma/client";

export const agent = Router();
const chatSchema = z.object({
  message: z.string().min(1).max(4000),
  history: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().max(8000),
      }),
    )
    .max(20)
    .default([]),
});
const tools: any[] = [
  {
    type: "function",
    name: "list_schedules",
    description:
      "Read the live class schedule. Use for next-class and classes-by-day questions.",
    parameters: {
      type: "object",
      properties: {
        day: { type: ["string", "null"] },
        course: { type: ["string", "null"] },
      },
      required: ["day", "course"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    type: "function",
    name: "list_rooms",
    description:
      "Read and filter live rooms, including time-specific availability and equipment.",
    parameters: {
      type: "object",
      properties: {
        type: {
          type: ["string", "null"],
          enum: ["classroom", "lab", "seminar", null],
        },
        min_capacity: { type: ["number", "null"] },
        equipment: {
          type: ["string", "null"],
          description: "Comma-separated equipment",
        },
        date: { type: ["string", "null"] },
        start_time: { type: ["string", "null"] },
        end_time: { type: ["string", "null"] },
      },
      required: [
        "type",
        "min_capacity",
        "equipment",
        "date",
        "start_time",
        "end_time",
      ],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    type: "function",
    name: "list_events",
    description: "Read live events. Name is a fuzzy search term.",
    parameters: {
      type: "object",
      properties: {
        date: { type: ["string", "null"] },
        status: { type: ["string", "null"] },
        name: { type: ["string", "null"] },
      },
      required: ["date", "status", "name"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    type: "function",
    name: "list_announcements",
    description:
      "Read live announcements by priority, optionally including expired notices.",
    parameters: {
      type: "object",
      properties: {
        priority: {
          type: ["string", "null"],
          enum: ["high", "medium", "low", null],
        },
        include_expired: { type: "boolean" },
      },
      required: ["priority", "include_expired"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    type: "function",
    name: "list_assignments",
    description:
      "Read live assignments, optionally by status or deadline window.",
    parameters: {
      type: "object",
      properties: {
        status: {
          type: ["string", "null"],
          enum: ["pending", "submitted", "graded", "late", null],
        },
        due_within_days: { type: ["number", "null"] },
      },
      required: ["status", "due_within_days"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    type: "function",
    name: "book_room",
    description:
      "Book one specific room for the logged-in student after exact availability was verified with list_rooms.",
    parameters: {
      type: "object",
      properties: {
        room_id: { type: "string" },
        date: { type: "string" },
        start_time: { type: "string" },
        end_time: { type: "string" },
        purpose: { type: "string" },
      },
      required: ["room_id", "date", "start_time", "end_time", "purpose"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    type: "function",
    name: "register_event",
    description: "Register the logged-in user for a visible event.",
    parameters: {
      type: "object",
      properties: { event_id: { type: "string" } },
      required: ["event_id"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    type: "function",
    name: "cancel_room_booking",
    description: "Cancel one room booking owned by the logged-in user.",
    parameters: {
      type: "object",
      properties: { booking_id: { type: "string" } },
      required: ["booking_id"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    type: "function",
    name: "list_my_room_bookings",
    description: "List room bookings owned by the logged-in user, optionally on one date.",
    parameters: {
      type: "object",
      properties: { date: { type: ["string", "null"] } },
      required: ["date"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    type: "function",
    name: "cancel_event_registration",
    description: "Cancel the logged-in user's registration for one event.",
    parameters: {
      type: "object",
      properties: { event_id: { type: "string" } },
      required: ["event_id"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    type: "function",
    name: "list_my_event_registrations",
    description: "List event registrations owned by the logged-in user.",
    parameters: {
      type: "object",
      properties: {},
      required: [],
      additionalProperties: false,
    },
    strict: true,
  },
  {type:"function",name:"post_class_announcement",description:"Post a scoped course or class announcement. Available only to admins.",parameters:{type:"object",properties:{title:{type:"string"},body:{type:"string"},priority:{type:"string",enum:["high","medium","low"]},expires:{type:"string"},course_code:{type:["string","null"]},department:{type:["string","null"]},academic_year:{type:["number","null"]},semester:{type:["number","null"]}},required:["title","body","priority","expires","course_code","department","academic_year","semester"],additionalProperties:false},strict:true},
];
const toolRoles: Record<string, string[]> = {
  book_room: ["student"],
  register_event: ["student"],
  cancel_room_booking: ["student"],
  list_my_room_bookings: ["student"],
  cancel_event_registration: ["student"],
  list_my_event_registrations: ["student"],
  post_class_announcement:["admin"],
};
const toolsFor = (role: string) =>
  tools.filter((tool) => {
    const allowed = toolRoles[tool.name];
    return !allowed || allowed.includes(role);
  });
const system = (
  now: string,
  user: User,
) => `You are the CampusOS assistant, a knowledgeable campus concierge for ${user.name} (role: ${user.role}). Current campus date/time is ${now}; timezone Asia/Dhaka; university days are Sunday-Thursday.

You have tools to read and act on the university's live data: class schedules, rooms, bookings, events, event registrations, announcements, and assignments. This data changes constantly as students and admins use the dashboard, so you must always check it live.

Follow these rules exactly:

1. GROUNDING: Never state a fact about schedules, rooms, events, announcements, or assignments unless you got it from a tool call in this conversation. If you don't know, call the right tool. Do not guess or rely on earlier conversation data that might be outdated.

2. ACTIONS NEED VERIFICATION FIRST: Before booking a room, always call list_rooms to check availability for that exact date and time window. Before registering for an event, call list_events and confirm it has open capacity. Never call a booking or registration tool speculatively.

3. ASK WHEN UNCLEAR: If a request is missing information needed to act, ask ONE short, specific clarifying question. Do not guess defaults or perform an action with assumed values.

4. REFUSE WHAT ISN'T ALLOWED: Only admins can create, edit, or delete schedule entries, rooms, events, announcements, or assignments. Students can only book rooms and register for events for themselves, and can only cancel their own bookings or registrations. If authorization or validation fails, explain plainly why and do not retry or attempt a workaround.

5. COMBINE SOURCES WHEN NEEDED: Call every data source needed for multi-source questions and provide one synthesized answer, not separate raw dumps.

6. STAY CURRENT: Never invent a room number, course code, event name, record, or time that did not come from a tool result.

7. TONE: Answer like a helpful, well-informed senior student. Be direct, brief, and conversational. Lead with the answer and avoid corporate or robotic phrasing.

8. ACTION OUTCOMES: Clearly confirm what succeeded or failed. Never leave an action outcome ambiguous.

Respect the logged-in user's department, year, semester, section, course assignments, and tool permissions. Interpret relative dates from the current time above and state concrete dates for actions. Return plain text without Markdown formatting.`;

let openAI: OpenAI | undefined;
async function generateResponse(input: any[], now: string, user: User) {
  const key = process.env.OPENAI_API_KEY;
  if (!key || key === "your_key_here")
    throw new HttpError(
      503,
      "Add a valid OPENAI_API_KEY to apps/api/.env to enable the assistant",
    );
  openAI ??= new OpenAI({ apiKey: key });
  try {
    return await openAI.responses.create({
      model: process.env.OPENAI_MODEL ?? "gpt-5-mini",
      instructions: system(now, user),
      input,
      tools: toolsFor(user.role),
      max_output_tokens: 1200,
    });
  } catch (error) {
    const status =
      typeof error === "object" && error && "status" in error
        ? Number(error.status)
        : undefined;
    const message = error instanceof Error ? error.message : "AI provider request failed";
    throw new HttpError(
      status === 401 || status === 403 || status === 429 ? 503 : 502,
      status === 401 || status === 403
        ? "The configured OpenAI API key was rejected"
        : status === 429
          ? "The CampusOS assistant is temporarily busy. Please try again shortly"
          : `The CampusOS assistant could not reach its AI provider: ${message}`,
    );
  }
}

async function courseCodes(user: User) {
  return user.role === "admin"
    ? undefined
    : user.role === "teacher"
      ? taughtCourseCodes(user.id)
      : assignedCourseCodes(user.id);
}
type Verification = { rooms: Set<string>; events: Set<string> };
const roomVerificationKey = (roomId: string, date: string, start: string, end: string) => `${roomId}|${date}|${start}|${end}`;

async function execute(name: string, args: any, user: User, verified: Verification) {
  if (name === "list_schedules")
    return db.schedule.findMany({
      where: {
        ...(user.role !== "admin" && user.role !== "teacher"
          ? cohortWhere(user, true)
          : {}),
        day: args.day ?? undefined,
        course: args.course
          ? { contains: args.course }
          : (await courseCodes(user))
            ? { in: await courseCodes(user) }
            : undefined,
      },
      orderBy: [{ day: "asc" }, { start_time: "asc" }],
    });
  if (name === "list_rooms") {
    const records = await db.room.findMany({
      where: {
        type: args.type ?? undefined,
        capacity: args.min_capacity ? { gte: args.min_capacity } : undefined,
        status: "available",
        bookings:
          args.date && args.start_time && args.end_time
            ? {
                none: {
                  date: args.date,
                  start_time: { lt: args.end_time },
                  end_time: { gt: args.start_time },
                },
              }
            : undefined,
      },
      include: { bookings: true },
      orderBy: { room_number: "asc" },
    });
    const wanted = String(args.equipment ?? "")
      .split(",")
      .map((x) => x.trim().toLowerCase())
      .filter(Boolean);
    let result = records
      .map(serializeRoom)
      .filter((r) =>
        wanted.every((w) => r.equipment.some((e) => e.toLowerCase() === w)),
      );
    if (args.date && args.start_time && args.end_time) {
      const day = new Date(`${args.date}T12:00:00`).toLocaleDateString("en-US", { weekday: "long", timeZone: "Asia/Dhaka" });
      const scheduled = await db.schedule.findMany({ where: { day, start_time: { lt: args.end_time }, end_time: { gt: args.start_time } }, select: { room: true } });
      const occupiedRooms = new Set(scheduled.map((entry) => entry.room));
      result = result.filter((room) => !occupiedRooms.has(room.room_number));
      for (const room of result) verified.rooms.add(roomVerificationKey(room.id, args.date, args.start_time, args.end_time));
    }
    return result;
  }
  if (name === "book_room") {
    if (!verified.rooms.has(roomVerificationKey(args.room_id, args.date, args.start_time, args.end_time))) {
      throw new HttpError(409, "Check this room's availability for the exact date and time before booking it");
    }
    return db.$transaction(async (tx) => {
      const room = await tx.room.findUnique({ where: { id: args.room_id } });
      if (!room) throw new HttpError(404, "Room not found");
      if (room.status !== "available")
        throw new HttpError(409, "Room is unavailable");
      if (args.start_time >= args.end_time)
        throw new HttpError(400, "End time must be after start time");
      const conflict = await tx.booking.findFirst({
        where: {
          room_id: room.id,
          date: args.date,
          start_time: { lt: args.end_time },
          end_time: { gt: args.start_time },
        },
      });
      if (conflict)
        throw new HttpError(
          409,
          "That room is already booked during the requested time",
        );
      await tx.booking.create({
        data: {
          booking_id: `bk-${randomUUID()}`,
          booked_by: user.name,
          user_id: user.id,
          status: user.role === "cr" ? "requested" : "approved",
          date: args.date,
          start_time: args.start_time,
          end_time: args.end_time,
          purpose: args.purpose,
          room_id: room.id,
        },
      });
      return serializeRoom(
        await tx.room.findUniqueOrThrow({
          where: { id: room.id },
          include: { bookings: true },
        }),
      );
    });
  }
  if (name === "list_events") {
    const rows = await db.event.findMany({
      where: {
        ...(user.role !== "admin" ? audienceWhere(user) : {}),
        date: args.date ?? undefined,
        status: args.status ?? undefined,
      },
      include: { registrations: true },
      orderBy: [{ date: "asc" }, { start_time: "asc" }],
    });
    const q = String(args.name ?? "").toLowerCase();
    const result = rows
      .map(serializeEvent)
      .filter(
        (e) => !q || `${e.name} ${e.description}`.toLowerCase().includes(q),
      );
    for (const event of result) {
      if (event.registered < event.capacity && !["full", "cancelled", "completed"].includes(event.status)) verified.events.add(event.id);
    }
    return result;
  }
  if (name === "register_event") {
    if (!verified.events.has(args.event_id)) throw new HttpError(409, "Check this event's current capacity before registering");
    return db.$transaction(async (tx) => {
      const event = await tx.event.findUnique({
        where: { id: args.event_id },
        include: { registrations: true },
      });
      if (!event) throw new HttpError(404, "Event not found");
      if (event.registered >= event.capacity || event.status === "full")
        throw new HttpError(409, "Event is full");
      if (event.registrations.some((r) => r.student_id === user.id))
        throw new HttpError(409, "You are already registered");
      await tx.registration.create({
        data: {
          event_id: event.id,
          student_id: user.id,
          name: user.name,
        },
      });
      const registered = event.registered + 1;
      return serializeEvent(
        await tx.event.update({
          where: { id: event.id },
          data: {
            registered,
            status: registered >= event.capacity ? "full" : event.status,
          },
          include: { registrations: true },
        }),
      );
    });
  }
  if (name === "list_my_room_bookings") {
    return db.booking.findMany({
      where: { user_id: user.id, date: args.date ?? undefined },
      select: { booking_id: true, room_id: true, date: true, start_time: true, end_time: true, purpose: true, status: true },
      orderBy: [{ date: "asc" }, { start_time: "asc" }],
    });
  }
  if (name === "cancel_room_booking") {
    const booking = await db.booking.findUnique({ where: { booking_id: args.booking_id } });
    if (!booking) throw new HttpError(404, "Room booking not found");
    if (booking.user_id !== user.id) throw new HttpError(403, "You can cancel only your own room booking");
    await db.booking.delete({ where: { booking_id: booking.booking_id } });
    return { cancelled: true, booking_id: booking.booking_id, room_id: booking.room_id, date: booking.date, start_time: booking.start_time, end_time: booking.end_time };
  }
  if (name === "list_my_event_registrations") {
    return db.registration.findMany({
      where: { student_id: user.id },
      select: { event: { select: { id: true, name: true, date: true, start_time: true, end_time: true, venue: true, status: true } } },
      orderBy: { event: { date: "asc" } },
    });
  }
  if (name === "cancel_event_registration") {
    const registration = await db.registration.findUnique({ where: { event_id_student_id: { event_id: args.event_id, student_id: user.id } } });
    if (!registration) throw new HttpError(404, "You are not registered for that event");
    return db.$transaction(async (tx) => {
      await tx.registration.delete({ where: { id: registration.id } });
      const event = await tx.event.findUniqueOrThrow({ where: { id: args.event_id } });
      const registered = Math.max(0, event.registered - 1);
      await tx.event.update({ where: { id: event.id }, data: { registered, status: event.status === "full" ? "upcoming" : event.status } });
      return { cancelled: true, event_id: event.id, event_name: event.name };
    });
  }
  if (name === "list_announcements") {
    const today = new Date().toLocaleDateString("en-CA", {
      timeZone: "Asia/Dhaka",
    });
    const codes = (await courseCodes(user)) ?? [];
    const scope =
      user.role === "admin"
        ? {}
        : user.role === "teacher"
          ? {
              OR: [
                audienceWhere(user),
                { course: { in: codes } },
              ],
            }
          : {
              AND: [
                audienceWhere(user),
                { OR: [{ section: null }, { section: user.section }] },
                { OR: [{ course: null }, { course: { in: codes } }] },
              ],
            };
    return db.announcement.findMany({
      where: {
        ...scope,
        priority: args.priority ?? undefined,
        expires: args.include_expired ? undefined : { gte: today },
      },
      orderBy: { date: "desc" },
    });
  }
  if (name === "list_assignments") {
    const today = new Date().toLocaleDateString("en-CA", {
      timeZone: "Asia/Dhaka",
    });
    let end: string | undefined;
    if (args.due_within_days !== null) {
      const d = new Date();
      d.setDate(d.getDate() + args.due_within_days);
      end = d.toLocaleDateString("en-CA", { timeZone: "Asia/Dhaka" });
    }
    return db.assignment.findMany({
      where: {
        ...(user.role !== "admin" && user.role !== "teacher"
          ? cohortWhere(user)
          : {}),
        course: (await courseCodes(user))
          ? { in: await courseCodes(user) }
          : undefined,
        status: args.status ?? undefined,
        deadline: end ? { gte: today, lte: end } : undefined,
      },
      orderBy: { deadline: "asc" },
    });
  }
  if(name==="post_class_announcement"){
    let department:string|undefined,academic_year:number|undefined,semester:number|undefined,section:string|null=null,course_id:string|null=null;
    if(user.role==="admin"){department=args.department;academic_year=args.academic_year;semester=args.semester}
    else if(user.role==="teacher") {const course=await db.courseOffering.findFirst({where:{code:args.course_code,teacher_id:user.id}});if(!course)throw new HttpError(403,"Choose a course you teach");department=course.department;academic_year=course.academic_year;semester=course.semester;section=course.section;course_id=course.id}
    else {const cohort=cohortWhere(user,true);department=cohort.department;academic_year=cohort.academic_year;semester=cohort.semester;section=user.section;if(args.course_code){const course=await db.courseOffering.findFirst({where:{code:args.course_code,members:{some:{user_id:user.id}}}});if(!course)throw new HttpError(403,"Choose a course assigned to your class");course_id=course.id}}
    if(!department||!academic_year||!semester)throw new HttpError(400,"Department, academic year, and semester are required");
    return db.cohortAnnouncement.create({data:{id:`announcement-${randomUUID()}`,title:args.title,body:args.body,priority:args.priority,expires:args.expires,department,academic_year,semester,section,course_id,author_id:user.id,author_name:user.name}})
  }
  throw new HttpError(400, `Unknown tool: ${name}`);
}

agent.post(
  "/chat",
  requireRoles("student", "teacher", "cr", "admin"),
  asyncRoute(async (req, res) => {
    const user = await authenticatedUser(req),
      input = parse(chatSchema, req.body),
      now = new Intl.DateTimeFormat("en-US", {
        timeZone: "Asia/Dhaka",
        dateStyle: "full",
        timeStyle: "short",
      }).format(new Date());
    const conversation: any[] = [
      ...input.history.map((item) => ({
        role: item.role,
        content: item.content,
      })),
      { role: "user", content: input.message },
    ];
    const used: string[] = [];
    const verified: Verification = { rooms: new Set(), events: new Set() };
    let response = await generateResponse(conversation, now, user);
    for (let turn = 0; turn < 8; turn++) {
      conversation.push(...response.output);
      const calls = response.output.filter(
        (item): item is Extract<(typeof response.output)[number], { type: "function_call" }> =>
          item.type === "function_call",
      );
      if (!calls.length) break;
      for (const call of calls) {
        used.push(call.name);
        let output: Record<string, unknown>;
        try {
          if (!toolsFor(user.role).some((tool) => tool.name === call.name))
            throw new HttpError(403, "This tool is not available to your role");
          const args = JSON.parse(call.arguments || "{}") as Record<string, unknown>;
          output = { result: await execute(call.name, args, user, verified) };
        } catch (error) {
          output = {
            error: error instanceof Error ? error.message : "Tool failed",
          };
        }
        conversation.push({
          type: "function_call_output",
          call_id: call.call_id,
          output: JSON.stringify(output),
        });
      }
      response = await generateResponse(conversation, now, user);
    }
    const message = response.output_text.trim();
    res.json({
      message: message || "I couldn't complete that request.",
      tools_used: [...new Set(used)],
    });
  }),
);
