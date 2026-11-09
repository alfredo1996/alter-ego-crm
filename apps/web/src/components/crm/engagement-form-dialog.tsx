"use client"

import { eurShort } from "@alter-ego/kernel/currency"
import { formatYearMonth, isoDate, parseYearMonth } from "@alter-ego/kernel/dates"
import { SegmentedButtons } from "@alter-ego/ui/page/segmented-buttons"
import { Button } from "@alter-ego/ui/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@alter-ego/ui/ui/dialog"
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@alter-ego/ui/ui/form"
import { Input } from "@alter-ego/ui/ui/input"
import { Label } from "@alter-ego/ui/ui/label"
import { Switch } from "@alter-ego/ui/ui/switch"
import { Textarea } from "@alter-ego/ui/ui/textarea"
import { cn } from "@alter-ego/ui/utils"
import { zodResolver } from "@hookform/resolvers/zod"
import { addMonths, differenceInCalendarMonths, format, parseISO } from "date-fns"
import { useEffect, useId } from "react"
import { type Resolver, useForm, useWatch } from "react-hook-form"
import { type z } from "zod"

import { ClientCombobox } from "@/components/crm/client-combobox"
import { monthsFrom } from "@/lib/engagement-burndown"
import {
  allocationsAfterEnd,
  closingEndDate,
  contractDays,
  contractUnit,
  contractEndDate,
  endBeforeAmendmentError,
  endFields,
  fromContractUnit,
  inContractUnit,
  rateSteps,
  timecardsAfterEnd,
  toContractUnit,
  unitNoun,
} from "@/lib/engagements"
import { monthRun } from "@/lib/invoices"
import { createEngagementSchema, updateEngagementSchema } from "@/types/schemas"

import type { Allocation, Client, Engagement, Timecard } from "@/types"

// isActive exists on edit only: a new contract is always active.
type FormValues = z.infer<typeof createEngagementSchema> & { isActive?: boolean }

/**
 * What the form holds and shows is in the contract's unit (€/h and hours on an hourly one);
 * what it stores is days. The resolver turns the one into the other, so onSubmit gets days.
 */
type Terms = Pick<FormValues, "unit" | "dailyRate" | "contractedDays" | "defaultDaysPerMonth">
const toStored = <T extends Terms>(v: T): T => {
  const t = fromContractUnit({ unit: v.unit, rate: v.dailyRate, contracted: v.contractedDays ?? null, perMonth: v.defaultDaysPerMonth })
  return { ...v, ...t, contractedDays: v.contractedDays === undefined ? undefined : t.contractedDays }
}
const toShown = <T extends Terms>(v: T): T => {
  const t = toContractUnit({ ...v, contractedDays: v.contractedDays ?? null })
  return { ...v, dailyRate: t.rate, defaultDaysPerMonth: t.perMonth, contractedDays: v.contractedDays === undefined ? undefined : t.contracted }
}

const EMPTY: FormValues = {
  clientId: "",
  name: null,
  opportunityId: null,
  unit: "day",
  dailyRate: 500,
  vatApplicable: true,
  contractedDays: null,
  defaultDaysPerMonth: 10,
  startMonth: null,
  notes: null,
}

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  engagement?: Engagement | null
  /** Every allocation: the dialog warns about this contract's days stored past its end. */
  allocations?: Allocation[]
  /** Every timecard: the dialog warns about this contract's hours logged past its end. */
  timecards?: Timecard[]
  /** Prefill for a contract being created from a won opportunity. */
  prefill?: Partial<FormValues> | null
  clients: Client[]
  onCreateClient: (name: string) => Promise<string>
  onSubmit: (values: FormValues) => void
  isPending: boolean
  /** No DialogTrigger: the caller puts focus back on the button that opened it. */
  onCloseAutoFocus?: (event: Event) => void
}

