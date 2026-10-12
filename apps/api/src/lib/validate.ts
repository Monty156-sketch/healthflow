import type { Response } from "express";
import { z } from "zod";

/**
 * Parses input with a zod schema. On failure it answers 400 with one plain
 * message per field ({ error: "invalid_input", fields: { name: "..." } }),
 * which the forms show beside each field, and returns null.
 */
export function parseOr400<T extends z.ZodTypeAny>(
  schema: T,
  input: unknown,
  res: Response
): z.infer<T> | null {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  const fields: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const key = issue.path.join(".") || "_";
    if (!fields[key]) fields[key] = issue.message;
  }
  res.status(400).json({ error: "invalid_input", fields });
  return null;
}

/** Trims; turns an empty string into null so "cleared" means cleared. */
export const optionalText = (max: number, label: string) =>
  z
    .string()
    .trim()
    .max(max, `${label} must be ${max} characters or fewer.`)
    .nullish()
    .transform((v) => (v ? v : null));

export const requiredText = (max: number, label: string) =>
  z
    .string({ required_error: `${label} is required.` })
    .trim()
    .min(1, `${label} is required.`)
    .max(max, `${label} must be ${max} characters or fewer.`);

/** A pure calendar date, YYYY-MM-DD, stored as UTC midnight. */
export const optionalDate = (label: string) =>
  z
    .string()
    .trim()
    .nullish()
    .transform((v, ctx) => {
      if (!v) return null;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${label} must be a date.` });
        return z.NEVER;
      }
      const d = new Date(`${v}T00:00:00.000Z`);
      if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${label} is not a real date.` });
        return z.NEVER;
      }
      return d;
    });

export const optionalPhone = (label: string) =>
  z
    .string()
    .trim()
    .nullish()
    .transform((v, ctx) => {
      if (!v) return null;
      const digits = v.replace(/[\s()-]/g, "");
      if (!/^\+?\d{9,15}$/.test(digits)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${label} should be a phone number, for example 024 123 4567.`,
        });
        return z.NEVER;
      }
      return v;
    });

export const optionalEmail = (label: string) =>
  z
    .string()
    .trim()
    .nullish()
    .transform((v, ctx) => {
      if (!v) return null;
      if (!z.string().email().safeParse(v).success) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${label} is not a valid email address.` });
        return z.NEVER;
      }
      return v.toLowerCase();
    });
