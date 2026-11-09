import { z } from "zod"

/** The cap the rules hold too (rent.rules). */
export const MAX_RENT = 1_000_000

/** A property is also a cost centre, and a cost centre allows 60 (schemas `project`, crm.rules): a longer house would save here and fail on its first movement. */
export const MAX_PROPERTY = 60

const text = (max: number, what: string) => z.string().trim().min(1, `${what} is required`).max(max, `${what} is too long`)
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, "Too long")
    .nullish()
    .transform((v) => v || null)
// z.iso.date() knows the calendar: 2026-02-31 is refused, so dayLabel can never throw on a stored lease.
const isoDate = (what: string) => z.iso.date(`${what} is required`)
const amount = (what: string) => z.number(`${what} is required`).min(0, `${what} cannot be negative`).max(MAX_RENT, `${what} is too high`)

export const createTenantSchema = z.object({
  firstName: text(100, "First name"),
  surname: text(100, "Surname"),
  taxId: optionalText(50),
  street: optionalText(200),
  postcode: optionalText(20),
  city: optionalText(100),
  province: optionalText(50),
  country: optionalText(100),
})

export const createLeaseSchema = z
  .object({
    tenantId: text(200, "Tenant"),
    property: text(MAX_PROPERTY, "Property"),
    room: optionalText(100),
    rent: amount("Rent"),
    contribution: amount("Contribution")
      .nullish()
      .transform((v) => v ?? null),
    startDate: isoDate("Start"),
    endDate: isoDate("End"),
    paidBy: optionalText(100),
    // At most 24 months, the cap the rules hold too (they cannot check the entries, this does).
    agreedMonths: z
      .record(z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Agreed month is a month, YYYY-MM"), z.object({ amount: amount("Agreed amount"), note: z.string().trim().max(200, "Note is too long").default("") }))
      .refine((m) => Object.keys(m).length <= 24, "Too many agreed months")
      .nullish()
      .transform((v) => v ?? {}),
  })
  .refine((l) => l.endDate >= l.startDate, { path: ["endDate"], message: "End cannot be before start" })
