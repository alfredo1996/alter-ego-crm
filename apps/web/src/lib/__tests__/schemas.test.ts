import { describe, it, expect } from "vitest"

import {
  createCompanyAccountSchema,
  createCompanyExpenseSchema,
  createCompanyLoanSchema,
  createCompanyMovementSchema,
  createInvoiceSchema,
  createSolutionSchema,
  MAX_SOLUTION_ENTITIES,
  MAX_SOLUTION_RELATIONS,
  MAX_SOLUTION_STEPS,
  MAX_SOLUTION_STACK,
  normalizeSolutionDomain,
  normalizeSolutionGraph,
  normalizeSolutionKind,
  normalizeSolutionSteps,
  normalizeSolutionTarget,
  normalizeSolutionSections,
  normalizeSolutionStack,
  SOLUTION_SECTION_MAX,
  SOLUTION_KIND_SECTIONS,
  SOLUTION_SECTIONS,
  SOLUTION_TARGET_MAX,
  solutionFields,
  updateCompanyExpenseSchema,
  updateCompanyLoanSchema,
  updateInvoiceSchema,
  updateSolutionSchema,
} from "@/types/schemas"

/**
 * The cash book's zod side. firestore/crm.rules repeats each check, and the mock
 * parses these, so the two backends refuse the same writes (adapter-contract).
 */

const account = { name: "Bank A", openingBalance: 1000, openingDate: new Date("2026-05-01") }

describe("createCompanyAccountSchema", () => {
  it("accepts the minimum, a negative opening balance, and a full statement", () => {
    expect(createCompanyAccountSchema.safeParse(account).success).toBe(true)
    expect(createCompanyAccountSchema.safeParse({ ...account, openingBalance: -50 }).success).toBe(true)
    const checked = { ...account, statementBalance: 1200, statementDate: new Date("2026-06-30"), importRef: "imp-1" }
    expect(createCompanyAccountSchema.safeParse(checked).success).toBe(true)
    expect(createCompanyAccountSchema.safeParse({ ...account, statementBalance: null, statementDate: null }).success).toBe(true)
  })

  it.each([
    ["an empty name", { name: "" }],
    ["a name over 100", { name: "x".repeat(101) }],
    ["a non-finite opening balance", { openingBalance: Infinity }],
    ["a string opening date", { openingDate: "2026-05-01" }],
    ["an import ref over 40", { importRef: "x".repeat(41) }],
    ["a bank balance without its date", { statementBalance: 10 }],
    ["a statement date without its balance", { statementDate: new Date() }],
    ["a balance with a null date", { statementBalance: 10, statementDate: null }],
  ])("refuses %s", (_, over) => {
    expect(createCompanyAccountSchema.safeParse({ ...account, ...over }).success).toBe(false)
  })
})

const income = {
  kind: "income",
  direction: "in",
  amount: 100,
  date: new Date("2026-06-02"),
  accountId: "acc-a",
  description: "Room A rent",
}

