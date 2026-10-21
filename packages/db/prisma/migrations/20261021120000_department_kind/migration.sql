CREATE TYPE "DepartmentKind" AS ENUM ('WARD', 'SUPPORT', 'OFFICE');
ALTER TABLE "Department" ADD COLUMN "kind" "DepartmentKind" NOT NULL DEFAULT 'WARD';
