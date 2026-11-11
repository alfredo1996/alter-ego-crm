"use client"

import { Button } from "@alter-ego/ui/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@alter-ego/ui/ui/dialog"
import { Input } from "@alter-ego/ui/ui/input"
import { Label } from "@alter-ego/ui/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@alter-ego/ui/ui/select"
import { Textarea } from "@alter-ego/ui/ui/textarea"
import { ArrowLeft, ArrowRight } from "lucide-react"
import { useState } from "react"

import { STEP_STATE } from "@/components/crm/solution-road"
import { saveStep, type StepDraft } from "@/lib/solutions"

import type { SolutionStep, SolutionStepPayer } from "@/types"

/** A contract or an opportunity of the solution's client that can pay for a step. */
export interface StepPayerOption extends SolutionStepPayer {
  label: string
}

const NONE = "none"
const key = (p: SolutionStepPayer) => `${p.type}:${p.id}`

interface Props {
  /** The step being edited; "new" adds one at the end; null = closed. */
  index: number | "new" | null
  /** Changes at each opening, so a draft never outlives the dialog it was typed in. */
  session: number
  steps: SolutionStep[]
  solutionName: string
  payers: StepPayerOption[]
  today: string
  /** Writes the road. False when it failed. */
  onSave: (steps: SolutionStep[]) => Promise<boolean>
  onMove: (from: number, to: number) => void
  onDelete: (index: number) => void
  onClose: () => void
}

export function StepDialog({ index, session, ...rest }: Props) {
  return (
    <Dialog open={index !== null} onOpenChange={(o) => !o && rest.onClose()}>
      {index !== null && <StepBody key={session} index={index} {...rest} />}
    </Dialog>
  )
}

function StepBody({ index, steps, solutionName, payers, today, onSave, onMove, onDelete, onClose }: Omit<Props, "session" | "index"> & { index: number | "new" }) {
  const step = index === "new" ? undefined : steps[index]
  const [draft, setDraft] = useState<StepDraft>({
    title: step?.title ?? "",
    state: step?.state ?? "next",
    fromMonth: step?.fromMonth ?? today.slice(0, 7),
    toMonth: step?.toMonth ?? "",
    paidBy: step?.paidBy ?? null,
    goal: step?.goal ?? "",
    outcome: step?.outcome ?? "",
  })
  const [errors, setErrors] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const set = (patch: Partial<StepDraft>) => setDraft((d) => ({ ...d, ...patch }))
  const position = index === "new" ? steps.length + 1 : index + 1
  // A payer the step already has but the client no longer offers (a lost opportunity) stays choosable.
  const options = step?.paidBy && !payers.some((p) => key(p) === key(step.paidBy!)) ? [...payers, { ...step.paidBy, label: "No longer listed" }] : payers

  async function submit() {
    const result = saveStep(steps, index === "new" ? null : index, draft, today)
    if ("errors" in result) return setErrors(result.errors)
    setErrors([])
    setSaving(true)
    const saved = await onSave(result.steps)
    setSaving(false)
    if (!saved) setErrors(["Save failed. Try again."])
  }

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle className="pr-6">{index === "new" ? "Add Step" : "Edit Step"}</DialogTitle>
        <DialogDescription>
          {index === "new" ? `Step ${position} on ${solutionName}, at the end of the road.` : `Step ${position} of ${steps.length} on ${solutionName}. Drag steps on the roadmap to reorder them.`}
        </DialogDescription>
      </DialogHeader>
      <form
        noValidate
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        <div className="space-y-2">
          <Label htmlFor="step-title">Title</Label>
          <Input id="step-title" value={draft.title} maxLength={200} autoFocus={index === "new"} onChange={(e) => set({ title: e.target.value })} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="step-state">State</Label>
          <Select value={draft.state} onValueChange={(v) => set({ state: v as StepDraft["state"] })}>
            <SelectTrigger id="step-state">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(STEP_STATE).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            One step is Now at a time. Marking it Done asks for its outcome and moves Now to the next step.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label htmlFor="step-from">From</Label>
            <Input id="step-from" type="month" value={draft.fromMonth} onChange={(e) => set({ fromMonth: e.target.value })} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="step-to">To (optional)</Label>
            <Input id="step-to" type="month" value={draft.toMonth} onChange={(e) => set({ toMonth: e.target.value })} />
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="step-paid-by">Paid by (optional)</Label>
          <Select
            value={draft.paidBy ? key(draft.paidBy) : NONE}
            onValueChange={(v) => {
              const hit = options.find((p) => key(p) === v)
              set({ paidBy: hit ? { type: hit.type, id: hit.id } : null })
            }}
          >
            <SelectTrigger id="step-paid-by">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>Nobody yet</SelectItem>
              {options.map((p) => (
                <SelectItem key={key(p)} value={key(p)}>
                  {p.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            A contract or an opportunity of this client. When the opportunity is won, the step follows its contract: days, invoices and health.
          </p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="step-goal">Goal</Label>
          <Textarea id="step-goal" rows={2} maxLength={1000} value={draft.goal} onChange={(e) => set({ goal: e.target.value })} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="step-outcome">Outcome</Label>
          <Textarea
            id="step-outcome"
            rows={2}
            maxLength={1000}
            value={draft.outcome}
            placeholder="What came of it. Asked for when the step is Done."
            onChange={(e) => set({ outcome: e.target.value })}
          />
        </div>
        {errors.length > 0 && (
          <ul role="alert" className="space-y-1 text-sm text-destructive">
            {errors.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        )}
        {index !== "new" && (
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" disabled={index === 0} onClick={() => onMove(index, index - 1)}>
              <ArrowLeft aria-hidden /> Move Earlier
            </Button>
            <Button type="button" variant="outline" disabled={index === steps.length - 1} onClick={() => onMove(index, index + 1)}>
              Move Later <ArrowRight aria-hidden />
            </Button>
          </div>
        )}
        <DialogFooter className="sm:justify-between">
          {index !== "new" ? (
            <Button type="button" variant="ghost" className="text-destructive" onClick={() => onDelete(index)}>
              Delete Step
            </Button>
          ) : (
            <span />
          )}
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              Save Step
            </Button>
          </div>
        </DialogFooter>
      </form>
    </DialogContent>
  )
}