describe("createCompanyMovementSchema", () => {
  it("accepts an income with no optional field, and with every one", () => {
    expect(createCompanyMovementSchema.safeParse(income).success).toBe(true)
    const full = {
      ...income, kind: "deposit_held", toAccountId: null, expenseId: null, documentRef: "R-1",
      project: "Project X", counterparty: "Room A", notes: "n", dateEstimated: true, importRef: "2026:S1!2",
    }
    expect(createCompanyMovementSchema.safeParse(full).success).toBe(true)
  })

  it("accepts a transfer out to another account and a supplier payment naming its document", () => {
    expect(createCompanyMovementSchema.safeParse({ ...income, kind: "transfer", direction: "out", toAccountId: "acc-b" }).success).toBe(true)
    expect(createCompanyMovementSchema.safeParse({ ...income, kind: "supplier_payment", direction: "out", expenseId: "exp-1" }).success).toBe(true)
  })

  it.each([
    ["an unknown kind", { kind: "withdrawal" }],
    ["an unknown direction", { direction: "sideways" }],
    ["a zero amount", { amount: 0 }],
    ["a negative amount", { amount: -5 }],
    ["a string date", { date: "2026-06-02" }],
    ["no account", { accountId: "" }],
    ["an empty description", { description: "" }],
    ["a description over 300", { description: "x".repeat(301) }],
    ["a document ref over 100", { documentRef: "x".repeat(101) }],
    ["a project over 60", { project: "x".repeat(61) }],
    ["a counterparty over 100", { counterparty: "x".repeat(101) }],
    ["notes over 1000", { notes: "x".repeat(1001) }],
    ["a non-boolean dateEstimated", { dateEstimated: "yes" }],
    ["an import ref over 40", { importRef: "x".repeat(41) }],
    ["a destination on a non-transfer", { toAccountId: "acc-b" }],
    ["a supplier document on a non-payment", { expenseId: "exp-1" }],
    ["a supplier payment without its document", { kind: "supplier_payment", direction: "out" }],
    ["a transfer to the same account", { kind: "transfer", direction: "out", toAccountId: "acc-a" }],
    ["a transfer with no destination", { kind: "transfer", direction: "out" }],
    ["a transfer coming in", { kind: "transfer", direction: "in", toAccountId: "acc-b" }],
  ])("refuses %s", (_, over) => {
    expect(createCompanyMovementSchema.safeParse({ ...income, ...over }).success).toBe(false)
  })

  // The UI asks who a deposit belongs to; the data layer does not.
  it("leaves the counterparty optional on deposit kinds", () => {
    expect(createCompanyMovementSchema.safeParse({ ...income, kind: "deposit_held" }).success).toBe(true)
    expect(createCompanyMovementSchema.safeParse({ ...income, kind: "deposit_paid", direction: "out" }).success).toBe(true)
  })
})

describe("invoice paidAccountId", () => {
  const invoice = { clientId: "c1", number: "1", yearMonth: "2026-06", amount: 100, vat: 22 }

  it("is optional, nullable, or an account id", () => {
    expect(createInvoiceSchema.safeParse(invoice).success).toBe(true)
    expect(createInvoiceSchema.safeParse({ ...invoice, paidAccountId: null }).success).toBe(true)
    expect(createInvoiceSchema.safeParse({ ...invoice, paidDate: new Date(), paidAccountId: "acc-a" }).success).toBe(true)
    expect(createInvoiceSchema.safeParse({ ...invoice, paidAccountId: "" }).success).toBe(false)
    expect(createInvoiceSchema.safeParse({ ...invoice, paidAccountId: 5 }).success).toBe(false)
  })

  // Deadlines and Invoices untick with {paidDate: null} alone: no rule ties the two.
  it("is not tied to paidDate", () => {
    expect(updateInvoiceSchema.safeParse({ paidDate: null }).success).toBe(true)
    expect(updateInvoiceSchema.safeParse({ paidAccountId: "acc-a" }).success).toBe(true)
  })
})

