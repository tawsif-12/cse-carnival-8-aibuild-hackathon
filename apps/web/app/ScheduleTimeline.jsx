"use client";

import { useEffect, useMemo, useState } from "react";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";
const START_HOUR = 9;
const END_HOUR = 18;
const HOURS = Array.from({ length: END_HOUR - START_HOUR + 1 }, (_, index) => START_HOUR + index);
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const FLOOR_DEPARTMENTS = { 1: "Civil Engineering", 2: "Civil Engineering", 3: "Electrical & Electronic Engineering", 4: "Electrical & Electronic Engineering", 5: "Arts & Science", 6: "Textile Engineering", 7: "Computer Science & Engineering", 8: "Mechanical Engineering" };
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

export default function ScheduleTimeline() {
  const [schedules, setSchedules] = useState([]);
  const [rooms, setRooms] = useState([]);
  const [selectedDay, setSelectedDay] = useState(DAYS[new Date().getDay()]);
  const [floor, setFloor] = useState("all");
  const [mode, setMode] = useState("Day");
  const [filter, setFilter] = useState("");
  const [mySchedule, setMySchedule] = useState([]);
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

  useEffect(() => {
    loadData();
    try { setMySchedule(JSON.parse(window.localStorage.getItem("campusos-my-schedule") || "[]")); } catch { setMySchedule([]); }
  }, []);

  function toggleMyClass(item) {
    setMySchedule((current) => {
      const next = current.some((entry) => entry.id === item.id) ? current.filter((entry) => entry.id !== item.id) : [...current, item];
      window.localStorage.setItem("campusos-my-schedule", JSON.stringify(next));
      return next;
    });
  }

  const allRooms = rooms.length ? rooms : MOCK_ROOMS;
  const floorOptions = [...new Set(allRooms.map((room) => room.floor).filter(Boolean))].sort((a, b) => a - b);
  const visibleRooms = allRooms.filter((room) => floor === "all" || String(room.floor) === floor).sort((a, b) => a.room_number.localeCompare(b.room_number, undefined, { numeric: true }));
  const dayClasses = useMemo(() => schedules.filter((item) => item.day === selectedDay).filter((item) => {
    const needle = filter.trim().toLowerCase();
    const room = String(item.room || "").toLowerCase();
    return (!needle || item.course.toLowerCase().includes(needle) || item.instructor.toLowerCase().includes(needle) || room.includes(needle)) && visibleRooms.some((entry) => entry.room_number === item.room);
  }), [schedules, selectedDay, filter, visibleRooms]);
  const classCount = dayClasses.length;
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

  return <section className="schedulePage">
    <div className="scheduleToolbar">
      <div><span className="scheduleEyebrow">STUDENT PLANNER</span><h2>Official schedule</h2><p>Browse published classes and build your personal timetable.</p></div>
      <div className="scheduleControls"><div className="segmented">{["Day", "Week", "Month"].map((item) => <button key={item} className={mode === item ? "selected" : ""} onClick={() => setMode(item)}>{item}</button>)}</div><label className="scheduleFloor"><span>Floor</span><select value={floor} onChange={(event) => setFloor(event.target.value)}><option value="all">All floors</option>{floorOptions.map((item) => <option key={item} value={item}>Floor {item} · {FLOOR_DEPARTMENTS[item] || "General"}</option>)}</select></label><label className="scheduleFilter">⌕<input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Course, instructor, room" /></label><span className="myScheduleCount">{mySchedule.length} selected</span></div>
    </div>
    {error && <div className="scheduleError">{error}<button onClick={() => setError("")}>×</button></div>}
    <div className="scheduleNavigator"><div className="dayPicker"><button onClick={() => moveDay(-1)} aria-label="Previous day">‹</button><div><span>SELECTED DAY</span><b>{formatDay(parseDateForDay(selectedDay))}</b></div><button onClick={() => moveDay(1)} aria-label="Next day">›</button></div><div className="scheduleMeta"><span>{classCount} {classCount === 1 ? "class" : "classes"}</span><small>{visibleRooms.length} of {allRooms.length} rooms</small>{mode !== "Day" && <small>{mode} view preview</small>}</div></div>
    <div className="timelineCard">
      {loading ? <div className="scheduleLoading">Loading university rooms and classes...</div> : <div className="timelineScroller"><div className="timelineHeader"><div className="roomHeader">ROOMS <small>{visibleRooms.length} of {allRooms.length} spaces</small></div><div className="hours">{HOURS.map((hour) => <span key={hour}>{hour > 12 ? hour - 12 : hour}{hour < 12 ? " AM" : hour === 12 ? " PM" : " PM"}</span>)}</div></div>
        <div className="timelineBody">{visibleRooms.map((room) => <div className="roomRow" key={room.id}><div className="roomInfo"><b>{room.room_number}</b><small>{room.capacity} seats · {(room.equipment || []).slice(0, 2).join(" · ") || "Flexible room"}</small></div><div className="roomTrack">{HOURS.slice(0, -1).map((hour) => <i key={hour} style={{ left: `${((hour - START_HOUR) / (END_HOUR - START_HOUR)) * 100}%` }} />)}{dayClasses.filter((item) => item.room === room.room_number).map((item, index) => { const position = getTimelinePosition(item.start_time, item.end_time); const palette = colors[item.course] || coursePalette(item.course, index); const selected = mySchedule.some((entry) => entry.id === item.id); return <article key={item.id} className={`scheduleBar ${conflicts.has(item.id) ? "conflict" : ""} ${selected ? "selected" : ""}`} style={{ left: `${position.left}%`, width: `${position.width}%`, background: palette[0], borderLeftColor: palette[1], top: `${conflicts.has(item.id) ? (index % 2) * 39 + 8 : 8}px` }}><div className="barContent"><strong>{item.course}</strong><small>{item.start_time}–{item.end_time}</small><div className="barTags"><span>{item.instructor}</span><span>{item.day}</span></div></div><button className="selectClass" onClick={() => toggleMyClass(item)}>{selected ? "Added" : "+ Add"}</button>{conflicts.has(item.id) && <em className="conflictFlag">Room conflict</em>}</article> })}</div></div>)}</div>
      </div>}
    </div>
  </section>;
}
