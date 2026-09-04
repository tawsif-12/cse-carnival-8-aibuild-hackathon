ALTER TABLE "User" ADD COLUMN "department" TEXT;
ALTER TABLE "User" ADD COLUMN "academic_year" INTEGER;
ALTER TABLE "User" ADD COLUMN "semester" INTEGER;

CREATE TABLE "CourseOffering" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "code" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "department" TEXT NOT NULL,
  "academic_year" INTEGER NOT NULL,
  "semester" INTEGER NOT NULL,
  "teacher_id" TEXT,
  CONSTRAINT "CourseOffering_teacher_id_fkey" FOREIGN KEY ("teacher_id") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "CourseOffering_code_department_academic_year_semester_key" ON "CourseOffering"("code", "department", "academic_year", "semester");
CREATE INDEX "CourseOffering_department_academic_year_semester_idx" ON "CourseOffering"("department", "academic_year", "semester");

CREATE TABLE "CourseMember" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "user_id" TEXT NOT NULL,
  "course_id" TEXT NOT NULL,
  CONSTRAINT "CourseMember_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "CourseMember_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "CourseOffering" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "CourseMember_user_id_course_id_key" ON "CourseMember"("user_id", "course_id");

CREATE TABLE "CourseLecture" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "course_id" TEXT NOT NULL,
  "teacher_id" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "content_url" TEXT NOT NULL,
  "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CourseLecture_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "CourseOffering" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "CourseLecture_teacher_id_fkey" FOREIGN KEY ("teacher_id") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "CourseLecture_course_id_created_at_idx" ON "CourseLecture"("course_id", "created_at");

CREATE TABLE "CohortAnnouncement" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "title" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "department" TEXT NOT NULL,
  "academic_year" INTEGER NOT NULL,
  "semester" INTEGER NOT NULL,
  "course_id" TEXT,
  "author_id" TEXT NOT NULL,
  "author_name" TEXT NOT NULL,
  "priority" TEXT NOT NULL,
  "expires" TEXT NOT NULL,
  "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CohortAnnouncement_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "CourseOffering" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "CohortAnnouncement_department_academic_year_semester_created_at_idx" ON "CohortAnnouncement"("department", "academic_year", "semester", "created_at");
