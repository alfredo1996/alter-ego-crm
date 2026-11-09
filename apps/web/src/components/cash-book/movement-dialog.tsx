"use client"

import { isoDate } from "@alter-ego/kernel/dates"
import { Button } from "@alter-ego/ui/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@alter-ego/ui/ui/dialog"
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@alter-ego/ui/ui/form"
import { Input } from "@alter-ego/ui/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@alter-ego/ui/ui/select"
import { Textarea } from "@alter-ego/ui/ui/textarea"
import { toast } from "@alter-ego/ui/use-toast"
import { cn } from "@alter-ego/ui/utils"
import { zodResolver } from "@hookform/resolvers/zod"
import { Trash2 } from "lucide-react"
import { useEffect, useId, useMemo, useState } from "react"
import { useForm, useWatch, type Control } from "react-hook-form"


import { defaultAccountId, rememberAccount } from "@/components/cash-book/last-account"
import { ConfirmDeleteDialog } from "@/components/confirm-delete-dialog"
import { MarkPaidForm } from "@/components/crm/invoice-table"
import { MoneyInput } from "@/components/money-input"
import { NO_RENT_LINK, RentLinkFields, type RentLink } from "@/components/rent/rent-link-fields"
import { useCreateCompanyExpense } from "@/hooks/use-company-expenses"
import { useCreateCompanyLoan } from "@/hooks/use-company-loans"
import {
  useCreateCompanyMovement,
  useDeleteCompanyMovement,
  useUpdateCompanyMovement,
} from "@/hooks/use-company-movements"
import {
  COST_CATEGORY_LABELS,
  costCentresOf,
  dayLabel,
  deposits,
  kindLabel,
  ownerLoanBalance,
  pickEstimate,
  round2,
  supplierDocuments,
} from "@/lib/cash-book"
import { payHint } from "@/lib/cash-book-recurring"
import { eurCents, invoiceClientId, invoiceTotal, openCredits } from "@/lib/invoices"
import { priceIn } from "@/lib/projection"
import { z } from "@/lib/zod"
import { companyExpenseCategorySchema, companyMovementKindSchema } from "@/types/schemas"

import type {
  Client,
  CompanyAccount,
  CompanyExpense,
  CompanyExpenseCategory,
  CompanyLoan,
  CompanyMovement,
  CompanyMovementKind,
  CreateCompanyMovementInput,
  Engagement,
  Invoice,
} from "@/types"

type Direction = "out" | "in" | "transfer"

/**
 * What each type writes, behind one dialog: "invoice" marks an invoice paid,
 * "cost" and "refund" are a cost on its account, "loan" a shareholder loan
 * (in) or its repayment (out). Every other type is a movement.
 */
type TypeValue = CompanyMovementKind | "invoice" | "cost" | "refund" | "loan"

/** What Add Movement opens on, besides a blank form: Pay on Owed & Held. */
export type MovementPreset =
  | {
      direction: "out"
      type: "supplier_payment"
      expenseId: string
      amount: number
      documentRef: string | null
      project: string | null
    }
  | {
      /** Moving out (Rent module): giving a lease's deposit back. */
      direction: "out"
      type: "deposit_held"
      leaseId: string
      amount: number
      date: string
      accountId?: string
      counterparty: string
      project: string | null
    }

const NONE = "none"

type TypeOption = { value: TypeValue; label: string; help: string }

// ponytail: rare reversals (VAT refund, income reversed, capital returned) stay off the list until one happens.
const TYPES: Record<"out" | "in", TypeOption[]> = {
  out: [
    {
      value: "cost",
      label: "Cost",
      help: "Something the company paid for, a bank fee or stamp duty too: a cost on Costs and in the Plan.",
    },
    {
      value: "supplier_payment",
      label: "Supplier Invoice Payment",
      help: "All or part of a supplier invoice recorded on Costs as Not Paid Yet. The invoice is the cost; this is the money.",
    },
    { value: "vat", label: "VAT (F24)", help: "VAT paid with an F24." },
    {
      value: "tax",
      label: "Tax (F24)",
      help: "IRES, IRAP, INPS or IRPEF lines of an F24. Stamp duty and chamber-of-commerce lines are a Cost with document \"F24\"; a withholding (code 1040) is a Supplier Invoice Payment on the professional's invoice.",
    },
    {
      value: "compensation",
      label: "Administrator Pay",
      help: "Your net pay as administrator.",
    },
    {
      value: "deposit_held",
      label: "Deposit Returned",
      help: "A tenant's deposit given back. To keep part of it, also add that part as Rent & Other Income.",
    },
    { value: "deposit_paid", label: "Deposit Paid", help: "A deposit the company paid, e.g. to a landlord: money to get back, not a cost." },
    {
      value: "loan",
      label: "Shareholder Loan Repayment",
      help: "The SRL pays you back a loan, or costs you paid with your own card. Never a cost.",
    },
  ],
  in: [
    { value: "invoice", label: "Client Invoice Payment", help: "Marks the invoice paid, on the account it arrived on." },
    { value: "income", label: "Rent & Other Income", help: "Rent, expense contributions and other income. Consulting money goes on its invoice." },
    {
      value: "client_income",
      label: "Client Payment Without Invoice",
      help: "Client money with no invoice in the app, e.g. a platform payout. The Plan doesn't count it again.",
    },
    { value: "deposit_held", label: "Deposit Received", help: "A tenant's deposit: money to give back, not income." },
    { value: "deposit_paid", label: "Deposit Refunded", help: "A deposit the company paid, coming back." },
    { value: "loan", label: "Shareholder Loan", help: "Money you lend the company: it owes it back to you. Not income." },
    { value: "capital", label: "Share Capital", help: "Capital paid into the company: neither income nor a loan." },
    { value: "refund", label: "Refund", help: "Money a supplier gave back: it lowers the costs." },
  ],
}

