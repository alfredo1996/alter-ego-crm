"use client"

import { isoDate } from "@alter-ego/kernel/dates"
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
import { Form, FormField, FormItem, FormLabel, FormControl, FormMessage } from "@alter-ego/ui/ui/form"
import { Input } from "@alter-ego/ui/ui/input"
import { Label } from "@alter-ego/ui/ui/label"
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@alter-ego/ui/ui/select"
import { Switch } from "@alter-ego/ui/ui/switch"
import { Textarea } from "@alter-ego/ui/ui/textarea"
import { zodResolver } from "@hookform/resolvers/zod"
import { useEffect, useId } from "react"
import { type Resolver, useForm, useWatch } from "react-hook-form"
import { type z } from "zod"

import { ClientCombobox } from "@/components/crm/client-combobox"
import { contractUnit, fromContractUnit, toContractUnit } from "@/lib/engagements"
import { STAGE_LABELS, STAGE_PROBABILITY } from "@/lib/opportunities"
import { createOpportunitySchema } from "@/types/schemas"

import type { Client, Opportunity, OpportunityStage } from "@/types"

type FormValues = z.infer<typeof createOpportunitySchema>

/**
 * What the form holds and shows is in the deal's unit (€/h and hours a month on an hourly one);
 * what it stores is days. The resolver turns the one into the other, so onSubmit gets days.
 */
const toStored = (v: FormValues): FormValues => {
  const t = fromContractUnit({ unit: v.unit, rate: v.dailyRate, contracted: null, perMonth: v.estimatedDaysPerMonth })
  return { ...v, dailyRate: t.dailyRate, estimatedDaysPerMonth: t.defaultDaysPerMonth }
}
const toShown = (v: FormValues): FormValues => {
  const t = toContractUnit({ unit: v.unit, dailyRate: v.dailyRate, defaultDaysPerMonth: v.estimatedDaysPerMonth, contractedDays: null })
  return { ...v, dailyRate: t.rate, estimatedDaysPerMonth: t.perMonth }
}

const STAGES: OpportunityStage[] = ["lead", "proposal", "negotiation", "won", "lost"]

const EMPTY: FormValues = {
  clientId: "",
  title: "",
  stage: "lead",
  probability: STAGE_PROBABILITY.lead,
  unit: "day",
  dailyRate: 500,
  estimatedDaysPerMonth: 10,
  estimatedDurationMonths: 6,
  expectedStartMonth: null,
  vatApplicable: true,
  nextActionDate: null,
  nextActionNote: null,
  notes: null,
  lostReason: null,
}

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  opportunity?: Opportunity | null
  /** A new one starts on this client: the client page's New Opportunity. */
  defaultClientId?: string
  clients: Client[]
  onCreateClient: (name: string) => Promise<string>
  onSubmit: (values: FormValues) => void
  isPending: boolean
  /** Where focus goes on close, for a dialog opened from a menu whose item is gone by then. */
  onCloseAutoFocus?: (event: Event) => void
}

