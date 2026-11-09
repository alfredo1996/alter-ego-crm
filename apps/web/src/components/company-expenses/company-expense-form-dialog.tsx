"use client"

import { eur } from "@alter-ego/kernel/currency"
import { formatYearMonth, isoDate } from "@alter-ego/kernel/dates"
import { SegmentedButtons } from "@alter-ego/ui/page/segmented-buttons"
import { Button } from "@alter-ego/ui/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@alter-ego/ui/ui/dialog"
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@alter-ego/ui/ui/form"
import { Input } from "@alter-ego/ui/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@alter-ego/ui/ui/select"
import { Switch } from "@alter-ego/ui/ui/switch"
import { Textarea } from "@alter-ego/ui/ui/textarea"
import { toast } from "@alter-ego/ui/use-toast"
import { zodResolver } from "@hookform/resolvers/zod"
import { format } from "date-fns"
import { useEffect, useId, useState } from "react"
import { useForm, useWatch } from "react-hook-form"

import { defaultAccountId, rememberAccount } from "@/components/cash-book/last-account"
import { InvoiceFileSlot } from "@/components/company-files/invoice-file-slot"
import { MoneyInput } from "@/components/money-input"
import { NO_RENT_LINK, RentLinkFields, type RentLink } from "@/components/rent/rent-link-fields"
import { useAssignments } from "@/hooks/use-assignments"
import { useClients } from "@/hooks/use-clients"
import { useCollaborators } from "@/hooks/use-collaborators"
import { useCreateCompanyExpense, useUpdateCompanyExpense } from "@/hooks/use-company-expenses"
import { FileUploadError, NO_FILE_CHANGE, writeWithInvoiceFile, type FileDraft } from "@/hooks/use-company-files"
import { useEngagements } from "@/hooks/use-engagements"
import { useTimecards } from "@/hooks/use-timecards"
import { COST_CATEGORY_LABELS, pickEstimate, round2 } from "@/lib/cash-book"
import { nextPaymentsLine, payHint } from "@/lib/cash-book-recurring"
import { collaboratorMonth } from "@/lib/collaborator-invoices"
import { byActiveThenName } from "@/lib/collaborators"
import { engagementLabel } from "@/lib/engagements"
import { eurCents } from "@/lib/invoices"
import { priceIn } from "@/lib/projection"
import { z } from "@/lib/zod"
import { companyExpenseCategorySchema } from "@/types/schemas"

import { PriceChangesField } from "./price-changes-field"

import type { CompanyAccount, CompanyExpense, CompanyExpenseCategory, CompanyMovement, CreateCompanyExpenseInput, FeeChange } from "@/types"

/** Paid From: the owner's own card, or not paid yet (a supplier invoice); else an account id. */
export const OWNER = "owner"
export const UNPAID = "unpaid"
const NONE = "none"

type Values = {
  description: string
  category: CompanyExpenseCategory
  amount: string
  vat: string
  date: string
  paidFrom: string
  refund: boolean
  isRecurring: boolean
  recurrenceMonths: string
  recurringExpenseId: string
  documentRef: string
  project: string
  notes: string
  /** NONE, or a collaborator's id: the invoice is theirs. */
  collaboratorId: string
  /** NONE = a fixed fee, else the contract's id. */
  engagementId: string
  /** "YYYY-MM": the month of work the invoice pays. */
  forMonth: string
  /** Recurring only. "YYYY-MM" the last month the Plan counts it, or "" for no end. */
  endMonth: string
  /** Recurring only: counted whole in the months it is paid, or a share of it every month. */
  timing: Timing
}

type Timing = "paid" | "spread"

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/

/**
 * What the dialog opens on: a cost to edit, a new recurring cost, or a payment
 * of an estimate. Month End dates a payment on the month's last day, and links
 * a cost to an estimate by opening it with that estimate picked.
 */
export type CostDialogState =
  | { kind: "new" }
  | { kind: "recurring" }
  | { kind: "pay"; estimate: CompanyExpense; date?: string }
  | { kind: "edit"; expense: CompanyExpense; estimateId?: string }

