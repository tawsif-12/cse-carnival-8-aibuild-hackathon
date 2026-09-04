"use client";
import { useEffect, useState, type FormEvent } from "react";
import type { Role } from "./sections";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
type Lecture = {
  id: string;
  title: string;
  description: string;
  content_url: string;
  created_at: string;
};
type Course = {
  id: string;
  code: string;
  title: string;
  department: string;
  academic_year: number;
  semester: number;
  section:string;
  teacher: { id: string; name: string } | null;
  lectures: Lecture[];
  members: {
    user: { id: string; name: string; email: string; role: Role };
  }[];
  _count: { members: number };
};
type Notice = {
  id: string;
  title: string;
  body: string;
  priority: string;
  expires: string;
  author_name: string;
  course: { code: string; title: string } | null;
};
type PortalData = {
  user: {
    name: string;
    role: Role;
    department: string | null;
    academic_year: number | null;
    semester: number | null;
    section: string | null;
  };
  courses: Course[];
  announcements: Notice[];
  metrics: {
    courses: number;
    announcements: number;
    university_events: number;
    users: number;
  };
};
type ManagedUser = {
  id: string;
  name: string;
  email: string;
  role: Role;
  department: string | null;
  academic_year: number | null;
  semester: number | null;
  section: string | null;
};
async function request<T>(path: string, options?: RequestInit) {
  const token = localStorage.getItem("campus_token");
  const response = await fetch(API + path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...options?.headers,
    },
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? "Request failed");
  return body as T;
}