describe("company expense fields", () => {
  const fee = { description: "Bank fee", category: "bank_fees", amount: 25, date: new Date("2026-10-05") }
  const ok = (o: object) => createCompanyExpenseSchema.safeParse({ ...fee, ...o }).success

  it("takes each cash book field as optional, nullable or its type", () => {
    expect(ok({})).toBe(true)
    expect(ok({ accountId: null })).toBe(true)
    expect(ok({
      accountId: "acc-a", vat: 5.5, documentRef: "FPR 40/26", project: "Flat Rental", recurringExpenseId: "est-1",
      dateEstimated: true, importRef: "2026:S1!4", paidByOwner: false,
    })).toBe(true)
    expect(ok({ accountId: "" })).toBe(false)
    expect(ok({ documentRef: "x".repeat(101) })).toBe(false)
    expect(ok({ project: "x".repeat(61) })).toBe(false)
    expect(updateCompanyExpenseSchema.safeParse({ accountId: "acc-a" }).success).toBe(true)
    expect(updateCompanyExpenseSchema.safeParse({ accountId: 5 }).success).toBe(false)
  })

  it.each([
    ["a collaborator link", { category: "collaborators", collaboratorId: "c1", engagementId: "e1", forMonth: "2026-09" }, true],
    ["no link", { collaboratorId: null, engagementId: null, forMonth: null }, true],
    ["an empty collaborator", { collaboratorId: "" }, false],
    ["an empty contract", { engagementId: "" }, false],
    ["a month with a day", { forMonth: "2026-09-01" }, false],
    ["month 13", { forMonth: "2026-13" }, false],
  ])("takes %s", (_, over, expected) => {
    expect(ok(over)).toBe(expected)
  })

  it.each([
    ["an end month", { endMonth: "2027-12" }, true],
    ["no end", { endMonth: null }, true],
    ["an end with a day", { endMonth: "2027-12-01" }, false],
    ["price changes", { priceChanges: [{ from: "2027-07", amount: 1350 }, { from: "2028-01", amount: 1400 }] }, true],
    ["a change to 0", { priceChanges: [{ from: "2027-07", amount: 0 }] }, false],
    ["a change in month 13", { priceChanges: [{ from: "2027-13", amount: 5 }] }, false],
    ["two changes in one month", { priceChanges: [{ from: "2027-07", amount: 5 }, { from: "2027-07", amount: 6 }] }, false],
    ["25 changes", { priceChanges: Array.from({ length: 25 }, (_, i) => ({ from: `${2030 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}`, amount: 5 })) }, false],
    ["an end before the start", { date: new Date("2027-03-01"), endMonth: "2027-02" }, false],
    ["the end in the start month", { date: new Date("2027-03-01"), endMonth: "2027-03" }, true],
    ["a change in or before the start month", { date: new Date("2027-03-01"), priceChanges: [{ from: "2027-03", amount: 5 }] }, false],
    ["a change after the end", { endMonth: "2027-12", priceChanges: [{ from: "2028-01", amount: 5 }] }, false],
    ["the timing", { countedWhenPaid: true }, true],
  ])("takes %s on an estimate", (_, over, expected) => {
    expect(ok({ isRecurring: true, recurrenceMonths: 3, ...over })).toBe(expected)
  })

  it("never pays a recurring estimate: each payment is a one-off", () => {
    const estimate = { isRecurring: true, recurrenceMonths: 1 }
    expect(ok(estimate)).toBe(true)
    expect(ok({ ...estimate, accountId: "acc-a" })).toBe(false)
    expect(ok({ ...estimate, paidByOwner: true })).toBe(false)
    expect(ok({ ...estimate, recurringExpenseId: "est-1" })).toBe(false)
  })

  it("is paid from an account or by the owner, never both", () => {
    expect(ok({ paidByOwner: true })).toBe(true)
    expect(ok({ accountId: "acc-a", paidByOwner: true })).toBe(false)
  })

  it("is negative only as a refund into an account, never 0, and its VAT follows the sign", () => {
    expect(ok({ amount: 0 })).toBe(false)
    expect(ok({ amount: -40, accountId: "acc-a", vat: -8.8 })).toBe(true)
    expect(ok({ amount: -40 })).toBe(false)
    expect(ok({ amount: -40, paidByOwner: true })).toBe(false)
    expect(ok({ amount: -40, accountId: "acc-a", isRecurring: true })).toBe(false)
    expect(ok({ vat: 0 })).toBe(true)
    expect(ok({ vat: -5 })).toBe(false)
    expect(ok({ amount: -40, accountId: "acc-a", vat: 5 })).toBe(false)
  })
})

describe("company loan fields", () => {
  const loan = { description: "Lend to SRL", direction: "to_company", amount: 5000, date: new Date("2026-05-02") }
  it("takes an account, an estimated date and an import ref; an update is any part", () => {
    expect(createCompanyLoanSchema.safeParse(loan).success).toBe(true)
    expect(createCompanyLoanSchema.safeParse({ ...loan, accountId: "acc-a", dateEstimated: true, importRef: "x" }).success).toBe(true)
    expect(createCompanyLoanSchema.safeParse({ ...loan, accountId: "" }).success).toBe(false)
    expect(createCompanyLoanSchema.safeParse({ ...loan, direction: "withdrawal" }).success).toBe(false)
    expect(updateCompanyLoanSchema.safeParse({ accountId: null }).success).toBe(true)
    expect(updateCompanyLoanSchema.safeParse({ amount: -1 }).success).toBe(false)
  })
})