/** The line under How the Plan Counts It: which months carry the cost. */
function timingHint(v: Values, amount: number): string {
  const every = Number(v.recurrenceMonths)
  if (v.timing === "spread") {
    return `${amount ? `${eurCents(round2(amount / every))} in` : "The amount divided by " + every + ", in"} every month.`
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v.date) || 12 % every !== 0) return "The full amount in each payment month, and nothing in between. Move Starts On to move those months."
  const names = Array.from({ length: 12 / every }, (_, i) => new Date(2000, Number(v.date.slice(5, 7)) - 1 + i * every, 1))
    .sort((a, b) => a.getMonth() - b.getMonth())
    .map((m) => format(m, "MMM"))
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`
  return `The full ${amount ? eurCents(amount) : "amount"} in ${list}, and nothing in between. Move Starts On to move those months.`
}

/** A blank estimate for the preview line to start from: only what the Plan reads is set per keystroke. */
const DRAFT_ESTIMATE: CompanyExpense = {
  id: "draft", userId: "", description: "", category: "other", amount: 0, date: new Date(0), isRecurring: true, recurrenceMonths: 1,
  notes: null, accountId: null, paidByOwner: false, vat: null, documentRef: null, project: null, recurringExpenseId: null,
  dateEstimated: false, importRef: null, collaboratorId: null, engagementId: null, forMonth: null, createdAt: new Date(0), updatedAt: new Date(0),
}

/** "every month", "every 3 months". */
export const everyLabel = (months: number | null) => (!months || months <= 1 ? "every month" : `every ${months} months`)

function valuesOf(state: CostDialogState, accounts: CompanyAccount[], expenses: CompanyExpense[], today: string): Values {
  const blank: Values = {
    description: "", category: "other", amount: "", vat: "0", date: today,
    paidFrom: defaultAccountId(accounts) || (accounts.length === 0 ? UNPAID : ""), refund: false,
    isRecurring: false, recurrenceMonths: "1", recurringExpenseId: NONE, documentRef: "", project: "", notes: "",
    collaboratorId: NONE, engagementId: NONE, forMonth: today.slice(0, 7), endMonth: "", timing: "spread",
  }
  if (state.kind === "new") return blank
  // A new estimate counts whole in its payment months; one stored without the field stays spread until the owner picks.
  if (state.kind === "recurring") return { ...blank, isRecurring: true, paidFrom: UNPAID, timing: "paid" }
  if (state.kind === "pay") {
    const e = state.estimate
    return {
      ...blank,
      description: e.description, category: e.category, amount: String(priceIn(e, (state.date ?? today).slice(0, 7))), vat: String(e.vat ?? 0),
      date: state.date ?? today, recurringExpenseId: e.id, project: e.project ?? "",
    }
  }
  const e = state.expense
  return {
    description: e.description,
    category: e.category,
    amount: String(Math.abs(e.amount)),
    // Not stated (written before costs had VAT): left empty, and kept so.
    vat: e.vat === null ? "" : String(Math.abs(e.vat)),
    date: isoDate(e.date),
    paidFrom: e.accountId ?? (e.paidByOwner ? OWNER : UNPAID),
    refund: e.amount < 0,
    isRecurring: e.isRecurring,
    recurrenceMonths: String(e.recurrenceMonths ?? 1),
    // An estimate deleted since: the link names nothing, and goes on save.
    recurringExpenseId:
      state.estimateId ?? (expenses.some((x) => x.id === e.recurringExpenseId && x.isRecurring) ? e.recurringExpenseId! : NONE),
    documentRef: e.documentRef ?? "",
    project: e.project ?? "",
    notes: e.notes ?? "",
    collaboratorId: e.collaboratorId ?? NONE,
    engagementId: e.engagementId ?? NONE,
    forMonth: e.forMonth ?? isoDate(e.date).slice(0, 7),
    endMonth: e.endMonth ?? "",
    timing: e.countedWhenPaid ? "paid" : "spread",
  }
}

/**
 * A company cost, one entry for both the Plan and the Cash Book: paid from a
 * company account (a row in its balance), with the owner's personal card (the
 * SRL owes it to the owner), or not paid yet (a supplier invoice paid later by
 * Supplier Invoice Payments). A recurring cost is an estimate for the Plan; each
 * real payment of it is a cost of its own that stands for it.
 */
export function CompanyExpenseFormDialog({
  userId,
  state,
  onClose,
  onCloseAutoFocus,
  accounts,
  expenses,
  movements,
  costCentres,
}: {
  userId: string | undefined
  /** null: closed. */
  state: CostDialogState | null
  onClose: () => void
  onCloseAutoFocus?: (event: Event) => void
  accounts: CompanyAccount[]
  /** Every cost: the recurring estimates a payment may stand for. */
  expenses: CompanyExpense[]
  /** Every movement: a supplier invoice with payments stays one. */
  movements: CompanyMovement[]
  /** The cost centres in use, offered as you type. */
  costCentres: string[]
}) {
  return (
    <Dialog open={state !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent size="md" onCloseAutoFocus={onCloseAutoFocus}>
        {state && (
          <CostForm
            key={state.kind === "edit" ? state.expense.id : state.kind === "pay" ? `pay-${state.estimate.id}` : state.kind}
            userId={userId}
            state={state}
            accounts={accounts}
            expenses={expenses}
            paidInCashBook={state.kind === "edit" && movements.some((m) => m.expenseId === state.expense.id)}
            costCentres={costCentres}
            onClose={onClose}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

function CostForm({
  userId,
  state,
  accounts,
  expenses,
  paidInCashBook,
  costCentres,
  onClose,
}: {
  userId: string | undefined
  state: CostDialogState
  accounts: CompanyAccount[]
  expenses: CompanyExpense[]
  /** A supplier invoice Supplier Invoice Payments point at: it stays Not Paid Yet, with its document (BILL_HAS_PAYMENTS). */
  paidInCashBook: boolean
  costCentres: string[]
  onClose: () => void
}) {
  const createExpense = useCreateCompanyExpense(userId)
  const updateExpense = useUpdateCompanyExpense(userId)
  const { data: collaborators = [] } = useCollaborators(userId)
  const { data: assignments = [] } = useAssignments(userId)
  const { data: engagements = [] } = useEngagements(userId)
  const { data: clients = [] } = useClients(userId)
  const { data: timecards = [] } = useTimecards(userId)
  const [today] = useState(() => isoDate(new Date()))
  const listId = useId()
  // A recurring cost's dated price changes live beside the form: a list with its own Add Change pair.
  const [priceChanges, setPriceChanges] = useState<FeeChange[]>(() => (state.kind === "edit" ? (state.expense.priceChanges ?? []) : []))
  const [changeDraft, setChangeDraft] = useState(false)
  // The invoice file waits here until Save: Cancel uploads nothing.
  const [fileDraft, setFileDraft] = useState<FileDraft>(NO_FILE_CHANGE)
  const [saving, setSaving] = useState(false)
  const [changeError, setChangeError] = useState<string | undefined>()
  const editing = state.kind === "edit" ? state.expense : null
  // Rent module: a cost netted against a lease's rent for a month (an offset).
  const [rentLink, setRentLink] = useState<RentLink>(
    editing?.leaseId ? { leaseId: editing.leaseId, month: editing.forMonth ?? "", part: "rent" } : NO_RENT_LINK,
  )

  const schema = z
    .object({
      description: z.string().trim().min(1, "Describe the cost.").max(300, "Keep it under 300 characters."),
      category: companyExpenseCategorySchema,
      amount: z.string(),
      vat: z.string(),
      date: z.string().min(1, "Enter the date."),
      paidFrom: z.string(),
      refund: z.boolean(),
      isRecurring: z.boolean(),
      recurrenceMonths: z.string(),
      recurringExpenseId: z.string(),
      documentRef: z.string().max(100, "Keep it under 100 characters."),
      project: z.string().max(60, "Keep it under 60 characters."),
      notes: z.string().max(500, "Keep it under 500 characters."),
      collaboratorId: z.string(),
      engagementId: z.string(),
      forMonth: z.string(),
      endMonth: z.string(),
      timing: z.enum(["paid", "spread"]),
    })
    .superRefine((v, ctx) => {
      const issue = (path: keyof Values, message: string) => ctx.addIssue({ code: "custom", path: [path], message })
      const amount = Number(v.amount)
      if (v.amount.trim() === "" || !Number.isFinite(amount) || amount <= 0) issue("amount", "Enter the amount, above 0.")
      const vat = Number(v.vat)
      if (v.vat.trim() !== "" && (!Number.isFinite(vat) || vat < 0)) issue("vat", "Enter the VAT, 0 or more.")
      if (v.isRecurring) {
        const every = Number(v.recurrenceMonths)
        if (!Number.isInteger(every) || every < 1 || every > 60) issue("recurrenceMonths", "Enter 1 to 60 months.")
        const start = v.date.slice(0, 7)
        if (v.endMonth && !MONTH.test(v.endMonth)) issue("endMonth", "Enter the last month, or leave it empty.")
        else if (v.endMonth && start && v.endMonth < start) issue("endMonth", "The end is before the start.")
        else if (priceChanges.some((c) => v.endMonth && c.from > v.endMonth)) issue("endMonth", "A price change falls after this end: remove it first.")
        if (priceChanges.some((c) => start && c.from <= start)) issue("date", "A price change starts before this date: remove it first.")
      } else if (!v.paidFrom) {
        issue("paidFrom", "Say how it was paid.")
      }
      if (!v.isRecurring && v.category === "collaborators" && v.collaboratorId === NONE) {
        issue("collaboratorId", "Choose the collaborator this invoice is from.")
      }
      if (!v.isRecurring && v.collaboratorId !== NONE && !MONTH.test(v.forMonth)) issue("forMonth", "Enter the month of work it pays.")
      if (paidInCashBook && !v.documentRef.trim()) issue("documentRef", "Its payments in the Cash Book name this number: keep it.")
    })

  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: valuesOf(state, accounts, expenses, today) })
  const v = useWatch({ control: form.control }) as Values
  const account = accounts.find((a) => a.id === v.paidFrom)
  const paidFromAccount = !v.isRecurring && account !== undefined
  const refund = paidFromAccount && v.refund
  const estimates = expenses.filter((e) => e.isRecurring && e.id !== editing?.id)
  const suggestion = pickEstimate({ category: v.category, description: v.description }, estimates)
  const linked = estimates.find((e) => e.id === v.recurringExpenseId)
  const amount = Number(v.amount) || 0
  const vat = Number(v.vat) || 0
  // The price each estimate asks in the month this payment is dated in.
  const payMonth = /^\d{4}-\d{2}/.test(v.date) ? v.date.slice(0, 7) : today.slice(0, 7)
  // The estimate as the form stands, for the preview line: the same helpers the Plan counts with.
  const draft: CompanyExpense = {
    ...(editing ?? DRAFT_ESTIMATE),
    isRecurring: true,
    amount,
    recurrenceMonths: Number(v.recurrenceMonths) || 1,
    date: new Date(`${/^\d{4}-\d{2}-\d{2}$/.test(v.date) ? v.date : today}T00:00:00`),
    endMonth: MONTH.test(v.endMonth) ? v.endMonth : null,
    priceChanges,
    countedWhenPaid: v.timing === "paid",
  }
  const preview = v.isRecurring && amount > 0 ? nextPaymentsLine(draft, expenses, today.slice(0, 7)) : null

  // Collaborator invoices: one-off costs only. Contract lists theirs; For Month follows the Date until set by hand.
  // A stored month other than the date's was set by hand; one that matches it still follows a new date.
  const [monthByHand, setMonthByHand] = useState(editing?.forMonth != null && editing.forMonth !== isoDate(editing.date).slice(0, 7))
  const asksCollaborator = !v.isRecurring && (collaborators.length > 0 || v.collaboratorId !== NONE || v.category === "collaborators")
  const pickable = collaborators.filter((c) => c.isActive || c.id === v.collaboratorId).sort(byActiveThenName)
  const contractsOf = (collaboratorId: string) =>
    assignments
      .filter((a) => a.collaboratorId === collaboratorId)
      .flatMap((a) => {
        const e = engagements.find((x) => x.id === a.engagementId)
        return e ? [{ id: e.id, name: `${clients.find((c) => c.id === e.clientId)?.name ?? ""} · ${engagementLabel(e)}` }] : []
      })
  const collaborator = collaborators.find((c) => c.id === v.collaboratorId)
  useEffect(() => {
    if (!monthByHand && /^\d{4}-\d{2}-\d{2}$/.test(v.date)) form.setValue("forMonth", v.date.slice(0, 7))
  }, [v.date, monthByHand, form])
  const planHint = () => {
    if (!collaborator || !MONTH.test(v.forMonth)) return "The month of work it pays."
    const plan = collaboratorMonth(collaborator, { assignments, timecards, expenses: [], yearMonth: v.forMonth }).plan
    return `The month of work it pays: Quarters and the Collaborators page compare it with ${formatYearMonth(v.forMonth, "MMMM")}'s plan${plan > 0 ? `, ${eur(plan)}` : ""}.`
  }

  // A new cost takes the one estimate it clearly pays, until a pick is made by hand.
  const picked = suggestion.picked?.id
  useEffect(() => {
    if (state.kind !== "new" || form.getFieldState("recurringExpenseId").isDirty) return
    form.setValue("recurringExpenseId", picked ?? NONE)
  }, [picked, state.kind, form])

  const save = form.handleSubmit(async (values) => {
    const recurring = values.isRecurring
    // A change typed into the inline pair and not kept would be lost silently.
    if (recurring && changeDraft) return setChangeError("Save or cancel the change first.")
    const fromAccount = !recurring && accounts.some((a) => a.id === values.paidFrom)
    const sign = fromAccount && values.refund ? -1 : 1
    const linked = !recurring && values.collaboratorId !== NONE
    const offsetting = !recurring && !linked && rentLink.leaseId !== ""
    const input: CreateCompanyExpenseInput = {
      description: values.description.trim(),
      category: values.category,
      amount: round2(sign * Number(values.amount)),
      vat: values.vat.trim() === "" ? null : round2(sign * Number(values.vat)),
      date: new Date(`${values.date}T00:00:00`),
      isRecurring: recurring,
      recurrenceMonths: recurring ? Number(values.recurrenceMonths) : null,
      accountId: fromAccount ? values.paidFrom : null,
      paidByOwner: !recurring && values.paidFrom === OWNER,
      // A refund pays no estimate: it lowers the costs.
      recurringExpenseId: !recurring && sign > 0 && values.recurringExpenseId !== NONE ? values.recurringExpenseId : null,
      documentRef: values.documentRef.trim() || null,
      project: values.project.trim() || null,
      notes: values.notes.trim() || null,
      collaboratorId: linked ? values.collaboratorId : null,
      engagementId: linked && values.engagementId !== NONE ? values.engagementId : null,
      forMonth: linked ? values.forMonth : offsetting ? rentLink.month : null,
      ...(offsetting ? { leaseId: rentLink.leaseId } : editing?.leaseId ? { leaseId: null } : {}), // moved off the lease: unlink it
      // Always sent with a recurring cost: an edit that touches none of them writes back what it opened with,
      // so a stored estimate (no field) stays spread until the owner picks the other timing.
      ...(recurring && { endMonth: values.endMonth || null, priceChanges, countedWhenPaid: values.timing === "paid" }),
    }
    setSaving(true)
    try {
      await writeWithInvoiceFile({
        userId: userId ?? "",
        stored: editing?.file,
        // An estimate is no invoice: it keeps no file, so switching a cost to one removes its file.
        draft: recurring ? (editing?.file ? { picked: null, removed: true } : NO_FILE_CHANGE) : fileDraft,
        write: async (file) => {
          const withFile = { ...input, ...(file !== undefined && { file }) }
          if (editing) {
            // Any date edit makes the day a real one.
            const dateEdited = values.date !== isoDate(editing.date)
            await updateExpense.mutateAsync({ id: editing.id, input: { ...withFile, ...(dateEdited && { dateEstimated: false }) } })
          } else {
            await createExpense.mutateAsync(withFile)
          }
        },
      })
    } catch (err) {
      // A rejected write has its app-wide error toast; a failed upload is said here. The form stays to retry.
      if (err instanceof FileUploadError) toast({ variant: "destructive", title: "Cost not saved", description: err.message })
      return
    } finally {
      setSaving(false)
    }
    if (input.accountId) rememberAccount(input.accountId)
    toast({ title: `${editing ? "Saved" : "Added"}: ${input.description}, ${outcome(input)}.` })
    onClose()
  })

  /** Where the cost went, said once it is saved. */
  function outcome(input: CreateCompanyExpenseInput): string {
    const total = eurCents(Math.abs(input.amount + (input.vat ?? 0)))
    if (input.isRecurring) return `${eurCents(input.amount)} ${everyLabel(input.recurrenceMonths ?? 1)} in the Plan`
    if (input.accountId) return `${total} ${input.amount < 0 ? "back into" : "from"} ${accounts.find((a) => a.id === input.accountId)?.name}`
    if (input.paidByOwner) return `${total} on your card: the SRL owes it to you`
    return input.documentRef ? `${total} owed to the supplier` : `${total} in the Plan`
  }

  const title = {
    new: "New Cost",
    recurring: "New Recurring Cost",
    pay: "Record Payment",
    edit: editing?.isRecurring ? "Edit Recurring Cost" : "Edit Cost",
  }[state.kind]
  const submit = { new: "Add Cost", recurring: "Add Recurring Cost", pay: "Record Payment", edit: "Save Changes" }[state.kind]
  const pending = createExpense.isPending || updateExpense.isPending || saving

  const paidFromHelp = () => {
    if (paidInCashBook) return "Paid in the Cash Book by Supplier Invoice Payments: delete those payments to change how it was paid."
    if (account) return `${refund ? "Money back into" : "Paid from"} ${account.name}: a row in the Cash Book and its balance.`
    if (v.paidFrom === OWNER) return "Paid with your own card: the SRL owes it to you (SRL Owes You). No company account moves."
    if (v.paidFrom === UNPAID) {
      return v.documentRef.trim()
        ? "A supplier invoice to pay later: it shows in You Owe Suppliers. Pay it in the Cash Book with Supplier Invoice Payment."
        : "Not paid from a company account. For a supplier invoice to pay later, add its number under Document: it then shows in You Owe Suppliers."
    }
    return accounts.length === 0 ? "Add your company accounts in the Cash Book to say which one paid." : "Which account paid it, or your own card."
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>
          {state.kind === "pay"
            ? `A payment of "${state.estimate.description}": the Plan counts it instead of the estimate.`
            : v.isRecurring
              ? "An estimate the Plan counts every period. Record each real payment of it with Record Payment: the Plan then counts the payment instead."
              : editing
                ? "Changes show in the Plan and the Cash Book at once."
                : "A company cost. It counts in the Plan, and once paid from an account it is in the Cash Book."}
        </DialogDescription>
      </DialogHeader>
      <Form {...form}>
        <form noValidate onSubmit={save} className="space-y-4">
          <FormField
            control={form.control}
            name="description"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Description</FormLabel>
                <FormControl>
                  <Input autoFocus placeholder="e.g. Accountant, October" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          {/* The amount straight after the description: it was the sixth field, below the fold on a phone. */}
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField
              control={form.control}
              name="amount"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{v.isRecurring ? "Amount Each Time" : refund ? "Amount Refunded" : "Amount Before VAT"}</FormLabel>
                  <FormControl>
                    <MoneyInput {...field} min="0" />
                  </FormControl>
                  <FormDescription>Net of the VAT you recover.</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="vat"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>VAT (€)</FormLabel>
                  <FormControl>
                    <MoneyInput {...field} min="0" placeholder="Not stated" />
                  </FormControl>
                  <FormDescription>
                    In euros, on top of the amount: €22 on €100 at 22%. 0 when it can&apos;t be recovered: reverse charge, an
                    exempt rental&apos;s costs.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
          <p className="text-sm">
            {refund ? "Total refunded" : v.isRecurring ? "Total each time" : "Total paid"}:{" "}
            <span className="font-medium tabular-nums">{eurCents(round2(amount + vat))}</span>
          </p>

          <div className="grid gap-4 sm:grid-cols-2">
            <FormField
              control={form.control}
              name="category"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Category</FormLabel>
                  <Select value={field.value} onValueChange={(c) => c && field.onChange(c)}>
                    <FormControl>
                      <SelectTrigger ref={field.ref}>
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {Object.entries(COST_CATEGORY_LABELS)
                        .filter(([value]) => value !== "collaborators" || !v.isRecurring)
                        .map(([value, label]) => (
                          <SelectItem key={value} value={value}>
                            {label}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="date"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{v.isRecurring ? "Starts On" : "Date"}</FormLabel>
                  <FormControl>
                    <Input type="date" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          {asksCollaborator && (
            <FormField
              control={form.control}
              name="collaboratorId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Collaborator</FormLabel>
                  <Select
                    value={field.value}
                    onValueChange={(id) => {
                      if (!id) return
                      field.onChange(id)
                      if (id === NONE) return form.setValue("engagementId", NONE)
                      // Picking one makes it their invoice; the contract is theirs when they are on exactly one.
                      form.setValue("category", "collaborators")
                      const mine = contractsOf(id)
                      form.setValue("engagementId", mine.length === 1 ? mine[0].id : NONE)
                    }}
                  >
                    <FormControl>
                      <SelectTrigger ref={field.ref}>
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value={NONE}>None</SelectItem>
                      {pickable.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
          )}

          {asksCollaborator && v.collaboratorId !== NONE && (
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="engagementId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Contract</FormLabel>
                    <Select value={field.value} onValueChange={(id) => id && field.onChange(id)}>
                      <FormControl>
                        <SelectTrigger ref={field.ref}>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value={NONE}>None, fixed fee</SelectItem>
                        {contractsOf(v.collaboratorId).map((c) => (
                          <SelectItem key={c.id} value={c.id}>
                            {c.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="forMonth"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>For Month</FormLabel>
                    <FormControl>
                      <Input
                        type="month"
                        {...field}
                        onChange={(e) => {
                          setMonthByHand(true)
                          field.onChange(e)
                        }}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <p className="text-sm text-muted-foreground sm:col-span-2">{planHint()}</p>
            </div>
          )}

          {!v.isRecurring && (
            <FormField
              control={form.control}
              name="paidFrom"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Paid From</FormLabel>
                  <Select value={field.value} onValueChange={(p) => p && field.onChange(p)} disabled={paidInCashBook}>
                    <FormControl>
                      <SelectTrigger ref={field.ref}>
                        <SelectValue placeholder="Pick how it was paid" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {accounts.map((a) => (
                        <SelectItem key={a.id} value={a.id}>
                          {a.name}
                        </SelectItem>
                      ))}
                      <SelectItem value={OWNER}>Owner&apos;s Personal Card</SelectItem>
                      <SelectItem value={UNPAID}>Not Paid Yet</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormDescription>{paidFromHelp()}</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          )}

          {paidFromAccount && (
            <FormField
              control={form.control}
              name="refund"
              render={({ field }) => (
                <FormItem className="flex items-center justify-between gap-3 rounded-lg border p-3">
                  <div className="space-y-0.5">
                    <FormLabel>Refund</FormLabel>
                    <FormDescription>Money a supplier gave back: it comes into the account and lowers the costs.</FormDescription>
                  </div>
                  <FormControl>
                    <Switch checked={field.value} onCheckedChange={field.onChange} />
                  </FormControl>
                </FormItem>
              )}
            />
          )}

          {v.isRecurring ? (
            <>
              <FormField
                control={form.control}
                name="recurrenceMonths"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Every (Months)</FormLabel>
                    <FormControl>
                      <Input type="number" min="1" max="60" {...field} />
                    </FormControl>
                    <FormDescription>1 = monthly, 3 = quarterly, 12 = yearly.</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              {Number(v.recurrenceMonths) > 1 && (
                <div className="space-y-2">
                  <span id={`${listId}-timing`} className="text-sm font-medium">
                    How the Plan Counts It
                  </span>
                  <div>
                    <SegmentedButtons
                      aria-labelledby={`${listId}-timing`}
                      value={v.timing}
                      options={[
                        { value: "paid", label: "In the Months It Is Paid" },
                        { value: "spread", label: "A Share Every Month" },
                      ]}
                      onChange={(timing) => form.setValue("timing", timing, { shouldDirty: true })}
                    />
                  </div>
                  <p className="text-meta text-muted-foreground">{timingHint(v, amount)}</p>
                </div>
              )}
              <FormField
                control={form.control}
                name="endMonth"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Ends After (optional)</FormLabel>
                    <FormControl>
                      <Input type="month" {...field} />
                    </FormControl>
                    <FormDescription>The last month the Plan counts it. Leave empty to keep it going.</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <PriceChangesField
                changes={priceChanges}
                onChange={setPriceChanges}
                start={v.date.slice(0, 7)}
                end={MONTH.test(v.endMonth) ? v.endMonth : ""}
                onDraft={(dirty) => {
                  setChangeDraft(dirty)
                  setChangeError(undefined)
                }}
                error={changeError}
              />
              {preview && (
                <p className="rounded-lg bg-muted px-3 py-2 text-meta text-muted-foreground" aria-live="polite">
                  {preview}
                </p>
              )}
            </>
          ) : (
            estimates.length > 0 &&
            !refund && (
              <FormField
                control={form.control}
                name="recurringExpenseId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Pays Recurring Cost</FormLabel>
                    <Select value={field.value} onValueChange={(id) => id && field.onChange(id)}>
                      <FormControl>
                        <SelectTrigger ref={field.ref}>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value={NONE}>None</SelectItem>
                        {estimates.map((e) => (
                          <SelectItem key={e.id} value={e.id}>
                            {e.description} · {eurCents(priceIn(e, payMonth))} {everyLabel(e.recurrenceMonths)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormDescription>
                      {linked
                        ? payHint(linked, v.date)
                        : suggestion.candidates.length > 0
                          ? `Does it pay ${suggestion.candidates.map((e) => `"${e.description}"`).join(" or ")}? Pick it, or the Plan counts both.`
                          : "Only for a payment of a recurring cost: the Plan then counts it instead of the estimate."}
                    </FormDescription>
                  </FormItem>
                )}
              />
            )
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <FormField
              control={form.control}
              name="documentRef"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{paidInCashBook ? "Document" : "Document (optional)"}</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g. Invoice 40/26" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="project"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Cost Centre (optional)</FormLabel>
                  <FormControl>
                    <Input list={`${listId}-centres`} placeholder="e.g. Flat Rental" {...field} />
                  </FormControl>
                  <datalist id={`${listId}-centres`}>
                    {costCentres.map((c) => (
                      <option key={c} value={c} />
                    ))}
                  </datalist>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          {!v.isRecurring && (
            <div className="space-y-2">
              <span className="text-sm font-medium leading-none">Invoice File</span>
              <InvoiceFileSlot
                stored={editing?.file}
                draft={fileDraft}
                onDraftChange={setFileDraft}
                noun="cost"
                viewHref={editing ? `/costs/${editing.id}/file` : undefined}
                unsaved={form.formState.isDirty || fileDraft.picked !== null || fileDraft.removed}
                disabled={pending}
                hint="The XML from the SDI, signed (.p7m) or not. A PDF only when the supplier sends no XML."
              />
            </div>
          )}

          {!editing?.isRecurring && !paidInCashBook && v.paidFrom === UNPAID && v.recurringExpenseId === NONE && state.kind !== "pay" && (
            <FormField
              control={form.control}
              name="isRecurring"
              render={({ field }) => (
                <FormItem className="flex items-center justify-between gap-3 rounded-lg border p-3">
                  <div className="space-y-0.5">
                    <FormLabel>Recurring Estimate</FormLabel>
                    <FormDescription>The Plan counts it every period, until a payment stands for it.</FormDescription>
                  </div>
                  <FormControl>
                    <Switch
                      checked={field.value}
                      onCheckedChange={(on) => {
                        field.onChange(on)
                        // An estimate has no collaborator to name: Collaborators is for a one-off invoice.
                        if (on && v.category === "collaborators") form.setValue("category", "other")
                      }}
                    />
                  </FormControl>
                </FormItem>
              )}
            />
          )}

          {!v.isRecurring && v.collaboratorId === NONE && (
            <RentLinkFields project={v.project} mode="offset" date={v.date} value={rentLink} onChange={setRentLink} />
          )}

          <FormField
            control={form.control}
            name="notes"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Notes (optional)</FormLabel>
                <FormControl>
                  <Textarea rows={2} {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : submit}
            </Button>
          </DialogFooter>
        </form>
      </Form>
    </>
  )
}