export function OpportunityFormDialog({
  open,
  onOpenChange,
  opportunity,
  defaultClientId,
  clients,
  onCreateClient,
  onSubmit,
  isPending,
  onCloseAutoFocus,
}: Props) {
  const isEditing = !!opportunity
  const unitLabelId = useId()
  const form = useForm<FormValues>({
    resolver: (values, context, options) => (zodResolver(createOpportunitySchema) as Resolver<FormValues>)(toStored(values), context, options),
    defaultValues: EMPTY,
  })
  const unit = useWatch({ control: form.control, name: "unit" }) ?? "day"
  const hourly = unit === "hour"
  const dailyRate = useWatch({ control: form.control, name: "dailyRate" })
  const perMonth = useWatch({ control: form.control, name: "estimatedDaysPerMonth" })
  const currentStage = useWatch({ control: form.control, name: "stage" })

  useEffect(() => {
    if (!open) return
    form.reset(
      toShown(
        opportunity
        ? {
            clientId: opportunity.clientId,
            title: opportunity.title,
            stage: opportunity.stage,
            probability: opportunity.probability,
            unit: contractUnit(opportunity),
            dailyRate: opportunity.dailyRate,
            estimatedDaysPerMonth: opportunity.estimatedDaysPerMonth,
            estimatedDurationMonths: opportunity.estimatedDurationMonths,
            expectedStartMonth: opportunity.expectedStartMonth,
            vatApplicable: opportunity.vatApplicable,
            nextActionDate: opportunity.nextActionDate,
            nextActionNote: opportunity.nextActionNote,
            notes: opportunity.notes,
            lostReason: opportunity.lostReason,
          }
        : { ...EMPTY, clientId: defaultClientId ?? "" },
      ),
    )
  }, [open, opportunity, defaultClientId, form])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm" onCloseAutoFocus={onCloseAutoFocus}>
        <DialogHeader>
          <DialogTitle>{isEditing ? "Edit Opportunity" : "New Opportunity"}</DialogTitle>
          <DialogDescription>
            The estimate has the same shape as a contract, so it enters the projection
            right away, weighted by its probability.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
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
              name="title"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Title</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g. Retainer renewal 2027" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="stage"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Stage</FormLabel>
                    <Select
                      value={field.value}
                      onValueChange={(stage: OpportunityStage) => {
                        field.onChange(stage)
                        // Seed the odds from the stage; the user can still override.
                        form.setValue("probability", STAGE_PROBABILITY[stage])
                      }}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {STAGES.map((stage) => (
                          <SelectItem key={stage} value={stage}>
                            {STAGE_LABELS[stage]}
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
                name="probability"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Probability (%)</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min="0"
                        max="100"
                        {...field}
                        onChange={(e) => field.onChange(e.target.valueAsNumber || 0)}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {/* Chosen when the deal is created; it stays in its unit after, and its contract follows it. */}
            {!isEditing && (
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
                      const t = fromContractUnit({ unit, rate: dailyRate, contracted: null, perMonth })
                      const shown = toShown({ ...form.getValues(), unit: next, dailyRate: t.dailyRate, estimatedDaysPerMonth: t.defaultDaysPerMonth })
                      form.setValue("unit", next)
                      form.setValue("dailyRate", shown.dailyRate)
                      form.setValue("estimatedDaysPerMonth", shown.estimatedDaysPerMonth)
                    }}
                  />
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <FormField
                control={form.control}
                name="dailyRate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{hourly ? "Hourly rate" : "Day rate"}</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min="0"
                        step="0.01"
                        {...field}
                        onChange={(e) => field.onChange(e.target.valueAsNumber || 0)}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="estimatedDaysPerMonth"
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
              <FormField
                control={form.control}
                name="estimatedDurationMonths"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Duration (months)</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min="1"
                        max="120"
                        {...field}
                        onChange={(e) => field.onChange(e.target.valueAsNumber || 1)}
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
                name="expectedStartMonth"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Expected start</FormLabel>
                    <FormControl>
                      <Input
                        type="month"
                        value={field.value ?? ""}
                        onChange={(e) => field.onChange(e.target.value || null)}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="nextActionDate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Next action</FormLabel>
                    <FormControl>
                      <Input
                        type="date"
                        value={field.value instanceof Date ? isoDate(field.value) : ""}
                        onChange={(e) =>
                          field.onChange(e.target.value ? new Date(e.target.value + "T00:00:00") : null)
                        }
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="nextActionNote"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>What to do</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="e.g. call back after the board meeting"
                      value={field.value ?? ""}
                      onChange={(e) => field.onChange(e.target.value || null)}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Only meaningful once the deal is lost, and the pipeline row renders it. */}
            {currentStage === "lost" && (
              <FormField
                control={form.control}
                name="lostReason"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Why it was lost</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="e.g. price too high"
                        value={field.value ?? ""}
                        onChange={(e) => field.onChange(e.target.value || null)}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

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

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={isPending}>
                {isPending ? "Saving…" : isEditing ? "Save" : "Create Opportunity"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
