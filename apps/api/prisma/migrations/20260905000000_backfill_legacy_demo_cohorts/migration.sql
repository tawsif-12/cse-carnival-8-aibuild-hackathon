-- Accounts created by the original demo seed predate cohort-scoped access.
-- Give only those known demo accounts the same cohort as the current demo data.
UPDATE "User"
SET
  "department" = COALESCE("department", 'CSE'),
  "academic_year" = COALESCE("academic_year", 4),
  "semester" = COALESCE("semester", 1),
  "section" = COALESCE("section", 'A')
WHERE "email" IN ('student.demo@campus.local', 'representative.demo@campus.local');
