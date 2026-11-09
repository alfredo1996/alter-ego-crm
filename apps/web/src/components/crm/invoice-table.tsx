"use client"

import { isoDate } from "@alter-ego/kernel/dates"
import { DataTableCard } from "@alter-ego/ui/page/data-table-card"
import { StatusPill, type Tone } from "@alter-ego/ui/page/status-pill"
import { Button } from "@alter-ego/ui/ui/button"
import { Checkbox } from "@alter-ego/ui/ui/checkbox"
import { Dialog, DialogContent, DialogTitle } from "@alter-ego/ui/ui/dialog"
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
import { Popover, PopoverContent, PopoverTrigger } from "@alter-ego/ui/ui/popover"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@alter-ego/ui/ui/select"
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@alter-ego/ui/ui/table"
import { ToastAction } from "@alter-ego/ui/ui/toast"
import { toast } from "@alter-ego/ui/use-toast"
import { cn } from "@alter-ego/ui/utils"
import { zodResolver } from "@hookform/resolvers/zod"
import { format } from "date-fns"
import { useEffect, useId, useRef, useState, type ReactNode } from "react"
import { useForm, useWatch } from "react-hook-form"

import { defaultAccountId, rememberAccount } from "@/components/cash-book/last-account"
import { useCompanyAccounts } from "@/hooks/use-company-accounts"
import { useCreateCompanyExpense, useDeleteCompanyExpense } from "@/hooks/use-company-expenses"
import { useUpdateInvoice } from "@/hooks/use-invoices"
import { MAX_BANK_FEE, NON_CASH, round2 } from "@/lib/cash-book"
import {
  eurCents,
  invoiceClientId,
  invoicePeriodLabel,
  invoiceStatus,
  invoiceTotal,
  openCredits,
  outstanding,
} from "@/lib/invoices"
import { z } from "@/lib/zod"

import type { InvoiceStatus } from "@/lib/invoices"
import type { Client, CompanyAccount, Engagement, Invoice } from "@/types"

/** invoiceStatus's tone as a pill's: owed amber, overdue red, paid green, a credit note grey. */
const STATUS_TONE: Record<InvoiceStatus["tone"], Tone> = {
  unpaid: "warning",
  due: "warning",
  overdue: "danger",
  paid: "success",
  credit: "neutral",
}

/**
 * invoiceStatus as a soft pill in its tone, always with its words. The table and the sheet header.
 * Squeezed, it breaks after its "·" only: "Overdue ·" over "due 31 Aug".
 */
export function StatusBadge({ status, className }: { status: InvoiceStatus; className?: string }) {
  return (
    <StatusPill tone={STATUS_TONE[status.tone]} className={className}>
      {status.label.replaceAll(" ", "\u00a0").replaceAll("·\u00a0", "· ")}
    </StatusPill>
  )
}

const MONEY = "text-right tabular-nums whitespace-nowrap"
/** A row header cell: TableCell's padding, the number's weight left alone. A phone's row pads itself. */
const ROW_HEADER = "text-left align-middle font-normal max-sm:block sm:h-12 sm:px-4"

const sum = (values: number[]) => round2(values.reduce((total, v) => total + v, 0))
const count = (n: number) => `${n} ${n === 1 ? "invoice" : "invoices"}`

/**
 * Every invoice in one card, newest work month first: marking one paid changes
 * its pill, never its place. A click on the row (or its number, for the
 * keyboard) opens it in the sheet; Mark Paid and Settle open their popup. On a
 * phone the table becomes a list, as Invoices-phone.dc draws it: each row two
 * lines, number and total over customer and status (the columns' figures
 * repeated there, CSS shows one of each), then Mark Paid across. The footer
 * totals the rows shown.
 */
