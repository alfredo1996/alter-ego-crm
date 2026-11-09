"use client"

import { Label } from "@alter-ego/ui/ui/label"
import { format, parseISO } from "date-fns"
import { useState } from "react"

import type { ReactNode } from "react"
import type { z } from "zod"

/** 25/09/2027, as the dialogs say a date. */
export const dayLabel = (iso: string) => format(parseISO(iso), "dd/MM/yyyy")
/** Sep 2026, as the page says a lease's ends. */
export const monthLabel = (iso: string) => format(parseISO(iso), "MMM yyyy")

/** The first message per field of a failed parse. */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {}
  for (const issue of error.issues) out[String(issue.path[0])] ??= issue.message
  return out
}

/** A label, its control, a hint and the field's error, tied by id. */
export function Field({ id, label, hint, error, children }: { id: string; label: ReactNode; hint?: ReactNode; error?: string; children: ReactNode }) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint && <p id={`${id}-hint`} className="text-meta text-muted-foreground">{hint}</p>}
      {error && (
        <p id={`${id}-error`} role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  )
}

/** Runs a save, closing on success and saying why on failure. */
export function useSubmit(onDone: () => void) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const run = async (save: () => Promise<unknown>) => {
    setBusy(true)
    setError(null)
    try {
      await save()
      onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save")
    } finally {
      setBusy(false)
    }
  }
  return { busy, error, run }
}

/** "" -> undefined, so a blank money field is "no contribution", not 0. */
export const toAmount = (s: string) => (s.trim() === "" ? undefined : Number(s))
