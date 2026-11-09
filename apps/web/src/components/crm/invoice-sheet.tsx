"use client"

import { formatYearMonth, isoDate, parseYearMonth } from "@alter-ego/kernel/dates"
import { Badge } from "@alter-ego/ui/ui/badge"
import { Button } from "@alter-ego/ui/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@alter-ego/ui/ui/dropdown-menu"
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@alter-ego/ui/ui/form"
import { Input } from "@alter-ego/ui/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@alter-ego/ui/ui/select"
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@alter-ego/ui/ui/sheet"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@alter-ego/ui/ui/table"
import { ToastAction } from "@alter-ego/ui/ui/toast"
import { toast } from "@alter-ego/ui/use-toast"
import { cn } from "@alter-ego/ui/utils"
import { zodResolver } from "@hookform/resolvers/zod"
import { addMonths, format, subMonths } from "date-fns"
import { MoreHorizontal } from "lucide-react"
import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { useForm, useWatch, type RefCallBack } from "react-hook-form"


import { InvoiceFileSlot } from "@/components/company-files/invoice-file-slot"
import { ConfirmDeleteDialog } from "@/components/confirm-delete-dialog"
import { StatusBadge } from "@/components/crm/invoice-table"
import { MoneyInput } from "@/components/money-input"
import { useClients } from "@/hooks/use-clients"
import { useCompanyAccounts } from "@/hooks/use-company-accounts"
import { FileUploadError, NO_FILE_CHANGE, writeWithInvoiceFile, type FileDraft } from "@/hooks/use-company-files"
import { useEngagements } from "@/hooks/use-engagements"
import { useCreateInvoice, useDeleteInvoice, useInvoices, useUpdateInvoice } from "@/hooks/use-invoices"
import { useTimecards } from "@/hooks/use-timecards"
import { NON_CASH } from "@/lib/cash-book"
import { monthsFrom } from "@/lib/engagement-burndown"
import { engagementLabel } from "@/lib/engagements"
import {
  clientBilling,
  creditsOn,
  eurCents,
  invoiceClientId,
  invoiceNumberTaken,
  invoicePeriodError,
  invoicePeriodLabel,
  invoiceStatus,
  invoiceSuggestions,
  outstanding,
  periodMonths,
  rangeSuggestion,
  suggestedDueDate,
  suggestedInvoiceNumber,
  suggestedVat,
} from "@/lib/invoices"
import { IVA_RATE } from "@/lib/italian-tax"
import { z } from "@/lib/zod"

import type { BillingMonth, ClientBilling } from "@/lib/invoices"
import type { Client, CompanyAccount, Engagement, Invoice, Timecard, UpdateInvoiceInput } from "@/types"

/** The month just closed is the one being billed; typing it every time is noise. */
export function previousMonth(now: Date = new Date()): string {
  return format(subMonths(now, 1), "yyyy-MM")
}

/** The one month predicate: the schema and the guard must not drift apart. */
export function isYearMonth(value: string): boolean {
  return /^\d{4}-\d{2}$/.test(value)
}

/** An input's number, or null when it is empty or not a number. */
function money(text: string): number | null {
  const n = Number(text)
  return text.trim() === "" || !Number.isFinite(n) ? null : n
}

/** `+ 0` turns -0 into 0, which Intl would print as "-€0.00". */
const cents = (n: number) => Math.round(n * 100) / 100 + 0

/**
 * suggestedVat for a typed amount, as the input holds it: "0" for an empty or
 * unparseable one. A suggestion, never a rule: reverse charge types it down to 0.
 */
export function suggestVat(amount: string, vatShare: number): string {
  const parsed = money(amount)
  return String(parsed === null ? 0 : suggestedVat(parsed, vatShare))
}

/**
 * The suggested net as the parts that make it, over the months the balance
 * counts (closed, logged, not started mid-month): "Hours €13,300.00 + credit
 * notes €700.00 not yet re-invoiced = €14,000.00". null when it is the hours alone.
 */
export function amountParts(months: BillingMonth[], amount: number, currentMonth: string): string | null {
  const counted = months.filter((m) => m.logged !== null && m.yearMonth < currentMonth && !m.partlyLogged)
  const hours = cents(counted.reduce((s, m) => s + (m.logged ?? 0), 0))
  const invoiced = cents(counted.reduce((s, m) => s + m.invoiced, 0))
  // Invoices of other months covering these (−), or these months' covering others (+).
  const carried = cents(amount - hours + invoiced)
  if (invoiced === 0 && carried === 0) return null
  return [
    `Hours ${eurCents(hours)}`,
    invoiced > 0 && `− other invoices ${eurCents(invoiced)}`,
    invoiced < 0 && `+ credit notes ${eurCents(-invoiced)} not yet re-invoiced`,
    carried < 0 && `− ${eurCents(-carried)} covered by invoices on other months`,
    carried > 0 && `+ ${eurCents(carried)} invoiced here beyond the hours, counted on other months`,
    `= ${eurCents(amount)}`,
  ]
    .filter(Boolean)
    .join(" ")
}

/** What opens the sheet. Each new state starts a fresh form. */
export type InvoiceSheetState =
  | { kind: "record"; clientId: string | null; from?: string; to?: string }
  | { kind: "edit"; invoiceId: string }
  /** A new credit note correcting invoiceId. */
  | { kind: "credit"; invoiceId: string }

/** The form as its inputs hold it. amount and vat null = following the suggestion until typed over. */
export type InvoiceSheetValues = {
  clientId: string
  from: string
  to: string
  number: string
  amount: string | null
  vat: string | null
  dueDate: string
  paidDate: string
  /** The cash book account it was paid into; NON_CASH an offset, "" not recorded. */
  paidAccountId: string
}

/** What Save writes, the following fields resolved and the sign applied. */
export type InvoiceFields = {
  from: string
  to: string
  number: string
  amount: number
  vat: number
  /** "YYYY-MM-DD", "" = none. */
  dueDate: string
  paidDate: string
  /** "" = not recorded. */
  paidAccountId: string
}