// The fictional Nordwind Retail product knowledge graph: the design's fixture.
const nordwind = {
  clientId: "c-nordwind",
  name: "Product knowledge graph",
  engagementId: "e-product-graph",
  status: "delivered",
  domain: "retail",
  stack: ["neo4j", "gds", "kafka", "debezium", "airflow", "python", "graphql", "neodash"],
  sections: { purpose: "180,000 SKUs in three systems that do not talk to each other.", history: null },
  entities: [
    { name: "Product", source: "SAP MARA + MAKT, Akeneo", notes: "the core, keyed by sku" },
    { name: "Category", source: "Akeneo", notes: "four-level hierarchy" },
    { name: "SearchQuery", source: "GA4 via BigQuery", notes: null },
  ],
  relations: [
    { from: "Product", to: "Category", type: "IN_CATEGORY" },
    { from: "SearchQuery", to: "Product", type: "RETURNED" },
    { from: "Product", to: "Product", type: "SIMILAR_TO" },
  ],
}
const entity = (name: string) => ({ name, source: null, notes: null })

describe("SOLUTION_SECTIONS", () => {
  it("is the nine fixed keys, in order, each with a label and a question", () => {
    expect(SOLUTION_SECTIONS.map((s) => s.key)).toEqual([
      "purpose", "requirements", "kpis", "sources", "model", "architecture", "steps", "history", "results",
    ])
    for (const s of SOLUTION_SECTIONS) {
      expect(s.label, s.key).toMatch(/^[A-Z]/)
      expect(s.question, s.key).toContain("?")
    }
  })
})

describe("createSolutionSchema", () => {
  it("accepts the minimum, and the whole Nordwind record", () => {
    expect(createSolutionSchema.safeParse({ clientId: "c1", name: "Graph" }).success).toBe(true)
    expect(createSolutionSchema.safeParse(nordwind).success).toBe(true)
    expect(createSolutionSchema.safeParse({ ...nordwind, engagementId: null, domain: null }).success).toBe(true)
  })

  it("trims the name and lowercases the stack", () => {
    const parsed = createSolutionSchema.parse({ clientId: "c1", name: "  Graph  ", stack: [" Neo4j", "KAFKA"] })
    expect(parsed.name).toBe("Graph")
    expect(parsed.stack).toEqual(["neo4j", "kafka"])
  })

  it.each([
    ["no client", { clientId: "" }],
    ["an empty name", { name: "  " }],
    ["a name over 200", { name: "x".repeat(201) }],
    ["an empty contract id", { engagementId: "" }],
    ["an unknown status", { status: "archived" }],
    ["an empty domain", { domain: "" }],
    ["a domain over 60", { domain: "x".repeat(61) }],
    [`over ${MAX_SOLUTION_STACK} technologies`, { stack: Array.from({ length: MAX_SOLUTION_STACK + 1 }, (_, i) => `t${i}`) }],
    ["the same technology twice, in any case", { stack: ["neo4j", "Neo4j"] }],
    ["an empty tag", { stack: [" "] }],
    ["an unknown section key", { sections: { purpose: "ok", appendix: "no" } }],
    [`a section over ${SOLUTION_SECTION_MAX} characters`, { sections: { kpis: "x".repeat(SOLUTION_SECTION_MAX + 1) } }],
    ["a section that is not text", { sections: { kpis: 42 } }],
    [`over ${MAX_SOLUTION_ENTITIES} entities`, { entities: Array.from({ length: MAX_SOLUTION_ENTITIES + 1 }, (_, i) => entity(`E${i}`)), relations: [] }],
    ["an entity with no name", { entities: [entity("")], relations: [] }],
    ["an entity lacking source", { entities: [{ name: "Product", notes: null }], relations: [] }],
    ["an untyped relation", { relations: [{ from: "Product", to: "Category", type: "" }] }],
  ])("refuses %s", (_, over) => {
    expect(createSolutionSchema.safeParse({ ...nordwind, ...over }).success).toBe(false)
  })

  it(`accepts exactly ${SOLUTION_SECTION_MAX} characters, ${MAX_SOLUTION_ENTITIES} entities and ${MAX_SOLUTION_RELATIONS} relations`, () => {
    const entities = Array.from({ length: MAX_SOLUTION_ENTITIES }, (_, i) => entity(`E${i}`))
    const relations = Array.from({ length: MAX_SOLUTION_RELATIONS }, (_, i) => ({ from: `E${i % 100}`, to: "E0", type: `R${i}` }))
    const full = { ...nordwind, sections: { kpis: "x".repeat(SOLUTION_SECTION_MAX) }, entities, relations }
    expect(createSolutionSchema.safeParse(full).success).toBe(true)
    expect(createSolutionSchema.safeParse({ ...full, relations: [...relations, relations[0]] }).success).toBe(false)
  })

  it("refuses a relation naming a missing entity, at the end that is missing", () => {
    const result = createSolutionSchema.safeParse({
      ...nordwind,
      relations: [...nordwind.relations, { from: "Supplier", to: "Product", type: "SUPPLIES" }],
    })
    expect(result.success).toBe(false)
    expect(result.error?.issues.map((i) => i.path)).toEqual([["relations", 3, "from"]])
    expect(result.error?.issues[0].message).toBe('No entity is named "Supplier"')
  })

  it("refuses relations with no entities at all", () => {
    expect(createSolutionSchema.safeParse({ clientId: "c1", name: "G", relations: nordwind.relations }).success).toBe(false)
  })

  it("refuses two entities with one name, trimmed", () => {
    const result = createSolutionSchema.safeParse({ ...nordwind, entities: [...nordwind.entities, entity(" Product ")] })
    expect(result.error?.issues.map((i) => i.path)).toEqual([["entities", 3, "name"]])
  })
})