const DIRECTIONS: { value: Direction; label: string }[] = [
  { value: "out", label: "Out" },
  { value: "in", label: "In" },
  { value: "transfer", label: "Transfer" },
]

type Values = {
  direction: Direction
  /** A TypeValue. */
  type: string
  invoiceId: string
  amount: string
  accountId: string
  toAccountId: string
  date: string
  description: string
  counterparty: string
  project: string
  documentRef: string
  notes: string
  /** Cost and Refund. */
  category: CompanyExpenseCategory
  vat: string
  estimateId: string
  /** Supplier Invoice Payment: the supplier invoice, a cost. */
  expenseId: string
}

/** A cost on its account, not a movement. */
const isCost = (d: Direction, t: string) => (d === "out" && t === "cost") || (d === "in" && t === "refund")

/** Who a row's deposit or income belongs to: asked on these only. */
/** Which rent fields a form shows: a payment into an account as Rent & Other Income, an offset as a Cost. */
const rentModeOf = (v: { direction: Direction; type: string }): "payment" | "offset" | "deposit" | null =>
  v.direction === "in" && v.type === "income"
    ? "payment"
    : v.direction === "out" && v.type === "cost"
      ? "offset"
      : v.type === "deposit_held" && (v.direction === "in" || v.direction === "out")
        ? "deposit"
        : null

const hasCounterparty = (d: Direction, t: string) => d !== "transfer" && (t === "deposit_held" || t === "deposit_paid" || t === "income")

const isDeposit = (t: string): t is "deposit_held" | "deposit_paid" => t === "deposit_held" || t === "deposit_paid"

const isKind = (type: string): type is CompanyMovementKind => companyMovementKindSchema.safeParse(type).success

function typeLabel(direction: Direction, type: string): string {
  if (direction === "transfer") return "Transfer"
  return TYPES[direction].find((t) => t.value === type)?.label ?? (isKind(type) ? kindLabel(type, direction) : "")
}

function valuesOf(m: CompanyMovement | null, accounts: CompanyAccount[], today: string, preset: MovementPreset | null): Values {
  const costFields = { category: "other" as const, vat: "0", estimateId: NONE, expenseId: "" }
  if (!m) {
    return {
      direction: "out", type: "cost", invoiceId: "", amount: "", accountId: defaultAccountId(accounts), toAccountId: "",
      date: today, description: "", counterparty: "", project: "", documentRef: "", notes: "", ...costFields,
      ...(preset && {
        direction: preset.direction,
        type: preset.type,
        amount: String(preset.amount),
        project: preset.project ?? "",
        ...("expenseId" in preset
          ? { expenseId: preset.expenseId, documentRef: preset.documentRef ?? "" }
          : {
              date: preset.date,
              counterparty: preset.counterparty,
              ...(preset.accountId && accounts.some((a) => a.id === preset.accountId) && { accountId: preset.accountId }),
            }),
      }),
    }
  }
  return {
    ...costFields,
    expenseId: m.expenseId ?? "",
    direction: m.kind === "transfer" ? "transfer" : m.direction,
    type: m.kind,
    invoiceId: "",
    amount: String(m.amount),
    accountId: m.accountId,
    toAccountId: m.toAccountId ?? "",
    date: isoDate(m.date),
    description: m.description,
    counterparty: m.counterparty ?? "",
    project: m.project ?? "",
    documentRef: m.documentRef ?? "",
    notes: m.notes ?? "",
  }
}

/**
 * Add Movement, and the editor of a movement: Out, In or Transfer, one form.
 * Client Invoice Payment is Mark Paid, inside it. Save & Add Another keeps the
 * day, the account, the type and who paid: one bank transfer split in several rows.
 */