export default function CohortDashboard({
  role,
  notify,
}: {
  role: Role;
  notify(message: string): void;
}) {
  const [data, setData] = useState<PortalData | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [users, setUsers] = useState<ManagedUser[]>([]),
    [userEditor, setUserEditor] = useState(false),
    [courseEditor, setCourseEditor] = useState<Course | "new" | null>(null),
    [courseSearch, setCourseSearch] = useState(""),
    [memberByCourse, setMemberByCourse] = useState<Record<string, string>>({}),
    [lectureCourse, setLectureCourse] = useState<Course | null>(null),
    [announcement, setAnnouncement] = useState(false);
  async function load() {
    try {
      const dashboard = await request<PortalData>("/portal/dashboard");
      setData(dashboard);
      if (role === "admin")
        setUsers(await request<ManagedUser[]>("/portal/users"));
      setError("");
    } catch (reason) {
      setError((reason as Error).message);
    }
  }
  useEffect(() => {
    document.body.dataset.campusRole = role;
    void load();
  }, [role]);
  if (error) return <div className="sectionError">! {error}</div>;
  if (!data)
    return (
      <div className="loading">
        <span />
        <p>Loading your secure dashboard…</p>
      </div>
    );
  const cohort = data.user.department
    ? `${data.user.department} · Year ${data.user.academic_year} · Semester ${data.user.semester} · Section ${data.user.section ?? "-"}`
    : "University-wide access";
  const visibleCourses = data.courses.filter((course) => {
    const query = courseSearch.trim().toLowerCase();
    return (
      !query ||
      `${course.code} ${course.title} ${course.department} ${course.teacher?.name ?? "unassigned"}`
        .toLowerCase()
        .includes(query)
    );
  });
  return (
    <div className="cohortDashboard">
      <div className="roleHero">
        <div>
          <small>
            {role === "student"
              ? "MY SEMESTER"
              : role === "teacher"
                ? "MY COURSES"
                : role === "cr"
                  ? "CLASS CONTROL"
                  : "ADMIN CONTROL ROOM"}
          </small>
          <h2>{data.user.name}</h2>
          <p>{cohort}</p>
        </div>
        <div className="roleMetrics">
          <span>
            <b>{data.metrics.courses}</b>Courses
          </span>
          <span>
            <b>{data.metrics.announcements}</b>Notices
          </span>
          <span>
            <b>{data.metrics.university_events}</b>University events
          </span>
          {role === "admin" && (
            <span>
              <b>{data.metrics.users}</b>Users
            </span>
          )}
        </div>
      </div>
      {role === "admin" && (
        <div className="roleNotice">
          Admin controls university-wide events from the Events section. Course
          creation, teacher assignment, and student enrollment are protected by
          admin-only API endpoints.
        </div>
      )}
      {role === "admin" && (
        <section className="dashboardBlock">
          <div className="sectionTools">
            <div>
              <h2>Users management</h2>
              <p>
                Create accounts and assign roles, departments, years, semesters,
                and sections.
              </p>
            </div>
            <button className="newButton" onClick={() => setUserEditor(true)}>
              + Create user
            </button>
          </div>
          <div className="userManager">
            {users.map((user) => (
              <article key={user.id}>
                <div>
                  <b>{user.name}</b>
                  <small>{user.email}</small>
                </div>
                <select value={user.role} onChange={async event=>{try{await request(`/portal/users/${user.id}`,{method:"PATCH",body:JSON.stringify({role:event.target.value})});await load();notify("User role updated")}catch(reason){setError((reason as Error).message)}}}><option value="student">Student</option><option value="teacher">Teacher</option><option value="cr">CR</option><option value="admin">Admin</option></select>
                <span>
                  {user.department
                    ? `${user.department} · Y${user.academic_year} S${user.semester} · ${user.section ?? "-"}`
                    : "University-wide"}
                </span>
                <button
                  onClick={async () => {
                    if (!confirm(`Delete ${user.name}?`)) return;
                    try {
                      await request(`/portal/users/${user.id}`, {
                        method: "DELETE",
                      });
                      await load();
                      notify("User deleted");
                    } catch (reason) {
                      setError((reason as Error).message);
                    }
                  }}
                >
                  Delete
                </button>
              </article>
            ))}
          </div>
        </section>
      )}
      <section className="dashboardBlock">
        <div className="sectionTools">
          <div>
            <h2>
              {role === "teacher"
                ? "My teaching courses"
                : role === "admin"
                  ? "All course offerings"
                  : "My assigned courses"}
            </h2>
            <p>
              {role === "admin"
                ? "Review course scope, teachers, enrollment, and lecture content from one structured workspace."
                : "Only courses assigned to this authenticated account are shown."}
            </p>
          </div>
          {role === "admin" && (
            <button
              className="newButton"
              onClick={() => setCourseEditor("new")}
            >
              + Create course
            </button>
          )}
        </div>
        {data.courses.length ? role === "admin" ? (
          <div className="adminCoursePanel">
            <div className="adminCourseToolbar">
              <label>
                <span>Search offerings</span>
                <input
                  value={courseSearch}
                  onChange={(event) => setCourseSearch(event.target.value)}
                  placeholder="Course code, title, teacher, or department"
                />
              </label>
              <div>
                <span>
                  <b>{data.courses.length}</b> offerings
                </span>
                <span>
                  <b>
                    {data.courses.filter((course) => course.teacher).length}
                  </b>{" "}
                  assigned
                </span>
                <span>
                  <b>
                    {data.courses.reduce(
                      (total, course) => total + course._count.members,
                      0,
                    )}
                  </b>{" "}
                  enrollments
                </span>
              </div>
            </div>
            <div className="adminCourseList">
              {visibleCourses.map((course) => (
                <article className="adminCourseRow" key={course.id}>
                  <div className="adminCourseSummary">
                    <div className="adminCourseIdentity">
                      <span>{course.code.replace(/\s/g, "").slice(0, 3)}</span>
                      <div>
                        <b>{course.code}</b>
                        <small>{course.title}</small>
                      </div>
                    </div>
                    <span className="courseScope">
                      {course.department} · Year {course.academic_year} · Sem{" "}
                      {course.semester} · Section {course.section}
                    </span>
                    <div className="courseTeacher">
                      <small>TEACHER</small>
                      <b>{course.teacher?.name ?? "Not assigned"}</b>
                    </div>
                    <div className="courseCounts">
                      <span>
                        <b>{course._count.members}</b> students
                      </span>
                      <span>
                        <b>{course.lectures.length}</b> materials
                      </span>
                    </div>
                    <div className="adminCourseActions">
                      <button onClick={() => setLectureCourse(course)}>
                        + Material
                      </button>
                      <button onClick={() => setCourseEditor(course)}>
                        Edit
                      </button>
                      <button
                        className="danger"
                        onClick={async () => {
                          if (!confirm(`Delete ${course.code}?`)) return;
                          try {
                            await request(`/portal/courses/${course.id}`, {
                              method: "DELETE",
                            });
                            await load();
                            notify("Course offering deleted");
                          } catch (reason) {
                            setError((reason as Error).message);
                          }
                        }}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                  <div className="adminCourseManage">
                    <div className="courseEnroll">
                      <select
                        value={memberByCourse[course.id] ?? ""}
                        onChange={(event) =>
                          setMemberByCourse((current) => ({
                            ...current,
                            [course.id]: event.target.value,
                          }))
                        }
                      >
                        <option value="">Add matching student or CR</option>
                        {users
                          .filter(
                            (user) =>
                              (user.role === "student" ||
                                user.role === "cr") &&
                              user.department === course.department &&
                              user.academic_year === course.academic_year &&
                              user.semester === course.semester &&
                              user.section === course.section &&
                              !course.members.some(
                                (member) => member.user.id === user.id,
                              ),
                          )
                          .map((user) => (
                            <option value={user.id} key={user.id}>
                              {user.name} ({user.role})
                            </option>
                          ))}
                      </select>
                      <button
                        disabled={!memberByCourse[course.id]}
                        onClick={async () => {
                          try {
                            await request(
                              `/portal/courses/${course.id}/members`,
                              {
                                method: "POST",
                                body: JSON.stringify({
                                  user_id: memberByCourse[course.id],
                                }),
                              },
                            );
                            setMemberByCourse((current) => ({
                              ...current,
                              [course.id]: "",
                            }));
                            await load();
                            notify("Course member assigned");
                          } catch (reason) {
                            setError((reason as Error).message);
                          }
                        }}
                      >
                        Add
                      </button>
                    </div>
                    <div className="enrolledMembers">
                      {course.members.map(({ user }) => (
                        <span key={user.id}>
                          <span>
                            {user.name} <small>{user.role}</small>
                          </span>
                          <button
                            title={`Remove ${user.name} from ${course.code}`}
                            onClick={async () => {
                              try {
                                await request(
                                  `/portal/courses/${course.id}/members/${user.id}`,
                                  { method: "DELETE" },
                                );
                                await load();
                                notify("Course member removed");
                              } catch (reason) {
                                setError((reason as Error).message);
                              }
                            }}
                          >
                            ×
                          </button>
                        </span>
                      ))}
                      {!course.members.length && (
                        <small>No students enrolled yet</small>
                      )}
                    </div>
                    {!!course.lectures.length && (
                      <details className="courseMaterials">
                        <summary>{course.lectures.length} lecture links</summary>
                        <div>
                          {course.lectures.map((lecture) => (
                            <a
                              key={lecture.id}
                              href={lecture.content_url}
                              target="_blank"
                              rel="noreferrer"
                            >
                              {lecture.title}
                            </a>
                          ))}
                        </div>
                      </details>
                    )}
                  </div>
                </article>
              ))}
              {!visibleCourses.length && (
                <div className="blank compactBlank">
                  <h2>No matching course offerings</h2>
                  <p>Try a different course, teacher, or department.</p>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="courseCards">
            {data.courses.map((course) => (
              <article key={course.id}>
                <div>
                  <small>
                    {course.department} · YEAR {course.academic_year} · SEM{" "}
                    {course.semester} · SEC {course.section}
                  </small>
                  <h3>{course.code}</h3>
                  <p>{course.title}</p>
                </div>
                <span>
                  Teacher: <b>{course.teacher?.name ?? "Not assigned"}</b>
                </span>
                <span>{course._count.members} enrolled students</span>
                {course.lectures.length ? (
                  <div className="lectureList">
                    {course.lectures.map((item) => (
                      <a
                        key={item.id}
                        href={item.content_url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <b>{item.title}</b>
                        <small>{item.description || "Lecture material"}</small>
                      </a>
                    ))}
                  </div>
                ) : (
                  <small>No lecture content yet.</small>
                )}
                {role === "teacher" && (
                  <button
                    className="newButton"
                    onClick={() => setLectureCourse(course)}
                  >
                    + Upload lecture link
                  </button>
                )}
              </article>
            ))}
          </div>
        ) : (
          <div className="blank">
            <h2>No assigned courses</h2>
            <p>
              An administrator must assign this account to a course in the
              matching cohort.
            </p>
          </div>
        )}
      </section>
      <section className="dashboardBlock">
        <div className="sectionTools">
          <div>
            <h2>
              {role === "cr" ? "Class announcements" : "Cohort announcements"}
            </h2>
            <p>
              Visible only to matching department, year, semester, section, and
              assigned course students.
            </p>
          </div>
          {(role === "teacher" || role === "cr" || role === "admin") && (
            <button className="newButton" onClick={() => setAnnouncement(true)}>
              + Publish announcement
            </button>
          )}
        </div>
        {data.announcements.length ? (
          <div className="cohortNotices">
            {data.announcements.map((item) => (
              <article key={item.id}>
                <em className={item.priority}>{item.priority}</em>
                <div>
                  <small>
                    {item.course
                      ? `${item.course.code} · ${item.course.title}`
                      : "WHOLE COHORT"}
                  </small>
                  <h3>{item.title}</h3>
                  <p>{item.body}</p>
                  <span>
                    By {item.author_name} · expires {item.expires}
                  </span>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="blank">
            <p>No active announcements for your cohort and courses.</p>
          </div>
        )}
      </section>
      {lectureCourse && (
        <LectureForm
          course={lectureCourse}
          busy={busy}
          close={() => setLectureCourse(null)}
          submit={async (value) => {
            setBusy(true);
            try {
              await request(`/portal/courses/${lectureCourse.id}/lectures`, {
                method: "POST",
                body: JSON.stringify(value),
              });
              await load();
              setLectureCourse(null);
              notify("Lecture content published");
            } catch (reason) {
              setError((reason as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        />
      )}
      {announcement && (
        <AnnouncementForm
          courses={data.courses}
          busy={busy}
          close={() => setAnnouncement(false)}
          submit={async (value) => {
            setBusy(true);
            try {
              await request("/portal/announcements", {
                method: "POST",
                body: JSON.stringify(value),
              });
              await load();
              setAnnouncement(false);
              notify("Cohort announcement published");
            } catch (reason) {
              setError((reason as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        />
      )}
      {userEditor && (
        <UserForm
          busy={busy}
          close={() => setUserEditor(false)}
          submit={async (value) => {
            setBusy(true);
            try {
              await request("/portal/users", {
                method: "POST",
                body: JSON.stringify(value),
              });
              await load();
              setUserEditor(false);
              notify("User created");
            } catch (reason) {
              setError((reason as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        />
      )}
      {courseEditor && (
        <CourseForm
          item={courseEditor === "new" ? undefined : courseEditor}
          users={users}
          busy={busy}
          close={() => setCourseEditor(null)}
          submit={async (value) => {
            setBusy(true);
            try {
              const editing = courseEditor !== "new";
              await request(
                `/portal/courses${editing ? `/${courseEditor.id}` : ""}`,
                {
                method: editing ? "PATCH" : "POST",
                body: JSON.stringify(value),
                },
              );
              await load();
              setCourseEditor(null);
              notify(editing ? "Course offering updated" : "Course created");
            } catch (reason) {
              setError((reason as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        />
      )}
    </div>
  );
}
function UserForm({
  busy,
  close,
  submit,
}: {
  busy: boolean;
  close(): void;
  submit(value: Record<string, unknown>): void;
}) {
  const [x, set] = useState({
    name: "",
    email: "",
    password: "CampusOS123!",
    role: "student",
    department: "CSE",
    academic_year: 1,
    semester: 1,
    section: "A",
  });
  return (
    <div className="backdrop">
      <form
        className="modal"
        onSubmit={(e) => {
          e.preventDefault();
          submit(x);
        }}
      >
        <div className="modalTitle">
          <div>
            <small>ADMIN ONLY</small>
            <h2>Create campus user</h2>
          </div>
          <button type="button" onClick={close}>
            ×
          </button>
        </div>
        <div className="formGrid">
          <label>
            Name
            <input
              required
              value={x.name}
              onChange={(e) => set({ ...x, name: e.target.value })}
            />
          </label>
          <label>
            Email
            <input
              required
              type="email"
              value={x.email}
              onChange={(e) => set({ ...x, email: e.target.value })}
            />
          </label>
          <label>
            Password
            <input
              required
              minLength={8}
              value={x.password}
              onChange={(e) => set({ ...x, password: e.target.value })}
            />
          </label>
          <label>
            Role
            <select
              value={x.role}
              onChange={(e) => set({ ...x, role: e.target.value })}
            >
              <option value="student">Student</option>
              <option value="teacher">Teacher</option>
              <option value="cr">CR</option>
              <option value="admin">Admin</option>
            </select>
          </label>
          <label>
            Department
            <input
              value={x.department}
              onChange={(e) =>
                set({ ...x, department: e.target.value.toUpperCase() })
              }
            />
          </label>
          <label>
            Year
            <input
              type="number"
              min="1"
              max="8"
              value={x.academic_year}
              onChange={(e) =>
                set({ ...x, academic_year: Number(e.target.value) })
              }
            />
          </label>
          <label>
            Semester
            <input
              type="number"
              min="1"
              max="3"
              value={x.semester}
              onChange={(e) => set({ ...x, semester: Number(e.target.value) })}
            />
          </label>
          <label>
            Section
            <input
              value={x.section}
              onChange={(e) =>
                set({ ...x, section: e.target.value.toUpperCase() })
              }
            />
          </label>
        </div>
        <div className="modalActions">
          <button type="button" onClick={close}>
            Cancel
          </button>
          <button className="newButton" disabled={busy}>
            Create user
          </button>
        </div>
      </form>
    </div>
  );
}
function CourseForm({
  item,
  users,
  busy,
  close,
  submit,
}: {
  item?: Course;
  users: ManagedUser[];
  busy: boolean;
  close(): void;
  submit(value: Record<string, unknown>): void;
}) {
  const [x, set] = useState({
    code: item?.code ?? "",
    title: item?.title ?? "",
    department: item?.department ?? "CSE",
    academic_year: item?.academic_year ?? 1,
    semester: item?.semester ?? 1,
    section: item?.section ?? "A",
    teacher_id: item?.teacher?.id ?? "",
  });
  return (
    <div className="backdrop">
      <form
        className="modal"
        onSubmit={(e) => {
          e.preventDefault();
          submit({ ...x, teacher_id: x.teacher_id || null });
        }}
      >
        <div className="modalTitle">
          <div>
            <small>ADMIN ONLY</small>
            <h2>{item ? "Edit course offering" : "Create course offering"}</h2>
          </div>
          <button type="button" onClick={close}>
            ×
          </button>
        </div>
        <div className="formGrid">
          <label>
            Course code
            <input
              required
              value={x.code}
              onChange={(e) =>
                set({ ...x, code: e.target.value.toUpperCase() })
              }
            />
          </label>
          <label>
            Title
            <input
              required
              value={x.title}
              onChange={(e) => set({ ...x, title: e.target.value })}
            />
          </label>
          <label>
            Department
            <input
              required
              value={x.department}
              onChange={(e) =>
                set({ ...x, department: e.target.value.toUpperCase() })
              }
            />
          </label>
          <label>
            Year
            <input
              type="number"
              value={x.academic_year}
              onChange={(e) =>
                set({ ...x, academic_year: Number(e.target.value) })
              }
            />
          </label>
          <label>
            Semester
            <input
              type="number"
              value={x.semester}
              onChange={(e) => set({ ...x, semester: Number(e.target.value) })}
            />
          </label>
          <label>
            Section
            <input
              required
              value={x.section}
              onChange={(e) =>
                set({ ...x, section: e.target.value.toUpperCase() })
              }
            />
          </label>
          <label>
            Teacher
            <select
              value={x.teacher_id}
              onChange={(e) => set({ ...x, teacher_id: e.target.value })}
            >
              <option value="">Unassigned</option>
              {users
                .filter((user) => user.role === "teacher")
                .map((user) => (
                  <option value={user.id} key={user.id}>
                    {user.name}
                  </option>
                ))}
            </select>
          </label>
        </div>
        <div className="modalActions">
          <button type="button" onClick={close}>
            Cancel
          </button>
          <button className="newButton" disabled={busy}>
            {item ? "Save changes" : "Create course"}
          </button>
        </div>
      </form>
    </div>
  );
}
function LectureForm({
  course,
  busy,
  close,
  submit,
}: {
  course: Course;
  busy: boolean;
  close(): void;
  submit(value: {
    title: string;
    description: string;
    content_url: string;
  }): void;
}) {
  const [title, setTitle] = useState(""),
    [description, setDescription] = useState(""),
    [content_url, setUrl] = useState("");
  return (
    <div className="backdrop">
      <form
        className="modal"
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          submit({ title, description, content_url });
        }}
      >
        <div className="modalTitle">
          <div>
            <small>{course.code}</small>
            <h2>Publish lecture content</h2>
          </div>
          <button type="button" onClick={close}>
            ×
          </button>
        </div>
        <div className="formGrid">
          <label>
            Title
            <input
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>
          <label>
            Content URL
            <input
              required
              type="url"
              value={content_url}
              onChange={(e) => setUrl(e.target.value)}
            />
          </label>
          <label className="wide">
            Description
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </label>
        </div>
        <div className="modalActions">
          <button type="button" onClick={close}>
            Cancel
          </button>
          <button className="newButton" disabled={busy}>
            Publish
          </button>
        </div>
      </form>
    </div>
  );
}
function AnnouncementForm({
  courses,
  busy,
  close,
  submit,
}: {
  courses: Course[];
  busy: boolean;
  close(): void;
  submit(value: {
    title: string;
    body: string;
    priority: string;
    expires: string;
    course_id: string | null;
  }): void;
}) {
  const [title, setTitle] = useState(""),
    [body, setBody] = useState(""),
    [priority, setPriority] = useState("medium"),
    [expires, setExpires] = useState(
      new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10),
    ),
    [courseId, setCourseId] = useState("");
  return (
    <div className="backdrop">
      <form
        className="modal"
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          submit({
            title,
            body,
            priority,
            expires,
            course_id: courseId || null,
          });
        }}
      >
        <div className="modalTitle">
          <div>
            <small>SCOPED DELIVERY</small>
            <h2>Publish announcement</h2>
          </div>
          <button type="button" onClick={close}>
            ×
          </button>
        </div>
        <div className="formGrid">
          <label>
            Title
            <input
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>
          <label>
            Course
            <select
              value={courseId}
              onChange={(e) => setCourseId(e.target.value)}
            >
              <option value="">Whole cohort</option>
              {courses.map((course) => (
                <option value={course.id} key={course.id}>
                  {course.code}
                </option>
              ))}
            </select>
          </label>
          <label>
            Priority
            <select
              value={priority}
              onChange={(e) => setPriority(e.target.value)}
            >
              <option>high</option>
              <option>medium</option>
              <option>low</option>
            </select>
          </label>
          <label>
            Expires
            <input
              required
              type="date"
              value={expires}
              onChange={(e) => setExpires(e.target.value)}
            />
          </label>
          <label className="wide">
            Message
            <textarea
              required
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
          </label>
        </div>
        <div className="modalActions">
          <button type="button" onClick={close}>
            Cancel
          </button>
          <button className="newButton" disabled={busy}>
            Publish securely
          </button>
        </div>
      </form>
    </div>
  );
}
