"use client"

import { Button } from "@alter-ego/ui/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@alter-ego/ui/ui/dialog"
import { Input } from "@alter-ego/ui/ui/input"
import { useId, useState } from "react"

import { createTenantSchema } from "../schemas"
import { Field, fieldErrors, useSubmit } from "./form-kit"

import type { CreateTenantInput, Tenant } from "../types"

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Editing this tenant; null = a new one. */
  tenant: Tenant | null
  onSubmit: (input: CreateTenantInput) => Promise<unknown>
}

export function TenantDialog({ open, onOpenChange, tenant, onSubmit }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">{open && <TenantForm tenant={tenant} onClose={() => onOpenChange(false)} onSubmit={onSubmit} />}</DialogContent>
    </Dialog>
  )
}

// Mounted only while the dialog is open, so every opening starts from the tenant's stored values.
function TenantForm({ tenant, onClose, onSubmit }: { tenant: Tenant | null; onClose: () => void; onSubmit: Props["onSubmit"] }) {
  const id = useId()
  const [v, setV] = useState({
    firstName: tenant?.firstName ?? "",
    surname: tenant?.surname ?? "",
    taxId: tenant?.taxId ?? "",
    street: tenant?.street ?? "",
    postcode: tenant?.postcode ?? "",
    city: tenant?.city ?? "",
    province: tenant?.province ?? "",
    country: tenant?.country ?? "",
  })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const { busy, error, run } = useSubmit(onClose)

  const input = (key: keyof typeof v, label: string, extra?: { hint?: string; placeholder?: string }) => (
    <Field id={`${id}-${key}`} label={label} hint={extra?.hint} error={errors[key]}>
      <Input
        id={`${id}-${key}`}
        value={v[key]}
        placeholder={extra?.placeholder}
        aria-invalid={!!errors[key]}
        aria-describedby={errors[key] ? `${id}-${key}-error` : extra?.hint ? `${id}-${key}-hint` : undefined}
        onChange={(e) => setV({ ...v, [key]: e.target.value })}
      />
    </Field>
  )

  const submit = (ev: React.FormEvent) => {
    ev.preventDefault()
    const parsed = createTenantSchema.safeParse(v)
    if (!parsed.success) return setErrors(fieldErrors(parsed.error))
    setErrors({})
    void run(() => onSubmit(parsed.data))
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{tenant ? "Edit Tenant" : "New Tenant"}</DialogTitle>
        <DialogDescription>What goes on their invoice. Only the name is needed now; add the rest when you have it.</DialogDescription>
      </DialogHeader>
      <form onSubmit={submit} className="space-y-4" noValidate>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {input("firstName", "First Name")}
          {input("surname", "Surname")}
        </div>
        {input("taxId", "Tax ID (optional)", { hint: "Codice fiscale, or a foreign ID as on their document. Not checked." })}
        <fieldset className="space-y-3">
          <legend className="mb-2 text-sm font-medium">Residence (optional)</legend>
          {input("street", "Street and Number")}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {input("postcode", "Postcode")}
            {input("city", "City")}
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {input("province", "Province", { placeholder: "e.g. FI" })}
            {input("country", "Country")}
          </div>
        </fieldset>
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy}>
            {busy ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </form>
    </>
  )
}
