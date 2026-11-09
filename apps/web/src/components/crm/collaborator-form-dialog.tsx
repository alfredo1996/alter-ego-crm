"use client"

import { eur } from "@alter-ego/kernel/currency"
import { formatYearMonth } from "@alter-ego/kernel/dates"
import { SegmentedButtons } from "@alter-ego/ui/page/segmented-buttons"
import { Button } from "@alter-ego/ui/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@alter-ego/ui/ui/dialog"
import { Input } from "@alter-ego/ui/ui/input"
import { Label } from "@alter-ego/ui/ui/label"
import { Switch } from "@alter-ego/ui/ui/switch"
import { Textarea } from "@alter-ego/ui/ui/textarea"
import { format } from "date-fns"
import { Plus } from "lucide-react"
import { useCallback, useEffect, useId, useRef, useState } from "react"

import { CollaboratorAssignments } from "@/components/crm/collaborator-assignments"
import { quarterCost } from "@/lib/collaborators"
import { createCollaboratorSchema } from "@/types/schemas"

import type { Collaborator, CollaboratorFee, CollaboratorType, CreateCollaboratorInput, FeeChange } from "@/types"

const mon = (m: string) => formatYearMonth(m, "MMM yyyy")

/** Messages by field, from the schema the backend parses with. */
type Errors = Partial<Record<"name" | "notes" | "amount" | "from" | "until" | "changes", string>>

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  collaborator?: Collaborator | null
  onSubmit: (values: CreateCollaboratorInput) => void
  isPending: boolean
  /** The Plan's net for the next 12 months with this fee in it; the dialog shows it under the fee. */
  planNet: (draft: { isActive: boolean; fee: CollaboratorFee | null }) => number
  /** Edit only: Delete beside Save, as in the mockup. */
  onDelete?: () => void
  onCloseAutoFocus?: (event: Event) => void
}