describe("updateSolutionSchema", () => {
  it("accepts any one field, and a section cleared with null", () => {
    for (const input of [{ name: "Renamed" }, { status: "retired" }, { engagementId: null }, { sections: { history: null } }, { stack: [] }]) {
      expect(updateSolutionSchema.safeParse(input).success, JSON.stringify(input)).toBe(true)
    }
  })

  it("never moves a solution to another client", () => {
    expect(updateSolutionSchema.parse({ clientId: "elsewhere", name: "G" })).toEqual({ name: "G" })
  })

  it("checks the graph when it carries the entities, and cannot when it carries relations alone", () => {
    expect(updateSolutionSchema.safeParse({ entities: [entity("A")], relations: [{ from: "A", to: "B", type: "X" }] }).success).toBe(false)
    expect(updateSolutionSchema.safeParse({ entities: [entity("A"), entity("A")] }).success).toBe(false)
    expect(updateSolutionSchema.safeParse({ relations: [{ from: "A", to: "B", type: "X" }] }).success).toBe(true)
  })

  it("refuses an unknown section key and an oversized section", () => {
    expect(updateSolutionSchema.safeParse({ sections: { appendix: "x" } }).success).toBe(false)
    expect(updateSolutionSchema.safeParse({ sections: { steps: "x".repeat(SOLUTION_SECTION_MAX + 1) } }).success).toBe(false)
  })
})

describe("normalizeSolutionStack and normalizeSolutionDomain", () => {
  it("read a stored value as zod writes it, so the stored document parses again", () => {
    expect(normalizeSolutionStack(["Neo4j", "neo4j", " kafka ", "", "x".repeat(41), 7])).toEqual(["neo4j", "kafka"])
    expect(normalizeSolutionStack("neo4j")).toEqual([])
    expect(normalizeSolutionDomain(" retail ")).toBe("retail")
    expect(normalizeSolutionDomain("  ")).toBeNull()
    expect(normalizeSolutionDomain(3)).toBeNull()
    const stored = { clientId: "c1", name: "G", stack: normalizeSolutionStack(["Neo4j", "neo4j"]), domain: normalizeSolutionDomain("") }
    expect(createSolutionSchema.safeParse(stored).success).toBe(true)
  })
})

