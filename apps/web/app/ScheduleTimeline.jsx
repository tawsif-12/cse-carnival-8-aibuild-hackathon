"use client";

import { useEffect, useMemo, useState } from "react";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";
const START_HOUR = 9;
const END_HOUR = 18;
const HOURS = Array.from({ length: END_HOUR - START_HOUR + 1 }, (_, index) => START_HOUR + index);
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const COURSE_COLORS = {
  CSE: ["#dcecff", "#2d73d5"],
  EEE: ["#ece5ff", "#7959c7"],
  BBA: ["#ffe5ee", "#d65b83"],
  TEX: ["#dff7eb", "#2b9b68"],
  CE: ["#fff0d6", "#bc7a18"],
  ENG: ["#dff4f5", "#208f98"],
};
const MOCK_ROOMS = [
  { id: "mock-302", room_number: "302", capacity: 42, equipment: ["Projector", "Whiteboard"] },
  { id: "mock-303", room_number: "303", capacity: 36, equipment: ["Projector"] },
  { id: "mock-401", room_number: "401", capacity: 60, equipment: ["Lab", "Computers"] },
  { id: "mock-402", room_number: "402", capacity: 28, equipment: ["Whiteboard"] },
  { id: "mock-501", room_number: "501", capacity: 80, equipment: ["Projector", "Audio"] },
];
export const MOCK_SCHEDULE = [
  { id: "mock-1", course: "CSE 2201", title: "Data Structures", day: "Monday", start_time: "09:00", end_time: "10:30", room: "302", instructor: "Dr. N. Rahman", section: "A" },
  { id: "mock-2", course: "EEE 2103", title: "Circuit Theory", day: "Monday", start_time: "11:00", end_time: "12:30", room: "303", instructor: "Prof. S. Ahmed", section: "B" },
  { id: "mock-3", course: "BBA 3102", title: "Consumer Behaviour", day: "Monday", start_time: "13:00", end_time: "14:30", room: "401", instructor: "M. Islam", section: "A" },
  { id: "mock-4", course: "TEX 2205", title: "Fabric Science", day: "Monday", start_time: "14:00", end_time: "16:00", room: "402", instructor: "F. Karim", section: "A" },
  { id: "mock-5", course: "CSE 2305", title: "Operating Systems", day: "Monday", start_time: "15:00", end_time: "17:00", room: "302", instructor: "Dr. T. Hossain", section: "B" },
  { id: "mock-6", course: "CSE 3107", title: "Computer Networks", day: "Tuesday", start_time: "10:00", end_time: "12:00", room: "501", instructor: "S. Jahan", section: "A" },
  { id: "mock-7", course: "EEE 3101", title: "Digital Signal Processing", day: "Tuesday", start_time: "13:30", end_time: "15:00", room: "401", instructor: "R. Chowdhury", section: "A" },
  { id: "mock-8", course: "BBA 2101", title: "Business Mathematics", day: "Wednesday", start_time: "09:30", end_time: "11:00", room: "303", instructor: "N. Sultana", section: "C" },
];

function request(path, options) {
  return fetch(`${API}${path}`, { ...options, headers: { "Content-Type": "application/json", ...(options?.headers || {}) } }).then(async (response) => {
    const body = await response.json().catch(() => null);
    if (!response.ok) throw new Error(body?.error || "Request failed");
    return body;
  });
}

function timeToMinutes(value) {
  if (!value) return 0;
  const normalized = value.trim().toUpperCase();
  const twelveHour = normalized.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/);
  if (twelveHour) {
    let hours = Number(twelveHour[1]) % 12;
    if (twelveHour[3] === "PM") hours += 12;
    return hours * 60 + Number(twelveHour[2]);
  }
  const twentyFourHour = normalized.match(/^(\d{1,2}):(\d{2})$/);
  return twentyFourHour ? Number(twentyFourHour[1]) * 60 + Number(twentyFourHour[2]) : 0;
}

export function getTimelinePosition(start, end) {
  const visibleStart = START_HOUR * 60;
  const visibleDuration = (END_HOUR - START_HOUR) * 60;
  const left = ((timeToMinutes(start) - visibleStart) / visibleDuration) * 100;
  const right = ((timeToMinutes(end) - visibleStart) / visibleDuration) * 100;
  return { left: Math.max(0, Math.min(100, left)), width: Math.max(1.5, Math.min(100 - Math.max(0, left), right - left)) };
}