const day = (value: string) => (value ? new Date(`${value}T00:00:00`) : null)
const dayKey = (d: Date | null | undefined) => (d ? isoDate(d) : "")

// A new invoice is never paid here: the account is written by invoiceUpdate, when it changed.
function invoiceInput(f: InvoiceFields): Required<Omit<UpdateInvoiceInput, "paidAccountId" | "file">> {
  return {
    number: f.number.trim(),
    // From == to is a single month: stored as null, like every writer does.
    fromMonth: f.from < f.to ? f.from : null,
    yearMonth: f.to,
    amount: f.amount,
    vat: f.vat,
    dueDate: day(f.dueDate),
    paidDate: day(f.paidDate),
  }
}

/** The invoice Save would store, for the previews only: never written. */
export function draftInvoice(f: InvoiceFields, clientId: string): Invoice {
  const now = new Date()
  return { id: "draft", userId: "", clientId, engagementId: null, ...invoiceInput(f), paidAccountId: null, createdAt: now, updatedAt: now }
}

/**
 * The single update Save writes: only the fields that changed, so one left
 * alone never overwrites what Claude wrote meanwhile (meetingUpdate's rule).
 */
export function invoiceUpdate(opened: Invoice, f: InvoiceFields): UpdateInvoiceInput {
  const next = invoiceInput(f)
  const input: UpdateInvoiceInput = {}
  if (next.number !== opened.number) input.number = next.number
  if (next.fromMonth !== opened.fromMonth) input.fromMonth = next.fromMonth
  if (next.yearMonth !== opened.yearMonth) input.yearMonth = next.yearMonth
  if (next.amount !== opened.amount) input.amount = next.amount
  if (next.vat !== opened.vat) input.vat = next.vat
  if (f.dueDate !== dayKey(opened.dueDate)) input.dueDate = next.dueDate
  if (f.paidDate !== dayKey(opened.paidDate)) input.paidDate = next.paidDate
  if (f.paidAccountId !== (opened.paidAccountId ?? "")) input.paidAccountId = f.paidAccountId || null
  return input
}

/** Header, a body that scrolls, and the footer pinned to the bottom edge (Components.dc's sheet). */
const CONTENT = "flex w-full flex-col gap-0 p-0 sm:max-w-xl"
const HEADER = "border-b border-hairline px-6 py-5 pr-14 text-left"
/** The account select's "none": Radix has no empty item value. */
const NOT_RECORDED = "not-recorded"
/** Label above on a phone, a label column on sm+. */
const ROW = "grid gap-1.5 space-y-0 sm:grid-cols-[10rem_1fr] sm:gap-x-4"
const LABEL = "sm:pt-2.5"

/** The side panel every invoice change goes through: record, edit and credit note. */
export function InvoiceSheet({
  userId,
  state,
  onStateChange,
}: {
  userId: string | undefined
  state: InvoiceSheetState | null
  /** null closes it; another state re-targets it (a customer picked, Issue Credit Note). */
  onStateChange: (state: InvoiceSheetState | null) => void
}) {
  const open = state !== null
  // Opened from state, not a SheetTrigger, so Radix has nothing to hand focus
  // back to: the sheet remembers what had it (a row's number, a Record button).
  const opener = useRef<HTMLElement | null>(null)
  const isOpen = useRef(open)
  useLayoutEffect(() => {
    isOpen.current = open
    if (open) opener.current = document.activeElement as HTMLElement | null
  }, [open])
  const restoreFocus = (e: Event) => {
    e.preventDefault()
    // A content swapped for another (loaded, re-targeted) is not a close.
    if (isOpen.current) return
    // Gone (a deleted row, a recorded Ready line): the Invoices list, where the change shows.
    // ponytail: a refetch landing after the close animation still drops focus; await it in the mutations if that shows.
    const back = opener.current?.isConnected ? opener.current : document.getElementById("invoices")
    back?.focus()
  }
  return (
    <Sheet open={open} onOpenChange={(next) => !next && onStateChange(null)}>
      {state && (
        <SheetBody
          key={JSON.stringify(state)}
          userId={userId}
          state={state}
          onStateChange={onStateChange}
          restoreFocus={restoreFocus}
        />
      )}
    </Sheet>
  )
}

function Notice({
  title,
  description,
  restoreFocus,
}: {
  title: string
  description: string
  restoreFocus: (e: Event) => void
}) {
  return (
    <SheetContent side="right" className={CONTENT} onCloseAutoFocus={restoreFocus}>
      <SheetHeader className={HEADER}>
        <SheetTitle>{title}</SheetTitle>
        <SheetDescription>{description}</SheetDescription>
      </SheetHeader>
    </SheetContent>
  )
}

type Data = {
  clients: Client[]
  engagements: Engagement[]
  invoices: Invoice[]
  timecards: Timecard[]
  accounts: CompanyAccount[]
}

function SheetBody({
  userId,
  state,
  onStateChange,
  restoreFocus,
}: {
  userId: string | undefined
  state: InvoiceSheetState
  onStateChange: (state: InvoiceSheetState | null) => void
  restoreFocus: (e: Event) => void
}) {
  const { data: clients } = useClients(userId)
  const { data: engagements } = useEngagements(userId)
  const { data: invoices } = useInvoices(userId)
  const { data: timecards } = useTimecards(userId)
  const { data: accounts } = useCompanyAccounts(userId)
  // The browser's day, fixed for this opening: hours after it are scheduled, not worked.
  const [today] = useState(() => isoDate(new Date()))

  if (!clients || !engagements || !invoices || !timecards || !accounts) {
    return <Notice title="Loading…" description="Reading your invoices and hours." restoreFocus={restoreFocus} />
  }
  const target = state.kind === "record" ? null : (invoices.find((i) => i.id === state.invoiceId) ?? null)
  if (state.kind !== "record" && !target) {
    return <Notice title="Invoice Not Found" description="It was deleted in the meantime." restoreFocus={restoreFocus} />
  }
  return (
    <InvoiceForm
      userId={userId}
      data={{ clients, engagements, invoices, timecards, accounts }}
      today={today}
      state={state}
      target={target}
      onStateChange={onStateChange}
      restoreFocus={restoreFocus}
    />
  )
}