describe("solutionFields", () => {
  it("treats a section set to undefined as unchanged, on create and on update", () => {
    const created = solutionFields({ clientId: "c1", name: "G", sections: { purpose: undefined, kpis: "12% to 5%" } })
    expect(created.sections).toMatchObject({ purpose: null, kpis: "12% to 5%" })
    const edited = solutionFields({ ...created, sections: { ...created.sections, purpose: "Why" } }, {
      sections: { purpose: undefined, results: "Live in July" },
    })
    expect(edited.sections).toMatchObject({ purpose: "Why", kpis: "12% to 5%", results: "Live in July" })
  })
})

describe("normalizeSolutionSections", () => {
  it("gives every key, null where the stored map has no text", () => {
    const read = normalizeSolutionSections({ purpose: "Why", kpis: 42, appendix: "ignored" })
    expect(Object.keys(read)).toEqual(SOLUTION_SECTIONS.map((s) => s.key))
    expect(read).toMatchObject({ purpose: "Why", kpis: null, results: null })
    expect(read).not.toHaveProperty("appendix")
    expect(normalizeSolutionSections(undefined).purpose).toBeNull()
    expect(normalizeSolutionSections("not a map").history).toBeNull()
  })
})

describe("normalizeSolutionGraph", () => {
  it("keeps a valid graph as stored", () => {
    expect(normalizeSolutionGraph(nordwind.entities, nordwind.relations)).toEqual({
      entities: nordwind.entities,
      relations: nordwind.relations,
    })
  })

  it("drops malformed entities, a repeated name, and the relations left naming nothing", () => {
    const read = normalizeSolutionGraph(
      [entity("Product"), { name: 42 }, "Category", { name: "Order", source: null }, { ...entity("Product"), notes: "second" }, entity("Customer")],
      [
        { from: "Customer", to: "Product", type: "BOUGHT" },
        { from: "Order", to: "Product", type: "CONTAINS" },
        { from: "Product", to: "Product" },
        null,
      ],
    )
    expect(read.entities).toEqual([entity("Product"), entity("Customer")])
    expect(read.relations).toEqual([{ from: "Customer", to: "Product", type: "BOUGHT" }])
  })

  it("reads anything that is not a list as empty", () => {
    expect(normalizeSolutionGraph(undefined, { from: "A" })).toEqual({ entities: [], relations: [] })
  })
})

describe("the invoice file on a cost and an invoice", () => {
  const file = { path: "users/u/company-files/a.xml", name: "IT01.xml", kind: "xml", size: 10, uploadedAt: new Date() }
  const cost = { description: "Books", category: "accountant", amount: 100, date: new Date() }
  const invoice = { clientId: "c1", number: "1", yearMonth: "2026-09", amount: 100, vat: 22 }

  it.each([
    ["a cost", createCompanyExpenseSchema, cost],
    ["an invoice", createInvoiceSchema, invoice],
  ])("%s takes a file, null or none", (_n, schema, base) => {
    expect(schema.safeParse({ ...base, file }).success).toBe(true)
    expect(schema.safeParse({ ...base, file: null }).success).toBe(true)
    expect(schema.safeParse(base).success).toBe(true)
  })

  it.each([
    ["another kind", { ...file, kind: "docx" }],
    ["over 10 MB", { ...file, size: 10 * 1024 * 1024 + 1 }],
    ["a fractional size", { ...file, size: 1.5 }],
    ["no name", { ...file, name: "" }],
  ])("refuses a file with %s", (_n, bad) => {
    expect(createCompanyExpenseSchema.safeParse({ ...cost, file: bad }).success).toBe(false)
    expect(createInvoiceSchema.safeParse({ ...invoice, file: bad }).success).toBe(false)
  })

  it("drops a key the pointer does not have, so it is never stored", () => {
    expect(createCompanyExpenseSchema.parse({ ...cost, file: { ...file, extra: 1 } }).file).toEqual(file)
  })
})

// ─── A solution's kind, target and road of steps ─────────────────────────────