export function MovementDialog({
  userId,
  open,
  onOpenChange,
  onCloseAutoFocus,
  movement,
  preset = null,
  accounts,
  movements,
  expenses,
  loans,
  invoices,
  engagements,
  clients,
}: {
  userId: string | undefined
  open: boolean
  onOpenChange: (open: boolean) => void
  /** No DialogTrigger: the caller says where focus goes back to. */
  onCloseAutoFocus?: (event: Event) => void
  /** Editing this one; null adds. */
  movement: CompanyMovement | null
  /** A new one already filled in. */
  preset?: MovementPreset | null
  accounts: CompanyAccount[]
  /** Every movement: cost centres, deposits held, supplier payments. */
  movements: CompanyMovement[]
  /** Every cost: estimates, supplier invoices, the owner's card. */
  expenses: CompanyExpense[]
  loans: CompanyLoan[]
  invoices: Invoice[]
  engagements: Pick<Engagement, "id" | "clientId">[]
  clients: Pick<Client, "id" | "name">[]
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md" onCloseAutoFocus={onCloseAutoFocus}>
        {/* Keyed: each opening starts from its movement, or from today. */}
        {open && (
          <MovementForm
            key={movement?.id ?? (preset ? `pay-${"expenseId" in preset ? preset.expenseId : preset.leaseId}` : "new")}
            userId={userId}
            movement={movement}
            preset={preset}
            accounts={accounts}
            movements={movements}
            expenses={expenses}
            loans={loans}
            invoices={invoices}
            engagements={engagements}
            clients={clients}
            onClose={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

function MovementForm({
  userId,
  movement,
  preset,
  accounts,
  movements,
  expenses,
  loans,
  invoices,
  engagements,
  clients,
  onClose,
}: {
  userId: string | undefined
  movement: CompanyMovement | null
  preset: MovementPreset | null
  accounts: CompanyAccount[]
  movements: CompanyMovement[]
  expenses: CompanyExpense[]
  loans: CompanyLoan[]
  invoices: Invoice[]
  engagements: Pick<Engagement, "id" | "clientId">[]
  clients: Pick<Client, "id" | "name">[]
  onClose: () => void
}) {
  const createMovement = useCreateCompanyMovement(userId)
  const updateMovement = useUpdateCompanyMovement(userId)
  const deleteMovement = useDeleteCompanyMovement(userId)
  const createExpense = useCreateCompanyExpense(userId)
  const createLoan = useCreateCompanyLoan(userId)
  const [today] = useState(() => isoDate(new Date()))
  const [confirmDelete, setConfirmDelete] = useState(false)
  // Rent module: the lease, month and part of a payment (or the lease and month of an offset cost).
  const [rentLink, setRentLink] = useState<RentLink>(
    movement?.leaseId
      ? { leaseId: movement.leaseId, month: movement.rentMonth ?? "", part: movement.rentPart ?? "rent" }
      : preset && "leaseId" in preset
        ? { ...NO_RENT_LINK, leaseId: preset.leaseId }
        : NO_RENT_LINK,
  )
  // Save & Add Another: said here, not in a toast that Esc would close first.
  const [added, setAdded] = useState<{ last: string; count: number; total: number } | null>(null)
  const markPaidTitle = useId()
  const listId = useId()
  const editing = movement !== null

  // Without the row being edited: what is held besides it.
  const held = useMemo(() => deposits(movements.filter((m) => m.id !== movement?.id)), [movements, movement])
  const projects = useMemo(() => costCentresOf(movements, expenses), [movements, expenses])
  // What each supplier invoice is owed besides the payment being edited.
  const bills = useMemo(
    () => supplierDocuments(expenses, movements.filter((m) => m.id !== movement?.id)).docs,
    [expenses, movements, movement],
  )
  const owner = ownerLoanBalance(loans, expenses).total
  const estimates = expenses.filter((e) => e.isRecurring)
  const openInvoices = invoices
    .filter((i) => !i.paidDate && i.amount > 0)
    .sort((a, b) => a.yearMonth.localeCompare(b.yearMonth) || a.number.localeCompare(b.number))
  const customer = (i: Invoice) => clients.find((c) => c.id === invoiceClientId(i, engagements))?.name ?? "Unknown customer"

  const schema = z
    .object({
      direction: z.enum(["out", "in", "transfer"]),
      type: z.string(),
      invoiceId: z.string(),
      amount: z.string(),
      accountId: z.string(),
      toAccountId: z.string(),
      date: z.string(),
      description: z.string().max(300, "Keep it under 300 characters."),
      counterparty: z.string().max(100, "Keep it under 100 characters."),
      project: z.string().max(60, "Keep it under 60 characters."),
      documentRef: z.string().max(100, "Keep it under 100 characters."),
      notes: z.string().max(1000, "Keep it under 1,000 characters."),
      category: companyExpenseCategorySchema,
      vat: z.string(),
      estimateId: z.string(),
      expenseId: z.string(),
    })
    .superRefine((v, ctx) => {
      const issue = (path: keyof Values, message: string) => ctx.addIssue({ code: "custom", path: [path], message })
      const amount = Number(v.amount)
      if (v.amount.trim() === "" || !Number.isFinite(amount) || amount <= 0) issue("amount", "Enter the amount, above 0.")
      // A cost or a loan is saved as one, whose notes stop at 500.
      if ((isCost(v.direction, v.type) || (v.direction !== "transfer" && v.type === "loan")) && v.notes.trim().length > 500) {
        issue("notes", "Keep it under 500 characters.")
      }
      if (isCost(v.direction, v.type)) {
        const vat = Number(v.vat || 0)
        if (!Number.isFinite(vat) || vat < 0) issue("vat", "Enter the VAT, 0 or more.")
        else if (amount > 0 && vat >= amount) issue("vat", "The VAT is part of the amount: less than it.")
      }
      if (v.direction === "out" && v.type === "supplier_payment") {
        const bill = bills.find((b) => b.expense.id === v.expenseId)
        if (!bill) issue("expenseId", "Pick the supplier invoice it pays.")
        else if (amount > bill.owed) {
          issue("amount", `Only ${eurCents(bill.owed)} is owed on ${bill.expense.documentRef}. Record anything more as a Cost.`)
        }
      }
      if (!v.accountId) issue("accountId", "Pick the account.")
      if (v.direction === "transfer") {
        if (!v.toAccountId) issue("toAccountId", "Pick the account the money went to.")
        else if (v.toAccountId === v.accountId) issue("toAccountId", "Pick a different account from the one it left.")
      }
      if (!v.date) issue("date", "Enter the day it went through the bank.")
      else if (v.date > today) issue("date", "A movement can't be in the future.")
      if (v.direction !== "transfer" && v.type === "deposit_held" && !v.counterparty.trim()) {
        issue("counterparty", "Say whose deposit it is, e.g. Room 2.")
      }
    })

  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: valuesOf(movement, accounts, today, preset),
  })
  const values = useWatch({ control: form.control }) as Values
  const { direction, type } = values
  const transfer = direction === "transfer"
  // An edit stays a movement: a cost, a loan or a payment is edited where it lives.
  const options = transfer ? [] : TYPES[direction].filter((o) => !editing || isKind(o.value))
  const cost = isCost(direction, type)
  const loan = !transfer && type === "loan"
  const supplierPayment = direction === "out" && type === "supplier_payment"
  const openBills = bills.filter((b) => b.owed > 0 || b.expense.id === values.expenseId)
  const bill = supplierPayment ? bills.find((b) => b.expense.id === values.expenseId) : undefined
  const suggestion = pickEstimate({ category: values.category, description: values.description }, estimates)
  const linked = estimates.find((e) => e.id === values.estimateId)
  const vatPart = Number(values.vat) || 0
  const total = Number(values.amount) || 0
  // An imported or chat-written kind not on the list still shows as itself.
  const shownOptions =
    transfer || !isKind(type) || options.some((o) => o.value === type)
      ? options
      : [...options, { value: type as TypeValue, label: typeLabel(direction, type), help: "" }]
  const option = shownOptions.find((o) => o.value === type)
  const invoice = type === "invoice" && direction === "in" ? openInvoices.find((i) => i.id === values.invoiceId) : undefined
  const who = values.counterparty.trim()
  const heldBy = isDeposit(type) && who ? held.find((d) => d.kind === type && d.counterparty.toLowerCase() === who.toLowerCase()) : undefined
  const accountName = (id: string) => accounts.find((a) => a.id === id)?.name ?? "the account"
  // Giving back (or getting back) more than the book holds for that name.
  const backing = !transfer && ((type === "deposit_held" && direction === "out") || (type === "deposit_paid" && direction === "in"))
  const overReturn = backing && who !== "" && Number(values.amount) > (heldBy?.amount ?? 0)
  const whoHelp = (): string => {
    if (type === "income") return "Who paid, e.g. Room 2."
    if (overReturn) {
      const what = type === "deposit_held" ? "Deposit Received" : "Deposit Paid"
      return heldBy
        ? `${heldBy.counterparty}: only ${eurCents(heldBy.amount)} in the Cash Book, less than this. Check the amount and the name.`
        : `${who}: nothing in the Cash Book under this name. If it began before the book, first add it as ${what} dated before the account's opening date: it counts as a deposit without changing the balance.`
    }
    if (heldBy) return `${heldBy.counterparty}: ${eurCents(heldBy.amount)} ${type === "deposit_held" ? "held" : "to get back"} now.`
    return type === "deposit_held"
      ? "A name or a room: it groups the deposits to give back."
      : "Who holds it, e.g. the landlord: it groups the deposits to get back."
  }
  // A day before the account opened stays out of its balance: said before saving, not discovered after.
  const early = [accounts.find((a) => a.id === values.accountId), transfer ? accounts.find((a) => a.id === values.toAccountId) : undefined].find(
    (a) => a && values.date && values.date < isoDate(a.openingDate),
  )

  const setDirection = (d: Direction) => {
    form.setValue("direction", d)
    const allowed = d === "transfer" ? [] : TYPES[d].filter((o) => !editing || isKind(o.value))
    if (d !== "transfer" && !allowed.some((o) => o.value === form.getValues("type"))) form.setValue("type", allowed[0].value)
    form.clearErrors()
  }

  // A cost takes the one estimate it clearly pays, until a pick is made by hand.
  const picked = suggestion.picked?.id
  useEffect(() => {
    if (form.getFieldState("estimateId").isDirty) return
    form.setValue("estimateId", picked ?? NONE)
  }, [picked, form])

  const pickBill = (id: string) => {
    const b = bills.find((x) => x.expense.id === id)
    if (!b) return
    if (!form.getValues("amount")) form.setValue("amount", String(b.owed))
    if (!form.getValues("project")) form.setValue("project", b.expense.project ?? "")
    if (!form.getValues("documentRef")) form.setValue("documentRef", b.expense.documentRef ?? "")
  }

  // ponytail: Save & Add Another keeps type and account; a payment, cost or loan has no edit mode here.
  async function write(v: Values): Promise<number> {
    const amount = round2(Number(v.amount))
    const date = new Date(`${v.date}T00:00:00`)
    const label = typeLabel(v.direction, v.type)
    if (isCost(v.direction, v.type)) {
      const sign = v.type === "refund" ? -1 : 1
      const vat = round2(Number(v.vat || 0))
      await createExpense.mutateAsync({
        description: v.description.trim() || (v.type === "refund" ? `Refund: ${COST_CATEGORY_LABELS[v.category]}` : COST_CATEGORY_LABELS[v.category]),
        category: v.category,
        amount: round2(sign * (amount - vat)),
        vat: round2(sign * vat),
        date,
        isRecurring: false,
        accountId: v.accountId,
        recurringExpenseId: v.type === "cost" && v.estimateId !== NONE ? v.estimateId : null,
        documentRef: v.documentRef.trim() || null,
        project: v.project.trim() || null,
        notes: v.notes.trim() || null,
        ...(rentModeOf(v) === "offset" && rentLink.leaseId && { leaseId: rentLink.leaseId, forMonth: rentLink.month }),
      })
    } else if (v.direction !== "transfer" && v.type === "loan") {
      await createLoan.mutateAsync({
        direction: v.direction === "in" ? "to_company" : "from_company",
        amount,
        date,
        accountId: v.accountId,
        description: v.description.trim() || label,
        notes: v.notes.trim() || null,
      })
    } else if (movement) {
      // Any date edit makes the day a real one.
      const dateEdited = v.date !== isoDate(movement.date)
      await updateMovement.mutateAsync({ id: movement.id, input: { ...inputOf(v), ...(dateEdited && { dateEstimated: false }) } })
    } else {
      await createMovement.mutateAsync(inputOf(v))
    }
    return amount
  }

  const inputOf = (v: Values): CreateCompanyMovementInput => {
    const label = typeLabel(v.direction, v.type)
    return {
      kind: v.direction === "transfer" ? "transfer" : (v.type as CompanyMovementKind),
      direction: v.direction === "transfer" ? "out" : v.direction,
      amount: round2(Number(v.amount)),
      date: new Date(`${v.date}T00:00:00`),
      accountId: v.accountId,
      toAccountId: v.direction === "transfer" ? v.toAccountId : null,
      description:
        v.description.trim() || (v.direction === "transfer" ? `Transfer to ${accountName(v.toAccountId)}` : label),
      documentRef: v.documentRef.trim() || null,
      project: v.direction === "transfer" ? null : v.project.trim() || null,
      counterparty: hasCounterparty(v.direction, v.type) ? v.counterparty.trim() || null : null,
      notes: v.notes.trim() || null,
      ...(v.direction === "out" && v.type === "supplier_payment" && { expenseId: v.expenseId }),
      ...(rentModeOf(v) === "payment" && rentLink.leaseId
        ? { leaseId: rentLink.leaseId, rentMonth: rentLink.month, rentPart: rentLink.part }
        : rentModeOf(v) === "deposit" && rentLink.leaseId
          ? { leaseId: rentLink.leaseId, rentMonth: null, rentPart: null }
          : movement?.leaseId && { leaseId: null, rentMonth: null, rentPart: null }), // moved off the lease: unlink it
    }
  }

  const save = (again: boolean) =>
    form.handleSubmit(async (v) => {
      let amount: number
      try {
        amount = await write(v)
      } catch {
        // The MutationCache's onError has said why; the form stays to retry.
        return
      }
      const what = `${typeLabel(v.direction, v.type)} ${eurCents(amount)}`
      const where =
        v.direction === "transfer"
          ? `from ${accountName(v.accountId)} to ${accountName(v.toAccountId)}`
          : `${v.direction === "in" ? "into" : "from"} ${accountName(v.accountId)}`
      rememberAccount(v.accountId)
      if (!again) {
        toast({ title: `${movement ? "Saved" : "Added"}: ${what} ${where}.` })
        return onClose()
      }
      setAdded((a) => ({ last: `${what} ${where}`, count: (a?.count ?? 0) + 1, total: round2((a?.total ?? 0) + amount) }))
      // Same day, account, type, project and payer: the next part of the same transfer.
      // keepFieldsRef: without it reset drops the fields, and setFocus finds none.
      form.reset(
        { ...v, amount: "", description: "", documentRef: "", notes: "", vat: "0", estimateId: NONE, expenseId: "" },
        { keepFieldsRef: true },
      )
      form.setFocus("amount")
    })

  const remove = () =>
    deleteMovement.mutate(movement!.id, {
      onSuccess: () => {
        setConfirmDelete(false)
        onClose()
        toast({ title: `Deleted: ${movement!.description}.` })
      },
    })

  const pending = createMovement.isPending || updateMovement.isPending || createExpense.isPending || createLoan.isPending

  return (
    <>
      <DialogHeader>
        <DialogTitle>{editing ? "Edit Movement" : "Add Movement"}</DialogTitle>
        <DialogDescription>
          {editing
            ? "Changes show in the Cash Book balances at once."
            : "Money in or out of a company account, or moved between two of them."}
        </DialogDescription>
      </DialogHeader>
      <Form {...form}>
        <form noValidate className="space-y-4" onSubmit={save(false)}>
          <div role="group" aria-label="Direction" className="grid grid-cols-3 gap-1 rounded-md bg-muted p-1">
            {DIRECTIONS.map((d) => (
              <button
                key={d.value}
                type="button"
                aria-pressed={direction === d.value}
                disabled={editing && (d.value === "transfer") !== transfer}
                onClick={() => setDirection(d.value)}
                className={cn(
                  "rounded-sm px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors disabled:opacity-40 pointer-coarse:min-h-11",
                  direction === d.value && "bg-background text-foreground shadow-sm",
                )}
              >
                {d.label}
              </button>
            ))}
          </div>

          {!transfer && (
            <FormField
              control={form.control}
              name="type"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Type</FormLabel>
                  {/* Radix reports "" for a value it has no item for: never a type. */}
                  <Select value={field.value} onValueChange={(v) => v && field.onChange(v)} disabled={editing && field.value === "invoice"}>
                    <FormControl>
                      <SelectTrigger ref={field.ref}>
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {shownOptions
                        .filter((o) => !(editing && o.value === "invoice"))
                        .map((o) => (
                          <SelectItem key={o.value} value={o.value}>
                            {o.label}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                  <FormDescription>{option?.help}</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          )}

          {type === "invoice" && direction === "in" ? (
            <FormField
              control={form.control}
              name="invoiceId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Invoice</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger ref={field.ref}>
                        <SelectValue placeholder={openInvoices.length ? "Pick an unpaid invoice" : "No unpaid invoices"} />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {openInvoices.map((i) => (
                        <SelectItem key={i.id} value={i.id}>
                          {i.number} · {customer(i)} · {eurCents(invoiceTotal(i))}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormDescription>The same as Mark Paid on the Invoices page.</FormDescription>
                </FormItem>
              )}
            />
          ) : (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField
                  control={form.control}
                  name="amount"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{cost ? (type === "refund" ? "Amount Refunded, VAT Included" : "Amount Paid, VAT Included") : "Amount"}</FormLabel>
                      <div className="relative">
                        <span aria-hidden className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-muted-foreground">
                          €
                        </span>
                        <FormControl>
                          <Input
                            {...field}
                            // Not on touch: the keyboard opened at once over Type, which comes first.
                            autoFocus={!window.matchMedia("(pointer: coarse)").matches}
                            type="number"
                            min="0"
                            step="0.01"
                            inputMode="decimal"
                            className="pl-7 text-right tabular-nums"
                          />
                        </FormControl>
                      </div>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="date"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Date</FormLabel>
                      <FormControl>
                        <Input type="date" max={today} {...field} />
                      </FormControl>
                      {early && (
                        <FormDescription className="text-amber-700 dark:text-amber-400">
                          {!transfer && isDeposit(type)
                            ? `Before ${early.name} opened (${dayLabel(isoDate(early.openingDate))}): counted as a deposit, not in the balance, which already includes it.`
                            : `Before ${early.name} opened (${dayLabel(isoDate(early.openingDate))}): it stays out of the balance and shows in To Chase. Change the date, or the account's opening date.`}
                        </FormDescription>
                      )}
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              {/* Under the amount that takes focus after Save & Add Another: in sight on a phone too. Mounted empty, so the first message is announced. */}
              <p role="status" className={added ? "rounded-md bg-muted px-3 py-2 text-sm" : "sr-only"}>
                {added &&
                  `Added: ${added.last}. ${added.count === 1 ? "1 row" : `${added.count} rows`} so far, ${eurCents(added.total)} in all.`}
              </p>

              <div className={cn("grid gap-4", transfer && "sm:grid-cols-2")}>
                <AccountField
                  control={form.control}
                  name="accountId"
                  label={transfer ? "From Account" : direction === "in" ? "Into Account" : "From Account"}
                  accounts={accounts}
                />
                {transfer && <AccountField control={form.control} name="toAccountId" label="To Account" accounts={accounts} />}
              </div>
              {transfer && (
                <p className="text-sm text-muted-foreground">
                  Neither income nor a cost: the total of your accounts stays the same.
                </p>
              )}

              {supplierPayment && (
                <FormField
                  control={form.control}
                  name="expenseId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Supplier Invoice</FormLabel>
                      <Select
                        value={field.value}
                        onValueChange={(id) => {
                          if (!id) return
                          field.onChange(id)
                          pickBill(id)
                        }}
                      >
                        <FormControl>
                          <SelectTrigger ref={field.ref}>
                            <SelectValue placeholder={openBills.length ? "Pick the invoice it pays" : "No supplier invoice is waiting"} />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {openBills.map((b) => (
                            <SelectItem key={b.expense.id} value={b.expense.id}>
                              {b.expense.documentRef} · {b.expense.description} · {eurCents(b.owed)} owed
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormDescription>
                        {bill
                          ? `${eurCents(bill.total)} in all, ${eurCents(bill.paid)} paid before: ${eurCents(Math.max(0, round2(bill.owed - total)))} owed after this.`
                          : openBills.length
                            ? "The invoices on Costs not paid in full."
                            : "Record the supplier's invoice on Costs first, Paid From Not Paid Yet with its number under Document."}
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}

              {cost && (
                <>
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
                                // A collaborator's invoice is recorded from Costs; one already filed there stays editable.
                                .filter(([value]) => value !== "collaborators" || field.value === "collaborators")
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
                      name="vat"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Of Which VAT (€)</FormLabel>
                          <FormControl>
                            <MoneyInput {...field} min="0" />
                          </FormControl>
                          <FormDescription>The VAT you recover. 0 when none: reverse charge, an exempt rental&apos;s costs.</FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {type === "refund" ? "Costs lowered by" : "On Costs and in the Plan:"}{" "}
                    <span className="font-medium text-foreground tabular-nums">{eurCents(Math.max(0, round2(total - vatPart)))}</span>
                    {vatPart > 0 && ` + VAT ${eurCents(vatPart)}`}.
                  </p>
                  {type === "cost" && estimates.length > 0 && (
                    <FormField
                      control={form.control}
                      name="estimateId"
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
                                  {e.description} · {eurCents(priceIn(e, values.date ? values.date.slice(0, 7) : isoDate(new Date()).slice(0, 7)))}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <FormDescription>
                            {linked
                              ? payHint(linked, values.date)
                              : suggestion.candidates.length > 0
                                ? `Does it pay ${suggestion.candidates.map((e) => `"${e.description}"`).join(" or ")}? Pick it, or the Plan counts both.`
                                : "Only for a payment of a recurring cost: the Plan then counts it instead of the estimate."}
                          </FormDescription>
                        </FormItem>
                      )}
                    />
                  )}
                </>
              )}

              {loan && (
                <p
                  role="status"
                  className={cn(
                    "rounded-md bg-muted px-3 py-2 text-sm",
                    direction === "out" && total > Math.max(0, owner) && "bg-amber-500/10 text-amber-800 dark:text-amber-300",
                  )}
                >
                  {direction === "out" && total > Math.max(0, owner)
                    ? `More than the SRL owes you (${eurCents(Math.max(0, owner))}): it would pay you money with no reason, which an SRL can't. Check the amount.`
                    : `The SRL owes you ${eurCents(Math.max(0, owner))} now${total > 0 ? `, ${eurCents(round2(owner + (direction === "in" ? total : -total)))} after this` : ""}.`}
                </p>
              )}

              {hasCounterparty(direction, type) && (
                <FormField
                  control={form.control}
                  name="counterparty"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        {type === "income" ? "Paid By (optional)" : type === "deposit_held" ? "Whose Deposit" : "Held By (optional)"}
                      </FormLabel>
                      <FormControl>
                        <Input placeholder={type === "deposit_paid" ? "e.g. Landlord" : "e.g. Room 2"} list={`${listId}-who`} {...field} />
                      </FormControl>
                      <datalist id={`${listId}-who`}>
                        {held.map((d) => (
                          <option key={`${d.kind}${d.counterparty}`} value={d.counterparty} />
                        ))}
                      </datalist>
                      <FormDescription className={cn(overReturn && "text-amber-700 dark:text-amber-400")}>{whoHelp()}</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}

              <FormField
                control={form.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Description (optional)</FormLabel>
                    <FormControl>
                      <Input
                        placeholder={transfer ? "Transfer" : cost ? COST_CATEGORY_LABELS[values.category] : typeLabel(direction, type)}
                        {...field}
                      />
                    </FormControl>
                    <FormDescription>Empty = the type&apos;s name.</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className={cn("grid gap-4", !transfer && !loan && "sm:grid-cols-2")}>
                {!transfer && !loan && (
                  <FormField
                    control={form.control}
                    name="project"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Cost Centre (optional)</FormLabel>
                        <FormControl>
                          <Input list={`${listId}-projects`} placeholder="e.g. Flat Rental" {...field} />
                        </FormControl>
                        <datalist id={`${listId}-projects`}>
                          {projects.map((p) => (
                            <option key={p} value={p} />
                          ))}
                        </datalist>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}
                {!loan && (
                  <FormField
                    control={form.control}
                    name="documentRef"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Document (optional)</FormLabel>
                        <FormControl>
                          <Input placeholder={cost ? "e.g. Invoice 12/26" : "e.g. F24 16/11"} {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}
              </div>

              {rentModeOf(values) && (
                <RentLinkFields
                  project={values.project}
                  mode={rentModeOf(values)!}
                  date={values.date}
                  value={rentLink}
                  onChange={setRentLink}
                  deposit={{ movements: movements.filter((m) => m.id !== movement?.id), direction: values.direction === "out" ? "out" : "in", amount: Number(values.amount) || 0 }}
                />
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

              <DialogFooter className="justify-between">
                {editing && (
                  <Button
                    type="button"
                    variant="ghost"
                    className="text-destructive hover:text-destructive"
                    onClick={() => setConfirmDelete(true)}
                  >
                    <Trash2 className="h-4 w-4 sm:mr-2" />
                    <span className="max-sm:sr-only">Delete</span>
                  </Button>
                )}
                <div className="ml-auto flex flex-wrap justify-end gap-2">
                  {/* A phone has no room for three buttons in one row: the X closes. */}
                  <Button type="button" variant="outline" className={cn(!editing && "max-sm:hidden")} onClick={onClose}>
                    Cancel
                  </Button>
                  {!editing && (
                    <Button type="button" variant="outline" disabled={pending} onClick={save(true)}>
                      Save &amp; Add Another
                    </Button>
                  )}
                  <Button type="submit" disabled={pending}>
                    {pending ? "Saving…" : "Save"}
                  </Button>
                </div>
              </DialogFooter>
            </>
          )}
        </form>
      </Form>

      {invoice && (
        <div className="rounded-md border p-4">
          {/* Keyed: picking another invoice starts its own payment. */}
          <MarkPaidForm
            key={invoice.id}
            userId={userId}
            invoice={invoice}
            credits={openCredits(invoice, invoices, engagements)}
            accounts={accounts}
            titleId={markPaidTitle}
            onDone={onClose}
          />
        </div>
      )}

      {movement && (
        <ConfirmDeleteDialog
          open={confirmDelete}
          onOpenChange={setConfirmDelete}
          title="Delete Movement?"
          description={`${movement.description}, ${eurCents(movement.amount)} on ${dayLabel(isoDate(movement.date))}. The balances change at once.`}
          confirmLabel="Delete Movement"
          isPending={deleteMovement.isPending}
          onConfirm={remove}
        />
      )}
    </>
  )
}

function AccountField({
  control,
  name,
  label,
  accounts,
}: {
  control: Control<Values>
  name: "accountId" | "toAccountId"
  label: string
  accounts: CompanyAccount[]
}) {
  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => (
        <FormItem>
          <FormLabel>{label}</FormLabel>
          <Select value={field.value} onValueChange={field.onChange}>
            <FormControl>
              <SelectTrigger ref={field.ref}>
                <SelectValue placeholder="Pick an account" />
              </SelectTrigger>
            </FormControl>
            <SelectContent>
              {accounts.map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  {a.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FormMessage />
        </FormItem>
      )}
    />
  )
}