/** The newest invoice by createdAt: of the invoices, or of the credit notes. */
function latest(invoices: Invoice[], credit: boolean): Invoice | null {
  return invoices
    .filter((i) => i.amount < 0 === credit)
    .reduce<Invoice | null>((a, i) => (a === null || i.createdAt > a.createdAt ? i : a), null)
}

/** The form's first values and the due-date basis it shows: the suggestion is the draft. */
function opening(input: {
  state: InvoiceSheetState
  target: Invoice | null
  credit: boolean
  clientId: string | null
  base: ClientBilling
  engagements: Engagement[]
  invoices: Invoice[]
  customerInvoices: Invoice[]
  /** A new credit note: what its invoice still bills once earlier credit notes are off. */
  creditLeft: number
  today: string
}): {
  values: InvoiceSheetValues
  due: { date: string; basis: string } | null
  /** The number the suggested one follows: "Next after 17/2026". */
  after: string | null
} {
  const { state, target, credit, base, engagements, invoices, customerInvoices, today } = input
  const clientId = input.clientId ?? ""
  if (state.kind === "edit" && target) {
    const signed = (n: number) => String(credit ? Math.abs(n) : n)
    const from = periodMonths(target)[0]
    // Stored as the rule gives it (always, for a credit note's own ratio): it
    // follows the amount, so a corrected net never keeps the old VAT. Typed
    // otherwise (reverse charge on part): kept as stored.
    const follows =
      credit ||
      target.vat ===
        suggestedVat(target.amount, rangeSuggestion(base, from, target.yearMonth, engagements).vatShare)
    return {
      values: {
        clientId,
        from,
        to: target.yearMonth,
        number: target.number,
        amount: signed(target.amount),
        vat: follows ? null : signed(target.vat),
        dueDate: dayKey(target.dueDate),
        paidDate: dayKey(target.paidDate),
        paidAccountId: target.paidAccountId ?? "",
      },
      due: null,
      after: null,
    }
  }
  if (state.kind === "credit" && target) {
    const next = suggestedInvoiceNumber(invoices, { credit: true, today })
    return {
      values: {
        clientId,
        from: periodMonths(target)[0],
        to: target.yearMonth,
        number: next.number,
        amount: input.creditLeft > 0 ? String(input.creditLeft) : "",
        vat: null,
        dueDate: "",
        paidDate: "",
        paidAccountId: "",
      },
      due: null,
      after: next.after,
    }
  }
  const record = state.kind === "record" ? state : null
  const first = invoiceSuggestions(base)[0]
  // Last month, unless the customer's newest invoice already covers it: then the month after.
  const newest = latest(customerInvoices, false)
  const prev = previousMonth(parseYearMonth(today.slice(0, 7)))
  const manual =
    newest && newest.yearMonth >= prev ? format(addMonths(parseYearMonth(newest.yearMonth), 1), "yyyy-MM") : prev
  const from = record?.from ?? (first ? (first.fromMonth ?? first.yearMonth) : manual)
  const to = record?.to ?? (first ? first.yearMonth : manual)
  const due = input.clientId ? suggestedDueDate(customerInvoices, to, today) : null
  const next = input.clientId ? suggestedInvoiceNumber(invoices, { today }) : { number: "", after: null }
  return {
    values: {
      clientId,
      from,
      to,
      number: next.number,
      amount: null,
      vat: null,
      dueDate: due?.date ?? "",
      paidDate: "",
      paidAccountId: "",
    },
    due,
    after: next.after,
  }
}

/** A link-styled button inside a help line: "Use €6,500.00". */
function UseLink({ value, onClick }: { value: number; onClick: () => void }) {
  return (
    <Button type="button" variant="link" className="h-auto p-0 text-[0.8rem]" onClick={onClick}>
      Use {eurCents(value)}
    </Button>
  )
}

/** A run of fields under a 12px caps eyebrow over a hairline. */
function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-5">
      <h3 className="border-b border-hairline pb-2 text-xs font-semibold tracking-[0.08em] text-muted-foreground uppercase">
        {title}
      </h3>
      {children}
    </section>
  )
}

