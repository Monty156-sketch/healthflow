-- Departments that work Monday to Friday and rest at weekends and on public holidays.
-- Additive: one new column. Existing public health departments are switched on by name.
ALTER TABLE "Department" ADD COLUMN "weekdaysOnly" BOOLEAN NOT NULL DEFAULT false;

UPDATE "Department" SET "weekdaysOnly" = true
WHERE lower(trim("name")) IN (
  'public health', 'disease control', 'family health', 'reproductive and child health', 'health promotion',
  'nutrition', 'health information', 'public health nursing', 'malaria control',
  'tuberculosis and priority diseases', 'occupational health', 'mental health', 'environmental health and sanitation'
);
