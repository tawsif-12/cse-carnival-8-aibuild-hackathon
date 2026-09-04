import { z } from "zod";

const id = z.string().min(1);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM");

export const scheduleSchema = z.object({
  id,
  course: z.string().min(1),
  title: z.string().min(1),
  day: z.enum(["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday"]),
  start_time: time,
  end_time: time,
  room: z.string().min(1),
  instructor: z.string().min(1),
  section: z.string().min(1),
  department: z.string().nullable().optional(),
  academic_year: z.number().int().nullable().optional(),
  semester: z.number().int().nullable().optional(),
  teacher_id: z.string().nullable().optional(),
});
export const bookingSchema = z.object({
  booking_id: id,
  booked_by: z.string().min(1),
  date,
  start_time: time,
  end_time: time,
  purpose: z.string().min(1),
});
export const roomSchema = z.object({
  id,
  room_number: z.string().min(1),
  type: z.enum(["classroom", "lab", "seminar"]),
  capacity: z.number().int().positive(),
  equipment: z.array(z.string()),
  floor: z.number().int(),
  status: z.enum(["available", "unavailable"]),
  bookings: z.array(bookingSchema),
});
export const registrationSchema = z.object({
  student_id: id,
  name: z.string().min(1),
});
export const eventSchema = z.object({
  id,
  name: z.string().min(1),
  description: z.string(),
  date,
  start_time: time,
  end_time: time,
  end_date: date,
  venue: z.string().min(1),
  organizer: z.string().min(1),
  capacity: z.number().int().positive(),
  registered: z.number().int().nonnegative(),
  registrations: z.array(registrationSchema),
  status: z.enum(["upcoming", "ongoing", "completed", "cancelled", "full"]),
  department: z.string().nullable().optional(),
  academic_year: z.number().int().nullable().optional(),
  semester: z.number().int().nullable().optional(),
});
export const announcementSchema = z.object({
  id,
  title: z.string().min(1),
  body: z.string().min(1),
  date,
  priority: z.enum(["high", "medium", "low"]),
  posted_by: z.string().min(1),
  expires: date,
  department: z.string().nullable().optional(),
  academic_year: z.number().int().nullable().optional(),
  semester: z.number().int().nullable().optional(),
  section: z.string().nullable().optional(),
  course: z.string().nullable().optional(),
  author_id: z.string().nullable().optional(),
});
export const assignmentSchema = z.object({
  id,
  course: z.string().min(1),
  course_title: z.string().min(1),
  title: z.string().min(1),
  description: z.string(),
  assigned_date: date,
  deadline: date,
  submission_platform: z.string().min(1),
  status: z.enum(["pending", "submitted", "graded", "late"]),
  marks: z.number().nonnegative(),
  department: z.string().nullable().optional(),
  academic_year: z.number().int().nullable().optional(),
  semester: z.number().int().nullable().optional(),
  teacher_id: z.string().nullable().optional(),
});

export type Schedule = z.infer<typeof scheduleSchema>;
export type Booking = z.infer<typeof bookingSchema>;
export type Room = z.infer<typeof roomSchema>;
export type Registration = z.infer<typeof registrationSchema>;
export type Event = z.infer<typeof eventSchema>;
export type Announcement = z.infer<typeof announcementSchema>;
export type Assignment = z.infer<typeof assignmentSchema>;