function InvoiceForm({
  userId,
  data,
  today,
  state,
  target,
  onStateChange,
  restoreFocus,
}: {
  userId: string | undefined
  data: Data
  today: string
  state: InvoiceSheetState
  /** The stored invoice being edited, or the one a new credit note corrects. */
  target: Invoice | null
  onStateChange: (state: InvoiceSheetState | null) => void
  restoreFocus: (e: Event) => void
}) {
  const { clients, engagements, timecards, invoices, accounts } = data
  const createInvoice = useCreateInvoice(userId)
  const updateInvoice = useUpdateInvoice(userId)
  const deleteInvoice = useDeleteInvoice(userId)
  const [confirmDelete, setConfirmDelete] = useState(false)
  // The invoice file waits here until Save: Cancel uploads nothing.
  const [fileDraft, setFileDraft] = useState<FileDraft>(NO_FILE_CHANGE)
  const [saving, setSaving] = useState(false)

  // The invoice as opened: a refetch or Claude's edit while the sheet is open
  // must not turn an untouched field into an "edit" that reverts it.
  const [opened] = useState(state.kind === "edit" ? target : null)
  const original = state.kind === "credit" ? target : null
  const credit = state.kind === "credit" || (opened !== null && opened.amount < 0)
  // A credit note's VAT keeps the ratio of the invoice it corrects, or its own when edited.
  const mirror = credit ? (original ?? opened) : null
  const clientId = state.kind === "record" ? state.clientId : target && invoiceClientId(target, engagements)
  const name = clients.find((c) => c.id === clientId)?.name ?? "Unknown customer"
  const noun = credit ? "credit note" : "invoice"
  const Noun = credit ? "Credit note" : "Invoice"

  const billingOf = (list: Invoice[]) =>
    clientBilling({ clientId: clientId ?? "", engagements, timecards, invoices: list, today })
  // base: every invoice but the one being edited, so recording and editing share one path.
  const baseInvoices = useMemo(() => invoices.filter((i) => i.id !== opened?.id), [invoices, opened])
  const base = useMemo(
    () => clientBilling({ clientId: clientId ?? "", engagements, timecards, invoices: baseInvoices, today }),
    [clientId, engagements, timecards, baseInvoices, today],
  )
  const customerInvoices = invoices.filter((i) => invoiceClientId(i, engagements) === clientId)
  // Credit notes already on the original's months: a new one offers only what they leave.
  const earlier = original ? creditsOn(original, invoices, engagements) : []
  const creditedBefore = cents(earlier.reduce((s, c) => s + Math.abs(c.amount), 0))
  const creditLeft = original ? Math.max(0, cents(Math.abs(original.amount) - creditedBefore)) : 0

  const [initial] = useState(() =>
    opening({
      state,
      target,
      credit,
      clientId,
      base,
      engagements,
      invoices,
      customerInvoices,
      creditLeft,
      today,
    }),
  )

  /** The values Save would write: a following field takes its suggestion. */
  const resolve = useMemo(() => {
    return (v: InvoiceSheetValues) => {
      const suggestion = rangeSuggestion(base, v.from, v.to, engagements)
      const amount =
        v.amount ??
        (mirror ? String(Math.abs(mirror.amount)) : suggestion.amount > 0 ? String(suggestion.amount) : "")
      const net = money(amount)
      const vatSuggested =
        net === null
          ? 0
          : mirror
            ? mirror.amount === 0
              ? 0
              : cents((Math.abs(mirror.vat) * net) / Math.abs(mirror.amount))
            : v.amount === null
              ? suggestion.vat
              : Number(suggestVat(amount, suggestion.vatShare))
      return { suggestion, amount, vat: v.vat ?? String(vatSuggested), vatSuggested }
    }
  }, [base, engagements, mirror])

  const needsClient = state.kind === "record" && clientId === null
  const schema = useMemo(
    () =>
      z
        .object({
          clientId: z.string(),
          from: z.string(),
          to: z.string(),
          number: z.string(),
          amount: z.string().nullable(),
          vat: z.string().nullable(),
          dueDate: z.string(),
          paidDate: z.string(),
          paidAccountId: z.string(),
        })
        .superRefine((v, ctx) => {
          const issue = (path: keyof InvoiceSheetValues, message: string) =>
            ctx.addIssue({ code: "custom", path: [path], message })
          if (needsClient) {
            if (!v.clientId) issue("clientId", "Pick the customer this invoice is for.")
            return
          }
          const period =
            isYearMonth(v.from) && isYearMonth(v.to)
              ? invoicePeriodError(v.from, v.to)
              : "Pick the months this invoice covers."
          if (period) issue("from", period)

          const number = v.number.trim()
          const taken = number ? invoiceNumberTaken(invoices, number, opened?.id) : undefined
          if (!number) issue("number", "Enter the number printed on the invoice.")
          else if (number.length > 50) issue("number", "Keep it under 50 characters.")
          else if (taken) {
            const owner = clients.find((c) => c.id === invoiceClientId(taken, engagements))?.name ?? "another customer"
            issue("number", `${number} is already recorded (${owner}, ${invoicePeriodLabel(taken)}).`)
          }

          const { amount, vat } = resolve(v)
          const net = money(amount)
          if (credit && (net === null || net <= 0)) issue("amount", "Enter the amount to credit, above 0.")
          else if (net === null) issue("amount", "Enter the net amount before VAT, e.g. 6500.")
          else if (net <= 0) {
            issue(
              "amount",
              "Enter an amount above 0. To cancel or reduce an invoice, open it and choose Issue Credit Note.",
            )
          }
          if (money(vat) === null) issue("vat", "Enter the VAT charged, or 0 if none.")
          if (v.paidDate > today) issue("paidDate", "The payment date can't be in the future.")
        }),
    [needsClient, invoices, opened, engagements, clients, resolve, credit, today],
  )

  const form = useForm<InvoiceSheetValues>({
    resolver: zodResolver(schema),
    defaultValues: initial.values,
    // The duplicate number shows as soon as he leaves the field.
    mode: "onTouched",
  })
  const values: InvoiceSheetValues = { ...initial.values, ...useWatch({ control: form.control }) }
  const dirty = form.formState.isDirty || fileDraft.picked !== null || fileDraft.removed
  const { suggestion, amount, vat, vatSuggested } = resolve(values)
  const net = money(amount)
  const vatValue = money(vat)
  const sign = (n: number) => (credit ? -Math.abs(n) : n)
  const fields: InvoiceFields | null =
    net !== null && vatValue !== null
      ? { ...values, amount: cents(sign(net)), vat: cents(sign(vatValue)) }
      : null

  // ponytail: 3× clientBilling per keystroke is fine for one owner's data; useDeferredValue if it lags.
  const draft = fields && clientId ? draftInvoice(fields, clientId) : null
  const current = opened ? billingOf(invoices) : base
  const after = draft ? billingOf([...baseInvoices, draft]) : null
  const alone = draft ? billingOf([draft]) : null
  const covered = periodMonths({ fromMonth: values.from, yearMonth: values.to })
  const currentMonth = today.slice(0, 7)
  const parts = amountParts(
    base.months.filter((m) => covered.includes(m.yearMonth)),
    suggestion.amount,
    currentMonth,
  )
  const own = engagements.filter((e) => e.clientId === clientId)
  const toInvoice = (b: ClientBilling | null) => Math.max(0, b?.toInvoice ?? 0)
  const unpaidNow = outstanding(customerInvoices)
  const unpaidAfter = draft
    ? outstanding([...customerInvoices.filter((i) => i.id !== opened?.id), draft])
    : unpaidNow

  // Part of a longer invoice would land on a month already invoiced: say so, never block.
  const landsOn =
    covered.length > 1
      ? base.months.find(
          (m) =>
            covered.includes(m.yearMonth) &&
            m.yearMonth < currentMonth &&
            m.logged !== null &&
            m.unbilled < m.logged,
        )
      : undefined
  // Its one-click fix: start after the newest month already invoiced, when one is left.
  const startFrom = landsOn && covered.find((ym) => ym > landsOn.yearMonth)

  const already = `${earlier.map((c) => c.number).join(", ")} already ${earlier.length === 1 ? "credits" : "credit"}`
  const creditHelp = !original
    ? "Before VAT, as a positive number."
    : earlier.length === 0
      ? `Before VAT, as a positive number: ${eurCents(creditLeft)} cancels all of ${original.number}.`
      : creditLeft > 0
        ? `Before VAT, as a positive number: ${eurCents(creditLeft)} cancels the rest of ${original.number} (${already} ${eurCents(creditedBefore)}).`
        : `Before VAT, as a positive number. ${already} all of ${original.number}.`

  const vatShare = suggestion.vatShare
  const vatBadge = vatShare > 0.999 ? `${IVA_RATE * 100}%` : vatShare < 0.001 ? "No VAT" : `${IVA_RATE * 100}% on part`
  const vatHelp = mirror
    ? original
      ? `Mirrors ${original.number}'s VAT.`
      : "Follows the amount at the rate it was recorded with."
    : vatShare > 0.999
      ? `${IVA_RATE * 100}%: this customer's contracts carry VAT.`
      : vatShare < 0.001
        ? "No VAT: this customer's contracts carry none (reverse charge, abroad or exempt)."
        : `${IVA_RATE * 100}% on the contracts that carry VAT only.`

  const year = today.slice(0, 4)
  const monthOptions = [
    ...new Set([
      ...monthsFrom(format(subMonths(parseYearMonth(currentMonth), 24), "yyyy-MM"), 28),
      // An old invoice's months, or a suggestion older than the window.
      ...periodMonths({ fromMonth: initial.values.from, yearMonth: initial.values.to }),
    ]),
  ]
    .sort()
    .reverse()

  const close = () => onStateChange(null)
  const pending = createInvoice.isPending || updateInvoice.isPending || saving

  const submit = form.handleSubmit(async (v) => {
    const { amount: a, vat: t } = resolve(v)
    const f: InvoiceFields = { ...v, amount: cents(sign(Number(a))), vat: cents(sign(Number(t))) }
    const number = f.number.trim()
    /** The record and its file, written in the order that never leaves a pointer to a missing object. */
    const save = async <T,>(write: (file: Invoice["file"]) => Promise<T>): Promise<{ value: T } | null> => {
      setSaving(true)
      try {
        return { value: await writeWithInvoiceFile({ userId: userId ?? "", stored: opened?.file, draft: fileDraft, write }) }
      } catch (err) {
        // A rejected write has its app-wide error toast; a failed upload is said here. The sheet stays to retry.
        if (err instanceof FileUploadError) toast({ variant: "destructive", title: `${Noun} not saved`, description: err.message })
        return null
      } finally {
        setSaving(false)
      }
    }
    if (opened) {
      const input = invoiceUpdate(opened, f)
      if (Object.keys(input).length === 0 && !fileDraft.picked && !fileDraft.removed) return close()
      const done = await save((file) => updateInvoice.mutateAsync({ id: opened.id, input: { ...input, ...(file !== undefined && { file }) } }))
      if (!done) return
      close()
      toast({ title: `${Noun} ${number} saved.` })
      return
    }
    if (!clientId) return
    const label = invoicePeriodLabel({ fromMonth: f.from < f.to ? f.from : null, yearMonth: f.to })
    const left = after ? rangeSuggestion(after, f.from, f.to).amount : 0
    const saved = await save((file) => createInvoice.mutateAsync({ clientId, ...invoiceInput(f), ...(file !== undefined && { file }) }))
    if (!saved) return
    const created = saved.value
    close()
    if (credit) return void toast({ title: `Credit note ${number} recorded.` })
    toast({
      title: `Invoice ${number} recorded. ${
        left > 0 ? `${eurCents(left)} of ${label} stays to invoice.` : `${label} is now invoiced.`
      }`,
      action: (
        <ToastAction altText="Undo" onClick={() => deleteInvoice.mutate(created.id)}>
          Undo
        </ToastAction>
      ),
    })
  })

  function remove() {
    if (!opened) return
    deleteInvoice.mutate(opened.id, {
      onSuccess: () => {
        setConfirmDelete(false)
        close()
        toast({ title: `${Noun} ${opened.number} deleted.` })
      },
    })
  }

  // Unsaved edits go only through Cancel or the close button, never a stray click beside the panel.
  const keepEdits = (e: Event) => {
    if (dirty) e.preventDefault()
  }

  const status = opened ? invoiceStatus(opened, new Date()) : null
  const title = opened
    ? `${credit ? "Credit Note" : "Invoice"} ${opened.number}`
    : original
      ? `Credit Note for ${original.number}`
      : "Record Invoice"
  const description = opened
    ? credit
      ? `Cancels all or part of an invoice. Until it is settled it lowers what ${name} owes.`
      : `${name} · ${invoicePeriodLabel(opened)} · recorded ${format(opened.createdAt, "d MMM yyyy")}`
    : original
      ? `Cancels all or part of an invoice. Until it is settled it lowers what ${name} owes.`
      : clientId
        ? `${name} · an invoice you already issued: check the figures and save.`
        : "An invoice you already issued: pick the customer, then check the figures and save."

  const customers = needsClient
    ? clients
        .map((c) => {
          const b = clientBilling({ clientId: c.id, engagements, timecards, invoices, today })
          return { client: c, toInvoice: toInvoice(b) }
        })
        .filter((r) => r.client.isActive || r.toInvoice > 0)
        .sort((a, b) => b.toInvoice - a.toInvoice || a.client.name.localeCompare(b.client.name))
    : []

  const pickMonth = (onChange: (v: string) => void, v: string) => {
    onChange(v)
    // The amount follows the months: an old "enter the amount" error no longer holds.
    form.clearErrors(["amount", "vat"])
    void form.trigger("from")
  }

  const monthSelect = (field: { value: string; onChange: (v: string) => void; ref: RefCallBack }, label: string) => {
    const trigger = (
      <SelectTrigger ref={field.ref} aria-label={label} className="w-36">
        <SelectValue />
      </SelectTrigger>
    )
    return (
      <Select value={field.value} onValueChange={(v) => pickMonth(field.onChange, v)}>
        {/* The visible label "Months covered" points at From; both keep their own name. */}
        {label === "From" ? <FormControl>{trigger}</FormControl> : trigger}
        <SelectContent>
          {monthOptions.map((m) => (
            <SelectItem key={m} value={m}>
              {formatYearMonth(m, "MMM yyyy")}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    )
  }

  return (
    <SheetContent
      side="right"
      className={CONTENT}
      onInteractOutside={keepEdits}
      onEscapeKeyDown={keepEdits}
      onCloseAutoFocus={restoreFocus}
    >
      <SheetHeader className={HEADER}>
        <div className="flex flex-wrap items-center gap-2">
          <SheetTitle>{title}</SheetTitle>
          {status && <StatusBadge status={status} />}
        </div>
        <SheetDescription>{description}</SheetDescription>
      </SheetHeader>

      <Form {...form}>
        {/* noValidate: every error is the form's own red line, never the browser's tooltip. */}
        <form noValidate className="flex min-h-0 flex-1 flex-col" onSubmit={submit}>
          <div className="flex flex-1 flex-col gap-7 overflow-y-auto px-6 py-5">
            {needsClient ? (
              <FormField
                control={form.control}
                name="clientId"
                render={({ field }) => (
                  <FormItem className={ROW}>
                    <FormLabel className={LABEL}>Customer</FormLabel>
                    <div className="min-w-0 space-y-1.5">
                      <Select
                        value={field.value}
                        // A customer picked re-opens the sheet on its suggestion.
                        onValueChange={(id) => onStateChange({ kind: "record", clientId: id })}
                      >
                        <FormControl>
                          <SelectTrigger ref={field.ref}>
                            <SelectValue placeholder="Pick a customer" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {customers.map(({ client, toInvoice: amount }) => (
                            <SelectItem key={client.id} value={client.id}>
                              {client.name}
                              {amount > 0 && ` · ${eurCents(amount)} to invoice`}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormDescription>Customers with hours to invoice come first.</FormDescription>
                      <FormMessage />
                    </div>
                  </FormItem>
                )}
              />
            ) : (
              <>
                <Group title={state.kind !== "record" ? "Customer and Period" : "Period"}>
                  {state.kind !== "record" && (
                    <div className={ROW}>
                      <p className="text-sm font-medium">Customer</p>
                      <div className="min-w-0 space-y-1.5">
                        <p className="text-sm">{name}</p>
                        <p className="text-[0.8rem] text-muted-foreground">
                          Fixed once issued: to change it, delete it and record it again.
                        </p>
                      </div>
                    </div>
                  )}

                  <FormField
                    control={form.control}
                    name="from"
                    render={({ field }) => (
                      <FormItem className={ROW}>
                        <FormLabel className={LABEL}>Months covered</FormLabel>
                        <div className="min-w-0 space-y-1.5">
                          <div className="flex flex-wrap items-center gap-2">
                            {monthSelect(field, "From")}
                            <span className="text-sm text-muted-foreground">to</span>
                            <FormField control={form.control} name="to" render={({ field: to }) => monthSelect(to, "To")} />
                          </div>
                          <FormDescription>The months you worked, not the invoice&apos;s date.</FormDescription>
                          <FormMessage />
                          {landsOn && (
                            <p className="text-[0.8rem] text-amber-600 dark:text-amber-400">
                              {formatYearMonth(landsOn.yearMonth, "MMM yyyy")} is already invoiced
                              {landsOn.invoices.length > 0 && ` (${landsOn.invoices.map((i) => i.number).join(", ")})`}
                              : part of this invoice would land on it. Record one invoice per run of open months
                              instead.
                              {startFrom && (
                                <>
                                  {" "}
                                  <Button
                                    type="button"
                                    variant="link"
                                    className="h-auto p-0 text-[0.8rem] underline"
                                    onClick={() => pickMonth(field.onChange, startFrom)}
                                  >
                                    Start from {formatYearMonth(startFrom, "MMM yyyy")}
                                  </Button>
                                </>
                              )}
                            </p>
                          )}
                        </div>
                      </FormItem>
                    )}
                  />

                  <div className="space-y-1.5">
                    {/* One line per figure on a phone: Hours value goes, and Month takes what the figures
                        leave (w-full max-w-0), so a long contract name truncates instead of widening it. */}
                    <Table className="whitespace-nowrap text-xs">
                      <TableHeader>
                        <TableRow>
                          <TableHead className="h-8 w-full max-w-0">Month</TableHead>
                          <TableHead className="h-8 text-right">Hours</TableHead>
                          <TableHead className="hidden h-8 text-right sm:table-cell">Hours value</TableHead>
                          <TableHead className="h-8 text-right">{credit ? "This credit note" : "This invoice"}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {covered.map((ym) => {
                          const m = base.months.find((b) => b.yearMonth === ym)
                          const share = alone?.months.find((b) => b.yearMonth === ym)?.invoiced
                          const hours = m?.hours ?? 0
                          return (
                            <TableRow key={ym}>
                              <TableCell className="max-w-0 py-1.5 align-top">
                                {formatYearMonth(ym, "MMM yyyy")}
                                {own.length > 1 &&
                                  m?.contracts.map((l) => {
                                    const e = own.find((c) => c.id === l.engagementId)
                                    const label = e ? engagementLabel(e) : "Contract"
                                    return (
                                      <span key={l.engagementId} className="flex gap-1 text-muted-foreground">
                                        <span className="truncate" title={label}>
                                          {label}
                                        </span>{" "}
                                        {l.hours} h · {eurCents(l.logged)}
                                      </span>
                                    )
                                  })}
                              </TableCell>
                              <TableCell className="py-1.5 text-right align-top tabular-nums">
                                {hours > 0 ? `${hours} h` : "No hours"}
                              </TableCell>
                              <TableCell className="hidden py-1.5 text-right align-top tabular-nums sm:table-cell">
                                {hours > 0 && m?.logged != null ? eurCents(m.logged) : "—"}
                              </TableCell>
                              <TableCell className="py-1.5 text-right align-top tabular-nums">
                                {share === undefined ? "—" : eurCents(share)}
                              </TableCell>
                            </TableRow>
                          )
                        })}
                      </TableBody>
                    </Table>
                    {covered.length > 1 && (
                      <p className="text-[0.8rem] text-muted-foreground">
                        Split by hours value. The figures settle once the last month has ended.
                      </p>
                    )}
                  </div>
                </Group>

                <Group title="Amounts">
                  <FormField
                    control={form.control}
                    name="number"
                    render={({ field }) => (
                      <FormItem className={ROW}>
                        <FormLabel className={LABEL}>{credit ? "Credit note number" : "Invoice number"}</FormLabel>
                        <div className="min-w-0 space-y-1.5">
                          <FormControl>
                            <Input
                              {...field}
                              placeholder={credit ? `e.g. NC 1/${year}` : `e.g. 1/${year}`}
                              // Typing replaces the suggested number.
                              autoFocus={state.kind === "record"}
                              onFocus={state.kind === "record" ? (e) => e.currentTarget.select() : undefined}
                            />
                          </FormControl>
                          <FormDescription>
                            {initial.after && initial.values.number
                              ? `Next after ${initial.after}. Check it matches your invoicing software.`
                              : !opened && initial.values.number
                                ? "Check it matches your invoicing software."
                                : `As printed on the ${noun}.`}
                          </FormDescription>
                          <FormMessage />
                        </div>
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="amount"
                    render={({ field }) => (
                      <FormItem className={ROW}>
                        <FormLabel className={LABEL}>{credit ? "Amount credited" : "Net amount"}</FormLabel>
                        <div className="min-w-0 space-y-1.5">
                          <FormControl>
                            <MoneyInput
                              ref={field.ref}
                              name={field.name}
                              value={amount}
                              placeholder="e.g. 6500"
                              onBlur={field.onBlur}
                              onChange={(e) => field.onChange(e.target.value)}
                            />
                          </FormControl>
                          <FormDescription>
                            {credit ? (
                              creditHelp
                            ) : (
                              <>
                                Before VAT.{" "}
                                {parts ?? (
                                  <>
                                    {opened ? "Not covered by your other invoices" : "Not yet invoiced"} in these months:{" "}
                                    {eurCents(suggestion.amount)}
                                    {/* Hours only when they are what the figure is worth: no month partly invoiced. */}
                                    {suggestion.amount === suggestion.logged && ` (${suggestion.hours} h)`}
                                  </>
                                )}
                                .
                                {values.amount !== null && suggestion.amount > 0 && net !== suggestion.amount && (
                                  <>
                                    {" "}
                                    <UseLink value={suggestion.amount} onClick={() => field.onChange(null)} />
                                  </>
                                )}
                              </>
                            )}
                          </FormDescription>
                          {!credit && net !== null && net > 0 && net !== suggestion.amount && (
                            <p className="text-[0.8rem] text-muted-foreground">
                              {net < suggestion.amount
                                ? `${eurCents(suggestion.amount - net)} less than the hours: ${eurCents(suggestion.amount - net)} stays to invoice.`
                                : `${eurCents(net - suggestion.amount)} more than the hours: counts as invoiced beyond the hours.`}
                            </p>
                          )}
                          {original && net !== null && net > creditLeft && (
                            <p className="text-[0.8rem] text-amber-600 dark:text-amber-400">
                              {earlier.length === 0
                                ? `More than ${original.number}'s net (${eurCents(creditLeft)}).`
                                : `More than what's left of ${original.number} (${eurCents(creditLeft)}).`}
                            </p>
                          )}
                          <FormMessage />
                        </div>
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="vat"
                    render={({ field }) => (
                      <FormItem className={ROW}>
                        {/* self-start: a stretched grid cell would centre the label on the help text. */}
                        <div className={cn("flex items-center gap-2 self-start", LABEL)}>
                          <FormLabel>VAT</FormLabel>
                          {!credit && <Badge variant="outline">{vatBadge}</Badge>}
                        </div>
                        <div className="min-w-0 space-y-1.5">
                          <FormControl>
                            <MoneyInput
                              ref={field.ref}
                              name={field.name}
                              value={vat}
                              onBlur={field.onBlur}
                              onChange={(e) => field.onChange(e.target.value)}
                            />
                          </FormControl>
                          <FormDescription>
                            {vatHelp}
                            {values.vat !== null && vatValue !== vatSuggested && (
                              <>
                                {" "}
                                {form.formState.dirtyFields.vat && "You changed it · "}
                                <UseLink value={vatSuggested} onClick={() => field.onChange(null)} />
                              </>
                            )}
                          </FormDescription>
                          <FormMessage />
                        </div>
                      </FormItem>
                    )}
                  />

                  <div className={ROW}>
                    <p className="text-sm font-medium">{credit ? "Back to the customer" : "Total (incl. VAT)"}</p>
                    <div className="min-w-0 space-y-1.5">
                      {/* Under the amounts it adds up; signed as the invoice list shows it. */}
                      <p className="pr-3 text-right font-semibold tabular-nums">
                        {net !== null && vatValue !== null ? eurCents(cents(sign(net + vatValue))) : "—"}
                      </p>
                      <p className="text-[0.8rem] text-muted-foreground">
                        {credit
                          ? "Incl. VAT: what you give back or deduct."
                          : "What the customer pays. Unpaid counts this."}
                      </p>
                    </div>
                  </div>
                </Group>

                {(!credit || opened) && (
                  <Group title={credit ? "Settlement" : "Payment"}>
                    {!credit && (
                      <FormField
                        control={form.control}
                        name="dueDate"
                        render={({ field }) => (
                          <FormItem className={ROW}>
                            <FormLabel className={LABEL}>Due date</FormLabel>
                            <div className="min-w-0 space-y-1.5">
                              <FormControl>
                                <Input type="date" className="w-44" {...field} />
                              </FormControl>
                              <FormDescription>
                                {initial.due
                                  ? `${initial.due.basis} Empty: never overdue.`
                                  : opened
                                    ? "Leave it empty and it never shows as overdue."
                                    : "Leave it empty if you don't track when it's due."}
                              </FormDescription>
                              <FormMessage />
                            </div>
                          </FormItem>
                        )}
                      />
                    )}

                    {opened && (
                      <FormField
                        control={form.control}
                        name="paidDate"
                        render={({ field }) => (
                          <FormItem className={ROW}>
                            <FormLabel className={LABEL}>{credit ? "Settled on" : "Paid on"}</FormLabel>
                            <div className="min-w-0 space-y-1.5">
                              <div className="flex flex-wrap items-center gap-2">
                                <FormControl>
                                  <Input type="date" max={today} className="w-44" {...field} />
                                </FormControl>
                                <Button type="button" variant="outline" size="sm" onClick={() => field.onChange(today)}>
                                  Today
                                </Button>
                                <Button type="button" variant="ghost" size="sm" onClick={() => field.onChange("")}>
                                  Clear
                                </Button>
                              </div>
                              <FormDescription>
                                {credit ? "When refunded or deducted. Until then it lowers what is owed." : "Empty = not paid yet."}
                              </FormDescription>
                              <FormMessage />
                            </div>
                          </FormItem>
                        )}
                      />
                    )}

                    {opened && accounts.length > 0 && (
                      <FormField
                        control={form.control}
                        name="paidAccountId"
                        render={({ field }) => (
                          <FormItem className={ROW}>
                            <FormLabel className={LABEL}>{credit ? "Refunded from" : "Into account"}</FormLabel>
                            <div className="min-w-0 space-y-1.5">
                              <Select value={field.value || NOT_RECORDED} onValueChange={(v) => field.onChange(v === NOT_RECORDED ? "" : v)}>
                                <FormControl>
                                  <SelectTrigger className="w-full sm:w-64">
                                    <SelectValue />
                                  </SelectTrigger>
                                </FormControl>
                                <SelectContent>
                                  {accounts.map((a) => (
                                    <SelectItem key={a.id} value={a.id}>
                                      {a.name}
                                    </SelectItem>
                                  ))}
                                  <SelectItem value={NON_CASH}>Offset, No Bank Payment</SelectItem>
                                  <SelectItem value={NOT_RECORDED}>Not Recorded</SelectItem>
                                </SelectContent>
                              </Select>
                              <FormDescription>Where the Cash Book shows it. Offset: no money moved.</FormDescription>
                              <FormMessage />
                            </div>
                          </FormItem>
                        )}
                      />
                    )}
                  </Group>
                )}

                <Group title="Invoice File">
                  <InvoiceFileSlot stored={opened?.file} draft={fileDraft} onDraftChange={setFileDraft} noun="invoice" viewHref={opened ? `/invoices/${opened.id}/file` : undefined} unsaved={dirty} disabled={pending} />
                </Group>

                <div className={cn(ROW, "rounded-lg bg-surface-subtle px-3 py-2.5")}>
                  <p className="text-sm font-medium">After saving</p>
                  <p aria-live="polite" className="text-sm tabular-nums text-muted-foreground">
                    {toInvoice(current) === toInvoice(after ?? current) && unpaidNow === unpaidAfter ? (
                      "No change to To invoice or Unpaid."
                    ) : (
                      <>
                        {current.toInvoice !== null &&
                          `To invoice ${eurCents(toInvoice(current))} → ${eurCents(toInvoice(after ?? current))} net · `}
                        Unpaid {eurCents(unpaidNow)} → {eurCents(unpaidAfter)} incl. VAT
                      </>
                    )}
                  </p>
                </div>
              </>
            )}
          </div>

          <SheetFooter className="shrink-0 flex-row flex-wrap items-center gap-2 border-t border-hairline px-6 py-4 sm:justify-between sm:space-x-0">
            {/* Delete and Issue Credit Note, out of the way of Save: Delete is the menu's only red item. */}
            {opened && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button type="button" variant="ghost" size="icon-lg" aria-label="More actions">
                    <MoreHorizontal aria-hidden />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" side="top">
                  {!credit && (
                    <DropdownMenuItem onSelect={() => onStateChange({ kind: "credit", invoiceId: opened.id })}>
                      Issue Credit Note
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem variant="destructive" onSelect={() => setConfirmDelete(true)}>
                    Delete {credit ? "Credit Note" : "Invoice"}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            <div className="ml-auto flex flex-wrap justify-end gap-2">
              <Button type="button" variant="outline" onClick={close}>
                Cancel
              </Button>
              {/* Never silently disabled: a click shows every error and focuses the first. */}
              <Button type="submit" disabled={pending}>
                {pending
                  ? opened
                    ? "Saving…"
                    : "Recording…"
                  : opened
                    ? "Save Changes"
                    : credit
                      ? "Record Credit Note"
                      : "Record Invoice"}
              </Button>
            </div>
          </SheetFooter>
        </form>
      </Form>

      {opened && (
        <ConfirmDeleteDialog
          open={confirmDelete}
          onOpenChange={setConfirmDelete}
          title={`Delete ${credit ? "Credit Note" : "Invoice"} ${opened.number}?`}
          description={`This removes the app's copy only; the ${noun} in your invoicing software is untouched.${
            current.toInvoice !== null
              ? ` To invoice for ${name} goes from ${eurCents(toInvoice(current))} to ${eurCents(toInvoice(base))}.`
              : ""
          }`}
          confirmLabel={`Delete ${credit ? "Credit Note" : "Invoice"}`}
          isPending={deleteInvoice.isPending}
          onConfirm={remove}
        />
      )}
    </SheetContent>
  )
}
