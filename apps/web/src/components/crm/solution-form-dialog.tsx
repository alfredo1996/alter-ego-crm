"use client"


import { Badge } from "@alter-ego/ui/ui/badge"
import { Button } from "@alter-ego/ui/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@alter-ego/ui/ui/dialog"
import { Input } from "@alter-ego/ui/ui/input"
import { Label } from "@alter-ego/ui/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@alter-ego/ui/ui/select"
import { Textarea } from "@alter-ego/ui/ui/textarea"
import { X } from "lucide-react"
import { useLayoutEffect, useRef, useState, type RefObject } from "react"

import { ClientCombobox } from "@/components/crm/client-combobox"
import { useCreateClient } from "@/hooks/use-clients"
import { useCreateSolution, useUpdateSolution } from "@/hooks/use-solutions"
import { engagementLabel } from "@/lib/engagements"
import { SOLUTION_STATUS, SOLUTION_STATUSES, solutionNameTaken } from "@/lib/solutions"
import {
  MAX_SOLUTION_STACK,
  SOLUTION_TARGET_MAX,
  createSolutionSchema,
  normalizeSolutionStack,
  updateSolutionSchema,
} from "@/types/schemas"

import type { Client, Engagement, Solution, SolutionKind, SolutionStatus, UpdateSolutionInput } from "@/types"

/** A Radix Select item cannot hold "" or null: the Contract choice for pre-sales. */
const PRE_SALES = "none"

/** The header fields, in the shape the inputs hold them. The sections and the data model are edited in the sheet. */
export interface SolutionForm {
  name: string
  /** "" until one is picked. */
  clientId: string
  /** null = pre-sales. */
  engagementId: string | null
  status: SolutionStatus
  kind: SolutionKind
  /** "" = none. */
  target: string
  /** "" = none. */
  domain: string
  stack: string[]
}

/** A new solution starts proposed and in pre-sales, on the client the list is filtered by. */
export function solutionForm(solution: Solution | null, clientId: string | null): SolutionForm {
  if (!solution) return { name: "", clientId: clientId ?? "", engagementId: null, status: "proposed", kind: "product", target: "", domain: "", stack: [] }
  return {
    name: solution.name,
    clientId: solution.clientId,
    engagementId: solution.engagementId,
    status: solution.status,
    kind: solution.kind,
    target: solution.target ?? "",
    domain: solution.domain ?? "",
    stack: solution.stack,
  }
}

/** A client picked: the contract stays only if it is that client's, else the solution goes back to pre-sales. */
export function withClient(
  form: SolutionForm,
  clientId: string,
  engagements: Pick<Engagement, "id" | "clientId">[],
): SolutionForm {
  const keeps = engagements.some((e) => e.id === form.engagementId && e.clientId === clientId)
  return { ...form, clientId, engagementId: keeps ? form.engagementId : null }
}

/**
 * The single update Save writes: only the fields that changed, so one left
 * alone never overwrites what chat wrote meanwhile. clientId never changes, as
 * on a verbale.
 */
export function solutionUpdate(opened: Solution, form: SolutionForm): UpdateSolutionInput {
  const input: UpdateSolutionInput = {}
  const domain = form.domain.trim() || null
  const target = form.target.trim() || null
  if (form.name.trim() !== opened.name) input.name = form.name
  if (form.engagementId !== opened.engagementId) input.engagementId = form.engagementId
  if (form.status !== opened.status) input.status = form.status
  if (form.kind !== opened.kind) input.kind = form.kind
  if (target !== opened.target) input.target = target
  if (domain !== opened.domain) input.domain = domain
  if (form.stack.join(",") !== opened.stack.join(",")) input.stack = form.stack
  return input
}

type Errors = Partial<Record<keyof SolutionForm, string>>

