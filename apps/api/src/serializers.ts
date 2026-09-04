import type { Booking, Event, Registration, Room } from "@prisma/client";

export function serializeRoom(room: Room & { bookings?: Booking[] }) {
  return {
    ...room,
    equipment: JSON.parse(room.equipment) as string[],
    bookings: (room.bookings ?? []).map(({ booking_id, booked_by, date, start_time, end_time, purpose }) =>
      ({ booking_id, booked_by, date, start_time, end_time, purpose })),
  };
}

export function serializeEvent(event: Event & { registrations?: Registration[] }) {
  return { ...event, registrations: (event.registrations ?? []).map(({ student_id, name }) => ({ student_id, name })) };
}