export function InvoiceTable({
  userId,
  invoices,
  engagements,
  customers,
  firstMonth,
  onOpen,
  tab,
  match,
  empty,
}: {
  userId: string | undefined
  /** The ones to list; their customers' open credit notes among them. */
  invoices: Invoice[]
  engagements: Pick<Engagement, "id" | "clientId">[]
  /** Given on /invoices: adds the Customer column. */
  customers?: Pick<Client, "id" | "name">[]
  /** Paid invoices of earlier months fold behind "Show N older invoices", like the chart. */
  firstMonth: string
  onOpen: (invoiceId: string) => void
  /**
   * A status tab: the rows it held when the table mounted stay, so one marked paid under Unpaid keeps
   * its place until the tab changes. Key the table by tab. `invoices` still feeds Mark Paid's credit notes.
   */
  tab?: (invoice: Invoice) => boolean
  /** A search or a filter: applied as it changes. */
  match?: (invoice: Invoice) => boolean
  /** Shown instead of the card when no row is left. */
  empty?: ReactNode
}) {
  const [showOlder, setShowOlder] = useState(false)
  // Fixed when the list opens, so a row never folds away under the click that paid it.
  const [folded] = useState(
    () => new Set(invoices.filter((i) => i.paidDate && i.yearMonth < firstMonth).map((i) => i.id)),
  )
  const [kept] = useState(() => new Set(invoices.filter((i) => tab?.(i) ?? true).map((i) => i.id)))
  const today = new Date()

  const matching = [...invoices]
    .filter((i) => ((tab?.(i) ?? true) || kept.has(i.id)) && (match?.(i) ?? true))
    .sort((a, b) => b.yearMonth.localeCompare(a.yearMonth) || b.createdAt.getTime() - a.createdAt.getTime())
  const recent = matching.filter((i) => !folded.has(i.id))
  // Nothing recent: the older ones, rather than a card holding only its "Show older".
  const rows = showOlder || recent.length === 0 ? matching : recent
  const older = matching.length - rows.length
  if (rows.length === 0) return empty ?? null

  const customerName = (i: Invoice) =>
    customers?.find((c) => c.id === invoiceClientId(i, engagements))?.name ?? "Unknown customer"
  // Unpaid as the Unpaid figure counts it: per customer, a credit note netting within its own.
  // ponytail: no Map.groupBy, an older Safari lacks it.
  const byCustomer = new Map<string | null, Invoice[]>()
  for (const i of rows) byCustomer.set(invoiceClientId(i, engagements), [...(byCustomer.get(invoiceClientId(i, engagements)) ?? []), i])
  const unpaid = sum([...byCustomer.values()].map(outstanding))
  const total = sum(rows.map(invoiceTotal))

  return (
    <DataTableCard>
      {/* Blocks on a phone: rows that stack their cells, the header row gone. */}
      <Table className="max-sm:block">
        <caption className="sr-only">Invoices, newest month first</caption>
        <TableHeader className="max-sm:hidden">
          <TableRow className="hover:bg-transparent">
            <TableHead>Number</TableHead>
            {customers && <TableHead className="hidden sm:table-cell">Customer</TableHead>}
            <TableHead className="hidden sm:table-cell">Period</TableHead>
            <TableHead className="hidden text-right lg:table-cell">Net</TableHead>
            <TableHead className="hidden text-right lg:table-cell">VAT</TableHead>
            <TableHead className="hidden text-right sm:table-cell">Total</TableHead>
            <TableHead className="hidden sm:table-cell">Status</TableHead>
            {/* A fixed column, so the Mark Paid buttons line up. */}
            <TableHead className="w-0">
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody className="max-sm:block">
          {rows.map((invoice) => {
            const status = invoiceStatus(invoice, today)
            const period = invoicePeriodLabel(invoice)
            const credit = invoice.amount < 0
            return (
              <TableRow
                key={invoice.id}
                className="cursor-pointer max-sm:flex max-sm:flex-col max-sm:gap-2.5 max-sm:px-4 max-sm:py-3"
                onClick={() => onOpen(invoice.id)}
              >
                <th scope="row" className={cn(ROW_HEADER, "sm:p-2")}>
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="flex min-w-0 items-baseline whitespace-nowrap">
                      {/* No handler of its own: Enter on it clicks, and the click reaches the row. */}
                      <button
                        type="button"
                        aria-haspopup="dialog"
                        className="font-mono text-[13.5px] underline decoration-border-strong underline-offset-4 hover:decoration-foreground max-sm:text-sm max-sm:font-medium max-sm:no-underline pointer-coarse:-my-3 pointer-coarse:py-3"
                      >
                        {invoice.number}
                      </button>
                      <span className="truncate text-meta text-muted-foreground sm:hidden">&nbsp;· {period}</span>
                    </span>
                    <span className="text-[15px] font-semibold whitespace-nowrap tabular-nums sm:hidden">{eurCents(invoiceTotal(invoice))}</span>
                  </div>
                  {/* A phone's second line: whose, and where it stands. */}
                  <div className="mt-1.5 flex items-center justify-between gap-3 sm:hidden">
                    {customers && <span className="min-w-0 truncate text-[13.5px] text-subtle-foreground">{customerName(invoice)}</span>}
                    <StatusBadge status={status} className="shrink-0 whitespace-nowrap" />
                  </div>
                </th>
                {customers && <TableCell className="hidden sm:table-cell">{customerName(invoice)}</TableCell>}
                <TableCell className="hidden whitespace-nowrap sm:table-cell">{period}</TableCell>
                <TableCell className={cn("hidden lg:table-cell", MONEY)}>{eurCents(invoice.amount)}</TableCell>
                <TableCell className={cn("hidden lg:table-cell", MONEY)}>{eurCents(invoice.vat)}</TableCell>
                <TableCell className={cn("hidden sm:table-cell", MONEY)}>{eurCents(invoiceTotal(invoice))}</TableCell>
                <TableCell className="hidden sm:table-cell">
                  <StatusBadge status={status} />
                </TableCell>
                {/* Across the row on a phone; nothing to show for a paid one. */}
                <TableCell className="text-right max-sm:block max-sm:p-0 max-sm:empty:hidden">
                  {!invoice.paidDate && (
                    <MarkPaid userId={userId} invoice={invoice} invoices={invoices} engagements={engagements}>
                      <Button type="button" variant="outline" size="sm" className="max-sm:h-11 max-sm:w-full max-sm:text-sm">
                        {credit ? "Settle" : "Mark Paid"}
                      </Button>
                    </MarkPaid>
                  )}
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
        <TableFooter className="border-hairline bg-surface-subtle font-normal text-subtle-foreground max-sm:block">
          {/* A phone's one line across the card, then a desktop's under each column. */}
          <TableRow className="hover:bg-transparent max-sm:block sm:hidden">
            <th scope="row" colSpan={2} className={cn(ROW_HEADER, "px-4 py-3")}>
              <span className="flex flex-wrap justify-between gap-x-3 text-meta">
                <span>
                  {count(rows.length)} · <span className="font-medium text-foreground">{eurCents(unpaid)}</span> unpaid
                </span>
                <span>
                  <span className="text-foreground">{eurCents(total)}</span> incl. VAT
                </span>
              </span>
            </th>
          </TableRow>
          <TableRow className="hidden hover:bg-transparent sm:table-row">
            <th scope="row" className={cn(ROW_HEADER, "p-2 font-medium text-foreground")}>
              {count(rows.length)}
            </th>
            {customers && <TableCell className="hidden sm:table-cell" />}
            <TableCell className="hidden sm:table-cell" />
            <TableCell className={cn("hidden lg:table-cell", MONEY)}>{eurCents(sum(rows.map((i) => i.amount)))}</TableCell>
            <TableCell className={cn("hidden lg:table-cell", MONEY)}>{eurCents(sum(rows.map((i) => i.vat)))}</TableCell>
            <TableCell className={cn("hidden font-medium text-foreground sm:table-cell", MONEY)}>{eurCents(total)}</TableCell>
            <TableCell colSpan={2} className="hidden whitespace-nowrap sm:table-cell">
              <span className="font-medium text-foreground">{eurCents(unpaid)}</span> unpaid
            </TableCell>
          </TableRow>
        </TableFooter>
      </Table>
      {older > 0 && (
        <div className="border-t border-hairline px-[18px] sm:px-[22px]">
          <button
            type="button"
            className="min-h-11 text-meta text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            onClick={() => setShowOlder(true)}
          >
            Show {older} older {older === 1 ? "invoice" : "invoices"}
          </button>
        </div>
      )}
    </DataTableCard>
  )
}

/**
 * The popup that marks an invoice paid, or settles a credit note, on a chosen
 * day (today unless defaultPaidDate says otherwise), into an account (the last
 * one used unless defaultAccount says otherwise). An open credit note on
 * the same months is offered ticked, since it is usually deducted from this
 * payment, with the amount to expect in the bank. Once the company has a cash
 * book account, it also asks where the money arrived and how much: a small
 * shortfall becomes a bank fee. The toast's Undo clears every date it set and
 * the fee it booked. On a phone it opens as a dialog instead: squeezed beside a
 * table row, the popup hid its fields in an inner scroll.
 */
export function MarkPaid({
  userId,
  invoice,
  invoices,
  engagements,
  defaultPaidDate,
  defaultAccount,
  children,
}: {
  userId: string | undefined
  invoice: Invoice
  /** Where its customer's open credit notes are found. */
  invoices: Invoice[]
  engagements: Pick<Engagement, "id" | "clientId">[]
  /** "yyyy-MM-dd" the day field opens on; today when not given. Month End's bank check gives its own day. */
  defaultPaidDate?: string
  /** The account id Into Account opens on; the last one used when not given. Month End's bank check gives its own account. */
  defaultAccount?: string
  /** The trigger: a button. */
  children: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const [phone, setPhone] = useState(false)
  const titleId = useId()
  const wrapper = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLElement | null>(null)
  const paid = useRef(false)
  // Read with the list, so the popup opens with its accounts already there.
  const { data: accounts } = useCompanyAccounts(userId)
  useEffect(() => {
    // Paid, the trigger goes once the list refetches, taking focus with it: the
    // row stays where it was, so its number takes it.
    // ponytail: table rows only; Deadlines moves a paid row to Done, so focus is lost there as before.
    const row = wrapper.current?.closest("tr")
    return () => {
      if (paid.current && document.activeElement === document.body) row?.querySelector("button")?.focus()
    }
  }, [])
  // Unmounted when closed, so each opening starts from today with the credit notes ticked.
  const form = (
    <MarkPaidForm
      userId={userId}
      invoice={invoice}
      credits={openCredits(invoice, invoices, engagements)}
      accounts={accounts}
      titleId={titleId}
      defaultPaidDate={defaultPaidDate}
      defaultAccount={defaultAccount}
      onDone={() => {
        paid.current = true
        setOpen(false)
      }}
    />
  )
  return (
    // The popup renders in a portal, yet its clicks still bubble through React: keep them off the row.
    <div ref={wrapper} onClick={(e) => e.stopPropagation()}>
      <Popover open={open && !phone} onOpenChange={setOpen}>
        <PopoverTrigger
          asChild
          onClick={(ev) => {
            trigger.current = ev.currentTarget
            const small = window.matchMedia("(max-width: 639px)").matches
            setPhone(small)
            // On a phone the dialog opens instead: the popover's own toggle is skipped.
            if (small) {
              ev.preventDefault()
              setOpen(true)
            }
          }}
        >
          {children}
        </PopoverTrigger>
        {/* A phone keeps a gutter: the popup never touches the screen edge. */}
        {/* As tall as the screen allows: the fields scroll inside it, the button and the fee line stay in sight. */}
        <PopoverContent
          align="end"
          collisionPadding={16}
          className="flex max-h-[var(--radix-popover-content-available-height)] w-80 flex-col sm:w-96"
          aria-labelledby={titleId}
        >
          {form}
        </PopoverContent>
      </Popover>
      <Dialog open={open && phone} onOpenChange={setOpen}>
        {/* flex-col: the fields scroll, Mark Paid and the fee line stay at the bottom. */}
        <DialogContent
          size="sm"
          className="flex flex-col"
          aria-describedby={undefined}
          onCloseAutoFocus={(ev) => {
            // No DialogTrigger: focus goes back to the button by hand.
            ev.preventDefault()
            if (trigger.current?.isConnected) trigger.current.focus()
          }}
        >
          {/* The form's own heading is the visible one; Radix wants a DialogTitle. */}
          <DialogTitle className="sr-only">{invoice.amount < 0 ? `Settle ${invoice.number}` : `Mark ${invoice.number} Paid`}</DialogTitle>
          {form}
        </DialogContent>
      </Dialog>
    </div>
  )
}

/** received null = following the expected amount until typed over. */
type MarkPaidValues = { paidDate: string; settle: string[]; accountId: string; received: string | null }

/** The form inside Mark Paid; Add Movement › Client Invoice Payment renders it too. */
export function MarkPaidForm({
  userId,
  invoice,
  credits,
  accounts,
  titleId,
  defaultPaidDate,
  defaultAccount,
  onDone,
}: {
  userId: string | undefined
  invoice: Invoice
  credits: Invoice[]
  /**
   * The company's cash book accounts. None, or still loading (they load with
   * the list, before any click), means no account asked: paid with the day alone.
   */
  accounts: CompanyAccount[] | undefined
  /** The heading's id: the popup's accessible name. */
  titleId: string
  /** "yyyy-MM-dd"; today when not given. */
  defaultPaidDate?: string
  /** An account id; the last one used when not given. */
  defaultAccount?: string
  onDone: () => void
}) {
  const updateInvoice = useUpdateInvoice(userId)
  const createExpense = useCreateCompanyExpense(userId)
  const deleteExpense = useDeleteCompanyExpense(userId)
  const [today] = useState(() => isoDate(new Date()))
  const credit = invoice.amount < 0
  const asks = (accounts?.length ?? 0) > 0
  const expectedOf = (ids: string[]) =>
    round2(invoiceTotal(invoice) + credits.reduce((s, c) => (ids.includes(c.id) ? s + invoiceTotal(c) : s), 0))
  const form = useForm<MarkPaidValues>({
    resolver: zodResolver(
      z
        .object({
          paidDate: z
            .string()
            .min(1, credit ? "Enter the day it was settled." : "Enter the day the money arrived.")
            .refine((v) => v <= today, "The payment date can't be in the future."),
          settle: z.array(z.string()),
          accountId: z.string(),
          received: z.string().nullable(),
        })
        .superRefine((v, ctx) => {
          const expected = expectedOf(v.settle)
          if (!asks || (!credit && expected <= 0)) return
          if (!v.accountId) {
            ctx.addIssue({
              code: "custom",
              path: ["accountId"],
              message: credit ? "Pick the account it was refunded from, or Offset." : "Pick the account the money arrived on.",
            })
            return
          }
          if (credit || v.accountId === NON_CASH) return
          const received = v.received === null ? expected : Number(v.received)
          const short = round2(expected - received)
          const message =
            v.received !== null && (v.received.trim() === "" || !Number.isFinite(received))
              ? "Enter the amount that arrived in the bank."
              : short > MAX_BANK_FEE
                ? "Partial payments aren't supported: record the payment when it is complete, or fix the invoice."
                : short < 0
                  ? `That is more than expected: mark it paid at ${eurCents(expected)} and add the extra in the Cash Book as a Client Payment Without Invoice.`
                  : null
          if (message) ctx.addIssue({ code: "custom", path: ["received"], message })
        }),
    ),
    defaultValues: {
      paidDate: defaultPaidDate ?? today,
      settle: credits.map((c) => c.id),
      accountId: defaultAccount ?? defaultAccountId(accounts ?? []),
      received: null,
    },
  })
  const settle = useWatch({ control: form.control, name: "settle" })
  const accountId = useWatch({ control: form.control, name: "accountId" })
  const receivedText = useWatch({ control: form.control, name: "received" })
  const expected = expectedOf(settle)
  // Credit notes covering the invoice close it with no money: an offset, never a balance.
  const offset = !credit && expected <= 0
  const cash = asks && !offset && accountId !== "" && accountId !== NON_CASH
  const received = receivedText === null ? expected : Number(receivedText)
  const fee = cash && !credit ? round2(expected - received) : 0
  const bookFee = fee > 0 && fee <= MAX_BANK_FEE
  const fields = useRef<HTMLDivElement>(null)
  // The fee line grows the footer and shrinks the fields above it: the amount just typed stays in sight.
  useEffect(() => {
    // `?.()`: jsdom has no scrollIntoView.
    fields.current?.querySelector<HTMLElement>(":focus")?.scrollIntoView?.({ block: "nearest" })
  }, [bookFee])

  const submit = form.handleSubmit(async ({ paidDate, settle: ids, accountId: picked }) => {
    const paid = new Date(`${paidDate}T00:00:00`)
    const marked = [invoice, ...credits.filter((c) => ids.includes(c.id))]
    const into = !asks ? undefined : offset ? NON_CASH : picked
    const input = into === undefined ? { paidDate: paid } : { paidDate: paid, paidAccountId: into }
    let feeId: string | null = null
    try {
      await Promise.all(marked.map((i) => updateInvoice.mutateAsync({ id: i.id, input })))
      // ponytail: two writes, not a batch; a failed fee shows as "Missing OUT" in Check Balance.
      if (bookFee && into) {
        const created = await createExpense.mutateAsync({
          description: `Bank fee on invoice ${invoice.number}`,
          category: "bank_fees",
          amount: fee,
          date: paid,
          accountId: into,
        })
        feeId = created.id
      }
    } catch {
      // The MutationCache's onError has already said why; the popup stays open to retry.
      return
    }
    if (into && into !== NON_CASH) rememberAccount(into)
    onDone()
    const on = format(paid, "d MMM")
    const settled = marked.slice(1).map((c) => c.number)
    const where =
      into === undefined ? "" : into === NON_CASH ? " as an offset, no money moved" : ` into ${accounts?.find((a) => a.id === into)?.name}`
    toast({
      title: credit
        ? `Credit note ${invoice.number} settled on ${on}${where}.`
        : `Invoice ${invoice.number} marked paid on ${on}${where}.${settled.length ? ` ${settled.join(", ")} settled too.` : ""}${
            feeId ? ` ${eurCents(fee)} booked as a bank fee.` : ""
          }`,
      action: (
        <ToastAction
          altText="Undo"
          onClick={() => {
            const undo = into === undefined ? { paidDate: null } : { paidDate: null, paidAccountId: null }
            marked.forEach((i) => updateInvoice.mutate({ id: i.id, input: undo }))
            if (feeId) deleteExpense.mutate(feeId)
          }}
        >
          Undo
        </ToastAction>
      ),
    })
  })

  return (
    <Form {...form}>
      <form noValidate className="flex min-h-0 flex-1 flex-col gap-3" onSubmit={submit}>
        {/* The fields scroll in a short popup; the outcome and the button below never do. */}
        <div ref={fields} className="-mx-1 min-h-0 flex-1 space-y-4 overflow-y-auto px-1 pb-1">
          <div className="space-y-1">
            <h4 id={titleId} className="font-medium leading-none">{credit ? `Settle ${invoice.number}` : `Mark ${invoice.number} Paid`}</h4>
            <p className="text-sm text-muted-foreground">
              {credit
                ? "When it was refunded, or deducted from a payment."
                : `${eurCents(invoiceTotal(invoice))} incl. VAT.`}
            </p>
          </div>
          <FormField
            control={form.control}
            name="paidDate"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{credit ? "Settled on" : "Paid on"}</FormLabel>
                <FormControl>
                  <Input type="date" max={today} {...field} />
                </FormControl>
                <FormDescription>
                  {defaultPaidDate && defaultPaidDate !== today
                    ? "Change it if the money moved on another day."
                    : credit
                      ? "Today, unless it was settled earlier."
                      : "Today, unless the money arrived earlier."}
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
          {credits.map((c) => (
            <FormField
              key={c.id}
              control={form.control}
              name="settle"
              render={({ field }) => (
                <FormItem className="flex flex-row items-start gap-2 space-y-0">
                  <FormControl>
                    <Checkbox
                      checked={field.value.includes(c.id)}
                      onCheckedChange={(on) =>
                        field.onChange(on === true ? [...field.value, c.id] : field.value.filter((id) => id !== c.id))
                      }
                    />
                  </FormControl>
                  <div className="space-y-1">
                    <FormLabel>Also settle {c.number}</FormLabel>
                    <FormDescription>
                      {eurCents(invoiceTotal(c))}, usually deducted from this payment. Untick it if it is refunded
                      separately.
                    </FormDescription>
                  </div>
                </FormItem>
              )}
            />
          ))}
          {!credit && !offset && (
            <p className="text-sm">
              Expected in the bank: <span className="font-medium tabular-nums">{eurCents(expected)}</span> incl. VAT
            </p>
          )}
          {asks && offset && (
            <p className="text-sm text-muted-foreground">
              {expected < 0
                ? `The ticked credit notes are ${eurCents(-expected)} more than this invoice: that much is still owed back to the customer. It closes as an offset, no money moves.`
                : "The ticked credit notes cover this invoice: it closes as an offset, no money moves."}
            </p>
          )}
          {asks && !offset && (
            <FormField
              control={form.control}
              name="accountId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{credit ? "Refunded From" : "Into Account"}</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger ref={field.ref}>
                        <SelectValue placeholder="Pick an account" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {accounts?.map((a) => (
                        <SelectItem key={a.id} value={a.id}>
                          {a.name}
                        </SelectItem>
                      ))}
                      <SelectItem value={NON_CASH}>Offset, No Bank Payment</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormDescription>
                    {credit
                      ? "Where the refund left from. Offset: deducted from a payment, no money moved."
                      : "Where the money arrived. Offset: closed against a credit note, no money moved."}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          )}
          {cash && !credit && (
            <FormField
              control={form.control}
              name="received"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Amount Received</FormLabel>
                  <FormControl>
                    <Input
                      ref={field.ref}
                      name={field.name}
                      onBlur={field.onBlur}
                      type="number"
                      step="0.01"
                      inputMode="decimal"
                      className="text-right tabular-nums"
                      value={field.value ?? String(expected)}
                      onChange={(e) => field.onChange(e.target.value)}
                    />
                  </FormControl>
                  <FormDescription>What the bank shows. Up to €50 short is booked as a bank fee.</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          )}
        </div>
        <div className="flex items-end justify-between gap-3 border-t pt-3">
          {/* Next to the button it confirms; mounted empty so the first figure is announced. */}
          <p aria-live="polite" className="min-w-0 text-sm">
            {bookFee ? `${eurCents(fee)} short: booked as a bank fee, a cost on the same day and account.` : ""}
          </p>
          <Button type="submit" size="sm" className="shrink-0" disabled={updateInvoice.isPending || createExpense.isPending}>
            {credit ? "Settle" : "Mark Paid"}
          </Button>
        </div>
      </form>
    </Form>
  )
}