export function EngagementFormDialog({
  open,
  onOpenChange,
  engagement,
  allocations = [],
  timecards = [],
  prefill,
  clients,
  onCreateClient,
  onSubmit,
  isPending,
  onCloseAutoFocus,
}: Props) {
  const isEditing = !!engagement
  const unitLabelId = useId()
  const isConversion = !isEditing && !!prefill?.opportunityId
  // The update schema keeps isActive, which the create schema would strip on the way
  // out. The cast: TS cannot infer one resolver type from a union of two schemas.
  const stored = zodResolver(isEditing ? updateEngagementSchema : createEngagementSchema) as Resolver<FormValues>
  const form = useForm<FormValues>({
    resolver: (values, context, options) => stored(toStored(values), context, options),
    defaultValues: EMPTY,
  })
  const unit = useWatch({ control: form.control, name: "unit" }) ?? "day"
  const hourly = unit === "hour"
  const noun = unitNoun(unit)
  const isActive = useWatch({ control: form.control, name: "isActive" }) ?? true
  const endMonth = useWatch({ control: form.control, name: "endMonth" })
  const endDate = useWatch({ control: form.control, name: "endDate" })
  const startMonth = useWatch({ control: form.control, name: "startMonth" })
  const dailyRate = useWatch({ control: form.control, name: "dailyRate" })
  const vatApplicable = useWatch({ control: form.control, name: "vatApplicable" })
  const contractedDays = useWatch({ control: form.control, name: "contractedDays" }) ?? null
  const daysPerMonth = useWatch({ control: form.control, name: "defaultDaysPerMonth" })
  const today = isoDate(new Date())
  const currentMonth = today.slice(0, 7)
  // Closing a contract that has not started leaves it with no end: any month would bill.
  const notStarted = !!startMonth && startMonth > today.slice(0, 7)
  const end = contractEndDate({ endMonth: endMonth ?? null, endDate: endDate ?? null })
  const afterEnd = engagement && endMonth ? allocationsAfterEnd(allocations, engagement.id, endMonth) : []
  // Closed with no end, the contract takes no hours at all: every one it holds is late ("" is before any day).
  const hoursAfterEnd =
    engagement && (end || !isActive) ? timecardsAfterEnd(timecards, engagement.id, end ?? "") : []

  // Owner decision (2026-10-07), as update_engagement: once hours exist the signed rate is what
  // invoiced months were priced at, so a new one is an amendment from a month on.
  const rateLocked = !!engagement && timecards.some((t) => t.engagementId === engagement.id)
  const amendments = engagement?.amendments ?? []
  const addedDays = contractDays({ contractedDays: 0, amendments }) ?? 0
  const addedShown = inContractUnit(addedDays, unit)
  // What changing a term reprices: every month since the start the plan holds, so only on a started contract.
  const own = engagement ? allocations.filter((a) => a.engagementId === engagement.id) : []
  const anchor = startMonth ?? own.map((a) => a.yearMonth).sort()[0]
  const started = !!engagement && !!anchor && anchor <= currentMonth
  // The past months Days/month still prices: no stored row (never confirmed with Use), up to the end.
  const unconfirmed = started
    ? monthsFrom(anchor, differenceInCalendarMonths(parseYearMonth(currentMonth), parseYearMonth(anchor))).filter(
        (m) => (!endMonth || m <= endMonth) && !own.some((a) => a.yearMonth === m),
      )
    : []
  const mon = (ym: string) => formatYearMonth(ym, "MMM yyyy")
  const startsBefore = startMonth ? amendments.filter((a) => a.from < startMonth) : []
  // Refused, as Close and update_engagement refuse it.
  const endsBeforeError = endBeforeAmendmentError({ amendments }, endMonth ?? null, "app")
  // Against the values the form opened with: before the reset lands they equal the empty form's, so nothing flashes.
  const opened = form.formState.defaultValues
  const signedDays = opened?.contractedDays ?? null
  const repriceWarnings = !engagement || !started
    ? []
    : [
        dailyRate !== opened?.dailyRate && "Changes the rate on every month since the start, in the Plan.",
        vatApplicable !== opened?.vatApplicable &&
          "Changes VAT on every month since the start; a VAT change is usually a new contract.",
        daysPerMonth !== opened?.defaultDaysPerMonth &&
          unconfirmed.length > 0 &&
          `Changes every past month not confirmed with Use: ${monthRun(unconfirmed)}. Confirm them in the Plan first.`,
        contractedDays !== signedDays &&
          (contractedDays === null || (signedDays !== null && contractedDays > signedDays)
            ? "Months that ran over budget can bill again."
            : `Fewer ${noun} can cap months already planned and lower their revenue.`),
        startsBefore.length > 0 &&
          `Start moves past the ${startsBefore.map((a) => mon(a.from)).join(", ")} amendment${startsBefore.length > 1 ? "s" : ""}: from the start on, ${startsBefore.length > 1 ? "they apply" : "it applies"} as if dated then.`,
      ].filter((w): w is string => !!w)

  function submit(values: FormValues) {
    // Added days need a budget to add to: amendContract never adds them to time and materials either.
    if (values.contractedDays === null && addedDays > 0) {
      form.setError("contractedDays", {
        message: `Amendments add ${addedShown} ${noun} to this budget, so it can't become time and materials. Remove them with Amend Contract first.`,
      })
      return
    }
    if (endsBeforeError) {
      form.setFocus("endDate")
      return
    }
    // Locked, the field shows the signed rate whatever was typed before hours arrived: that is what is sent.
    onSubmit(rateLocked && engagement ? { ...values, dailyRate: engagement.dailyRate } : values)
  }

  function setEnd(fields: Pick<Engagement, "endMonth" | "endDate">) {
    form.setValue("endMonth", fields.endMonth)
    form.setValue("endDate", fields.endDate)
  }

  // Switching back to how the contract was when the dialog opened restores its end,
  // so off-and-on cannot wipe a planned end. A real change computes one: closing ends
  // today, never moves an end already past (closingEndDate), and reopening clears it.
  function endOn(on: boolean): Pick<Engagement, "endMonth" | "endDate"> {
    if (!engagement || on === engagement.isActive) {
      return { endMonth: engagement?.endMonth ?? null, endDate: engagement?.endDate ?? null }
    }
    if (on) return endFields(null)
    return endFields(
      closingEndDate({ startMonth: startMonth ?? null, endMonth: engagement.endMonth, endDate: engagement.endDate }, today),
    )
  }

  useEffect(() => {
    if (!open) return
    form.reset(
      toShown(
        engagement
          ? {
              clientId: engagement.clientId,
              name: engagement.name,
              opportunityId: engagement.opportunityId,
              unit: contractUnit(engagement),
              dailyRate: engagement.dailyRate,
              vatApplicable: engagement.vatApplicable,
              contractedDays: engagement.contractedDays,
              defaultDaysPerMonth: engagement.defaultDaysPerMonth,
              startMonth: engagement.startMonth,
              endMonth: engagement.endMonth,
              endDate: engagement.endDate,
              isActive: engagement.isActive,
              notes: engagement.notes,
            }
          : { ...EMPTY, ...prefill, unit: prefill?.unit ?? "day" },
      ),
    )
  }, [open, engagement, prefill, form])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm" onCloseAutoFocus={onCloseAutoFocus}>
        <DialogHeader>
          <DialogTitle>
            {isEditing ? "Edit Contract" : isConversion ? "Create Contract" : "New Contract"}
          </DialogTitle>
          <DialogDescription>
            {isConversion
              ? `Prefilled from the opportunity's estimate. Correct the rate and ${noun} to match the signed contract.`
              : isEditing
                ? "Fixes what was signed. A new rate, more days or a later end agreed with the client is Amend Contract, so earlier months keep their price."
                : `Contracted ${noun} are the budget: when they run out, revenue drops to zero, and the plan tells you ahead of time.`}
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          {/* ponytail: the form re-sends endMonth/endDate, so an end extended over chat while it is open
              is put back on Save. Accepted for a single owner; send only the dirty fields if that bites. */}
          <form onSubmit={form.handleSubmit(submit)} className="space-y-4">
            <FormField
              control={form.control}
              name="clientId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Client</FormLabel>
                  <FormControl>
                    <ClientCombobox
                      clients={clients}
                      value={field.value || null}
                      onChange={field.onChange}
                      onCreate={onCreateClient}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Name</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="e.g. Cloud migration"
                      maxLength={120}
                      value={field.value ?? ""}
                      onChange={(e) => field.onChange(e.target.value.trim() === "" ? null : e.target.value)}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Chosen when the contract is created: it follows the deal on a conversion, and an existing
                contract stays in its unit (converting one would reprice its hours and invoices). */}
            {!isEditing && !isConversion && (
              <div className="space-y-2">
                <Label id={unitLabelId}>Unit</Label>
                <div>
                  <SegmentedButtons
                    aria-labelledby={unitLabelId}
                    value={unit}
                    options={[
                      { value: "hour", label: "Hours" },
                      { value: "day", label: "Days" },
                    ]}
                    onChange={(next) => {
                      // The numbers change with the unit, not their meaning: €500/day, 10 days is €62.5/h, 80 h.
                      const t = fromContractUnit({ unit, rate: dailyRate, contracted: contractedDays, perMonth: daysPerMonth })
                      const shown = toShown({ unit: next, dailyRate: t.dailyRate, contractedDays: t.contractedDays, defaultDaysPerMonth: t.defaultDaysPerMonth })
                      form.setValue("unit", next)
                      form.setValue("dailyRate", shown.dailyRate)
                      form.setValue("defaultDaysPerMonth", shown.defaultDaysPerMonth)
                      form.setValue("contractedDays", shown.contractedDays)
                    }}
                  />
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="dailyRate"
                render={({ field }) => (
                  <FormItem className={cn(rateLocked && "sm:col-span-2")}>
                    <FormLabel>{hourly ? "Hourly rate" : "Day rate"}</FormLabel>
                    <FormControl>
                      {rateLocked && engagement ? (
                        <Input readOnly className="bg-muted/40" value={`${eurShort(toContractUnit(engagement).rate)}/${hourly ? "h" : "day"} signed`} />
                      ) : (
                        <Input
                          type="number"
                          min="0"
                          step="0.01"
                          {...field}
                          onChange={(e) => field.onChange(e.target.valueAsNumber || 0)}
                        />
                      )}
                    </FormControl>
                    {rateLocked && (
                      // The amended rates as text, not in the input: on a phone they would be cut off.
                      <FormDescription>
                        {rateSteps(amendments).length > 0 &&
                          `Amended: ${rateSteps(amendments).map((r) => `${eurShort(toContractUnit({ ...r, unit, contractedDays: null, defaultDaysPerMonth: 0 }).rate)} from ${mon(r.from)}`).join(" · ")}. `}
                        Change it with Amend Contract, from a month on, so invoiced months keep their price.
                      </FormDescription>
                    )}
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="defaultDaysPerMonth"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{hourly ? "Hours/month" : "Days/month"}</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min="0"
                        max={hourly ? 31 * 8 : 31}
                        step="0.5"
                        {...field}
                        onChange={(e) => field.onChange(e.target.valueAsNumber || 0)}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="contractedDays"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{isEditing ? `Signed ${noun}` : `Contracted ${noun}`}</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min="1"
                        placeholder="empty = time and materials"
                        value={field.value ?? ""}
                        onChange={(e) => field.onChange(e.target.valueAsNumber || null)}
                      />
                    </FormControl>
                    {addedDays > 0 && (
                      <FormDescription>
                        +{addedShown} from amendments{field.value != null && ` = ${field.value + addedShown}`}
                      </FormDescription>
                    )}
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="startMonth"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Start</FormLabel>
                    <FormControl>
                      <Input
                        type="month"
                        value={field.value ?? ""}
                        onChange={(e) => {
                          const next = e.target.value || null
                          // A conversion's End follows its Start while it still spans the deal's
                          // duration, as convert_to_engagement recomputes it from a new start (#154).
                          // Only while it is a month: a day typed in End date is the user's.
                          if (isConversion && !endDate && prefill?.startMonth && prefill.endMonth && field.value && next) {
                            const span = differenceInCalendarMonths(parseYearMonth(prefill.endMonth), parseYearMonth(prefill.startMonth))
                            const endFor = (start: string) => format(addMonths(parseYearMonth(start), span), "yyyy-MM")
                            if (endMonth === endFor(field.value)) form.setValue("endMonth", endFor(next))
                          }
                          field.onChange(next)
                        }}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="vatApplicable"
              render={({ field }) => (
                <FormItem className="flex items-center justify-between rounded-lg border p-3">
                  <div className="space-y-0.5">
                    <FormLabel>VAT applicable</FormLabel>
                    <p className="text-xs text-muted-foreground">22% on invoices</p>
                  </div>
                  <FormControl>
                    <Switch checked={field.value} onCheckedChange={field.onChange} />
                  </FormControl>
                </FormItem>
              )}
            />

            {isEditing && (
              <FormField
                control={form.control}
                name="isActive"
                render={({ field }) => (
                  <FormItem className="flex items-center justify-between rounded-lg border p-3">
                    <div className="space-y-0.5">
                      <FormLabel>Active</FormLabel>
                      <p className="text-xs text-muted-foreground">
                        Closed, it counts up to its end date&apos;s month: past revenue stays, and no
                        hours go after the end date
                      </p>
                    </div>
                    <FormControl>
                      <Switch
                        checked={field.value ?? true}
                        onCheckedChange={(on) => {
                          field.onChange(on)
                          setEnd(endOn(on))
                        }}
                      />
                    </FormControl>
                  </FormItem>
                )}
              />
            )}

            {/* Always on a new contract: a conversion prefills the end (#154), and it must stay
                visible to correct and to show an end-before-start error. On edit, for a closed
                contract or a planned end set over MCP. */}
            {(!isEditing || !isActive || endMonth) && (
              <FormField
                control={form.control}
                name="endDate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>End date</FormLabel>
                    <FormControl>
                      {/* Required when closing a running contract: without one it would drop out of past months too.
                          A contract ended by month (legacy, a conversion) shows that month's last day. */}
                      <Input
                        ref={field.ref}
                        type="date"
                        min={startMonth ? `${startMonth}-01` : undefined}
                        required={!isActive && !!engagement?.isActive && !notStarted}
                        value={end ?? ""}
                        onChange={(e) => setEnd(endFields(e.target.value || null))}
                      />
                    </FormControl>
                    {endsBeforeError && (
                      <FormDescription className="font-medium text-destructive">{endsBeforeError}</FormDescription>
                    )}
                    {!isActive && !end && (
                      <p className="text-xs text-muted-foreground">
                        Without an end date it leaves the plan, past months included.
                      </p>
                    )}
                    {afterEnd.length > 0 && (
                      <p className="text-xs text-amber-600 dark:text-amber-400">
                        {inContractUnit(afterEnd.reduce((sum, a) => sum + a.days, 0), unit)} {noun} planned after the end month
                        ({afterEnd.map((a) => formatYearMonth(a.yearMonth, "MMM yyyy")).join(", ")}) still count
                        as revenue: zero them in the Plan grid if they won&apos;t happen.
                      </p>
                    )}
                    {hoursAfterEnd.length > 0 && (
                      <p className="text-xs text-amber-600 dark:text-amber-400">
                        {Number(hoursAfterEnd.reduce((sum, t) => sum + t.hours, 0).toFixed(2))} h logged{" "}
                        {end ? "after the end date" : "on this contract"} (
                        {[...new Set([hoursAfterEnd[0], hoursAfterEnd.at(-1)!].map((t) => format(parseISO(t.date), "d MMM")))].join(" – ")}
                        ) stay: clear them on Plan if they won&apos;t happen.
                      </p>
                    )}
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            <FormField
              control={form.control}
              name="notes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Notes</FormLabel>
                  <FormControl>
                    <Textarea
                      rows={2}
                      value={field.value ?? ""}
                      onChange={(e) => field.onChange(e.target.value || null)}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {repriceWarnings.length > 0 && (
              <ul className="space-y-1 text-xs text-amber-700 dark:text-amber-400">
                {repriceWarnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            )}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={isPending}>
                {isPending ? "Saving…" : isEditing ? "Save" : "Create Contract"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