function coursePalette(course, index) {
  const prefix = String(course || "").split(/[ -]/)[0].toUpperCase();
  if (COURSE_COLORS[prefix]) return COURSE_COLORS[prefix];
  const fallbacks = [["#e6edff", "#5275c7"], ["#f9e5d7", "#c06a3c"], ["#e3f1e8", "#438568"], ["#f1e6f5", "#9866a7"]];
  return fallbacks[index % fallbacks.length];
}

function formatDay(date) {
  return date.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
}

function parseDateForDay(day) {
  const date = new Date();
  const current = date.getDay();
  const target = DAYS.indexOf(day);
  date.setDate(date.getDate() + target - current);
  return date;
}

const emptyClass = { course: "", day: "Monday", start_time: "09:00", end_time: "10:00", room: "", instructor: "" };

export default function ScheduleTimeline() {
  const [schedules, setSchedules] = useState([]);
  const [rooms, setRooms] = useState([]);
  const [selectedDay, setSelectedDay] = useState(DAYS[new Date().getDay()]);
  const [mode, setMode] = useState("Day");
  const [filter, setFilter] = useState("");
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState(emptyClass);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [usingMock, setUsingMock] = useState(false);

  async function loadData() {
    setLoading(true);
    try {
      const [scheduleData, roomData] = await Promise.all([request("/schedules"), request("/rooms")]);
      setSchedules(scheduleData);
      setRooms(roomData);
      setUsingMock(false);
      setError("");
    } catch (loadError) {
      setSchedules(MOCK_SCHEDULE);
      setRooms(MOCK_ROOMS);
      setUsingMock(true);
      setError(`Live schedule unavailable: ${loadError.message}. Showing preview data.`);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadData(); }, []);

  const visibleRooms = rooms.length ? rooms : MOCK_ROOMS;
  const dayClasses = useMemo(() => schedules.filter((item) => item.day === selectedDay).filter((item) => {
    const needle = filter.trim().toLowerCase();
    return !needle || item.course.toLowerCase().includes(needle) || item.instructor.toLowerCase().includes(needle);
  }), [schedules, selectedDay, filter]);
  const classCount = schedules.filter((item) => item.day === selectedDay).length;
  const colors = useMemo(() => Object.fromEntries([...new Set(schedules.map((item) => item.course))].map((course, index) => [course, coursePalette(course, index)])), [schedules]);
  const conflicts = useMemo(() => {
    const grouped = {};
    dayClasses.forEach((item) => { grouped[item.room] = [...(grouped[item.room] || []), item]; });
    const overlapping = Object.values(grouped).flatMap((items) => items.filter((item, index) => {
      return items.some((other, otherIndex) => index !== otherIndex && timeToMinutes(item.start_time) < timeToMinutes(other.end_time) && timeToMinutes(item.end_time) > timeToMinutes(other.start_time));
    }));
    return new Set(overlapping.map((item) => item.id));
  }, [dayClasses]);

  function moveDay(amount) {
    const next = (DAYS.indexOf(selectedDay) + amount + DAYS.length) % DAYS.length;
    setSelectedDay(DAYS[next]);
  }

  function openAdd() {
    setForm({ ...emptyClass, day: selectedDay, room: visibleRooms[0]?.room_number || "" });
    setModal("add");
  }

  function openEdit(item) {
    setForm({ ...item });
    setModal(item);
  }

  async function saveClass(event) {
    event.preventDefault();
    const isEdit = modal !== "add";
    const payload = { ...form, title: form.course, section: form.section || "A" };
    try {
      if (usingMock) throw new Error("Connect the API to edit preview data.");
      await request(isEdit ? `/schedules/${modal.id}` : "/schedules", { method: isEdit ? "PATCH" : "POST", body: JSON.stringify(isEdit ? payload : { ...payload, id: `schedule-${Date.now()}` }) });
      await loadData();
      setModal(null);
    } catch (saveError) { setError(saveError.message); }
  }

  async function deleteClass(item) {
    setSchedules((current) => current.filter((entry) => entry.id !== item.id));
    try {
      if (usingMock) throw new Error("Connect the API to delete preview data.");
      await request(`/schedules/${item.id}`, { method: "DELETE" });
      await loadData();
    } catch (deleteError) { setError(deleteError.message); await loadData(); }
  }

  return <section className="schedulePage">
    <div className="scheduleToolbar">
      <div><span className="scheduleEyebrow">CAMPUS PLANNER</span><h2>Schedule</h2><p>See every room at a glance and keep the day moving.</p></div>
      <div className="scheduleControls"><div className="segmented">{["Day", "Week", "Month"].map((item) => <button key={item} className={mode === item ? "selected" : ""} onClick={() => setMode(item)}>{item}</button>)}</div><label className="scheduleFilter">⌕<input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Filter course or instructor" /></label><button className="addClass" onClick={openAdd}>+ <span>Add Class</span></button></div>
    </div>
    {error && <div className="scheduleError">{error}<button onClick={() => setError("")}>×</button></div>}
    <div className="scheduleNavigator"><div className="dayPicker"><button onClick={() => moveDay(-1)} aria-label="Previous day">‹</button><div><span>SELECTED DAY</span><b>{formatDay(parseDateForDay(selectedDay))}</b></div><button onClick={() => moveDay(1)} aria-label="Next day">›</button></div><div className="scheduleMeta"><span>{classCount} {classCount === 1 ? "class" : "classes"}</span>{mode !== "Day" && <small>{mode} view preview</small>}</div></div>
    <div className="timelineCard">
      {loading ? <div className="scheduleLoading">Loading rooms and classes...</div> : <div className="timelineScroller"><div className="timelineHeader"><div className="roomHeader">ROOMS <small>{visibleRooms.length} spaces</small></div><div className="hours">{HOURS.map((hour) => <span key={hour}>{hour > 12 ? hour - 12 : hour}{hour < 12 ? " AM" : hour === 12 ? " PM" : " PM"}</span>)}</div></div>
        <div className="timelineBody">{visibleRooms.map((room) => <div className="roomRow" key={room.id}><div className="roomInfo"><b>{room.room_number}</b><small>{room.capacity} seats · {(room.equipment || []).slice(0, 2).join(" · ") || "Flexible room"}</small></div><div className="roomTrack">{HOURS.slice(0, -1).map((hour) => <i key={hour} style={{ left: `${((hour - START_HOUR) / (END_HOUR - START_HOUR)) * 100}%` }} />)}{dayClasses.filter((item) => item.room === room.room_number).map((item, index) => { const position = getTimelinePosition(item.start_time, item.end_time); const palette = colors[item.course] || coursePalette(item.course, index); return <article key={item.id} className={`scheduleBar ${conflicts.has(item.id) ? "conflict" : ""}`} style={{ left: `${position.left}%`, width: `${position.width}%`, background: palette[0], borderLeftColor: palette[1], top: `${conflicts.has(item.id) ? (index % 2) * 39 + 8 : 8}px` }}><div className="barContent"><strong>{item.course}</strong><small>{item.start_time}–{item.end_time}</small><div className="barTags"><span>{item.instructor}</span><span>{item.day}</span></div></div><div className="barActions"><button onClick={() => openEdit(item)}>Edit</button><button onClick={() => deleteClass(item)} aria-label={`Delete ${item.course}`}>×</button></div>{conflicts.has(item.id) && <em className="conflictFlag">Conflict</em>}</article> })}</div></div>)}</div>
      </div>}
    </div>
    {modal && <div className="scheduleBackdrop" onMouseDown={(event) => event.target === event.currentTarget && setModal(null)}><form className="scheduleModal" onSubmit={saveClass}><div className="scheduleModalHead"><div><span>{modal === "add" ? "NEW CLASS" : "EDIT CLASS"}</span><h3>{modal === "add" ? "Add to the timetable" : "Update class"}</h3></div><button type="button" onClick={() => setModal(null)}>×</button></div><div className="scheduleFormGrid"><label>Course code<input required value={form.course} onChange={(event) => setForm({ ...form, course: event.target.value })} placeholder="CSE 2201" /></label><label>Instructor<input required value={form.instructor} onChange={(event) => setForm({ ...form, instructor: event.target.value })} placeholder="Instructor name" /></label><label>Day<select value={form.day} onChange={(event) => setForm({ ...form, day: event.target.value })}>{DAYS.map((day) => <option key={day}>{day}</option>)}</select></label><label>Room<select required value={form.room} onChange={(event) => setForm({ ...form, room: event.target.value })}>{visibleRooms.map((room) => <option key={room.id} value={room.room_number}>{room.room_number}</option>)}</select></label><label>Start time<input required type="time" value={form.start_time} onChange={(event) => setForm({ ...form, start_time: event.target.value })} /></label><label>End time<input required type="time" value={form.end_time} onChange={(event) => setForm({ ...form, end_time: event.target.value })} /></label></div><div className="scheduleModalActions"><button type="button" onClick={() => setModal(null)}>Cancel</button><button className="addClass">{modal === "add" ? "Add class" : "Save changes"}</button></div></form></div>}
  </section>;
}