/** zod's first message for each field, shown under it. */
function fieldErrors(issues: { path: PropertyKey[]; message: string }[]): Errors {
  const errors: Errors = {}
  for (const issue of issues) errors[issue.path[0] as keyof SolutionForm] ??= issue.message
  return errors
}

/** Under its field, which names it with aria-describedby; announced, as focus stays on Create. */
function FieldError({ id, message }: { id: string; message: string | undefined }) {
  if (!message) return null
  return (
    <p id={id} role="alert" className="text-sm text-destructive">
      {message}
    </p>
  )
}

/** New Solution (`solution` null) or Edit Solution: the header fields only. */
export function SolutionFormDialog({
  open,
  returnFocus,
  ...props
}: {
  open: boolean
  solution: Solution | null
  /** Every solution: a name is unique within its client. */
  solutions: Solution[]
  /** A new solution's client: the one the list is filtered by. */
  clientId: string | null
  userId: string | undefined
  clients: Client[]
  engagements: Engagement[]
  onClose: () => void
  /** After New Solution: the id to open. */
  onCreated: (solutionId: string) => void
  /** Where focus goes back to when what opened it is gone (a menu's item). */
  returnFocus?: RefObject<HTMLElement | null>
}) {
  // Opened from state, not a DialogTrigger: focus goes back to what opened it by hand.
  const opener = useRef<HTMLElement | null>(null)
  useLayoutEffect(() => {
    if (open) opener.current = document.activeElement as HTMLElement | null
  }, [open])
  return (
    <Dialog open={open} onOpenChange={(o) => !o && props.onClose()}>
      {/* Mounted per opening, so each one starts from the solution as it is now. */}
      {open && (
        <SolutionFormBody
          {...props}
          restoreFocus={(e) => {
            e.preventDefault()
            const back = opener.current?.isConnected ? opener.current : returnFocus?.current
            back?.focus()
          }}
        />
      )}
    </Dialog>
  )
}

