"use client"

import { formatYearMonth, isoDate } from "@alter-ego/kernel/dates"
import { Button } from "@alter-ego/ui/ui/button"
import { Checkbox } from "@alter-ego/ui/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@alter-ego/ui/ui/dialog"
import { Input } from "@alter-ego/ui/ui/input"
import { Label } from "@alter-ego/ui/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@alter-ego/ui/ui/select"
import { cn } from "@alter-ego/ui/utils"
import { useQueryClient } from "@tanstack/react-query"
import { AlertTriangle, CheckCircle2, Plus, Trash2 } from "lucide-react"
import { useEffect, useMemo, useState } from "react"

import { ConfirmDeleteDialog } from "@/components/confirm-delete-dialog"
import { MoneyInput } from "@/components/money-input"
import { getBackend } from "@/lib/backend"
import { NON_CASH, dayLabel, round2 } from "@/lib/cash-book"
import { downloadCsv } from "@/lib/export"
import { eurCents } from "@/lib/invoices"
import {
  IN_KINDS,
  NO_CHOICES,
  OUT_KINDS,
  PrimaNotaError,
  bookAsLabel,
  detect,
  importedRecords,
  planImport,
} from "@/lib/prima-nota"
import { XlsxError, readXlsx } from "@/lib/xlsx"

import type { DatabaseAdapter } from "@/lib/backend"
import type { AppData, BookAs, Choices, Decision, ImportPlan, Part, ReviewItem, Workbook, Write } from "@/lib/prima-nota"
import type { ReactNode } from "react"

/** The queries the import writes to: refreshed once, at the end, not after each of a few hundred writes. */
export const IMPORT_QUERY_KEYS = ["companyAccounts", "companyMovements", "companyExpenses", "companyLoans", "invoices"]

const GOOD = "text-green-700 dark:text-green-400"
const WARN = "text-amber-700 dark:text-amber-400"

type Phase =
  /** previous: the workbook Change File left, whose decisions carry over to the rows that did not change. */
  | { phase: "pick"; error: string | null; previous?: Workbook }
  | { phase: "reading" }
  | { phase: "review"; name: string; workbook: Workbook }
  | { phase: "writing"; name: string; plan: ImportPlan; done: number }
  | { phase: "done" | "failed"; name: string; plan: ImportPlan; done: number; error: string | null }

/**
 * Import Excel: the prima nota workbook into the Cash Book, once (§4 of the
 * plan). The file is read in the browser and never uploaded. The owner sees
 * what will happen, decides the rows the workbook alone can't settle, sees the
 * check against the Saldo sheet, and only then writes, one record at a time.
 */
export function ImportDialog({
  userId,
  open,
  onOpenChange,
  onCloseAutoFocus,
  data,
  onUndo,
  onImported,
}: {
  userId: string | undefined
  open: boolean
  onOpenChange: (open: boolean) => void
  onCloseAutoFocus?: (event: Event) => void
  data: AppData
  /** Opens Undo Import in its place. */
  onUndo: () => void
  /** Every write went in: the Saldo day ("yyyy-MM-dd"), so the page can show the month the workbook ends on. */
  onImported?: (saldoDay: string) => void
}) {
  const [busy, setBusy] = useState(false)
  // Decisions taken and not imported: closing asks first, so Esc or a stray X doesn't throw them away.
  const [decided, setDecided] = useState(0)
  const [confirming, setConfirming] = useState(false)
  const close = () => {
    if (busy) return
    if (decided > 0) setConfirming(true)
    else onOpenChange(false)
  }
  return (
    <>
      <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
        {/* Full screen on a phone: the review runs to several screens, and the gutters only took width from it. */}
        <DialogContent
          size="xl"
          className="max-sm:h-dvh max-sm:max-h-dvh max-sm:w-full max-sm:max-w-none max-sm:rounded-none max-sm:border-0"
          onCloseAutoFocus={onCloseAutoFocus}
          // A click beside it must not throw away the decisions taken.
          onInteractOutside={(e) => e.preventDefault()}
          onEscapeKeyDown={(e) => {
            if (!busy && decided === 0) return
            e.preventDefault()
            close()
          }}
        >
          {open && (
            <ImportFlow
              userId={userId}
              data={data}
              onBusy={setBusy}
              onDecided={setDecided}
              onClose={close}
              onUndo={() => {
                setDecided(0)
                onUndo()
              }}
              onImported={onImported}
            />
          )}
        </DialogContent>
      </Dialog>
      <ConfirmDeleteDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Discard Your Decisions?"
        description={`You made ${decided} ${decided === 1 ? "decision" : "decisions"} in the import. Closing throws ${decided === 1 ? "it" : "them"} away; nothing has been written yet.`}
        isPending={false}
        confirmLabel="Discard"
        cancelLabel="Keep Deciding"
        onConfirm={() => {
          setConfirming(false)
          setDecided(0)
          onOpenChange(false)
        }}
      />
    </>
  )
}

