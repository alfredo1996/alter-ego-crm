"use client"

import { eurShort } from "@alter-ego/kernel/currency"
import { Button } from "@alter-ego/ui/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@alter-ego/ui/ui/dialog"
import { Input } from "@alter-ego/ui/ui/input"
import { Label } from "@alter-ego/ui/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@alter-ego/ui/ui/select"
import { useId, useState } from "react"

import { notSetWords, roomPart, tenantNotSet } from "../details"
import { canonicalProperty } from "../lease"
import { withoutMonth } from "../rent"
import { createLeaseSchema } from "../schemas"
import { Field, fieldErrors, monthLabel, toAmount, useSubmit } from "./form-kit"
import { PropertyField } from "./property-field"

import type { PropertyChoice } from "./property-field"
import type { CreateLeaseInput, Lease, Tenant } from "../types"

export const tenantName = (t: Pick<Tenant, "firstName" | "surname">) => `${t.firstName} ${t.surname}`

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Editing this lease; null = a new one. */
  lease: Lease | null
  tenants: Tenant[]
  properties: PropertyChoice[]
  onSubmit: (input: CreateLeaseInput) => Promise<unknown>
  /** Opens New Tenant; `picked` selects the tenant that gets created. */
  onNewTenant: (picked: (tenantId: string) => void) => void
  /** Opens the picked tenant to edit. */
  onEditTenant: (tenant: Tenant) => void
  /** Edit only: the two things done to a lease besides editing it. */
  onRenew: () => void
  onEndTenancy: () => void
  /** Edit only: where the lease stands, e.g. "Deposit held €2,000 · owed €0 · ends in 11 months". */
  standing?: string | null
}

export function LeaseDialog({ open, onOpenChange, ...rest }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        size="md"
        // Radix closes on Escape before the property list sees the key; while that list is open, Escape closes only the list.
        onEscapeKeyDown={(e) => document.activeElement?.getAttribute("aria-expanded") === "true" && e.preventDefault()}
      >{open && <LeaseForm {...rest} onClose={() => onOpenChange(false)} />}</DialogContent>
    </Dialog>
  )
}