function SolutionFormBody({
  solution: opened,
  solutions,
  clientId,
  userId,
  clients,
  engagements,
  onClose,
  onCreated,
  restoreFocus,
}: {
  solution: Solution | null
  solutions: Solution[]
  clientId: string | null
  userId: string | undefined
  clients: Client[]
  engagements: Engagement[]
  onClose: () => void
  onCreated: (solutionId: string) => void
  restoreFocus: (e: Event) => void
}) {
  const createSolution = useCreateSolution(userId)
  const updateSolution = useUpdateSolution(userId)
  const createClient = useCreateClient(userId)
  // The solution as opened: a refetch while the dialog is open must not turn an
  // untouched field into an "edit" that reverts what chat wrote.
  const [solution] = useState(opened)
  const [initial] = useState(() => solutionForm(solution, clientId))
  const [form, setForm] = useState(initial)
  const [tagDraft, setTagDraft] = useState("")
  const [errors, setErrors] = useState<Errors>({})

  const set = (patch: Partial<SolutionForm>) => {
    setForm((f) => ({ ...f, ...patch }))
    setErrors({})
  }
  const addTags = (raw: string[]) => set({ stack: normalizeSolutionStack([...form.stack, ...raw]) })
  // A technology typed but not yet confirmed with Enter still counts on Save.
  const values = { ...form, stack: normalizeSolutionStack([...form.stack, tagDraft]) }
  const dirty = solution
    ? Object.keys(solutionUpdate(solution, values)).length > 0
    : JSON.stringify(values) !== JSON.stringify(initial)
  const contracts = engagements.filter((e) => e.clientId === form.clientId)
  const clientName = clients.find((c) => c.id === form.clientId)?.name ?? "Unknown client"
  const full = form.stack.length >= MAX_SOLUTION_STACK
  const pending = createSolution.isPending || updateSolution.isPending
  const failed = createSolution.isError || updateSolution.isError

  /** The refusal MCP create/update_solution give, in the page's words; renaming a solution to its own name in another case is no clash. */
  const nameTaken = (name: string | undefined) => {
    const taken = name === undefined ? undefined : solutionNameTaken(solutions, form.clientId, name, solution?.id)
    if (taken) setErrors({ name: `${clientName} already has a solution named "${taken.name}".` })
    return !!taken
  }

  function save() {
    if (solution) {
      const update = solutionUpdate(solution, values)
      if (Object.keys(update).length === 0) return onClose()
      const parsed = updateSolutionSchema.safeParse(update)
      if (!parsed.success) return setErrors(fieldErrors(parsed.error.issues))
      if (nameTaken(parsed.data.name)) return
      updateSolution.mutate({ id: solution.id, input: parsed.data }, { onSuccess: onClose })
    } else {
      const parsed = createSolutionSchema.safeParse({ ...values, target: values.target.trim() || null, domain: values.domain.trim() || null })
      if (!parsed.success) return setErrors(fieldErrors(parsed.error.issues))
      if (nameTaken(parsed.data.name)) return
      createSolution.mutate(parsed.data, {
        onSuccess: (created) => {
          onClose()
          onCreated(created.id)
        },
      })
    }
  }

  // Unsaved edits go only through Cancel or the close button, never through
  // a stray click beside the dialog or an Escape meant for a field.
  const keepEdits = (e: Event) => {
    if (dirty) e.preventDefault()
  }

  return (
    <DialogContent onInteractOutside={keepEdits} onEscapeKeyDown={keepEdits} onCloseAutoFocus={restoreFocus}>
      <DialogHeader>
        <DialogTitle className="pr-6">{solution ? "Edit Solution" : "New Solution"}</DialogTitle>
        <DialogDescription>
          {solution
            ? "The sections and the data model are edited on the solution itself."
            : "What you built, or are proposing, for a client. You write the sections once it is created."}
        </DialogDescription>
      </DialogHeader>

      {/* noValidate: every error is the form's own red line, never the browser's tooltip. */}
      <form
        noValidate
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault()
          save()
        }}
      >
        <div className="space-y-2">
          <Label htmlFor="solution-name">Name</Label>
          <Input
            id="solution-name"
            value={form.name}
            maxLength={200}
            autoFocus={!solution}
            placeholder="Product knowledge graph"
            aria-invalid={!!errors.name}
            aria-describedby={errors.name ? "solution-name-error" : undefined}
            onChange={(e) => set({ name: e.target.value })}
          />
          <FieldError id="solution-name-error" message={errors.name} />
        </div>

        <div className="space-y-2">
          {/* Editing, the client is text: a label can only name a field. */}
          <Label htmlFor={solution ? undefined : "solution-client"}>Client</Label>
          {solution ? (
            <p className="text-sm">
              {clientName} <span className="text-muted-foreground">· a solution stays with its client</span>
            </p>
          ) : (
            <ClientCombobox
              id="solution-client"
              errorId={errors.clientId ? "solution-client-error" : undefined}
              clients={clients}
              value={form.clientId || null}
              onChange={(id) => {
                setForm((f) => withClient(f, id, engagements))
                setErrors({})
              }}
              onCreate={async (name) => (await createClient.mutateAsync({ name })).id}
            />
          )}
          <FieldError id="solution-client-error" message={errors.clientId} />
        </div>

        <div className="grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-2">
          <div className="min-w-0 space-y-2">
            <Label htmlFor="solution-contract">Contract</Label>
            <Select
              value={form.engagementId ?? PRE_SALES}
              disabled={!form.clientId}
              onValueChange={(value) => set({ engagementId: value === PRE_SALES ? null : value })}
            >
              <SelectTrigger
                id="solution-contract"
                aria-invalid={!!errors.engagementId}
                aria-describedby={errors.engagementId ? "solution-contract-error" : undefined}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={PRE_SALES}>None (pre-sales)</SelectItem>
                {contracts.map((e) => (
                  <SelectItem key={e.id} value={e.id}>
                    {engagementLabel(e)}
                    {!e.isActive && " (closed)"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FieldError id="solution-contract-error" message={errors.engagementId} />
          </div>

          <div className="min-w-0 space-y-2">
            <Label htmlFor="solution-status">Status</Label>
            <Select value={form.status} onValueChange={(value) => set({ status: value as SolutionStatus })}>
              <SelectTrigger id="solution-status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SOLUTION_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {SOLUTION_STATUS[s].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="solution-kind">Kind</Label>
          <Select value={form.kind} onValueChange={(value) => set({ kind: value as SolutionKind })}>
            <SelectTrigger id="solution-kind">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="product">Product</SelectItem>
              <SelectItem value="advisory">Advisory</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="solution-target">Target (optional)</Label>
          <Textarea
            id="solution-target"
            rows={2}
            value={form.target}
            placeholder="Where the road ends, in a sentence"
            aria-invalid={!!errors.target}
            aria-describedby={errors.target ? "solution-target-error" : undefined}
            onChange={(e) => set({ target: e.target.value })}
          />
          <p className="text-xs tabular-nums text-muted-foreground">
            {form.target.length} / {SOLUTION_TARGET_MAX}
          </p>
          <FieldError id="solution-target-error" message={errors.target} />
        </div>

        <div className="space-y-2">
          <Label htmlFor="solution-domain">Domain</Label>
          <Input
            id="solution-domain"
            value={form.domain}
            maxLength={60}
            placeholder="retail"
            aria-invalid={!!errors.domain}
            aria-describedby={errors.domain ? "solution-domain-error" : undefined}
            onChange={(e) => set({ domain: e.target.value })}
          />
          <FieldError id="solution-domain-error" message={errors.domain} />
        </div>

        <div className="space-y-2">
          <div className="flex items-baseline justify-between gap-2">
            <Label htmlFor="solution-stack">Stack</Label>
            <span className="text-xs tabular-nums text-muted-foreground">
              {form.stack.length} / {MAX_SOLUTION_STACK}
            </span>
          </div>
          {form.stack.length > 0 && (
            <ul className="flex flex-wrap gap-1.5">
              {form.stack.map((tag) => (
                <li key={tag} className="max-w-full">
                  <Badge variant="secondary" className="max-w-full gap-1 font-medium">
                    <span className="truncate">{tag}</span>
                    <button
                      type="button"
                      className="-mr-1 rounded-sm opacity-70 hover:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring pointer-coarse:-my-3 pointer-coarse:inline-flex pointer-coarse:size-11 pointer-coarse:items-center pointer-coarse:justify-center"
                      aria-label={`Remove ${tag}`}
                      onClick={() => set({ stack: form.stack.filter((t) => t !== tag) })}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                </li>
              ))}
            </ul>
          )}
          <Input
            id="solution-stack"
            value={tagDraft}
            maxLength={40}
            disabled={full}
            aria-invalid={!!errors.stack}
            aria-describedby={errors.stack ? "solution-stack-error" : undefined}
            placeholder={full ? `At most ${MAX_SOLUTION_STACK} technologies` : "Type one, then press Enter or comma"}
            onChange={(e) => {
              // A comma, typed or pasted, confirms what comes before it.
              const parts = e.target.value.split(",")
              if (parts.length > 1) addTags(parts.slice(0, -1))
              setTagDraft(parts[parts.length - 1])
            }}
            onKeyDown={(e) => {
              if (e.key !== "Enter") return
              // Enter adds the technology; it must not submit the form.
              e.preventDefault()
              addTags([tagDraft])
              setTagDraft("")
            }}
          />
          <FieldError id="solution-stack-error" message={errors.stack} />
        </div>

        {failed && (
          <p role="alert" className="text-sm text-destructive">
            Save failed. Try again.
          </p>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={pending}>
            {solution ? "Save Changes" : "Create Solution"}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  )
}