/** How many things the owner decided: review rows, overlaps kept, estimate ticks. */
const decisionCount = (c: Choices) => Object.keys(c.decisions).length + c.keep.length + Object.keys(c.estimates).length

/**
 * The decisions that still apply to a workbook chosen again: a row's decision carries over when the row at that
 * place reads the same (description, money, document, note); anything else starts over.
 */
function carry(choices: Choices, before: Workbook | undefined, after: Workbook): Choices {
  if (!before) return NO_CHOICES
  const key = (wb: Workbook, ref: string) => {
    const r = wb.rows.find((x) => x.ref === ref)
    return r ? JSON.stringify([r.description, r.legs, r.credit, r.debit, r.documentRef, r.notes]) : null
  }
  const decisions = Object.fromEntries(
    Object.entries(choices.decisions).filter(([id]) => {
      const ref = id.split("#")[0]
      return id.startsWith("invoice:") || (key(before, ref) !== null && key(before, ref) === key(after, ref))
    }),
  )
  return { ...choices, decisions }
}

function ImportFlow({
  userId,
  data,
  onBusy,
  onDecided,
  onClose,
  onUndo,
  onImported,
}: {
  userId: string | undefined
  data: AppData
  onBusy: (busy: boolean) => void
  onDecided: (count: number) => void
  onClose: () => void
  onUndo: () => void
  onImported?: (saldoDay: string) => void
}) {
  const queryClient = useQueryClient()
  const [state, setState] = useState<Phase>({ phase: "pick", error: null })
  const [choices, setChoices] = useState<Choices>(NO_CHOICES)
  const workbook = state.phase === "review" ? state.workbook : null
  const plan = useMemo(() => (workbook ? planImport(workbook, data, choices) : null), [workbook, data, choices])
  const imported = importedRecords(data)
  const alreadyRecords = imported.expenses.length + imported.loans.length + imported.movements.length
  const alreadyIn = imported.accounts.length + alreadyRecords
  const previous = state.phase === "pick" ? state.previous : undefined
  const decided = state.phase === "review" || previous ? decisionCount(choices) : 0
  useEffect(() => onDecided(decided), [decided, onDecided])

  async function read(file: File) {
    setState({ phase: "reading" })
    try {
      const book = await readXlsx(await file.arrayBuffer())
      const workbook = detect(book.sheets)
      setChoices((c) => carry(c, previous, workbook))
      setState({ phase: "review", name: file.name, workbook })
    } catch (e) {
      // The message names sheet, row and column, never a cell: nothing else is shown or logged.
      const error = e instanceof XlsxError || e instanceof PrimaNotaError ? e.message : "This file can't be read as an .xlsx workbook."
      setState({ phase: "pick", error, previous })
    }
  }

  const download = (name: string, plan: ImportPlan, status: string) =>
    downloadCsv(reportText(name, plan, status), `prima-nota-import-report_${isoDate(new Date())}.txt`, "text/plain;charset=utf-8;")

  async function run(name: string, frozen: ImportPlan) {
    // The rows it replaces are deleted for good: their data is saved before anything is written.
    if (frozen.overlaps.some((o) => o.replace)) download(name, frozen, `Saved before the import: ${frozen.writes.length} changes to write.`)
    onBusy(true)
    setState({ phase: "writing", name, plan: frozen, done: 0 })
    const ids = new Map<string, string>()
    let done = 0
    let error: string | null = null
    try {
      for (const w of frozen.writes) {
        await write(getBackend().db, userId!, w, ids)
        done++
        setState({ phase: "writing", name, plan: frozen, done })
      }
    } catch (e) {
      error = e instanceof Error ? e.message : "The write was refused."
    }
    await Promise.all(IMPORT_QUERY_KEYS.map((key) => queryClient.invalidateQueries({ queryKey: [key] })))
    onBusy(false)
    setState({ phase: error ? "failed" : "done", name, plan: frozen, done, error })
    setChoices(NO_CHOICES)
    if (!error) onImported?.(frozen.workbook.saldoDay)
  }

  const decide = (id: string, d: Decision | null) =>
    setChoices((c) => {
      const decisions = { ...c.decisions }
      if (d) decisions[id] = d
      else delete decisions[id]
      return { ...c, decisions }
    })

  if (state.phase === "writing") {
    const total = state.plan.writes.length
    return (
      <>
        <Header intro={false} />
        <div className="space-y-3 py-6">
          <p className="font-medium" aria-live="polite">
            Writing {state.done} of {total}…
          </p>
          <Progress value={state.done} max={total} label="Import progress" />
          <p className="text-sm text-muted-foreground">
            Keep this window open: each record is written one at a time. If it stops, Undo Import removes what was written.
          </p>
        </div>
      </>
    )
  }

  if (state.phase === "done" || state.phase === "failed") {
    const failed = state.phase === "failed"
    const replaced = state.plan.overlaps.some((o) => o.replace)
    const report = () =>
      download(
        state.name,
        state.plan,
        `Written: ${state.done} of ${state.plan.writes.length} changes, on ${dayLabel(isoDate(new Date()))}${state.error ? `\nStopped: ${state.error}` : ""}`,
      )
    return (
      <>
        <Header intro={false} />
        <div className="space-y-4">
          {failed ? (
            <div role="alert" className="space-y-1 rounded-md border border-destructive/50 bg-destructive/5 p-3 text-sm">
              <p className="font-medium text-destructive">
                The import stopped after {state.done} of {state.plan.writes.length} writes.
              </p>
              <p>{state.error}</p>
              <p className="text-muted-foreground">
                What it wrote is tagged as imported: Undo Import removes it, then you can import the workbook again.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              <p className={cn("flex items-center gap-2 font-medium", GOOD)}>
                <CheckCircle2 aria-hidden className="h-5 w-5 shrink-0" /> Imported: {state.done} changes written.
              </p>
              <ul className="space-y-1 text-sm">
                {state.plan.check.accounts.map((a) => (
                  <li key={a.name}>
                    {a.name}: matches the bank, {eurCents(a.bank)} on {dayLabel(a.day)}.
                  </li>
                ))}
              </ul>
              <p className="text-sm text-muted-foreground">
                From now on the workbook is retired: write new movements here. Download the report now, the app doesn&apos;t
                keep it: it lists the estimated dates to fix, the missing documents, the notes for your accountant
                {replaced ? " and every row the import replaced (also saved to your downloads before the import)" : ""}.
              </p>
            </div>
          )}
        </div>
        <DialogFooter className="gap-2">
          {failed && (
            <Button variant="outline" onClick={onUndo}>
              Undo Import
            </Button>
          )}
          <Button variant="outline" onClick={onClose}>
            Done
          </Button>
          <Button onClick={report}>Download Report</Button>
        </DialogFooter>
      </>
    )
  }

  if (state.phase !== "review" || !plan) {
    return (
      <>
        <Header intro />
        <div className="space-y-4 text-sm">
          {alreadyIn > 0 ? (
            <div role="status" className="space-y-2 rounded-md border border-amber-500/50 bg-amber-500/5 p-3">
              <p className={cn("flex items-center gap-2 font-medium", WARN)}>
                <AlertTriangle aria-hidden className="h-4 w-4 shrink-0" /> The workbook is already imported.
              </p>
              <p>
                {alreadyRecords} {alreadyRecords === 1 ? "record" : "records"} and {imported.accounts.length}{" "}
                {imported.accounts.length === 1 ? "account" : "accounts"} in the app came from it. To import it again, undo
                the import first: it removes only what the import created.
              </p>
              <Button variant="outline" size="sm" onClick={onUndo}>
                Undo Import
              </Button>
            </div>
          ) : (
            <ol className="list-decimal space-y-1 pl-5 text-muted-foreground">
              <li>It reads the Saldo sheet and one sheet per month. Verifica is skipped: the app redoes its sums.</li>
              <li>
                It creates each bank account of the Entrata/Uscita columns, at €0 on the 1st of the first month, or uses
                an empty account of yours with the same name.
              </li>
              <li>Each row becomes what the app records: costs, loans, movements, invoices marked paid.</li>
              <li>You decide the rows it can&apos;t settle alone, and see every balance checked against the Saldo sheet.</li>
              <li>Only then, Import writes it all. Undo Import takes it back.</li>
            </ol>
          )}
          <div className="space-y-2">
            <Label htmlFor="import-file">Workbook (.xlsx)</Label>
            <Input
              id="import-file"
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              disabled={alreadyIn > 0 || state.phase === "reading"}
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) void read(file)
              }}
            />
            {state.phase === "reading" && <p aria-live="polite">Reading the workbook…</p>}
            {previous && decided > 0 && (
              <p className="text-muted-foreground">
                Your decisions carry over to the rows that read the same in the file you choose.
              </p>
            )}
            {state.phase === "pick" && state.error && (
              <p role="alert" className="text-destructive">
                {state.error}
              </p>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
        </DialogFooter>
      </>
    )
  }

  const undecided = plan.review.filter((i) => !i.decision)
  const ready = plan.blockers.length === 0 && plan.unresolved.length === 0 && plan.check.ok
  const waiting = [
    plan.blockers.length > 0 && "fix the problems under The Check",
    plan.unresolved.length > 0 && `decide ${plan.unresolved.length} ${plan.unresolved.length === 1 ? "row" : "rows"}`,
    plan.blockers.length === 0 && !plan.check.ok && "make every account match (The Check)",
  ].filter(Boolean)
  const status = ready
    ? `Ready: ${plan.writes.length} changes, and every account matches the Saldo sheet.`
    : `Import is off until you ${waiting.join(" and ")}.`
  const wb = state.workbook
  const months = wb.sheets.map((s) => s.ym)

  return (
    <>
      <Header intro />
      <div className="min-w-0 space-y-6 text-sm">
        <Section title="What's in the File">
          <p>
            {state.name}: {plan.counts.rows} rows on {wb.sheets.length} month {wb.sheets.length === 1 ? "sheet" : "sheets"},{" "}
            {formatYearMonth(months[0])} to {formatYearMonth(months.at(-1)!)}, and bank balances on {dayLabel(wb.saldoDay)}.
          </p>
          <p className="text-muted-foreground">
            Per sheet: {plan.counts.perSheet.map((s) => `${s.sheet} ${s.rows}`).join(" · ")}
            {wb.empty.length > 0 &&
              `. ${wb.empty.length} ${wb.empty.length === 1 ? "row has" : "rows have"} no amount and ${wb.empty.length === 1 ? "is" : "are"} skipped: the report lists ${wb.empty.length === 1 ? "it" : "them"}.`}
          </p>
          <p className="rounded-md bg-muted px-3 py-2">
            <span className="font-medium">What Import will do: </span>
            {willDo(plan)}
          </p>
          <ul aria-label="Accounts" className="grid gap-2 sm:grid-cols-2">
            {plan.counts.byAccount.map((a, k) => {
              const matched = plan.accounts[k]?.matched
              return (
                <li key={a.name} className="rounded-md border p-3">
                  <p className="font-medium">{a.name}</p>
                  <p className="tabular-nums text-muted-foreground">
                    {a.rows} rows · in {eurCents(a.in)} · out {eurCents(a.out)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {matched ? "Your account of this name, empty: used as it is." : `New account, opening at ${eurCents(0)} on ${dayLabel(wb.openingDay)}.`}
                  </p>
                </li>
              )
            })}
          </ul>
          <Kinds title="Written to the App" kinds={plan.counts.byKind.filter((k) => k.written)} />
          <Kinds title="Checked or Reported, Not Written" kinds={plan.counts.byKind.filter((k) => !k.written)} />
          {plan.counts.splitRows > 0 && (
            <p className="text-muted-foreground">
              {plan.counts.splitRows} {plan.counts.splitRows === 1 ? "row is" : "rows are"} split into parts, each counted
              under its kind above.
            </p>
          )}
          {plan.counts.estimatedDates > 0 && (
            <p className="text-muted-foreground">
              Dates: {plan.counts.estimatedDates} rows have no day in the workbook. They get the 1st of their month, marked ~,
              and To Chase lists them to fix later.
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => download(state.name, plan, "Not imported yet: what Import would do now.")}>
              Download Report
            </Button>
            <span className="text-muted-foreground">Everything above row by row, to read before you import.</span>
          </div>
        </Section>

        {plan.review.length > 0 && (
          <Section
            title={`Rows You Decide (${plan.review.length})`}
            action={
              <Button
                variant="outline"
                size="sm"
                disabled={undecided.length === 0}
                onClick={() =>
                  setChoices((c) => ({
                    ...c,
                    decisions: { ...Object.fromEntries(undecided.map((i) => [i.id, start(i, i.suggested)])), ...c.decisions },
                  }))
                }
              >
                Accept All Suggestions
              </Button>
            }
          >
            <p className="text-muted-foreground">
              The workbook alone can&apos;t say what these are. Pick each one, or accept the suggestions and change the
              ones that are wrong. {plan.review.length - plan.unresolved.length} of {plan.review.length} done.
            </p>
            <ul className="space-y-3">
              {plan.review.map((item) => (
                <ReviewCard key={item.id} item={item} onDecide={(d) => decide(item.id, d)} />
              ))}
            </ul>
          </Section>
        )}

        {plan.collaboratorRows.length > 0 && (
          <Section title="Collaborator Invoices">
            <p className="text-muted-foreground">
              These costs name a collaborator, so they import as their invoices. For Month starts as the date&apos;s month: change
              it to the month of work each one pays.
            </p>
            <ul className="space-y-3">
              {plan.collaboratorRows.map((r) => (
                <li key={r.ref} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
                  <span className="min-w-0">
                    {r.description}
                    <span className="block text-meta text-muted-foreground">
                      {r.where} · Collaborator: {r.name}
                    </span>
                  </span>
                  <Input
                    type="month"
                    aria-label={`For Month: ${r.description}`}
                    value={r.forMonth}
                    className="w-44"
                    onChange={(e) => {
                      const forMonth = e.target.value
                      if (forMonth) setChoices((c) => ({ ...c, forMonths: { ...c.forMonths, [r.ref]: forMonth } }))
                    }}
                  />
                </li>
              ))}
            </ul>
          </Section>
        )}

        {(plan.overlaps.length > 0 || plan.estimates.length > 0) && (
          <Section title="Already in the App">
            {plan.overlaps.length > 0 && (
              <div className="space-y-2">
                <p className="text-muted-foreground">
                  These costs and loans are already in the app, with no account, and look like a workbook row: same amount,
                  within a month. By default the app&apos;s row is deleted and the workbook&apos;s kept on its account, so
                  nothing counts twice. Where the workbook has no day (~), the app&apos;s day is kept. Import saves the
                  report to your downloads before writing: it holds the deleted rows&apos; data.
                </p>
                <ul className="space-y-2">
                  {plan.overlaps.map((o) => (
                    <li key={o.id} className="grid gap-2 rounded-md border p-3 sm:grid-cols-[1fr_1fr_auto] sm:items-center">
                      <div className="min-w-0">
                        <p className="text-xs text-muted-foreground">In the app</p>
                        <p className="font-medium [overflow-wrap:anywhere]">{o.existing.description}</p>
                        <p className="tabular-nums text-muted-foreground">
                          {dayLabel(o.existing.day)} · {eurCents(o.existing.amount)}
                        </p>
                        <p className="text-xs text-muted-foreground [overflow-wrap:anywhere]">{o.existing.details.join(" · ")}</p>
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs text-muted-foreground">In the workbook, {o.imported.where}</p>
                        <p className="font-medium [overflow-wrap:anywhere]">{o.imported.description}</p>
                        <p className="tabular-nums text-muted-foreground">
                          {o.imported.dateEstimated ? `~${dayLabel(o.imported.day)}, no day in the workbook` : dayLabel(o.imported.day)} ·{" "}
                          {eurCents(o.imported.amount)}
                        </p>
                        {o.imported.appDay && (
                          <p className="text-xs text-muted-foreground">Replace keeps the app&apos;s {dayLabel(o.imported.appDay)}.</p>
                        )}
                      </div>
                      <Select
                        value={o.replace ? "replace" : "keep"}
                        onValueChange={(v) =>
                          setChoices((c) => ({ ...c, keep: v === "keep" ? [...c.keep, o.id] : c.keep.filter((id) => id !== o.id) }))
                        }
                      >
                        <SelectTrigger aria-label={`${o.existing.description}: replace or keep`} className="sm:w-64">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="replace">Replace With the Workbook&apos;s</SelectItem>
                          <SelectItem value="keep">Keep Both</SelectItem>
                        </SelectContent>
                      </Select>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {plan.estimates.length > 0 && (
              <div className="space-y-2">
                <p className="text-muted-foreground">
                  Recurring costs on Costs: linked payments stand for them, so the Plan stops counting the estimate in the
                  months they cover. Payments that only share the category are left for you to tick.
                </p>
                <ul className="space-y-2">
                  {plan.estimates.map((e) => {
                    const set = (patch: Partial<Choices["estimates"][string]>) =>
                      setChoices((c) => {
                        const was = c.estimates[e.key] ?? { link: e.sure, moveStart: e.startsEarly }
                        return { ...c, estimates: { ...c.estimates, [e.key]: { ...was, ...patch } } }
                      })
                    return (
                      <li key={e.key} className="space-y-2 rounded-md border p-3">
                        <p className="font-medium">
                          {e.estimate.description}: {e.payments} {e.payments === 1 ? "payment" : "payments"}, {eurCents(e.total)}
                        </p>
                        {!e.sure && (
                          <p className="text-muted-foreground [overflow-wrap:anywhere]">
                            {e.payments === 1 ? "This payment shares" : "These payments share"} its category, not a word of its
                            name (“{e.sample}”{e.payments > 1 ? " and more" : ""}): tick to link {e.payments === 1 ? "it if it is" : "them if they are"}{" "}
                            this cost.
                          </p>
                        )}
                        <Tick id={`link-${e.key}`} checked={e.link} onChange={(link) => set({ link })}>
                          Link them to this recurring cost
                        </Tick>
                        {e.startsEarly && (
                          <Tick id={`start-${e.key}`} checked={e.moveStart} disabled={!e.link} onChange={(moveStart) => set({ moveStart })}>
                            Start it on {dayLabel(wb.openingDay)}: it starts {dayLabel(isoDate(e.estimate.date))}, before the
                            accounts opened
                          </Tick>
                        )}
                      </li>
                    )
                  })}
                </ul>
              </div>
            )}
          </Section>
        )}

        <Section title="The Check">
          <p className="text-muted-foreground">
            The Verifica sheet, redone on what the import would write: each account&apos;s balance on the Saldo date, and each
            sheet&apos;s Entrata and Uscita per account.
          </p>
          <ul aria-label="Check" className="space-y-1">
            {plan.check.accounts.map((a) => (
              <li key={a.name} className={cn("flex items-start gap-2 font-medium", a.ok ? GOOD : WARN)}>
                {a.ok ? <CheckCircle2 aria-hidden className="mt-0.5 h-4 w-4 shrink-0" /> : <AlertTriangle aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />}
                <span className="min-w-0">{a.label}</span>
              </li>
            ))}
            {plan.check.problems.map((p) => (
              <li key={p} className={cn("flex items-start gap-2", WARN)}>
                <AlertTriangle aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
                <span className="min-w-0 [overflow-wrap:anywhere]">{p}</span>
              </li>
            ))}
          </ul>
          {!plan.check.ok && plan.blockers.length === 0 && (
            <p>
              Import stays off until every line above is green. A missing IN or OUT means that account&apos;s rows don&apos;t
              reach its Saldo balance: a row left out or in the wrong column, or a Saldo balance that isn&apos;t the
              bank&apos;s. Fix the workbook, save it and choose it again with Change File.
            </p>
          )}
          {plan.blockers.length > 0 && (
            <ul role="alert" className="space-y-1 rounded-md border border-destructive/50 bg-destructive/5 p-3 text-destructive">
              {plan.blockers.map((b) => (
                <li key={b} className="[overflow-wrap:anywhere]">
                  {b}
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
      {/* Sticky: Import and why it is off stay in sight however far the list scrolls; on a phone the reason reads first. */}
      <div className="sticky -bottom-6 z-10 -mx-6 -mb-6 flex flex-col gap-3 border-t bg-background px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
        <p role="status" className={cn("text-sm", ready ? GOOD : "text-muted-foreground")}>
          {status}
        </p>
        <div className="grid shrink-0 grid-cols-2 gap-2 sm:flex">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="outline" onClick={() => setState({ phase: "pick", error: null, previous: wb })}>
            Change File
          </Button>
          <Button className="order-first col-span-2 sm:order-none" disabled={!ready} onClick={() => void run(state.name, plan)}>
            Import
          </Button>
        </div>
      </div>
    </>
  )
}

function Kinds({ title, kinds }: { title: string; kinds: { label: string; count: number }[] }) {
  if (kinds.length === 0) return null
  return (
    <div>
      <p className="font-medium">{title}</p>
      <ul aria-label={title} className="mt-1 grid gap-x-6 sm:grid-cols-2">
        {kinds.map((k) => (
          <li key={k.label} className="flex justify-between gap-3 border-b border-dashed py-1">
            <span className="min-w-0">{k.label}</span>
            <span className="tabular-nums">{k.count}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** The writes in one plain sentence. */
function willDo(plan: ImportPlan): string {
  const n = (op: Write["op"], test: (w: Write) => boolean = () => true) => plan.writes.filter((w) => w.op === op && test(w)).length
  const plural = (k: number, one: string, many: string) => `${k} ${k === 1 ? one : many}`
  const created = n("create_account")
  const matched = n("update_account")
  const records = n("expense") + n("loan") + n("movement")
  const paid = n("update_invoice", (w) => w.op === "update_invoice" && !!w.input.paidAccountId && w.input.paidAccountId !== NON_CASH) + n("create_invoice")
  const settled = n("update_invoice", (w) => w.op === "update_invoice" && w.input.paidAccountId === NON_CASH)
  const deleted = n("delete_expense") + n("delete_loan")
  const estimates = n("update_estimate")
  return [
    created && `create ${plural(created, "account", "accounts")}`,
    matched && `use ${plural(matched, "empty account", "empty accounts")} of yours`,
    `write ${plural(records, "cost, loan or movement", "costs, loans and movements")}`,
    paid && `mark ${plural(paid, "invoice", "invoices")} paid into an account`,
    settled && `settle ${plural(settled, "invoice or credit note", "invoices and credit notes")} with no money`,
    deleted && `delete ${plural(deleted, "row", "rows")} already in the app that the workbook replaces`,
    estimates && `adjust ${plural(estimates, "recurring cost", "recurring costs")}`,
  ]
    .filter(Boolean)
    .join(", ")
    .replace(/, ([^,]*)$/, " and $1")
    .replace(/^./, (c) => c.toUpperCase()) + "."
}

/** intro: the promise before Import is pressed; after it, the screen says what happened. */
function Header({ intro }: { intro: boolean }) {
  return (
    <DialogHeader>
      <DialogTitle>Import Excel</DialogTitle>
      <DialogDescription>
        {intro
          ? "Your prima nota workbook into the Cash Book, once. The file stays in your browser: nothing is uploaded, and nothing is written until you press Import."
          : "Your prima nota workbook into the Cash Book. The file stays in your browser: nothing is uploaded."}
      </DialogDescription>
    </DialogHeader>
  )
}

function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section aria-label={title} className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-1">
        <h3 className="font-semibold">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  )
}

function Tick({ id, checked, disabled, onChange, children }: { id: string; checked: boolean; disabled?: boolean; onChange: (v: boolean) => void; children: ReactNode }) {
  return (
    <div className="flex items-start gap-2">
      <Checkbox id={id} checked={checked} disabled={disabled} onCheckedChange={(v) => onChange(v === true)} className="mt-0.5" />
      <Label htmlFor={id} className="font-normal leading-snug">
        {children}
      </Label>
    </div>
  )
}

export function Progress({ value, max, label }: { value: number; max: number; label: string }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0
  return (
    <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={value} className="h-2 w-full rounded-full bg-muted">
      <div className="h-2 rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
    </div>
  )
}

/** A decision for this option, filled from what the workbook suggests. */
function start(item: ReviewItem, option: string): Decision {
  const amount = item.amount ?? 0
  let parts: Part[] | undefined
  if (option === "split") {
    parts = (item.parts ?? []).map((p) => ({ ...p }))
    if (parts.length < 2) parts.push({ as: amount >= 0 ? "income" : "cost", amount: 0, description: "" })
  }
  return {
    option,
    parts,
    clientId: item.invoice?.clientId ?? undefined,
    amount: item.invoice?.amount,
    vat: item.invoice?.vat,
    gross: item.gross ?? undefined,
    invoiceId: item.invoiceId ?? (item.openInvoices?.length === 1 ? item.openInvoices[0].id : undefined),
  }
}

function ReviewCard({ item, onDecide }: { item: ReviewItem; onDecide: (d: Decision | null) => void }) {
  const d = item.decision
  const amount = item.amount ?? 0
  const label = (o: { id: string; label: string }) => `${o.label}${o.id === item.suggested ? " (suggested)" : ""}`
  return (
    <li className={cn("space-y-2 rounded-md border p-3", d && !item.problem && "border-green-600/40")}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="font-medium [overflow-wrap:anywhere]">{item.what}</p>
          <p className="text-xs text-muted-foreground">
            {[item.where, item.account, item.day && dayLabel(item.day)].filter(Boolean).join(" · ")}
          </p>
        </div>
        {item.amount !== null && <p className={cn("font-medium tabular-nums", amount > 0 && GOOD)}>{eurCents(amount)}</p>}
      </div>
      <p className="text-muted-foreground">{item.why}</p>
      <Select value={d?.option ?? ""} onValueChange={(option) => onDecide(start(item, option))}>
        <SelectTrigger aria-label={`What it is: ${item.where}`} className="w-full sm:w-96">
          <SelectValue placeholder="Choose what it is" />
        </SelectTrigger>
        <SelectContent>
          {item.options.map((o) => (
            <SelectItem key={o.id} value={o.id}>
              {label(o)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {d?.option === "split" && <SplitEditor amount={amount} parts={d.parts ?? []} onChange={(parts) => onDecide({ ...d, parts })} />}
      {(d?.option === "create_invoice" || d?.option === "platform_invoice") && (
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1">
            <Label htmlFor={`${item.id}-client`}>Client</Label>
            <Select value={d.clientId ?? ""} onValueChange={(clientId) => onDecide({ ...d, clientId })}>
              <SelectTrigger id={`${item.id}-client`}>
                <SelectValue placeholder="Pick the client" />
              </SelectTrigger>
              <SelectContent>
                {(item.clients ?? []).map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {d.option === "create_invoice" ? (
            <>
              <Amount id={`${item.id}-amount`} label="Amount, Net of VAT" value={d.amount} onChange={(v) => onDecide({ ...d, amount: v })} />
              <Amount id={`${item.id}-vat`} label="VAT" value={d.vat} onChange={(v) => onDecide({ ...d, vat: v })} />
              <p className="text-muted-foreground sm:col-span-3">
                Invoice {item.invoice?.number}, {eurCents(round2((d.amount ?? 0) + (d.vat ?? 0)))} with VAT, paid on the row&apos;s
                day into its account. A gap up to €50 becomes a bank fee.
              </p>
            </>
          ) : (
            <>
              <Amount id={`${item.id}-gross`} label="Gross, Before Commission" value={d.gross} onChange={(v) => onDecide({ ...d, gross: v })} />
              <p className="self-end pb-2 text-muted-foreground">
                Commission: {eurCents(Math.max(0, round2((d.gross ?? 0) - amount)))}
              </p>
            </>
          )}
        </div>
      )}
      {d?.option === "platform_existing" && (
        <div className="space-y-1">
          <Label htmlFor={`${item.id}-invoice`}>Invoice It Pays</Label>
          <Select value={d.invoiceId ?? ""} onValueChange={(invoiceId) => onDecide({ ...d, invoiceId })}>
            <SelectTrigger id={`${item.id}-invoice`} className="w-full sm:w-96">
              <SelectValue placeholder="Pick the invoice" />
            </SelectTrigger>
            <SelectContent>
              {(item.openInvoices ?? []).map((i) => (
                <SelectItem key={i.id} value={i.id}>
                  {i.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      {item.problem && <p className="text-destructive">{item.problem}</p>}
    </li>
  )
}

function Amount({ id, label, value, onChange }: { id: string; label: string; value: number | undefined; onChange: (v: number | undefined) => void }) {
  const [text, setText] = useState(value === undefined ? "" : String(value))
  return (
    <div className="space-y-1">
      <Label htmlFor={id}>{label}</Label>
      <MoneyInput
        id={id}
        value={text}
        onChange={(e) => {
          setText(e.target.value)
          const n = Number(e.target.value)
          onChange(e.target.value.trim() === "" || !Number.isFinite(n) ? undefined : round2(n))
        }}
      />
    </div>
  )
}

/** The parts of one bank amount, signed: money in positive, money out (a refund deducted) negative. */
function SplitEditor({ amount, parts, onChange }: { amount: number; parts: Part[]; onChange: (parts: Part[]) => void }) {
  const [texts, setTexts] = useState(() => parts.map((p) => (p.amount === 0 ? "" : String(p.amount))))
  const total = round2(parts.reduce((t, p) => t + (Number.isFinite(p.amount) ? p.amount : 0), 0))
  const kinds = (value: number) => (value < 0 || (value === 0 && amount < 0) ? OUT_KINDS : IN_KINDS)
  const set = (k: number, patch: Partial<Part>) => onChange(parts.map((p, n) => (n === k ? { ...p, ...patch } : p)))
  return (
    <fieldset className="space-y-3 rounded-md border p-3">
      <legend className="px-1 font-medium">Parts</legend>
      {/* On a phone: type, then amount and remove, then description; one row each part from sm. */}
      {parts.map((p, k) => (
        <div key={k} className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 sm:grid-cols-[minmax(0,13rem)_8rem_minmax(0,1fr)_auto] sm:items-center">
          <Select value={p.as} onValueChange={(as) => set(k, { as: as as BookAs })}>
            <SelectTrigger aria-label={`Part ${k + 1}: what it is`} className="col-span-2 sm:col-span-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {kinds(p.amount).map((as) => (
                <SelectItem key={as} value={as}>
                  {bookAsLabel(as, p.amount || amount)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <MoneyInput
            aria-label={`Part ${k + 1}: amount`}
            value={texts[k] ?? ""}
            onChange={(e) => {
              const text = e.target.value
              setTexts((t) => t.map((x, n) => (n === k ? text : x)))
              const value = text.trim() === "" ? 0 : Number(text)
              // A sign the type can't have switches it: money out is a cost, money in income.
              const as = kinds(value).includes(p.as) ? p.as : kinds(value)[0]
              set(k, { amount: Number.isFinite(value) ? round2(value) : Number.NaN, as })
            }}
          />
          <Input
            aria-label={`Part ${k + 1}: description`}
            placeholder="Description"
            className="order-last col-span-2 sm:order-none sm:col-span-1"
            value={p.description}
            onChange={(e) => set(k, { description: e.target.value })}
          />
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Remove part ${k + 1}`}
            disabled={parts.length <= 2}
            onClick={() => {
              setTexts((t) => t.filter((_x, n) => n !== k))
              onChange(parts.filter((_p, n) => n !== k))
            }}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      ))}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setTexts((t) => [...t, ""])
            onChange([...parts, { as: amount >= 0 ? "income" : "cost", amount: 0, description: "" }])
          }}
        >
          <Plus className="mr-1 h-4 w-4" /> Add Part
        </Button>
        <p className={cn("tabular-nums", total === amount ? GOOD : WARN)}>
          Parts {eurCents(total)} of {eurCents(amount)}
        </p>
      </div>
    </fieldset>
  )
}

/** One write, with the ids the earlier ones got: an account, a supplier invoice. */
async function write(db: DatabaseAdapter, userId: string, w: Write, ids: Map<string, string>) {
  const id = <T,>(v: T): T => (typeof v === "string" ? ((ids.get(v) ?? v) as T) : v)
  switch (w.op) {
    case "create_account":
      ids.set(w.key, (await db.createCompanyAccount(userId, w.input)).id)
      return
    case "update_account":
      await db.updateCompanyAccount(userId, w.id, w.input)
      return
    case "delete_expense":
      return db.deleteCompanyExpense(userId, w.id)
    case "delete_loan":
      return db.deleteCompanyLoan(userId, w.id)
    case "expense":
      ids.set(w.key, (await db.createCompanyExpense(userId, { ...w.input, accountId: id(w.input.accountId) })).id)
      return
    case "loan":
      await db.createCompanyLoan(userId, { ...w.input, accountId: id(w.input.accountId) })
      return
    case "movement":
      await db.createCompanyMovement(userId, {
        ...w.input,
        accountId: id(w.input.accountId),
        toAccountId: id(w.input.toAccountId),
        expenseId: id(w.input.expenseId),
      })
      return
    case "create_invoice":
      await db.createInvoice(userId, { ...w.input, paidAccountId: id(w.input.paidAccountId) })
      return
    case "update_invoice":
      await db.updateInvoice(userId, w.id, { ...w.input, ...(w.input.paidAccountId !== undefined && { paidAccountId: id(w.input.paidAccountId) }) })
      return
    case "update_estimate":
      await db.updateCompanyExpense(userId, w.id, w.input)
  }
}

/** The report the owner keeps: where the import stands, the check, then each section of the plan's. */
function reportText(name: string, plan: ImportPlan, status: string): string {
  return [
    "Prima nota import report",
    `File: ${name}`,
    status,
    "",
    "Check",
    ...plan.check.accounts.map((a) => `- ${a.label}`),
    "",
    plan.report,
    "",
  ].join("\n")
}
