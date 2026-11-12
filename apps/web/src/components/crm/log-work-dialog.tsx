"use client"

import { Button } from "@alter-ego/ui/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@alter-ego/ui/ui/dialog"
import { Input } from "@alter-ego/ui/ui/input"
import { Label } from "@alter-ego/ui/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@alter-ego/ui/ui/select"
import { Textarea } from "@alter-ego/ui/ui/textarea"
import { toast } from "@alter-ego/ui/use-toast"
import { useState } from "react"

import { useCreateJournalEntry, useUpdateJournalEntry } from "@/hooks/use-journal"
import { linesOf, stepNumberOf } from "@/lib/solution-journal"
import { nowStep } from "@/lib/solutions"
import {
  JOURNAL_LINE_MAX,
  JOURNAL_TEXT_MAX,
  createJournalEntrySchema,
  updateJournalEntrySchema,
} from "@/types/schemas"

import type { JournalEntry, Solution } from "@/types"

const NO_STEP = "none"

interface Props {
  /** The entry being edited; "new" files one; null = closed. */
  entry: JournalEntry | "new" | null
  /** Changes at each opening, so a draft never outlives the dialog it was typed in. */
  session: number
  solution: Solution
  userId: string | undefined
  today: string
  onClose: () => void
}

export function LogWorkDialog({ entry, session, ...rest }: Props) {
  return (
    <Dialog open={entry !== null} onOpenChange={(o) => !o && rest.onClose()}>
      {entry !== null && <LogWorkBody key={session} entry={entry} {...rest} />}
    </Dialog>
  )
}

function LogWorkBody({ entry, solution, userId, today, onClose }: Omit<Props, "session" | "entry"> & { entry: JournalEntry | "new" }) {
  const create = useCreateJournalEntry(userId)
  const update = useUpdateJournalEntry(userId)
  const editing = entry === "new" ? null : entry
  // A decision entry is one line; a new session defaults to the Now step.
  const isDecision = editing?.kind === "decision"
  const now = nowStep(solution.steps)
  const [did, setDid] = useState(editing?.text ?? "")
  const [decided, setDecided] = useState(editing?.decisions.join("\n") ?? "")
  const [links, setLinks] = useState(editing?.links.join("\n") ?? "")
  const [next, setNext] = useState(editing?.next ?? "")
  const [step, setStep] = useState(
    editing ? String(stepNumberOf(solution.steps, editing.stepTitle) ?? NO_STEP) : now ? String(solution.steps.indexOf(now) + 1) : NO_STEP,
  )
  const [errors, setErrors] = useState<string[]>([])
  const saving = create.isPending || update.isPending

  async function submit() {
    const stepTitle = step === NO_STEP ? null : (solution.steps[Number(step) - 1]?.title ?? null)
    // An entry whose step left the road keeps the title it was filed under unless another is picked.
    const kept = editing?.stepTitle && step === NO_STEP && stepNumberOf(solution.steps, editing.stepTitle) === null ? editing.stepTitle : stepTitle
    const fields = {
      text: did,
      stepTitle: kept,
      ...(isDecision ? {} : { decisions: linesOf(decided), links: linesOf(links), next: next.trim() || null }),
    }
    const parsed = editing
      ? updateJournalEntrySchema.safeParse(fields)
      : createJournalEntrySchema.safeParse({ solutionId: solution.id, clientId: solution.clientId, date: today, kind: "work", ...fields })
    if (!parsed.success) {
      const field: Record<string, string> = { text: isDecision ? "Decision" : "Did", decisions: "Decided", links: "Links", next: "Next", stepTitle: "Step" }
      return setErrors(
        parsed.error.issues.map((i) => {
          const label = field[String(i.path[0])]
          return label ? `${label}: ${i.message.charAt(0).toLowerCase()}${i.message.slice(1)}` : i.message
        }),
      )
    }
    setErrors([])
    try {
      if (editing) await update.mutateAsync({ id: editing.id, input: parsed.data })
      else await create.mutateAsync(parsed.data as Parameters<typeof create.mutateAsync>[0])
      toast({ title: editing ? "Entry saved." : "Work logged." })
      onClose()
    } catch {
      setErrors(["Save failed. Try again."])
    }
  }

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle className="pr-6">{editing ? (isDecision ? "Edit Decision" : "Edit Work Session") : "Log Work"}</DialogTitle>
        <DialogDescription>
          {editing ? `Entry of ${editing.date} on ${solution.name}.` : `A work session on ${solution.name}, dated today.`}
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
          <Label htmlFor="log-did">{isDecision ? "Decision" : "Did"}</Label>
          <Textarea id="log-did" rows={3} autoFocus maxLength={JOURNAL_TEXT_MAX} value={did} onChange={(e) => setDid(e.target.value)} />
        </div>
        {!isDecision && (
          <>
            <div className="space-y-2">
              <Label htmlFor="log-decided">Decided</Label>
              <Textarea id="log-decided" rows={2} value={decided} onChange={(e) => setDecided(e.target.value)} />
              <p className="text-xs text-muted-foreground">One decision per line. Each shows as its own Decision line in the Journal.</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="log-links">Links</Label>
              <Textarea id="log-links" rows={2} value={links} onChange={(e) => setLinks(e.target.value)} />
              <p className="text-xs text-muted-foreground">One per line: a web address, or a name such as PR #7.</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="log-next">Next</Label>
              <Input id="log-next" value={next} maxLength={JOURNAL_LINE_MAX} onChange={(e) => setNext(e.target.value)} />
            </div>
          </>
        )}
        <div className="space-y-2">
          <Label htmlFor="log-step">Step</Label>
          <Select value={step} onValueChange={setStep}>
            <SelectTrigger id="log-step">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_STEP}>{editing?.stepTitle && stepNumberOf(solution.steps, editing.stepTitle) === null ? `${editing.stepTitle} (no longer on the road)` : "No step"}</SelectItem>
              {solution.steps.map((s, i) => (
                <SelectItem key={i} value={String(i + 1)}>
                  {i + 1}. {s.title}
                  {s.state === "now" ? " (Now)" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {errors.length > 0 && (
          <ul role="alert" className="space-y-1 text-sm text-destructive">
            {errors.map((m, i) => (
              <li key={i}>{m}</li>
            ))}
          </ul>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving}>
            {editing ? "Save Entry" : "Log Work"}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  )
}