// Mounted only while the dialog is open, so every opening starts from the lease's stored values.
function LeaseForm({ lease, tenants, properties, onSubmit, onNewTenant, onEditTenant, onRenew, onEndTenancy, standing, onClose }: Omit<Props, "open" | "onOpenChange"> & { onClose: () => void }) {
  const id = useId()
  const [v, setV] = useState({
    tenantId: lease?.tenantId ?? "",
    property: lease?.property ?? "",
    room: lease?.room ?? "",
    rent: lease ? String(lease.rent) : "",
    contribution: lease?.contribution != null ? String(lease.contribution) : "",
    paidBy: lease?.paidBy ?? "",
    startDate: lease?.startDate ?? "",
    endDate: lease?.endDate ?? "",
  })
  const [agreed, setAgreed] = useState(lease?.agreedMonths ?? {})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const { busy, error, run } = useSubmit(onClose)
  const set = (patch: Partial<typeof v>) => setV((old) => ({ ...old, ...patch }))
  const tenant = tenants.find((t) => t.id === v.tenantId)
  const tenantWords = tenant ? notSetWords(tenantNotSet(tenant)) : null
  const described = (key: string) => (errors[key] ? `${id}-${key}-error` : undefined)

  const text = (key: "room" | "paidBy" | "startDate" | "endDate", label: string, extra?: { hint?: string; placeholder?: string; type?: string }) => (
    <Field id={`${id}-${key}`} label={label} hint={extra?.hint} error={errors[key]}>
      <Input
        id={`${id}-${key}`}
        type={extra?.type}
        value={v[key]}
        placeholder={extra?.placeholder}
        aria-invalid={!!errors[key]}
        aria-describedby={described(key) ?? (extra?.hint ? `${id}-${key}-hint` : undefined)}
        onChange={(e) => set({ [key]: e.target.value })}
      />
    </Field>
  )
  const money = (key: "rent" | "contribution", label: string, placeholder?: string) => (
    <Field id={`${id}-${key}`} label={label} error={errors[key]}>
      <Input
        id={`${id}-${key}`}
        type="number"
        inputMode="decimal"
        min="0"
        step="any"
        value={v[key]}
        placeholder={placeholder}
        aria-invalid={!!errors[key]}
        aria-describedby={described(key)}
        onChange={(e) => set({ [key]: e.target.value })}
      />
    </Field>
  )

  const submit = (ev: React.FormEvent) => {
    ev.preventDefault()
    const parsed = createLeaseSchema.safeParse({
      ...v,
      agreedMonths: agreed,
      rent: toAmount(v.rent),
      contribution: toAmount(v.contribution),
    })
    if (!parsed.success) return setErrors(fieldErrors(parsed.error))
    setErrors({})
    void run(() => onSubmit({ ...parsed.data, property: canonicalProperty(parsed.data.property, properties.map((p) => p.name)) }))
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{lease ? "Edit Lease" : "New Lease"}</DialogTitle>
        <DialogDescription>
          {lease && tenant ? `${tenantName(tenant)}${roomPart(lease.room)} · ${lease.property}` : "Who rents which room, at what rent, for how long."}
        </DialogDescription>
      </DialogHeader>
      <form onSubmit={submit} className="space-y-4" noValidate>
        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
            <Label htmlFor={`${id}-tenant`}>Tenant</Label>
            <span className="flex flex-wrap gap-x-3 gap-y-1">
              {tenant && (
                <Button type="button" variant="link" size="sm" className="h-auto p-0" onClick={() => onEditTenant(tenant)}>
                  Edit Tenant
                  {tenantWords && <span className="font-normal text-warning-soft-foreground"> · {tenantWords}</span>}
                </Button>
              )}
              <Button type="button" variant="link" size="sm" className="h-auto p-0" onClick={() => onNewTenant((tenantId) => set({ tenantId }))}>
                New Tenant
              </Button>
            </span>
          </div>
          {/* Radix reports "" while the value has no option yet (a tenant just created, before the list refetches). */}
          <Select value={v.tenantId} onValueChange={(tenantId) => tenantId && set({ tenantId })}>
            <SelectTrigger id={`${id}-tenant`} aria-invalid={!!errors.tenantId} aria-describedby={described("tenantId")}>
              <SelectValue placeholder={tenants.length ? "Pick a tenant" : "Add a tenant first"} />
            </SelectTrigger>
            <SelectContent>
              {tenants.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {tenantName(t)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {errors.tenantId && <p id={`${id}-tenantId-error`} role="alert" className="text-sm text-danger">{errors.tenantId}</p>}
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field id={`${id}-property`} label="Property" hint="Pick a house, or type a new name to add one. It's also the cost centre." error={errors.property}>
            <PropertyField
              id={`${id}-property`}
              value={v.property}
              onChange={(property) => set({ property })}
              properties={properties}
              invalid={!!errors.property}
              describedBy={described("property") ?? `${id}-property-hint`}
            />
          </Field>
          {text("room", "Room (optional)")}
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {money("rent", "Rent a Month")}
          {money("contribution", "Contribution a Month (optional)", "None")}
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {text("startDate", "Start", { type: "date" })}
          {text("endDate", "End", { type: "date" })}
        </div>
        {text("paidBy", "Paid By (optional)", { hint: "Who sends the money, when it isn't the tenant. The invoice still goes to the tenant.", placeholder: "The tenant" })}

        {lease && (
          <section aria-label="Agreed Months" className="space-y-2">
            <h3 className="text-sm font-medium">Agreed Months</h3>
            {Object.keys(agreed).length === 0 ? (
              <p className="text-meta text-muted-foreground">None. Set one from a month on the grid: it replaces rent and contribution for that month only.</p>
            ) : (
              <ul className="divide-y rounded-lg border text-sm">
                {Object.entries(agreed)
                  .sort(([a], [b]) => a.localeCompare(b))
                  .map(([m, a]) => (
                    <li key={m} className="flex items-center justify-between gap-3 px-3 py-2">
                      <span>
                        <b>{monthLabel(`${m}-01`)}</b> {eurShort(a.amount)} instead of {eurShort(lease.rent + (lease.contribution ?? 0))}
                        {a.note && ` · ${a.note}`}
                      </span>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        aria-label={`Remove agreed amount for ${monthLabel(`${m}-01`)}`}
                        onClick={() => setAgreed((old) => withoutMonth(old, m))}
                      >
                        Remove
                      </Button>
                    </li>
                  ))}
              </ul>
            )}
          </section>
        )}

        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
        {lease && standing && <p className="text-meta text-muted-foreground">{standing}</p>}
        <DialogFooter className="sm:justify-between">
          {lease ? (
            <span className="flex flex-col gap-2 sm:flex-row">
              <Button type="button" variant="outline" onClick={onRenew}>
                Renew
              </Button>
              <Button type="button" variant="outline" onClick={onEndTenancy}>
                End Tenancy
              </Button>
            </span>
          ) : (
            <span />
          )}
          <span className="flex flex-col-reverse gap-2 sm:flex-row">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? "Saving…" : "Save"}
            </Button>
          </span>
        </DialogFooter>
      </form>
    </>
  )
}