const step = (title: string, state: "done" | "now" | "next" | "later" = "next", over = {}) => ({
  title, state, fromMonth: "2026-03", toMonth: null, paidBy: null, goal: null, outcome: null, doneOn: null, ...over,
})

describe("SOLUTION_KIND_SECTIONS", () => {
  it("asks an Advisory for purpose, kpis and results only, a Product for seven without steps and history", () => {
    expect(SOLUTION_KIND_SECTIONS.advisory).toEqual(["purpose", "kpis", "results"])
    expect(SOLUTION_KIND_SECTIONS.product).toEqual(["purpose", "requirements", "kpis", "sources", "model", "architecture", "results"])
  })
})

describe("a solution's kind, target and steps", () => {
  const base = { clientId: "c1", name: "Query tuning" }
  const refused = (over: object) => createSolutionSchema.safeParse({ ...base, ...over })

  it("accepts a kind, a target and a road, and reads a solution with none as a product with no target and no steps", () => {
    const road = [step("Audit", "done", { doneOn: "2026-04-02", outcome: "Slow queries found" }), step("Tune", "now"), step("Review", "later")]
    expect(createSolutionSchema.safeParse({ ...base, kind: "advisory", target: "Every report under 2 s", steps: road }).success).toBe(true)
    expect(solutionFields(base)).toMatchObject({ kind: "product", target: null, steps: [] })
  })

  it.each([
    ["two Now steps", { steps: [step("A", "now"), step("B", "now")] }],
    ["a to month before the from month", { steps: [step("A", "next", { toMonth: "2026-02" })] }],
    [`${MAX_SOLUTION_STEPS + 1} steps`, { steps: Array.from({ length: MAX_SOLUTION_STEPS + 1 }, (_, i) => step(`S${i}`)) }],
    ["an unknown kind", { kind: "service" }],
    [`a target over ${SOLUTION_TARGET_MAX} characters`, { target: "x".repeat(SOLUTION_TARGET_MAX + 1) }],
    ["an unknown state", { steps: [step("A", "paused" as "now")] }],
    ["a from month that is not a month", { steps: [step("A", "next", { fromMonth: "2026-13" })] }],
  ])("refuses %s", (_, over) => {
    expect(refused(over).success).toBe(false)
  })

  it("accepts exactly 20 steps, one Now, and a to month equal to the from month", () => {
    const steps = Array.from({ length: MAX_SOLUTION_STEPS }, (_, i) => step(`S${i}`, i === 3 ? "now" : "next", { toMonth: "2026-03" }))
    expect(refused({ steps }).success).toBe(true)
  })

  it("is checked on an update too", () => {
    expect(updateSolutionSchema.safeParse({ steps: [step("A", "now"), step("B", "now")] }).success).toBe(false)
    expect(updateSolutionSchema.safeParse({ kind: "advisory", target: null }).success).toBe(true)
  })
})

describe("normalizeSolutionKind, Target and Steps", () => {
  it("reads a missing or unknown kind as a product, and a blank target as none", () => {
    expect(normalizeSolutionKind(undefined)).toBe("product")
    expect(normalizeSolutionKind("service")).toBe("product")
    expect(normalizeSolutionKind("advisory")).toBe("advisory")
    expect(normalizeSolutionTarget(" Under 2 s ")).toBe("Under 2 s")
    expect(normalizeSolutionTarget("  ")).toBeNull()
    expect(normalizeSolutionTarget(3)).toBeNull()
  })

  it("keeps the steps that parse, the first Now only and at most 20, so a stored road never breaks a later write", () => {
    expect(normalizeSolutionSteps("nope")).toEqual([])
    const read = normalizeSolutionSteps([step("A", "now"), { title: "" }, step("B", "now"), step("C", "done")])
    expect(read.map((s) => [s.title, s.state])).toEqual([["A", "now"], ["B", "next"], ["C", "done"]])
    expect(normalizeSolutionSteps(Array.from({ length: 25 }, (_, i) => step(`S${i}`)))).toHaveLength(MAX_SOLUTION_STEPS)
  })
})
