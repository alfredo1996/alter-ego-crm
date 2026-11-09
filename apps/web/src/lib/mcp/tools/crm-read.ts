import { formatYearMonth, isoDate } from "@alter-ego/kernel/dates"
import { endOfISOWeek, format, startOfISOWeek } from "date-fns"


import { getServerDb } from "@/lib/backend/server-db"
import {
  COST_CATEGORY_LABELS,
  UNTAGGED,
  balancesAt,
  bookRows,
  clientsOwe,
  costCentreTotals,
  deposits,
  isSupplierDocument,
  monthEnd,
  monthEnds,
  monthSheet,
  ownerLoanBalance,
  resultLabel,
  rowTypeLabel,
  statementCheck,
  statementLabel,
  supplierDocuments,
  toChase,
} from "@/lib/cash-book"
import { computeBurnDown, rateAt, toRevenueSources } from "@/lib/engagement-burndown"
import { contractEndDate, contractUnit, contractUsage, engagementLabel, hoursToDays, inContractUnit, runOutMonth } from "@/lib/engagements"
import {
  clientBilling,
  eurCents,
  invoiceClientId,
  invoicePeriodLabel,
  invoiceTotal,
  isInvoiceOverdue,
  sortInvoices,
  suggestedVat,
} from "@/lib/invoices"
import { IVA_RATE } from "@/lib/italian-tax"
import { monthInput, toolError, userIdOf } from "@/lib/mcp/tools/context"
import {
  ToolInputError,
  monthShift,
  monthSpan,
  normalizeMonth,
  ok,
  resolveDateWindow,
  round2,
} from "@/lib/mcp/tools/helpers"
import {
  amendmentView,
  capacityForMonths,
  contractStatus,
  contractTerms,
  groupInvoices,
  groupRevenue,
  groupTimecards,
  invoiceDrafts,
  meetingCard,
  monthEndNext,
  monthToClose,
  opportunityTerms,
  planProjection,
  planTotals,
  plural,
  resolveClient,
  resolveCompanyAccount,
  fileSummary,
  resolveEngagement,
  resolveSolution,
  revenueCells,
  solutionCard,
} from "@/lib/mcp/tools/helpers"
import { registerGetFile } from "@/lib/mcp/tools/invoice-files"
import { sortMeetings } from "@/lib/meetings"
import { BLOCKING, NOT_NEEDED, STEP_INFO, monthEndChecklist, monthEndFloor, openMonths, stepsOn } from "@/lib/month-end"
import {
  isActionOverdue,
  isOpen,
  monthlyValue,
  OPEN_STAGES,
  STAGE_LABELS,
  weightedMonthlyValue,
  weightedPipelineMonthly,
} from "@/lib/opportunities"
import { margin as quarterMargin, quarterRows } from "@/lib/quarters"
import { filterSolutions } from "@/lib/solutions"
import { isTaskOverdue, normalizeLabels, sortTasks, statusOf, taskClientId } from "@/lib/tasks"
import { hoursAction, monthHours, planCells } from "@/lib/timecards"
import { z } from "@/lib/zod"
import { isModuleOn } from "@/modules"
import { companyDeadlineKindSchema, SOLUTION_SECTIONS, solutionSectionKeySchema, solutionStatusSchema } from "@/types/schemas"

import type { CashRow } from "@/lib/cash-book"
import type { StepKey } from "@/lib/month-end"
import type { MeetingHealth, Opportunity } from "@/types"
import type { McpServer } from "@modelcontextprotocol/server"

/** "2026-08" for today — every UI grid originates at the current month. */
const currentMonth = () => format(new Date(), "yyyy-MM")

const dayInput = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")

/** Worst first: red, yellow, no status, green. */
const HEALTH_RANK = { red: 0, yellow: 1, none: 2, green: 3 } as const
const healthRank = (h: MeetingHealth | null) => HEALTH_RANK[h ?? "none"]

function opportunityCard(o: Opportunity) {
  return {
    id: o.id,
    title: o.title,
    stage: o.stage,
    stageLabel: STAGE_LABELS[o.stage],
    probability: o.probability,
    ...opportunityTerms(o),
    estimatedDurationMonths: o.estimatedDurationMonths,
    monthlyValue: monthlyValue(o),
    weightedMonthlyValue: weightedMonthlyValue(o),
    nextActionDate: o.nextActionDate ? isoDate(o.nextActionDate) : null,
    nextActionNote: o.nextActionNote,
    actionOverdue: isActionOverdue(o, new Date()),
  }
}