export function CollaboratorFormDialog({ open, onOpenChange, collaborator, onSubmit, isPending, planNet, onDelete, onCloseAutoFocus }: Props) {
  const isEditing = !!collaborator
  const id = useId()
  const thisMonth = format(new Date(), "yyyy-MM")
  const [name, setName] = useState("")
  const [type, setType] = useState<CollaboratorType>("freelancer")
  const [notes, setNotes] = useState("")
  const [isActive, setIsActive] = useState(true)
  const [hasFee, setHasFee] = useState(false)
  const [amount, setAmount] = useState("")
  const [from, setFrom] = useState(thisMonth)
  const [until, setUntil] = useState("")
  const [changes, setChanges] = useState<FeeChange[]>([])
  const [adding, setAdding] = useState(false)
  const [changeFrom, setChangeFrom] = useState("")
  const [changeAmount, setChangeAmount] = useState("")
  const [errors, setErrors] = useState<Errors>({})

  useEffect(() => {
    if (!open) return
    const f = collaborator?.fee
    // eslint-disable-next-line react-hooks/set-state-in-effect -- react-hooks 7 on existing code; rewrite left for 0.16
    setName(collaborator?.name ?? "")
    setType(collaborator?.type ?? "freelancer")
    setNotes(collaborator?.notes ?? "")
    setIsActive(collaborator?.isActive ?? true)
    setHasFee(!!f)
    setAmount(f ? String(f.amount) : "")
    setFrom(f?.from ?? thisMonth)
    setUntil(f?.until ?? "")
    setChanges(f?.changes ?? [])
    setAdding(false)
    setErrors({})
  }, [open, collaborator, thisMonth])

  const draftFee = (list: FeeChange[]): CollaboratorFee | null =>
    hasFee ? { amount: Number(amount) || 0, from, until: until || null, changes: list } : null

  /** First message per field. A change's own message sits under Changes. */
  const check = (input: CreateCollaboratorInput): Errors => {
    const parsed = createCollaboratorSchema.safeParse(input)
    if (parsed.success) return {}
    const out: Errors = {}
    for (const issue of parsed.error.issues) {
      const [head, sub] = issue.path
      const key = head === "fee" ? (sub === "changes" ? "changes" : (sub as keyof Errors)) : (head as keyof Errors)
      out[key] ??= issue.message
    }
    return out
  }
  const input = (list: FeeChange[]): CreateCollaboratorInput => ({ name, type, notes: notes.trim() || null, isActive, fee: draftFee(list) })

  const addChange = () => {
    const next = [...changes, { from: changeFrom, amount: Number(changeAmount) || 0 }].sort((a, b) => a.from.localeCompare(b.from))
    const found = check(input(next))
    if (found.changes || found.amount || found.from || found.until) {
      setErrors({ ...errors, changes: found.changes ?? "Check the fee first" })
      return
    }
    setChanges(next)
    setAdding(false)
    setChangeFrom("")
    setChangeAmount("")
    setErrors({ ...errors, changes: undefined })
  }

  // An assignment typed into its own form and not saved would be dropped by Save, silently.
  const assignmentDirty = useRef(false)
  const [assignmentPending, setAssignmentPending] = useState(false)
  const onAssignmentDirty = useCallback((dirty: boolean) => {
    assignmentDirty.current = dirty
    if (!dirty) setAssignmentPending(false)
  }, [])

  const submit = (ev: React.FormEvent) => {
    ev.preventDefault()
    if (assignmentDirty.current) {
      setAssignmentPending(true)
      return
    }
    const found = check(input(changes))
    // A change typed into the inline pair and not saved would be lost silently.
    if (adding && (changeFrom || changeAmount)) found.changes = "Save or cancel the change first"
    setErrors(found)
    if (Object.keys(found).length === 0) onSubmit(createCollaboratorSchema.parse(input(changes)))
  }

  const fee = draftFee(changes)
  const valid = hasFee && Object.keys(check(input(changes))).length === 0
  const year = new Date().getFullYear()
  const quarter = (Math.floor(new Date().getMonth() / 3) + 1) as 1 | 2 | 3 | 4
  const preview = valid && fee
    ? {
        // Both follow the Active switch, as the card does: an inactive collaborator costs nothing.
        quarter: quarterCost({ isActive, fee } as Collaborator, year, quarter),
        year: ([1, 2, 3, 4] as const).reduce((sum, q) => sum + quarterCost({ isActive, fee } as Collaborator, year, q), 0),
        net: planNet({ isActive, fee }),
      }
    : null

  const error = (key: keyof Errors) => (errors[key] ? <p id={`${id}-${key}`} role="alert" className="text-sm text-danger">{errors[key]}</p> : null)
  const described = (key: keyof Errors) => (errors[key] ? `${id}-${key}` : undefined)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm" onCloseAutoFocus={onCloseAutoFocus}>
        <DialogHeader>
          <DialogTitle>{isEditing ? "Edit Collaborator" : "New Collaborator"}</DialogTitle>
          <DialogDescription>Fees are net of VAT. Nothing here is a payslip or a tax figure.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4" noValidate>
          <div className="space-y-2">
            <Label htmlFor={`${id}-name`}>Name</Label>
            <Input id={`${id}-name`} placeholder="e.g. Studio Verdi" value={name} aria-invalid={!!errors.name} aria-describedby={described("name")} onChange={(e) => setName(e.target.value)} />
            {error("name")}
          </div>
          <div className="space-y-2">
            <span id={`${id}-type`} className="text-sm font-medium">Type</span>
            <div>
              <SegmentedButtons
                aria-labelledby={`${id}-type`}
                value={type}
                onChange={setType}
                options={[{ value: "freelancer", label: "Freelancer" }, { value: "company", label: "Company" }]}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${id}-notes`}>Notes</Label>
            <Textarea id={`${id}-notes`} rows={2} value={notes} aria-invalid={!!errors.notes} aria-describedby={described("notes")} onChange={(e) => setNotes(e.target.value)} />
            {error("notes")}
          </div>

          <fieldset className="space-y-3 rounded-lg border p-3.5">
            <div className="flex items-center justify-between gap-3">
              <legend className="text-sm font-medium">Fixed fee</legend>
              <span className="flex items-center gap-2 text-sm text-subtle-foreground">
                <Switch id={`${id}-has-fee`} checked={hasFee} onCheckedChange={setHasFee} />
                <Label htmlFor={`${id}-has-fee`} className="font-normal">A fee every month</Label>
              </span>
            </div>
            {hasFee && (
              <>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <div className="space-y-2">
                    <Label htmlFor={`${id}-amount`}>A month</Label>
                    <Input id={`${id}-amount`} type="number" inputMode="decimal" min="0" step="any" placeholder="2400" value={amount} aria-invalid={!!errors.amount} aria-describedby={described("amount")} onChange={(e) => setAmount(e.target.value)} />
                    {error("amount")}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor={`${id}-from`}>From</Label>
                    <Input id={`${id}-from`} type="month" value={from} aria-invalid={!!errors.from} aria-describedby={described("from")} onChange={(e) => setFrom(e.target.value)} />
                    {error("from")}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor={`${id}-until`}>Until</Label>
                    <Input id={`${id}-until`} type="month" value={until} aria-invalid={!!errors.until} aria-describedby={described("until")} onChange={(e) => setUntil(e.target.value)} />
                    {error("until")}
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm font-medium">Changes</span>
                    {!adding && (
                      <Button type="button" variant="ghost" size="sm" onClick={() => setAdding(true)}>
                        <Plus aria-hidden /> Add Change
                      </Button>
                    )}
                  </div>
                  {changes.length > 0 && (
                    <ul className="space-y-1.5">
                      {changes.map((c) => (
                        <li key={c.from} className="flex items-center gap-3 rounded-md bg-muted px-3 py-2 text-sm">
                          <span className="font-medium">From {mon(c.from)}</span>
                          <span className="flex-1 tabular-nums">{eur(c.amount)} a month</span>
                          <Button type="button" variant="ghost" size="sm" aria-label={`Remove the change from ${mon(c.from)}`} onClick={() => setChanges(changes.filter((x) => x !== c))}>
                            Remove
                          </Button>
                        </li>
                      ))}
                    </ul>
                  )}
                  {adding && (
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
                      <div className="space-y-2">
                        <Label htmlFor={`${id}-change-from`}>Change From</Label>
                        <Input id={`${id}-change-from`} type="month" value={changeFrom} aria-invalid={!!errors.changes} aria-describedby={described("changes")} onChange={(e) => setChangeFrom(e.target.value)} />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor={`${id}-change-amount`}>New Amount a Month</Label>
                        <Input id={`${id}-change-amount`} type="number" inputMode="decimal" min="0" step="any" value={changeAmount} aria-invalid={!!errors.changes} aria-describedby={described("changes")} onChange={(e) => setChangeAmount(e.target.value)} />
                      </div>
                      <div className="flex gap-2">
                        <Button type="button" variant="outline" onClick={addChange}>Save Change</Button>
                        <Button type="button" variant="ghost" onClick={() => { setAdding(false); setChangeFrom(""); setChangeAmount(""); setErrors({ ...errors, changes: undefined }) }}>Cancel Change</Button>
                      </div>
                    </div>
                  )}
                  {error("changes")}
                  <p className="text-meta text-muted-foreground">A change applies from its month on, until the next change or the end.</p>
                </div>

                {preview && (
                  <p className="text-sm text-subtle-foreground tabular-nums" aria-label="Fixed cost preview">
                    Q{quarter} {year} <b className="text-foreground">{eur(preview.quarter)}</b> · {year}{" "}
                    <b className="text-foreground">{eur(preview.year)}</b> · Plan net, next 12 months{" "}
                    <b className="text-foreground">{eur(preview.net)}</b>
                  </p>
                )}
              </>
            )}
          </fieldset>

          {isEditing && collaborator && <CollaboratorAssignments collaborator={collaborator} onDirtyChange={onAssignmentDirty} />}
          {assignmentPending && <p role="alert" className="text-sm text-danger">Save or cancel the assignment first</p>}

          <div className="flex items-center justify-between gap-3">
            <Label htmlFor={`${id}-active`}>Active</Label>
            <span className="flex items-center gap-2 text-sm text-subtle-foreground">
              <Switch id={`${id}-active`} checked={isActive} onCheckedChange={setIsActive} />
              Shown in the list and the plan
            </span>
          </div>

          <DialogFooter className="sm:justify-between">
            {isEditing && onDelete ? (
              <Button type="button" variant="ghost" className="text-danger" onClick={onDelete}>
                Delete
              </Button>
            ) : (
              <span />
            )}
            <span className="flex flex-col-reverse gap-2 sm:flex-row">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={isPending}>
                {isPending ? "Saving…" : isEditing ? "Save" : "Create Collaborator"}
              </Button>
            </span>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