export function registerCrmReadTools(server: McpServer): void {
  const db = getServerDb
  registerGetFile(server)

  server.registerTool(
    "list_clients",
    {
      title: "List Clients",
      description:
        "Lists CRM clients with their monthly contract value (€/month from active engagements, at the day rate " +
        "in force this month) and " +
        "open opportunity count. Use to find a client's exact name/id before other calls, or to answer " +
        "'which clients do I have?'.",
      inputSchema: z.object({ includeArchived: z.boolean().optional() }),
    },
    async ({ includeArchived }, ctx) => {
      try {
        const userId = userIdOf(ctx)
        const thisMonth = currentMonth()
        const [clients, engagements, opportunities] = await Promise.all([
          db().getClients(userId, { activeOnly: !includeArchived }),
          db().getEngagements(userId, { activeOnly: true }),
          db().getOpportunities(userId, { openOnly: true }),
        ])
        const rows = clients.map((c) => ({
          id: c.id,
          name: c.name,
          vatNumber: c.vatNumber,
          email: c.email,
          isActive: c.isActive,
          // clients-shell.tsx formula, deliberately unrounded: the rate in force this month
          activeMonthly: engagements
            .filter((e) => e.clientId === c.id)
            .reduce((s, e) => s + e.defaultDaysPerMonth * rateAt(e, thisMonth), 0),
          openOpportunities: opportunities.filter((o) => o.clientId === c.id).length,
        }))
        return ok({ summary: `${plural(rows.length, "client", "clients")}.`, clients: rows })
      } catch (e) {
        return toolError(e)
      }
    }
  )

  server.registerTool(
    "get_client",
    {
      title: "Client Details",
      description:
        "Everything about one client before a call: contracts (with name, rate, contracted-days budget, " +
        "end month, lastDay — the last day hours can be logged — and exhaustion month: null once the days worked pass the budget), open opportunities, and recent explicit month allocations. " +
        "Each contract carries its status (health green/yellow/red, from its latest meeting that " +
        "states one; healthAsOf is the day it was stated) and lastMeetingDate; list_meetings has the " +
        "calls. dailyRate and contractedDays are the signed terms; rateNow is the day rate in force this month, " +
        "budgetDays the signed days plus every amendment's, and amendments (when there are any) lists the dated " +
        "changes as recorded (from, dailyRate, addedDays, lastDay, note): what each addendum said. " +
        "A contract signed in hours (unit \"hour\") says hourlyRate, defaultHoursPerMonth, contractedHours and " +
        "budgetHours instead, its rateNow is €/h, and its amendments say hourlyRate and addedHours. " +
        "Accepts the client's name or id.",
      inputSchema: z.object({
        client: z.string().min(1),
        allocationMonths: z.number().int().min(1).max(24).optional(),
      }),
    },
    async ({ client: query, allocationMonths = 6 }, ctx) => {
      try {
        const userId = userIdOf(ctx)
        const from = currentMonth()
        // Every row, as the Clients card loads them: the burn-down walks each
        // contract from its start (#155), and the recent list takes its own slice.
        const [clients, engagements, opportunities, allocations, meetings, timecards] = await Promise.all([
          db().getClients(userId),
          db().getEngagements(userId),
          db().getOpportunities(userId),
          db().getAllocations(userId),
          db().getMeetings(userId),
          db().getTimecards(userId),
        ])
        const today = isoDate(new Date())
        const client = resolveClient(clients, query)
        const own = engagements.filter((e) => e.clientId === client.id)
        const ownIds = new Set(own.map((e) => e.id))
        const status = contractStatus(meetings)
        // Only the lights that need attention, on active contracts: a closed one shows no chip either.
        const alarms = (["red", "yellow"] as const)
          .map((h) => [h, own.filter((e) => e.isActive && status(e.id).health === h).length] as const)
          .filter(([, n]) => n > 0)
          .map(([h, n]) => `${n} ${h}`)

        // The burn-down month, then hidden once a contract is worked past its budget, as every screen does (runOutMonth).
        const sources = toRevenueSources({ engagements, opportunities: [], clients, scenario: "committed" })
        const burn = new Map(
          computeBurnDown({ sources, allocations, fromMonth: from, months: 36 }).map((b) => [
            b.sourceId,
            b.exhaustionMonth,
          ])
        )

        return ok({
          summary: `${client.name}: ${plural(own.filter((e) => e.isActive).length, "active contract", "active contracts")}${
            alarms.length ? ` (${alarms.join(", ")})` : ""
          }, ${plural(
            opportunities.filter((o) => o.clientId === client.id && isOpen(o)).length,
            "open opportunity",
            "open opportunities"
          )}.`,
          client: {
            id: client.id,
            name: client.name,
            vatNumber: client.vatNumber,
            email: client.email,
            contactName: client.contactName,
            contactPhone: client.contactPhone,
            notes: client.notes,
            isActive: client.isActive,
          },
          engagements: own.map((e) => ({
            id: e.id,
            name: e.name,
            isActive: e.isActive,
            ...contractTerms(e, from),
            startMonth: e.startMonth,
            endMonth: e.endMonth,
            // The last day hours can be logged, so the model never works out month ends.
            lastDay: contractEndDate(e),
            vatApplicable: e.vatApplicable,
            exhaustionMonth: runOutMonth(contractUsage({ engagement: e, timecards, cells: [], today }), burn.get(e.id) ?? null),
            notes: e.notes,
            ...(e.amendments?.length ? { amendments: e.amendments.map((a) => amendmentView(a, contractUnit(e))) } : {}),
            ...status(e.id),
          })),
          openOpportunities: opportunities
            .filter((o) => o.clientId === client.id && isOpen(o))
            .map(opportunityCard),
          recentAllocations: allocations
            .filter(
              (a) =>
                ownIds.has(a.engagementId) &&
                a.yearMonth <= from &&
                a.yearMonth >= monthShift(from, -(allocationMonths - 1))
            )
            .map((a) => ({ engagementId: a.engagementId, yearMonth: a.yearMonth, days: a.days })),
        })
      } catch (e) {
        return toolError(e)
      }
    }
  )

  server.registerTool(
    "get_pipeline",
    {
      title: "Sales Pipeline",
      description:
        "The sales pipeline grouped by stage (lead → proposal → negotiation, plus closed deals), with " +
        "per-opportunity monthly and probability-weighted values. Total mirrors the pipeline page KPI.",
      inputSchema: z.object({}),
    },
    async (_input, ctx) => {
      try {
        const userId = userIdOf(ctx)
        const [opportunities, clients] = await Promise.all([
          db().getOpportunities(userId),
          db().getClients(userId),
        ])
        const nameById = new Map(clients.map((c) => [c.id, c.name]))
        const card = (o: Opportunity) => ({
          clientName: nameById.get(o.clientId) ?? "Unknown client",
          ...opportunityCard(o),
        })

        return ok({
          summary: `Weighted pipeline: €${weightedPipelineMonthly(opportunities)}/month over ${plural(
            opportunities.filter(isOpen).length,
            "open opportunity",
            "open opportunities"
          )}.`,
          weightedMonthlyTotal: weightedPipelineMonthly(opportunities),
          stages: OPEN_STAGES.map((stage) => ({
            stage,
            label: STAGE_LABELS[stage],
            opportunities: opportunities.filter((o) => o.stage === stage).map(card),
          })),
          closed: opportunities
            .filter((o) => o.stage === "won" || o.stage === "lost")
            .map((o) => ({
              ...card(o),
              lostReason: o.lostReason,
              closedAt: o.closedAt?.toISOString() ?? null,
            })),
        })
      } catch (e) {
        return toolError(e)
      }
    }
  )

  server.registerTool(
    "get_revenue",
    {
      title: "Revenue by Period",
      description:
        "Revenue for an explicit month window, grouped by month, quarter, or client. Use for " +
        "«quanto ho fatturato nel Q2?» → from 2026-04, to 2026-06, or 'how much will I make in October?'. " +
        "Convert month and quarter names in any language to YYYY-MM yourself. basis: 'accrued' (default, by " +
        "accrual month «competenza»: allocated days (hours ÷ 8 on an hourly contract) × the daily rate in force that month — the same engine as the Plan " +
        "page; a row says plannedHours and billableHours when every contract in it is hourly, plannedDays and billableDays otherwise); 'invoiced' = real invoices by their accrual month (one covering several months " +
        "counts in its last accrual month, yearMonth); 'paid' = only invoices " +
        "actually collected, keyed on the payment month (cash). rows carry the net amount «imponibile» as " +
        "revenue with VAT apart. scenario 'committed' = signed contracts only; 'weighted' adds open " +
        "pipeline at probability and only applies to 'accrued'. Note: a closed contract still counts up " +
        "to its end month.",
      inputSchema: z.object({
        from: monthInput,
        to: monthInput.optional(),
        groupBy: z.enum(["month", "quarter", "client"]).optional(),
        scenario: z.enum(["committed", "weighted"]).optional(),
        basis: z.enum(["accrued", "invoiced", "paid"]).optional(),
      }),
    },
    async (input, ctx) => {
      try {
        const userId = userIdOf(ctx)
        // Months first: a malformed month is a date error whatever the basis is.
        const from = normalizeMonth(input.from)
        const to = normalizeMonth(input.to ?? input.from)
        if (monthSpan(from, to) > 36) {
          throw new ToolInputError("Window too wide: at most 36 months.")
        }
        const basis = input.basis ?? "accrued"
        const groupBy = input.groupBy ?? "month"
        const window = to !== from ? `${from}–${to}` : from

        if (basis !== "accrued") {
          if (!isModuleOn("invoicing")) {
            throw new ToolInputError(`Basis '${basis}' needs the Invoicing module, which this deployment leaves out. Ask for basis 'accrued'.`)
          }
          // Erroring beats ignoring the flag: a weighted invoice is nonsense, and
          // a silently-dropped scenario would answer a question nobody asked.
          if (input.scenario === "weighted") {
            throw new ToolInputError(
              `scenario 'weighted' applies only to basis 'accrued': issued invoices are not weighted ` +
                `by probability. Ask for basis '${basis}' without a scenario, or basis 'accrued'.`
            )
          }
          const [invoices, engagements, clients] = await Promise.all([
            db().getInvoices(userId),
            db().getEngagements(userId),
            db().getClients(userId),
          ])
          const nameById = new Map(clients.map((c) => [c.id, c.name]))
          // 'invoiced' keys on competenza, 'paid' on the cash month — and 'paid'
          // drops what has not been collected instead of counting it as zero.
          const items = invoices.flatMap((i) => {
            const key = basis === "paid" ? (i.paidDate && format(i.paidDate, "yyyy-MM")) : i.yearMonth
            if (!key || key < from || key > to) return []
            return [{
              yearMonth: key,
              clientName: nameById.get(invoiceClientId(i, engagements) ?? "") ?? "Unknown client",
              amount: i.amount,
              vat: i.vat,
            }]
          })
          const rows = groupInvoices(items, groupBy)
          const total = round2(rows.reduce((s, r) => s + r.revenue, 0))
          const vat = round2(rows.reduce((s, r) => s + r.vat, 0))
          return ok({
            summary:
              `${basis === "paid" ? "Collected" : "Invoiced"} ${window}: €${total} net ` +
              `over ${plural(items.length, "invoice", "invoices")} (VAT €${vat}).`,
            basis,
            scenario: null,
            from,
            to,
            groupBy,
            rows,
            total,
            vat,
          })
        }

        const scenario = input.scenario ?? "committed"
        // Every contract: toRevenueSources keeps a closed one for the months up to its
        // end, so closing a contract does not rewrite a quarter already billed. Every
        // allocation row: a budget burns from the contract's start, not from `from`.
        const [engagements, opportunities, clients, allocations] = await Promise.all([
          db().getEngagements(userId),
          scenario === "weighted"
            ? db().getOpportunities(userId, { openOnly: true })
            : Promise.resolve([]),
          db().getClients(userId),
          db().getAllocations(userId),
        ])
        const sources = toRevenueSources({ engagements, opportunities, clients, scenario })
        const hourlyIds = new Set([...engagements, ...opportunities].filter((s) => contractUnit(s) === "hour").map((s) => s.id))
        const rows = groupRevenue(revenueCells({ sources, allocations, from, to }), groupBy, (id) => hourlyIds.has(id))
        const total = round2(rows.reduce((s, r) => s + r.revenue, 0))

        return ok({
          summary: `Accrued revenue ${window} (${scenario}): €${total}.`,
          basis,
          scenario,
          from,
          to,
          groupBy,
          rows,
          total,
        })
      } catch (e) {
        return toolError(e)
      }
    }
  )

  server.registerTool(
    "list_invoices",
    {
      title: "List Invoices",
      description:
        "Lists issued invoices — unpaid first, soonest due first, with an overdue flag and the total " +
        "owed (net amount «imponibile» + VAT as charged). Answers «chi non mi ha pagato?» → unpaidOnly, " +
        "or 'which invoices did I send Acme?' → client. yearMonth filters on the accrual month " +
        "«competenza», not the issue date. A negative amount is a credit note «nota di credito», not an error. " +
        "Invoices belong to a client, not a contract. fromMonth, when set, is the first accrual month of an " +
        "invoice covering several, and yearMonth (which the filter reads) is the last; null = one month.",
      inputSchema: z.object({
        client: z.string().min(1).optional(),
        unpaidOnly: z.boolean().optional(),
        yearMonth: monthInput.optional(),
      }),
    },
    async (input, ctx) => {
      try {
        const userId = userIdOf(ctx)
        const [invoices, engagements, clients] = await Promise.all([
          db().getInvoices(userId),
          db().getEngagements(userId),
          db().getClients(userId),
        ])
        const nameById = new Map(clients.map((c) => [c.id, c.name]))

        let pool = invoices
        if (input.client) {
          const client = resolveClient(clients, input.client)
          pool = pool.filter((i) => invoiceClientId(i, engagements) === client.id)
        }
        if (input.unpaidOnly) pool = pool.filter((i) => i.paidDate == null)
        if (input.yearMonth) {
          const yearMonth = normalizeMonth(input.yearMonth)
          pool = pool.filter((i) => i.yearMonth === yearMonth)
        }

        const today = new Date()
        const rows = sortInvoices(pool).map((i) => ({
          id: i.id,
          number: i.number,
          client: nameById.get(invoiceClientId(i, engagements) ?? "") ?? null,
          clientId: invoiceClientId(i, engagements),
          fromMonth: i.fromMonth,
          yearMonth: i.yearMonth,
          amount: i.amount,
          vat: i.vat,
          total: invoiceTotal(i),
          dueDate: i.dueDate ? isoDate(i.dueDate) : null,
          paidDate: i.paidDate ? isoDate(i.paidDate) : null,
          overdue: isInvoiceOverdue(i, today),
          file: fileSummary(i.file),
        }))
        const overdue = rows.filter((r) => r.overdue)
        const overdueTotal = round2(overdue.reduce((s, r) => s + r.total, 0))
        return ok({
          summary:
            `${rows.length} ${input.unpaidOnly ? "unpaid " : ""}${rows.length === 1 ? "invoice" : "invoices"}` +
            (overdue.length ? `, ${overdue.length} overdue (€${overdueTotal}).` : "."),
          invoices: rows,
        })
      } catch (e) {
        return toolError(e)
      }
    }
  )

  server.registerTool(
    "get_unbilled",
    {
      title: "Left to Invoice",
      description:
        "What is still to invoice from the hours log_time recorded, per client: an invoice bills the client, and " +
        "one invoice a month covers the hours of all its contracts. For each client and accrual month " +
        "«competenza»: hours, days (8 h each), logged = Σ of each contract's days × its daily rate in force that month (net " +
        "«imponibile»; contracts lists those lines), invoiced = net already invoiced for that month (credit notes " +
        "subtract), left = logged − invoiced, unbilled = what the month still holds of the balance once a month " +
        "invoiced ahead (one invoice for several months) has covered the oldest ones. An invoice covering several " +
        "months (fromMonth–yearMonth) is spread over them by the value logged in each ended month, evenly when " +
        "none is, and the current month and later take an even share each (so an advance never covers older " +
        "months); " +
        "months before the client's first hours never count, and invoiceNumbers names it on each of its months. " +
        "toInvoice is the client's " +
        "balance over ended months since its hours were first logged, Σ unbilled when positive — the same " +
        "figure as the Invoices page. partlyLogged marks the client's first logged month when its hours start " +
        "part-way: its negative left is unlogged days, not money ahead. Answers «cosa devo ancora fatturare a " +
        "Dunder?» → client 'Dunder'; 'what do I invoice this month?' → no arguments, which lists only clients " +
        "with something to invoice. engagementId (a contract's id or name) answers for that contract's client. " +
        "Before create_invoice offer a client's suggestions: one invoice per run of fully open months, with the " +
        "next number and the customer's usual due date, as the Invoices page proposes. Confirm the number with " +
        "the owner. Never use left, and never more than toInvoice in total. " +
        "The current month is partial ('current': true), not in toInvoice and never unbilled. A client with " +
        "hoursLogged false was never logged: say so rather than calling it invoiced; notLogged names the active " +
        "contracts with no hours. Hours dated after today (scheduled with log_time) count from their day on. " +
        "Months not yet worked: get_plan. Unpaid invoices: list_invoices unpaidOnly.",
      inputSchema: z.object({
        client: z.string().min(1).optional(),
        engagementId: z.string().min(1).optional(),
      }),
    },
    async (input, ctx) => {
      try {
        const userId = userIdOf(ctx)
        const [engagements, clients, timecards, invoices] = await Promise.all([
          // Every contract, not only active ones: a closed contract's hours can still be unbilled.
          db().getEngagements(userId),
          db().getClients(userId),
          db().getTimecards(userId),
          db().getInvoices(userId),
        ])
        let scope = clients
        if (input.client) scope = [resolveClient(clients, input.client)]
        if (input.engagementId) {
          const contract = resolveEngagement(
            engagements.filter((e) => scope.some((c) => c.id === e.clientId)),
            clients,
            input.engagementId
          )
          scope = clients.filter((c) => c.id === contract.clientId)
        }
        const filtered = Boolean(input.client || input.engagementId)

        const today = isoDate(new Date())
        const cm = today.slice(0, 7)
        const contractById = new Map(engagements.map((e) => [e.id, e]))
        // Same function and inputs as the Invoices page, so chat and UI agree to the cent.
        const billed = scope.map((client) => ({
          client,
          b: clientBilling({ clientId: client.id, engagements, timecards, invoices, today }),
        }))
        // From the lines, not the timecards: hours scheduled after today do not count as logged yet.
        const notLogged = billed.flatMap(({ client, b }) => {
          const logged = new Set(b.months.flatMap((m) => m.contracts.map((l) => l.engagementId)))
          return engagements
            .filter((e) => e.clientId === client.id && e.isActive && !logged.has(e.id))
            .map((e) => `${client.name} · ${engagementLabel(e)}`)
        })
        const listed = billed
          .filter(({ b }) => filtered || (b.toInvoice ?? 0) > 0 || (b.thisMonth ?? 0) > 0)
          .sort((x, y) => (y.b.toInvoice ?? 0) - (x.b.toInvoice ?? 0))
        const vatShares = new Map<string, number[]>()
        // Numbered in turn across clients, so two suggestions never share a number.
        const drafts = invoiceDrafts({ invoices, engagements, billed: billed.map(({ b }) => b), today })
        const result = listed.map(({ client, b }) => ({
          client: client.name,
          clientId: client.id,
          hoursLogged: b.loggedSince !== null,
          loggedSince: b.loggedSince,
          toInvoice: b.toInvoice,
          thisMonth: b.thisMonth,
          // The page's Ready to Invoice rows, word for word; none when nothing is owed.
          ...((b.toInvoice ?? 0) > 0 ? { suggestions: drafts.get(client.id) ?? [] } : {}),
          // Untracked rows (left null) and settled ended months say nothing to invoice.
          months: b.months.flatMap((m) => {
            if (m.hours === null || m.left === null || (m.left === 0 && m.yearMonth !== cm)) return []
            if (m.unbilled > 0) vatShares.set(client.id, [...(vatShares.get(client.id) ?? []), m.vatShare])
            return [
              {
                yearMonth: m.yearMonth,
                hours: m.hours,
                days: hoursToDays(m.hours),
                logged: m.logged,
                invoiced: m.invoiced,
                left: m.left,
                unbilled: m.unbilled,
                partlyLogged: m.partlyLogged,
                invoiceNumbers: m.invoices.map((i) => i.number),
                suggestedVat: suggestedVat(m.unbilled, m.vatShare),
                current: m.yearMonth === cm,
                contracts: m.contracts.map((l) => {
                  const e = contractById.get(l.engagementId)
                  return {
                    contract: e ? engagementLabel(e) : l.engagementId,
                    engagementId: l.engagementId,
                    // The rate in force that month: the line's own, not the signed one.
                    dailyRate: l.dailyRate,
                    hours: l.hours,
                    days: hoursToDays(l.hours),
                    logged: l.logged,
                  }
                }),
              },
            ]
          }),
        }))

        const owed = result.filter((c) => (c.toInvoice ?? 0) > 0)
        const total = round2(owed.reduce((s, c) => s + (c.toInvoice ?? 0), 0))
        const soFar = round2(listed.reduce((s, { b }) => s + (b.thisMonth ?? 0), 0))
        const soFarDays = round2(hoursToDays(listed.reduce((s, { b }) => s + (b.thisMonthHours ?? 0), 0)))
        const shares = owed.flatMap((c) => vatShares.get(c.clientId) ?? [])
        const vatRate = `${Math.round(IVA_RATE * 100)}%`
        const sentences = [
          total > 0
            ? `${eurCents(total)} net to invoice on ${plural(owed.length, "client", "clients")} — ` +
              owed
                .map(
                  (c) =>
                    `${c.client}: ` +
                    (c.suggestions ?? []).map((s) => `${invoicePeriodLabel(s)} ${eurCents(s.amount)}`).join(", ")
                )
                .join("; ") +
              "."
            : "Nothing left to invoice from logged hours.",
          soFar > 0 && `This month so far ${eurCents(soFar)} (${soFarDays} d).`,
          total > 0 &&
            (shares.every((v) => v === 1)
              ? `VAT ${vatRate} applies.`
              : shares.every((v) => v === 0)
                ? "No VAT on these hours."
                : `VAT ${vatRate} on the VAT-liable contracts only: use suggestedVat.`),
          notLogged.length > 0 && `No hours logged yet on ${notLogged.join(", ")}.`,
        ]

        return ok({ summary: sentences.filter(Boolean).join(" "), total, clients: result, notLogged })
      } catch (e) {
        return toolError(e)
      }
    }
  )

  server.registerTool(
    "list_deadlines",
    {
      title: "List Deadlines",
      description:
        "Lists the deadlines you typed in yourself — the accountant's fee, an F24 the accountant gave you, a contract " +
        "renewal, a bank formality — soonest first, with an overdue flag. Answers 'what deadlines do I have?'. NOTE: " +
        "this is only the stored list, and the app computes no taxes: an F24 is here only if it was stored. Invoice due " +
        "dates, pipeline follow-ups and budget exhaustion are computed and never stored here: " +
        "invoice due dates are list_invoices, follow-ups get_pipeline, a contract's budget exhaustion get_client. " +
        "Whether a month that has ended is closed, its deadlines included: get_month_end. Done deadlines stay " +
        "hidden unless includeDone.",
      inputSchema: z.object({
        kind: companyDeadlineKindSchema.optional(),
        includeDone: z.boolean().optional(),
      }),
    },
    async (input, ctx) => {
      try {
        const userId = userIdOf(ctx)
        const deadlines = await db().getCompanyDeadlines(userId)

        let pool = deadlines
        if (input.kind) pool = pool.filter((d) => d.kind === input.kind)
        if (!input.includeDone) pool = pool.filter((d) => !d.isDone)

        const today = isoDate(new Date())
        const rows = pool
          .map((d) => ({
            id: d.id,
            title: d.title,
            date: isoDate(d.date),
            kind: d.kind,
            amount: d.amount,
            notes: d.notes,
            isDone: d.isDone,
          }))
          // Open before done, then soonest first — the same order the Deadlines page uses.
          .sort((a, b) => Number(a.isDone) - Number(b.isDone) || a.date.localeCompare(b.date))
          .map((r) => ({ ...r, overdue: !r.isDone && r.date < today }))

        const overdue = rows.filter((r) => r.overdue).length
        return ok({
          summary:
            `${rows.length} ${input.includeDone ? "" : "open "}${rows.length === 1 ? "deadline" : "deadlines"}` +
            (overdue ? `, ${overdue} overdue.` : "."),
          deadlines: rows,
        })
      } catch (e) {
        return toolError(e)
      }
    }
  )

  server.registerTool(
    "get_plan",
    {
      title: "Monthly Plan",
      description:
        "The next months' plan exactly as the Plan page shows it: per month, each contract's planned " +
        "and billable days, the budget left after the month (remainingDays, null = no budget) and " +
        "revenue (billable days × the daily rate in force that month; a contract signed in hours says plannedHours, billableHours and remainingHours), plus capacity (available days, time off, overbooking flag). " +
        "Also per month the costs, split into collaborators (their fixed fees and planned days × rate) and other " +
        "(the Costs page), with the net (revenue less costs), and the totals over the window; net of VAT, committed " +
        "contracts only, no taxes. Capacity counts the owner's own days: the collaborators' days on a contract are not his. " +
        "Use for 'how do the next months look?' or before committing new work.",
      inputSchema: z.object({ months: z.number().int().min(1).max(24).optional() }),
    },
    async ({ months = 12 }, ctx) => {
      try {
        const userId = userIdOf(ctx)
        const from = currentMonth()
        const to = monthShift(from, months - 1)
        // Every contract and every allocation row, as get_revenue: the engine and
        // capacityForMonths pick the months they need.
        const [engagements, clients, allocations, capacityDocs, expenses, collaborators, assignments] = await Promise.all([
          db().getEngagements(userId),
          db().getClients(userId),
          db().getAllocations(userId),
          db().getCapacityDocs(userId, { from, to }),
          db().getCompanyExpenses(userId),
          db().getCollaborators(userId),
          db().getAssignments(userId),
        ])
        const sources = toRevenueSources({ engagements, opportunities: [], clients, scenario: "committed" })
        const cells = revenueCells({ sources, allocations, from, to })
        const capacity = capacityForMonths({ engagements, allocations, capacityDocs, from, months, collaborators, assignments })
        // The Projection the Plan page reads: its collaborators / other costs / costs, one engine.
        const projection = planProjection({ engagements, clients, allocations, expenses, collaborators, assignments }, from, months)
        const costsOf = new Map(projection.map((p) => [p.yearMonth, p]))

        const unitOf = new Map(engagements.map((e) => [e.id, contractUnit(e)]))
        const monthsOut = capacity.map((cap) => {
          const monthCells = cells.filter((c) => c.yearMonth === cap.yearMonth && c.plannedDays > 0)
          return {
            yearMonth: cap.yearMonth,
            lines: monthCells.map((c) => ({
              engagementId: c.sourceId,
              clientName: c.clientName,
              ...(unitOf.get(c.sourceId) === "hour"
                ? {
                    unit: "hour",
                    plannedHours: inContractUnit(c.plannedDays, "hour"),
                    billableHours: inContractUnit(c.billableDays, "hour"),
                    remainingHours: Number.isFinite(c.remainingDays) ? inContractUnit(c.remainingDays, "hour") : null,
                  }
                : {
                    plannedDays: c.plannedDays,
                    billableDays: c.billableDays,
                    remainingDays: Number.isFinite(c.remainingDays) ? c.remainingDays : null,
                  }),
              revenue: round2(c.billableDays * c.weight * c.dailyRate),
              capped: c.capped,
            })),
            revenue: round2(
              monthCells.reduce((s, c) => s + round2(c.billableDays * c.weight * c.dailyRate), 0)
            ),
            costs: {
              collaborators: costsOf.get(cap.yearMonth)?.collaborators ?? 0,
              other: costsOf.get(cap.yearMonth)?.otherCosts ?? 0,
              total: costsOf.get(cap.yearMonth)?.costs ?? 0,
            },
            net: round2((costsOf.get(cap.yearMonth)?.revenue ?? 0) - (costsOf.get(cap.yearMonth)?.costs ?? 0)),
            capacity: cap,
          }
        })
        const { revenue, collaborators: collaboratorsCost, otherCosts, costs, net } = planTotals(projection)
        const overbooked = capacity.filter((c) => c.overbooked).map((c) => c.yearMonth)
        return ok({
          summary:
            overbooked.length > 0
              ? `Plan for ${plural(months, "month", "months")}; WARNING: overbooked in ${overbooked.join(", ")}.`
              : `Plan for ${plural(months, "month", "months")}, nothing overbooked.`,
          from,
          months: monthsOut,
          totals: { revenue, collaborators: collaboratorsCost, other: otherCosts, costs, net },
        })
      } catch (e) {
        return toolError(e)
      }
    }
  )

  server.registerTool(
    "get_quarters",
    {
      title: "Quarters",
      description:
        "Revenue, costs and net per calendar quarter and month, as the Plan page's Quarters section shows them. A month that " +
        "has ended counts what happened (source invoiced): revenue invoiced for it, collaborators' invoices counted by the " +
        "month of work they pay (For Month, so an invoice dated the next month still counts in its own), other costs by " +
        "date, and the collaborators' plan beside their invoices (fixed fee in force plus the days logged × rate) with the " +
        "gaps naming who has plan that no invoice covers. The current month and later come from the plan (source plan, " +
        "committed contracts only). Costs split into collaborators and other; net = revenue less costs; margin = net over " +
        "revenue in whole percent (null with no revenue). status: closed (all three months ended), in-progress or planned. " +
        "Net of VAT, cash flow only, no taxes. Defaults to this year. «come va il trimestre?» «come chiude l'anno?»",
      inputSchema: z.object({ year: z.number().int().min(2000).max(2100).optional() }),
    },
    async ({ year }, ctx) => {
      try {
        const userId = userIdOf(ctx)
        const today = isoDate(new Date())
        const thisMonth = today.slice(0, 7)
        const y = year ?? Number(thisMonth.slice(0, 4))
        const [engagements, clients, allocations, expenses, collaborators, assignments, invoices, timecards] = await Promise.all([
          db().getEngagements(userId),
          db().getClients(userId),
          db().getAllocations(userId),
          db().getCompanyExpenses(userId),
          db().getCollaborators(userId),
          db().getAssignments(userId),
          db().getInvoices(userId),
          db().getTimecards(userId),
        ])
        // The plan from this month to the year's end (nothing is read from it for a year that has ended).
        const planned = `${y}-12` < thisMonth ? 1 : Math.min(60, monthSpan(thisMonth, `${y}-12`))
        const plan = planProjection({ engagements, clients, allocations, expenses, collaborators, assignments }, thisMonth, planned)
        const { rows, year: total, soFar } = quarterRows({ year: y, today, invoices, engagements, timecards, expenses, plan, collaborators, assignments })
        const shape = (t: { revenue: number; collaborators: number; otherCosts: number; costs: number; net: number }) => ({
          revenue: t.revenue,
          costs: { collaborators: t.collaborators, other: t.otherCosts, total: t.costs },
          net: t.net,
          margin: quarterMargin(t),
        })
        const quarters = rows.map((r) => ({
          quarter: r.quarter,
          status: r.status,
          ...shape(r),
          // A closed quarter: what the collaborators' plan says, to set beside what they invoiced.
          collaboratorsPlan: r.plan,
          notInvoiced: r.notInvoiced,
          months: r.months.map((m) => ({
            yearMonth: m.yearMonth,
            source: m.source,
            revenue: m.revenue,
            collaborators: m.collaborators,
            otherCosts: m.otherCosts,
            costs: m.costs,
            net: round2(m.revenue - m.costs),
            collaboratorsPlan: m.plan,
            missing: m.missing,
          })),
        }))
        const gaps = rows.flatMap((r) => r.months.flatMap((m) => m.missing.map((x) => `${x.name} in ${m.yearMonth}`)))
        return ok({
          summary:
            `${y}: revenue ${eurCents(total.revenue)}, costs ${eurCents(total.costs)} (collaborators ${eurCents(total.collaborators)}, other ${eurCents(total.otherCosts)}), ` +
            `net ${eurCents(total.net)}. ` +
            rows.map((r) => `Q${r.quarter} ${r.status}`).join(", ") +
            (gaps.length ? `. Collaborators not invoiced: ${gaps.join(", ")}.` : "."),
          year: y,
          quarters,
          totals: shape(total),
          soFar: { revenue: soFar.revenue, costs: soFar.costs, net: soFar.net },
        })
      } catch (e) {
        return toolError(e)
      }
    }
  )

  server.registerTool(
    "get_capacity",
    {
      title: "Capacity and Time Off",
      description:
        "Available vs allocated days per month: shows time off (vacation, training), remaining free days " +
        "and overbooked months. Allocated days are the plan's: the days recorded for the month, " +
        "otherwise the contract default while its budget and end month last, less the days the active collaborators " +
        "take on those contracts (only the owner's own days load the owner). Use for 'how free am I " +
        "in September?' or before blocking vacation.",
      inputSchema: z.object({
        from: monthInput.optional(),
        months: z.number().int().min(1).max(24).optional(),
      }),
    },
    async (input, ctx) => {
      try {
        const userId = userIdOf(ctx)
        const from = input.from ? normalizeMonth(input.from) : currentMonth()
        const months = input.months ?? 6
        const to = monthShift(from, months - 1)
        // Every contract and every row, as get_plan: the budget burns from each contract's
        // start, so capacity needs the rows before `from`.
        const [engagements, allocations, capacityDocs, collaborators, assignments] = await Promise.all([
          db().getEngagements(userId),
          db().getAllocations(userId),
          db().getCapacityDocs(userId, { from, to }),
          db().getCollaborators(userId),
          db().getAssignments(userId),
        ])
        const capacity = capacityForMonths({ engagements, allocations, capacityDocs, from, months, collaborators, assignments })
        const free = capacity.reduce((s, c) => s + Math.max(0, c.remaining), 0)
        return ok({
          summary: `${plural(free, "free day", "free days")} over ${plural(months, "month", "months")} from ${from}.`,
          months: capacity,
        })
      } catch (e) {
        return toolError(e)
      }
    }
  )

  server.registerTool(
    "list_tasks",
    {
      title: "List Tasks",
      description:
        "Lists to-dos with their board column (status todo / doing / done), client and contract, open first " +
        "and soonest due first, with an overdue flag: 'what do I have to do?', 'what is there to do for " +
        "Acme?', 'what is in progress on Cloud migration?', «cosa è in ritardo?» → overdueOnly. A task " +
        "belongs to a client and optionally to one of its contracts: a client-level task has engagementId " +
        "and engagementLabel null. client filters to one client, its client-level tasks included; " +
        "engagementId to one contract by id or name (within the client when both are given), which leaves " +
        "client-level tasks out; status keeps one column and overrides includeDone; overdueOnly keeps the " +
        "late ones. Rows carry their labels; label keeps the tasks carrying that label, ignoring case " +
        "('what is labelled invoice?', 'the tasks labelled urgent'). Done tasks stay hidden unless " +
        "includeDone. The engagements array describes every contract the rows point at.",
      inputSchema: z.object({
        client: z.string().min(1).optional(),
        engagementId: z.string().min(1).optional(),
        status: z.enum(["todo", "doing", "done"]).optional(),
        overdueOnly: z.boolean().optional(),
        includeDone: z.boolean().optional(),
        label: z.string().min(1).max(100).optional(),
      }),
    },
    async (input, ctx) => {
      try {
        const userId = userIdOf(ctx)
        const [tasks, engagements, clients] = await Promise.all([
          db().getTasks(userId),
          db().getEngagements(userId),
          db().getClients(userId),
        ])
        const clientNameById = new Map(clients.map((c) => [c.id, c.name]))
        const engagementById = new Map(engagements.map((e) => [e.id, e]))
        const clientName = (clientId: string | null) => clientNameById.get(clientId ?? "") ?? null

        let pool = tasks
        const client = input.client ? resolveClient(clients, input.client) : null
        if (input.engagementId) {
          const scope = client ? engagements.filter((e) => e.clientId === client.id) : engagements
          const engagement = resolveEngagement(scope, clients, input.engagementId)
          pool = pool.filter((t) => t.engagementId === engagement.id)
        } else if (client) {
          pool = pool.filter((t) => taskClientId(t, engagements) === client.id)
        }
        const today = new Date()
        if (input.status) pool = pool.filter((t) => statusOf(t) === input.status)
        else if (!input.includeDone) pool = pool.filter((t) => !t.isDone)
        if (input.overdueOnly) pool = pool.filter((t) => isTaskOverdue(t, today))
        if (input.label !== undefined) {
          // Normalized as a stored label is, so " Fattura  cliente" finds "fattura cliente".
          const wanted = normalizeLabels([input.label])[0]?.toLowerCase()
          pool = pool.filter((t) => t.labels.some((l) => l.toLowerCase() === wanted))
        }

        const rows = sortTasks(pool).map((t) => {
          const e = t.engagementId ? engagementById.get(t.engagementId) : undefined
          const clientId = taskClientId(t, engagements)
          return {
            id: t.id,
            title: t.title,
            status: statusOf(t),
            clientId,
            client: clientName(clientId),
            engagementId: t.engagementId,
            engagementLabel: e ? engagementLabel(e) : null,
            dueDate: t.dueDate ? isoDate(t.dueDate) : null,
            overdue: isTaskOverdue(t, today),
            isDone: t.isDone,
            labels: t.labels,
            notes: t.notes,
          }
        })
        const shown = [...new Set(rows.map((r) => r.engagementId))]
          .map((id) => (id ? engagementById.get(id) : undefined))
          .filter((e) => e !== undefined)
          .map((e) => ({
            id: e.id,
            name: e.name,
            label: engagementLabel(e),
            client: clientName(e.clientId),
            dailyRate: e.dailyRate,
            startMonth: e.startMonth,
          }))

        const tally = { todo: 0, doing: 0, done: 0 }
        for (const r of rows) tally[r.status]++
        const overdue = rows.filter((r) => r.overdue).length
        const parts = [
          tally.todo && `${tally.todo} to do`,
          tally.doing && `${tally.doing} in progress`,
          tally.done && `${tally.done} done`,
          overdue && `${overdue} overdue`,
        ].filter(Boolean)
        return ok({
          summary: rows.length ? `${plural(rows.length, "task", "tasks")}: ${parts.join(", ")}.` : "No tasks.",
          tasks: rows,
          engagements: shown,
        })
      } catch (e) {
        return toolError(e)
      }
    }
  )

  server.registerTool(
    "list_time",
    {
      title: "Hours Worked",
      description:
        "Hours worked, from the timecards log_time writes, with days at 8 hours each: " +
        "«quante ore ho fatto questa settimana?» → no arguments (the current week, Monday to Sunday); 'how " +
        "many hours on Dunder in September?' → from 2026-09. from/to take YYYY-MM-DD or YYYY-MM, at most " +
        "12 months. groupBy day (default, with each day's notes), week (ISO, '2026-W39') or month; rows are " +
        "always split by contract, and byContract totals each one. client filters to one client; " +
        "engagementId to one contract by id or name (within the client when both are given). Month rows add " +
        "storedPlannedDays, the days the plan stores for that month (null = the contract default applies). " +
        "useDays is what the Plan page's Use would write for that contract-month (null = nothing to use): offer " +
        "log_allocation mode 'set' with it. Hours dated after " +
        "today (Europe/Rome) are scheduled, not worked: they come apart in scheduled (hours, days, rows), " +
        "never in total, byContract or rows. Actuals; scheduled days apart; the forecast is get_plan.",
      inputSchema: z.object({
        from: monthInput.optional(),
        to: monthInput.optional(),
        client: z.string().min(1).optional(),
        engagementId: z.string().min(1).optional(),
        groupBy: z.enum(["day", "week", "month"]).optional(),
      }),
    },
    async (input, ctx) => {
      try {
        const userId = userIdOf(ctx)
        if (input.to && !input.from) {
          throw new ToolInputError("to needs from as well.")
        }
        const now = new Date()
        const window = input.from
          ? resolveDateWindow({ from: input.from, to: input.to })
          : { from: startOfISOWeek(now), to: endOfISOWeek(now) }
        const from = isoDate(window.from)
        const to = isoDate(window.to)
        // A year of days split by contract is already a few hundred rows: past that the
        // reply stops being readable, so a longer question is asked in pieces.
        if (monthSpan(from.slice(0, 7), to.slice(0, 7)) > 12) {
          throw new ToolInputError("Window too wide: at most 12 months per call. Split the period.")
        }
        const groupBy = input.groupBy ?? "day"
        const [timecards, engagements, clients, allocations] = await Promise.all([
          db().getTimecards(userId),
          // Every contract, not only active ones: a closed contract's hours were still worked.
          db().getEngagements(userId),
          db().getClients(userId),
          // Every row, not the window's: the plan's walk starts each budget at its anchor.
          groupBy === "month" ? db().getAllocations(userId) : Promise.resolve([]),
        ])

        let pool = timecards.filter((t) => t.date >= from && t.date <= to)
        if (input.client || input.engagementId) {
          let scope = engagements
          if (input.client) {
            const client = resolveClient(clients, input.client)
            scope = scope.filter((e) => e.clientId === client.id)
          }
          if (input.engagementId) scope = [resolveEngagement(scope, clients, input.engagementId)]
          const ids = new Set(scope.map((e) => e.id))
          pool = pool.filter((t) => ids.has(t.engagementId))
        }

        const engagementById = new Map(engagements.map((e) => [e.id, e]))
        const clientNameById = new Map(clients.map((c) => [c.id, c.name]))
        const describe = (engagementId: string) => {
          const e = engagementById.get(engagementId)
          return {
            engagementId,
            contract: e ? engagementLabel(e) : null,
            client: (e && clientNameById.get(e.clientId)) ?? null,
          }
        }
        const planned = new Map(allocations.map((a) => [`${a.engagementId}:${a.yearMonth}`, a.days]))
        // A day's note is the owner's; a collaborator's rows come first so the owner's wins.
        const notes = new Map([...pool].sort((a, b) => Number(!!b.collaboratorId) - Number(!!a.collaboratorId)).map((t) => [`${t.engagementId}:${t.date}`, t.notes]))
        const today = isoDate(now)
        // The Plan page's Use, by the same rule. It acts on whole months, so it reads every
        // timecard, not only the window's or the filter's.
        const cells = groupBy === "month" ? planCells(engagements, allocations, today.slice(0, 7)) : null
        const hoursOf = cells && monthHours(timecards, today)
        // The Plan passes the month's time off to Use, so list_time does too.
        const daysOffOf = new Map<string, number>()
        if (hoursOf) {
          const months = [...hoursOf.covered.keys()].sort()
          if (months.length > 0) {
            const docs = await db().getCapacityDocs(userId, { from: months[0], to: months[months.length - 1] })
            for (const d of docs) daysOffOf.set(d.yearMonth, d.daysOff)
          }
        }
        const useDays = (engagementId: string, yearMonth: string) => {
          const key = `${engagementId}:${yearMonth}`
          const month = hoursOf?.byCell.get(key)
          if (!cells || !hoursOf || !month) return null
          const e = engagementById.get(engagementId)
          const action = hoursAction({
            yearMonth,
            today,
            end: e ? contractEndDate(e) : null,
            planned: cells.get(key)?.plannedDays ?? null,
            days: month.days,
            covered: hoursOf.covered.get(yearMonth) ?? 0,
            daysOff: daysOffOf.get(yearMonth) ?? 0,
          })
          return action === "use" ? month.days : null
        }
        const toRows = (cards: typeof pool) =>
          groupTimecards(cards, groupBy).map((r) => ({
            period: r.key,
            ...describe(r.engagementId),
            hours: r.hours,
            days: r.days,
            ...(groupBy === "day" && { notes: notes.get(`${r.engagementId}:${r.key}`) ?? null }),
            ...(groupBy === "month" && {
              storedPlannedDays: planned.get(`${r.engagementId}:${r.key}`) ?? null,
              useDays: useDays(r.engagementId, r.key),
            }),
          }))
        // Hours after today are scheduled with log_time, not worked: every existing field stays actuals.
        const ahead = pool.filter((t) => t.date > today)
        const rows = toRows(pool.filter((t) => t.date <= today))
        const aheadRows = toRows(ahead)
        const aheadHours = round2(ahead.reduce((s, t) => s + t.hours, 0))

        const perContract = new Map<string, number>()
        for (const r of rows) perContract.set(r.engagementId, (perContract.get(r.engagementId) ?? 0) + r.hours)
        const byContract = Array.from(perContract, ([engagementId, hours]) => ({
          ...describe(engagementId),
          hours: round2(hours),
          days: hoursToDays(round2(hours)),
        })).sort((a, b) => b.hours - a.hours)
        const hours = round2(rows.reduce((s, r) => s + r.hours, 0))

        const scheduled = plural(aheadHours, "hour", "hours")
        return ok({
          summary: rows.length
            ? `${plural(hours, "hour", "hours")} = ${plural(round2(hoursToDays(hours)), "day", "days")} from ${from} to ${to}, on ` +
              `${plural(byContract.length, "contract", "contracts")}.` +
              (ahead.length ? ` Plus ${scheduled} scheduled after today.` : "")
            : ahead.length
              ? `No hours worked from ${from} to ${to}; ${scheduled} scheduled.`
              : `No hours logged from ${from} to ${to}.`,
          from,
          to,
          groupBy,
          total: { hours, days: hoursToDays(hours) },
          byContract,
          rows,
          ...(ahead.length > 0 && { scheduled: { hours: aheadHours, days: hoursToDays(aheadHours), rows: aheadRows } }),
        })
      } catch (e) {
        return toolError(e)
      }
    }
  )

  server.registerTool(
    "list_meetings",
    {
      title: "Meetings and Status",
      description:
        "The story of the calls (meetings), full text, newest first, plus the status of each contract in " +
        "scope: health green, yellow or red («verde/giallo/rosso» → green/yellow/red) from its latest " +
        "meeting that states one, null = no status. A «progetto» is a contract. 'how are the projects " +
        "going?' → no filters; read contracts, worst first (red, yellow, no status, green). " +
        "«cosa è in rosso?» → health 'red', which keeps the contracts at that light now and the meetings " +
        "that stated it. 'how did the last call with Acme go?' → client 'Acme', limit 1. 'the history of " +
        "the Dunder project' → engagementId 'Dunder' (id or name, closed contracts too): its calls. What was " +
        "built, and its History section, is the solution catalog: get_solution / update_solution. 'what did we " +
        "discuss with Acme in September?' → client + from/to (YYYY-MM-DD, inclusive). client includes its " +
        "client-level meetings (engagementId null); without engagementId the contracts are the active ones " +
        "in scope. limit defaults to 10; total counts every match. healthAsOf is when the status was last " +
        "stated: if it is old, say so rather than presenting it as current.",
      inputSchema: z.object({
        client: z.string().min(1).optional(),
        engagementId: z.string().min(1).optional(),
        from: dayInput.optional(),
        to: dayInput.optional(),
        health: z.enum(["green", "yellow", "red"]).optional(),
        limit: z.number().int().min(1).max(50).optional(),
      }),
    },
    async (input, ctx) => {
      try {
        const userId = userIdOf(ctx)
        const [meetings, engagements, clients] = await Promise.all([
          db().getMeetings(userId),
          // Every contract: a closed one's history is still asked about by name.
          db().getEngagements(userId),
          db().getClients(userId),
        ])
        const client = input.client ? resolveClient(clients, input.client) : null
        const scope = client ? engagements.filter((e) => e.clientId === client.id) : engagements
        const contract = input.engagementId ? resolveEngagement(scope, clients, input.engagementId) : null

        const matches = sortMeetings(
          meetings.filter(
            (m) =>
              (contract ? m.engagementId === contract.id : !client || m.clientId === client.id) &&
              (!input.from || m.date >= input.from) &&
              (!input.to || m.date <= input.to) &&
              (!input.health || m.health === input.health)
          )
        )
        const limit = input.limit ?? 10

        // The current status reads every verbale, never just the window: it is today's light.
        const status = contractStatus(meetings)
        const clientName = new Map(clients.map((c) => [c.id, c.name]))
        const contracts = (contract ? [contract] : scope.filter((e) => e.isActive))
          .map((e) => ({
            engagementId: e.id,
            engagementLabel: engagementLabel(e),
            clientId: e.clientId,
            client: clientName.get(e.clientId) ?? null,
            isActive: e.isActive,
            ...status(e.id),
          }))
          .filter((r) => !input.health || r.health === input.health)
          // Oldest assessment first within a light: the stalest one is the one to ask about.
          .sort((a, b) => healthRank(a.health) - healthRank(b.health) || (a.healthAsOf ?? "").localeCompare(b.healthAsOf ?? ""))

        const shown =
          matches.length <= limit ? "" : limit === 1 ? ", showing the latest" : `, showing the latest ${limit}`
        const name = contract ? engagementLabel(contract) : client?.name
        let summary: string
        if (name) {
          const head = matches.length
            ? `${name}: ${plural(matches.length, "meeting", "meetings")} from ${matches.at(-1)!.date} to ${matches[0].date}${shown}.`
            : `No meetings for ${name}.`
          // One contract in scope is the name already said: "Status: …", not the name twice.
          const lines = contracts.map(
            (r) =>
              `${contract ? "Status" : r.engagementLabel}: ` +
              `${r.health ? `${r.health} since ${r.healthAsOf}` : "no status"}.`
          )
          summary = [head, ...lines].join(" ")
        } else {
          const counts = (["red", "yellow", "green", null] as const)
            .map((h) => [h, contracts.filter((r) => r.health === h).length] as const)
            .filter(([, n]) => n > 0)
            .map(([h, n]) => (h ? `${n} ${h}` : `${n} with no status`))
          summary =
            `${plural(contracts.length, "active contract", "active contracts")}${counts.length ? `: ${counts.join(", ")}` : ""}. ` +
            (matches.length ? `${plural(matches.length, "meeting", "meetings")}${shown}.` : "No meetings.")
        }

        return ok({
          summary,
          total: matches.length,
          meetings: matches.slice(0, limit).map((m) => meetingCard(m, clients, engagements)),
          contracts,
        })
      } catch (e) {
        return toolError(e)
      }
    }
  )

  // ─── Cash book ─────────────────────────────────────────────────────────────

  server.registerTool(
    "get_cash_book",
    {
      title: "Cash Book",
      description:
        "The company's cash book «prima nota», over the company (SRL) bank accounts only: each company account's " +
        "balance today and its last bank check, the period's money in and out (transfers between company accounts " +
        "excluded), and the deposits that are not really the company's: tenants' deposits to give back, deposits paid " +
        "to get back. Also what clients owe, what is owed " +
        "to suppliers, what the SRL owes the owner (shareholder loans and personal-card costs, less repayments), " +
        "income, costs and the gain or loss per cost centre, and what is left To Chase. Answers «quanto ho in banca?», " +
        "«com'è andato ottobre?» (period 2026-10) and «prima nota di settembre». " +
        "period is a month (YYYY-MM, default this month) or a year (YYYY); account narrows " +
        "the period, its cost centres and its rows to one company account; costCentre narrows the rows and cost " +
        "centres to one (Untagged for rows with none), with no all-centres total. Balances and the money held are " +
        "company-wide, whatever the filters. The same numbers as the Cash Book page. Each row and each of " +
        "otherEntries (the period's entries that reach no balance: costs paid with the owner's card, supplier " +
        "invoices, shareholder loans through no account, rows dated before their account opened or on an unknown " +
        "account) carries its source and id: what update_movement, update_expense, update_loan and their delete_* " +
        "take, or delete_invoice and update_invoice for an invoice. imported marks a row from the prima nota workbook.",
      inputSchema: z.object({
        period: z.string().regex(/^\d{4}(-\d{2})?$/, "Use YYYY-MM or YYYY").optional(),
        account: z.string().min(1).optional(),
        costCentre: z.string().trim().min(1).max(60).optional(),
        limit: z.number().int().min(1).max(200).optional(),
      }),
    },
    async (input, ctx) => {
      try {
        const userId = userIdOf(ctx)
        const [accounts, movements, invoices, expenses, loans, clients, engagements] = await Promise.all([
          db().getCompanyAccounts(userId),
          db().getCompanyMovements(userId),
          db().getInvoices(userId),
          db().getCompanyExpenses(userId),
          db().getCompanyLoans(userId),
          db().getClients(userId),
          db().getEngagements(userId),
        ])
        if (accounts.length === 0) {
          return ok({
            summary:
              "No company account yet: add the company's bank accounts in the Cash Book, or import the prima nota workbook there.",
            accounts: [],
          })
        }
        // "Today" is Rome's: both server entry points pin TZ (pinServerTimeZone).
        const today = isoDate(new Date())
        const period = input.period ?? today.slice(0, 7)
        const year = period.length === 4
        if (!year) normalizeMonth(period)
        const account = input.account ? resolveCompanyAccount(accounts, input.account) : null
        const accountId = account?.id ?? null
        const name = (id: string | null) => accounts.find((a) => a.id === id)?.name ?? "Unknown account"
        const add = (values: number[]) => round2(values.reduce((s, v) => s + v, 0))

        // The page's own read model, step by step: cashRows → splitRows → the rest.
        const { rows, counted } = bookRows({ accounts, invoices, expenses, loans, movements, clients, engagements })
        // The file an invoice or a cost row keeps; a loan or a movement has none.
        const fileOf = (source: string, id: string) =>
          fileSummary(source === "invoice" ? invoices.find((i) => i.id === id)?.file : source === "expense" ? expenses.find((e) => e.id === id)?.file : null)
        const balances = balancesAt(accounts, counted, today)

        // A month is its sheet; a year, each month the Months tab lists, up to this one.
        const months = year
          ? monthEnds(accounts, counted, Number(period), today.slice(0, 7), accountId).map((m) => m.ym)
          : [period]
        const sheets = months.map((ym) => ({ ym, sheet: monthSheet(accounts, counted, ym, accountId) }))
        const periodIn = add(sheets.map((s) => s.sheet.in))
        const periodOut = add(sheets.map((s) => s.sheet.out))
        const from = year ? `${period}-01-01` : `${period}-01`
        const to = year ? `${period}-12-31` : monthEnd(period)
        const centre = input.costCentre?.toLowerCase()
        const inCentre = (r: CashRow) =>
          centre === undefined || (r.kind !== "transfer" && (r.project?.trim() || UNTAGGED).toLowerCase() === centre)
        const lines = sheets.flatMap((s) => s.sheet.lines).filter((l) => inCentre(l.row))
        const byKind = new Map<string, { type: string; in: number; out: number }>()
        for (const { row, moved } of lines) {
          if (moved) continue
          const k = byKind.get(rowTypeLabel(row)) ?? { type: rowTypeLabel(row), in: 0, out: 0 }
          if (row.delta > 0) k.in = round2(k.in + row.delta)
          else k.out = round2(k.out - row.delta)
          byKind.set(k.type, k)
        }
        const limit = input.limit ?? 50
        // What the sheet never shows: the period's rows that reach no balance, and the costs no account paid.
        const inPeriod = (day: string) => day >= from && day <= to
        const countedRows = new Set(counted)
        const opened = new Set(accounts.map((a) => a.id))
        const otherEntries = [
          ...rows
            .filter((r) => !countedRows.has(r) && inPeriod(r.day) && (accountId === null || r.accountId === accountId) && inCentre(r))
            .map((r) => ({
              date: r.day,
              account: name(r.accountId),
              type: rowTypeLabel(r),
              kind: r.kind,
              description: r.description,
              documentRef: r.documentRef,
              costCentre: r.project,
              amount: r.delta,
              why: opened.has(r.accountId) ? "dated before the account opened" : "on an unknown account",
              source: r.source,
              file: fileOf(r.source, r.sourceId),
              id: r.sourceId,
              ...(r.importRef ? { imported: true } : {}),
            })),
          // Under one account none of these went through it.
          ...(accountId === null
            ? expenses
                .filter(
                  (e) =>
                    !e.isRecurring && e.accountId === null && inPeriod(isoDate(e.date)) &&
                    (centre === undefined || (e.project?.trim() || UNTAGGED).toLowerCase() === centre),
                )
                .map((e) => ({
                  date: isoDate(e.date),
                  paidBy: e.paidByOwner ? "owner's card" : isSupplierDocument(e) ? "supplier invoice" : "not paid from an account",
                  type: `Cost: ${COST_CATEGORY_LABELS[e.category]}`,
                  kind: "cost",
                  description: e.description,
                  documentRef: e.documentRef,
                  costCentre: e.project,
                  amount: -round2(e.amount + (e.vat ?? 0)),
                  source: "expense",
                  file: fileSummary(e.file),
                  id: e.id,
                  ...(e.importRef ? { imported: true } : {}),
                }))
            : []),
          // A shareholder loan through no account (the loan dialog allows one): in SRL Owes You, in no balance.
          ...(accountId === null && (centre === undefined || centre === UNTAGGED.toLowerCase())
            ? loans
                .filter((l) => !l.accountId && inPeriod(isoDate(l.date)))
                .map((l) => ({
                  date: isoDate(l.date),
                  paidBy: "no account",
                  type: l.direction === "to_company" ? "Shareholder Loan" : "Shareholder Loan Repayment",
                  kind: "loan",
                  description: l.description,
                  documentRef: null,
                  costCentre: null,
                  amount: l.direction === "to_company" ? l.amount : -l.amount,
                  source: "loan",
                  id: l.id,
                  ...(l.importRef ? { imported: true } : {}),
                }))
            : []),
        ].sort((a, b) => a.date.localeCompare(b.date))

        // Company-wide, as the page's tiles: they don't follow the account chip.
        const total = add([...balances.values()])
        const held = deposits(movements)
        const toGiveBack = add(held.filter((d) => d.kind === "deposit_held").map((d) => d.amount))
        const toGetBack = add(held.filter((d) => d.kind === "deposit_paid").map((d) => d.amount))
        const owner = ownerLoanBalance(loans, expenses)
        const bills = supplierDocuments(expenses, movements)
        const centres = costCentreTotals({ invoices, expenses, loans, movements }, from, to, accountId)
        const chase = toChase({ accounts, rows, invoices, expenses, invoicing: isModuleOn("invoicing") }).filter(
          (c) => accountId === null || ("row" in c ? c.row.accountId === accountId : "accountId" in c ? c.accountId === accountId : true),
        )
        const chaseCount = (kind: (typeof chase)[number]["kind"]) => chase.filter((c) => c.kind === kind).length

        const accountCards = accounts.map((a) => {
          const check = statementCheck(a, counted)
          return {
            id: a.id,
            name: a.name,
            // null: it opens later.
            balance: balances.get(a.id) ?? null,
            openedOn: isoDate(a.openingDate),
            lastCheck: statementLabel(check, eurCents),
            statement:
              check.status === "not_checked"
                ? null
                : { date: check.day, bank: check.bank, book: check.book, difference: check.difference, status: check.status },
          }
        })
        const periodLabel = year ? period : formatYearMonth(period)
        const scope = account ? ` on ${account.name}` : ""
        const warnings = [
          owner.total < 0 ? `The SRL has paid you ${eurCents(-owner.total)} more than it owed: check the repayments.` : null,
          chaseCount("negative") > 0 ? "A company account goes below zero on some day: see toChase." : null,
        ].filter(Boolean)

        return ok({
          summary:
            `Company accounts today: ${accountCards
              .map((a) => `${a.name} ${a.balance === null ? `opens ${a.openedOn}` : eurCents(a.balance)} (${a.lastCheck})`)
              .join(" · ")}. ` +
            `Total ${eurCents(total)}, deposits to give back ${eurCents(toGiveBack)}. ` +
            `${periodLabel}${scope}: in ${eurCents(periodIn)}, out ${eurCents(periodOut)}, net ${eurCents(round2(periodIn - periodOut))} ` +
            "(transfers between company accounts excluded)." +
            (warnings.length ? ` ${warnings.join(" ")}` : ""),
          today,
          accounts: accountCards,
          period: {
            period,
            from,
            to,
            account: account?.name ?? null,
            in: periodIn,
            out: periodOut,
            net: round2(periodIn - periodOut),
            ...(accountId ? { transfersNet: add(sheets.map((s) => s.sheet.transfers)) } : {}),
            opening: sheets[0]?.sheet.opening ?? null,
            closing: sheets.at(-1)?.sheet.closing ?? null,
            ...(year
              ? { months: sheets.map(({ ym, sheet }) => ({ month: ym, in: sheet.in, out: sheet.out, net: sheet.net, closing: sheet.closing })) }
              : {}),
            byType: [...byKind.values()],
          },
          figures: {
            total,
            depositsToGiveBack: toGiveBack,
            depositsHeld: held.filter((d) => d.kind === "deposit_held").map((d) => ({ counterparty: d.counterparty, amount: d.amount })),
            depositsToGetBack: toGetBack,
            depositsPaid: held.filter((d) => d.kind === "deposit_paid").map((d) => ({ counterparty: d.counterparty, amount: d.amount })),
            clientsOwe: clientsOwe(invoices, engagements),
            suppliersOwed: bills.owed,
            supplierInvoices: bills.docs
              .filter((d) => d.owed > 0)
              .map((d) => ({ id: d.expense.id, documentRef: d.expense.documentRef, description: d.expense.description, total: d.total, paid: d.paid, owed: d.owed })),
            srlOwesYou: Math.max(0, owner.total),
            ownerLoans: owner,
          },
          costCentres: centres.centres
            .filter((c) => centre === undefined || c.name.toLowerCase() === centre)
            .map((c) => ({ ...c, label: resultLabel(c.result, eurCents) })),
          // Every centre's sum: left out under a filter, as the export leaves out its Total line.
          ...(centre === undefined ? { costCentreTotal: { ...centres.total, label: resultLabel(centres.total.result, eurCents) } } : {}),
          loansInPeriod: centres.loans,
          toChase: {
            total: chase.length,
            negativeBalance: chaseCount("negative"),
            invoicesPaidWithNoAccount: chaseCount("no_account"),
            costsWithNoDocument: chaseCount("no_document"),
            estimatedDates: chaseCount("estimated"),
            beforeOpening: chaseCount("before_opening"),
            unknownAccount: chaseCount("unassigned"),
          },
          rowsTotal: lines.length,
          rows: lines.slice(-limit).map(({ row, moved, endOfDay }) => ({
            date: row.day,
            account: name(row.accountId),
            ...(row.otherAccountId ? { otherAccount: name(row.otherAccountId) } : {}),
            type: rowTypeLabel(row),
            kind: row.kind,
            description: row.description,
            documentRef: row.documentRef,
            costCentre: row.project,
            counterparty: row.counterparty,
            // A transfer between two company accounts moves no total: its amount alone.
            in: moved ? null : row.delta > 0 ? row.delta : 0,
            out: moved ? null : row.delta < 0 ? -row.delta : 0,
            ...(moved ? { transferred: -row.delta } : {}),
            endOfDay,
            dateEstimated: row.dateEstimated,
            source: row.source,
            file: fileOf(row.source, row.sourceId),
            id: row.sourceId,
            ...(row.importRef ? { imported: true } : {}),
          })),
          otherEntries: otherEntries.slice(-limit),
        })
      } catch (e) {
        return toolError(e)
      }
    }
  )

  // ─── Month End ─────────────────────────────────────────────────────────────

  server.registerTool(
    "get_month_end",
    {
      title: "Month End",
      description:
        "Whether a month that has ended is closed, step by step: the same checklist as the Month End page. " +
        "«chiudiamo settembre», «cosa manca per chiudere il mese?», «ho chiuso agosto?». About a month, never a " +
        "contract: closing a contract is update_engagement. month is YYYY-MM, or an English month name meaning its " +
        "most recent ended occurrence (December asked in January is last year's; translate an Italian name first); " +
        "none = the last month that has ended (Europe/Rome). The current month and later ones are refused: their " +
        "hours and invoices are still open. Closed is computed, never stored: a later edit to the month opens it " +
        "again, and alsoOpen lists the earlier months still open with their steps to do. The steps, in the order to " +
        "work them: Hours, Invoices (every month up to this one), Waiting for Payment, Supplier Invoices Owed, " +
        "Recurring Costs, Invoice Files, Bank, To Chase, Deadlines. Hours, Invoices, Bank, To Chase and Deadlines block (todo); the " +
        "other four are amber reminders (check) and never block. Invoice Files lists the month's one-off costs and issued invoices that have no file attached; no tool attaches one, the owner does it in the app. Bank: a matching check on the last day or later " +
        "counts, a later one labelled 'after month end'. A step with nothing to check is na, and notNeeded says why. " +
        "Each open item carries next: the tool to call with the arguments the data holds (ask the owner for the " +
        "rest, and confirm an invoice number with them), or app where only the web app can fix it; two items with " +
        "the same draft are one invoice. A provisional month (invoice_provisional) has no next: nothing to record " +
        "until the invoice covering it ends. Work top to bottom, then " +
        "call get_month_end again to confirm the month is closed. A step lists at most 50 items; more counts the rest.",
      inputSchema: z.object({ month: z.string().trim().min(1).max(20).optional() }),
    },
    async (input, ctx) => {
      try {
        const userId = userIdOf(ctx)
        // "Today" is Rome's: both server entry points pin TZ (pinServerTimeZone).
        const today = isoDate(new Date())
        const month = monthToClose(input.month, today)
        // Everything the Month End page loads, unfiltered: the steps read every month up to this one.
        const [engagements, clients, allocations, timecards, invoices, accounts, movements, expenses, loans, deadlines] =
          await Promise.all([
            db().getEngagements(userId),
            db().getClients(userId),
            db().getAllocations(userId),
            db().getTimecards(userId),
            db().getInvoices(userId),
            db().getCompanyAccounts(userId),
            db().getCompanyMovements(userId),
            db().getCompanyExpenses(userId),
            db().getCompanyLoans(userId),
            db().getCompanyDeadlines(userId),
          ])
        const data = { engagements, clients, allocations, timecards, invoices, accounts, movements, expenses, loans, deadlines }
        const floor = monthEndFloor(data)
        if (floor === null) {
          throw new ToolInputError(
            "Nothing to close yet: a month can be closed once it has hours logged or a company account in the Cash Book."
          )
        }
        if (month < floor) {
          throw new ToolInputError(`${month} is before the first month with data (${floor}): nothing to close there.`)
        }

        const checklist = monthEndChecklist(data, month, today, isModuleOn)
        const next = monthEndNext(checklist, data, today, isModuleOn("invoicing"))
        const titles = (keys: StepKey[]) => keys.map((k) => STEP_INFO[k].title)
        // ponytail: one more checklist per earlier open month, for its steps; fine for a few, memoise if it slows.
        const alsoOpen = openMonths(data, today, isModuleOn)
          .filter((m) => m < month)
          .map((m) => ({ month: m, todo: titles(monthEndChecklist(data, m, today, isModuleOn).todo) }))
        // A left-out module's steps are not in the checklist the owner sees, so they are not in the reminders either.
        const stepOrder = stepsOn(isModuleOn).order
        const open = (k: StepKey) => (stepOrder.includes(k) ? checklist.steps[k].items.filter((i) => i.status !== "done").length : 0)
        // The page's verdict, "Also open" and amber lines.
        const amber = [
          open("waiting") > 0 && `${plural(open("waiting"), "invoice", "invoices")} waiting for payment`,
          open("suppliers") > 0 && `${plural(open("suppliers"), "supplier invoice", "supplier invoices")} still owed`,
          open("recurring") > 0 && `${plural(open("recurring"), "recurring cost", "recurring costs")} not paid`,
          open("files") > 0 && `${plural(open("files"), "invoice file", "invoice files")} missing`,
        ].filter(Boolean)
        const name = formatYearMonth(month)
        const summary = [
          checklist.closed
            ? `${name} is closed: every required step is done.`
            : `${name}: ${plural(checklist.todo.length, "step", "steps")} to do (${titles(checklist.todo).join(", ")}).`,
          alsoOpen.length > 0 &&
            `Also open: ${plural(alsoOpen.length, "earlier month", "earlier months")} (oldest: ${formatYearMonth(alsoOpen[alsoOpen.length - 1].month)}).`,
          amber.length > 0 && `${amber.join(" · ")}.`,
        ]
          .filter(Boolean)
          .join(" ")

        return ok({
          summary,
          month,
          end: checklist.end,
          closed: checklist.closed,
          todo: checklist.todo,
          alsoOpen,
          steps: stepOrder.map((key) => {
            const { status, items } = checklist.steps[key]
            const count = (s: string) => items.filter((i) => i.status === s).length
            // ponytail: a first close after the prima nota import can hold hundreds of To Chase rows; the app lists them all.
            const shown = items.slice(0, 50)
            return {
              step: key,
              title: STEP_INFO[key].title,
              blocking: BLOCKING.includes(key),
              status,
              // The page's line under the title: why there is nothing to check, else what done means.
              ...(status === "na" ? { notNeeded: NOT_NEEDED[key] } : { done: STEP_INFO[key].done }),
              toDo: count("todo"),
              toCheck: count("check"),
              checked: count("done"),
              items: shown.map((i) => (next.has(i) ? { ...i, next: next.get(i) } : i)),
              ...(items.length > shown.length && { more: items.length - shown.length }),
            }
          }),
        })
      } catch (e) {
        return toolError(e)
      }
    }
  )

  // ─── Solutions ─────────────────────────────────────────────────────────────

  server.registerTool(
    "list_solutions",
    {
      title: "List Solutions",
      description:
        "The solution catalog: what was built, or proposed, for each client, documented for reuse in pre-sales. A " +
        "solution is the work itself, not its contract (get_client) nor its calls (list_meetings). One row per " +
        "solution, the most recently updated first: name, client, contract (contractState Pre-sales while there is " +
        "none), the solution's own status (proposed, building, delivered, retired), stack, purpose (the first line " +
        "of its Purpose and Target section) and missingSections, the sections not written yet. «cosa abbiamo fatto " +
        "con Neo4j?» → stack 'neo4j' (one technology, any case); «le soluzioni per Acme» → client; 'have we built " +
        "anything for recommendations?' → query, matched in the name, domain, stack and every section's text. " +
        "status keeps one status. get_solution reads one whole.",
      inputSchema: z.object({
        client: z.string().min(1).optional(),
        status: solutionStatusSchema.optional(),
        stack: z.string().trim().min(1).max(40).optional(),
        query: z.string().trim().min(1).max(200).optional(),
      }),
    },
    async (input, ctx) => {
      try {
        const userId = userIdOf(ctx)
        const [solutions, clients, engagements] = await Promise.all([
          db().getSolutions(userId),
          db().getClients(userId),
          db().getEngagements(userId),
        ])
        // Archived clients too: the catalog outlives the client.
        const client = input.client ? resolveClient(clients, input.client, true) : null
        const stack = input.stack?.toLowerCase() ?? null
        const rows = filterSolutions(solutions, { client: client?.id ?? null, status: input.status ?? null, stack, q: input.query ?? null })
          .map((s) => ({ ...solutionCard(s, clients, engagements), purpose: s.sections.purpose?.trim().split("\n")[0] || null }))
        const filters = [
          client && `client ${client.name}`,
          input.status && `status ${input.status}`,
          stack && `stack ${stack}`,
          input.query && `"${input.query}"`,
        ].filter(Boolean)
        const scope = filters.length ? ` ${filters.join(", ")}` : ""
        return ok({
          summary: rows.length
            ? `${plural(rows.length, "solution", "solutions")}${scope && ` for${scope}`}.`
            : solutions.length
              ? `No solution matches${scope} (${solutions.length} in the catalog).`
              : "No solutions yet: create_solution documents one.",
          solutions: rows,
        })
      } catch (e) {
        return toolError(e)
      }
    }
  )

  server.registerTool(
    "get_solution",
    {
      title: "Solution Details",
      description:
        "One solution of the catalog, whole: name, client, contract, status, domain, stack; the nine sections in " +
        "order with their text (null = not written yet); the data model as entities (each with its source, the " +
        "client's system or dataset it comes from, and notes) and relations (from, type, to); and missingSections. " +
        "With a contract, also its health (green/yellow/red) as of contractHealthAsOf and the date of its last " +
        "meeting, read from the meetings as list_meetings reports them; left out in pre-sales or before a first " +
        "meeting. «raccontami il knowledge graph di Acme» → solution 'knowledge graph' (a name, part of one, or the " +
        "id), client 'Acme', which narrows it when two clients have one by that name; list_solutions finds the " +
        "names. sections returns only those, by key (purpose, requirements, kpis, sources, model, " +
        "architecture, steps, history, results): 'the history of the knowledge graph' → sections ['history']; " +
        "the calls of its contract are list_meetings.",
      inputSchema: z.object({
        solution: z.string().trim().min(1),
        client: z.string().min(1).optional(),
        sections: z.array(solutionSectionKeySchema).min(1).optional(),
      }),
    },
    async (input, ctx) => {
      try {
        const userId = userIdOf(ctx)
        const [solutions, clients, engagements, meetings] = await Promise.all([
          db().getSolutions(userId),
          db().getClients(userId),
          db().getEngagements(userId),
          db().getMeetings(userId),
        ])
        const client = input.client ? resolveClient(clients, input.client, true) : null
        const s = resolveSolution(solutions, clients, input.solution, client?.id)
        const card = solutionCard(s, clients, engagements)
        // Read from the verbali, as get_client does: the catalog never copies the contract's status.
        const status = s.engagementId ? contractStatus(meetings)(s.engagementId) : null
        const met = status?.lastMeetingDate ? status : null
        const wanted = new Set(input.sections ?? SOLUTION_SECTIONS.map((x) => x.key))
        const written = SOLUTION_SECTIONS.length - card.missingSections.length
        return ok({
          summary:
            `${s.name} (${card.client}, ${card.contract ? `contract ${card.contract}` : "pre-sales"}): ${s.status}, ` +
            `${written} of ${SOLUTION_SECTIONS.length} sections written.` +
            (met ? ` Contract ${met.health ? `${met.health} since ${met.healthAsOf}` : "with no status"}, last meeting ${met.lastMeetingDate}.` : ""),
          solution: {
            ...card,
            ...(met && { contractHealth: met.health, contractHealthAsOf: met.healthAsOf, lastMeetingDate: met.lastMeetingDate }),
          },
          sections: SOLUTION_SECTIONS.filter(({ key }) => wanted.has(key)).map(({ key, label }) => ({
            key,
            label,
            text: s.sections[key]?.trim() ? s.sections[key] : null,
          })),
          entities: s.entities,
          relations: s.relations,
          missingSections: card.missingSections,
        })
      } catch (e) {
        return toolError(e)
      }
    }
  )
}
