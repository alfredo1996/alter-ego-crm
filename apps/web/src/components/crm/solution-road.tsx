"use client"

import { EmptyPrompt } from "@alter-ego/ui/page/empty-prompt"
import { SectionHeader } from "@alter-ego/ui/page/section-header"
import { Button } from "@alter-ego/ui/ui/button"
import { cn } from "@alter-ego/ui/utils"
import { Check, Flag, Plus } from "lucide-react"
import { useRef } from "react"

import { countIn } from "@/lib/engagements"
import { OPEN_STAGES, STAGE_LABELS } from "@/lib/opportunities"
import { contractState, stepContract, stepWhen } from "@/lib/solutions"

import type { Engagement, Opportunity, SolutionStep } from "@/types"

export const STEP_STATE = { done: "Done", now: "Now", next: "Next", later: "Later" } as const

/** What pays for a step, as the road says it: "Contract · closed", "Opportunity · Proposal", or null. */
export function payerLine(
  step: Pick<SolutionStep, "paidBy">,
  engagements: Pick<Engagement, "id" | "isActive">[],
  opportunities: Pick<Opportunity, "id" | "stage" | "engagementId">[],
): string | null {
  const payer = stepContract(step, opportunities)
  if (!payer) return null
  if (payer.type === "contract") {
    const contract = engagements.find((e) => e.id === payer.id)
    return contract ? `Contract · ${contractState(contract).toLowerCase()}` : "Contract · not found"
  }
  const opportunity = opportunities.find((o) => o.id === payer.id)
  return opportunity ? `Opportunity · ${STAGE_LABELS[opportunity.stage]}` : "Opportunity · not found"
}

/** The size of the open opportunity behind a Next or Later step, as the pipeline counts it: "15 days". */
export function estimateLine(
  step: Pick<SolutionStep, "paidBy" | "state">,
  opportunities: Pick<Opportunity, "id" | "stage" | "engagementId" | "estimatedDaysPerMonth" | "estimatedDurationMonths" | "unit">[],
): string | null {
  if (step.state !== "next" && step.state !== "later") return null
  const payer = stepContract(step, opportunities)
  const o = payer?.type === "opportunity" ? opportunities.find((x) => x.id === payer.id) : undefined
  return o && (OPEN_STAGES as readonly string[]).includes(o.stage) ? countIn(o.estimatedDaysPerMonth * o.estimatedDurationMonths, o.unit ?? "day") : null
}

/** A step state's shape, shared by the rail's markers and the list row's small track: filled, amber ring, ring, dashed ring. */
export const STEP_MARK = {
  done: "bg-foreground",
  now: "border-2 border-warning-soft-foreground bg-background",
  next: "border-2 border-muted-foreground bg-background",
  later: "border-2 border-dashed border-muted-foreground bg-background",
} as const

/** The marker on the rail: a check for Done, an amber ring with a dot for Now, a numbered circle for Next, a dashed one for Later. */
function Marker({ step, number }: { step: SolutionStep; number: number }) {
  return (
    <span
      aria-hidden
      data-marker
      className={cn(
        "flex size-8 shrink-0 items-center justify-center rounded-full text-[13px] font-semibold tabular-nums",
        STEP_MARK[step.state],
        step.state === "done" && "text-background",
        step.state === "next" && "text-muted-foreground",
        step.state === "later" && "text-subtle-foreground",
      )}
    >
      {step.state === "done" ? <Check className="size-4" strokeWidth={2.5} /> : step.state === "now" ? <span className="size-3 rounded-full bg-warning-soft-foreground" /> : number}
    </span>
  )
}

/** The line to the next marker: solid through Done steps, grey after. Across on a desktop, down on a phone. */
function Connector({ solid }: { solid: boolean }) {
  return <span aria-hidden className={cn("max-sm:min-h-6 max-sm:w-0.5 max-sm:flex-1 sm:h-0.5 sm:flex-1", solid ? "bg-foreground" : "bg-border")} />
}

/**
 * The road to the target, as a rail: a marker per step joined by a line, ending at the Target. Left to right
 * from sm up, top to bottom on a phone. A step opens Edit Step; steps reorder by the native drag of the task
 * board's cards, and by Move Earlier / Move Later in the dialog. `busy` while the road is being written: a
 * second write would undo the first.
 */
export function SolutionRoad({
  steps,
  target,
  nowLine,
  engagements,
  opportunities,
  onOpen,
  onAdd,
  onMove,
  canAdd,
  busy,
  readOnly = false,
}: {
  steps: SolutionStep[]
  target: string | null
  /** The Now step's days used, "6.5 of 11 days used", when a contract with a cap pays for it. */
  nowLine: string | null
  engagements: Pick<Engagement, "id" | "isActive">[]
  opportunities: Pick<Opportunity, "id" | "stage" | "engagementId" | "estimatedDaysPerMonth" | "estimatedDurationMonths" | "unit">[]
  onOpen: (index: number) => void
  onAdd: () => void
  onMove: (from: number, to: number) => void
  canAdd: boolean
  busy: boolean
  /** Presenting: a step opens nothing, drags nowhere, and there is no Add Step. */
  readOnly?: boolean
}) {
  const dragging = useRef<number | null>(null)
  const now = steps.findIndex((s) => s.state === "now")
  return (
    <section aria-labelledby="solution-roadmap" className="relative flex flex-col gap-3">
      <SectionHeader
        id="solution-roadmap"
        title="Roadmap"
        variant="card"
        description={steps.length === 0 ? null : now >= 0 ? `Step ${now + 1} of ${steps.length}` : `${steps.length} ${steps.length === 1 ? "step" : "steps"}`}
      />
      {steps.length === 0 ? (
        <EmptyPrompt title="No steps yet" description="Add the steps that lead to the target, in order." />
      ) : (
        <ol className="flex flex-col sm:grid sm:grid-flow-col sm:auto-cols-[minmax(11rem,1fr)] sm:overflow-x-auto sm:pb-2">
          {steps.map((step, i) => {
            const payer = payerLine(step, engagements, opportunities)
            const detail = step.state === "now" ? nowLine : estimateLine(step, opportunities)
            const isNow = step.state === "now"
            return (
              <li
                key={i}
                draggable={!busy && !readOnly}
                onDragStart={(e) => {
                  dragging.current = i
                  e.dataTransfer.setData("text/plain", String(i))
                  e.dataTransfer.effectAllowed = "move"
                }}
                onDragEnd={() => (dragging.current = null)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault()
                  const from = dragging.current
                  dragging.current = null
                  if (from !== null && !busy && !readOnly) onMove(from, i)
                }}
                className="flex gap-3 sm:flex-col"
              >
                <div className="flex items-center max-sm:flex-col sm:gap-0">
                  <Marker step={step} number={i + 1} />
                  <Connector solid={step.state === "done"} />
                </div>
                <button
                  type="button"
                  aria-haspopup={readOnly ? undefined : "dialog"}
                  aria-current={isNow ? "step" : undefined}
                  disabled={readOnly}
                  onClick={() => onOpen(i)}
                  className={cn(
                    "flex min-h-11 min-w-0 flex-1 flex-col items-start gap-1.5 rounded-lg border p-2.5 text-left transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none max-sm:mb-4 sm:mr-3",
                    isNow ? "border-warning/40 bg-warning-soft/60" : "border-transparent",
                    readOnly ? "cursor-default" : "cursor-grab hover:bg-muted/60",
                  )}
                >
                  <span className="text-meta text-muted-foreground">
                    <span className={cn("font-semibold", isNow && "text-warning-soft-foreground")}>{STEP_STATE[step.state]}</span>
                    {" · "}
                    {stepWhen(step)}
                  </span>
                  <span className="text-[15px] leading-snug font-semibold [overflow-wrap:anywhere]">
                    <span className="sr-only">Step {i + 1}: </span>
                    {step.title}
                  </span>
                  {step.state === "done" && step.outcome && <span className="text-sm text-muted-foreground [overflow-wrap:anywhere]">{step.outcome}</span>}
                  {detail && <span className="text-[13px] text-muted-foreground tabular-nums">{detail}</span>}
                  {payer && <span className="mt-auto rounded-md border border-hairline bg-muted px-2 py-0.5 text-xs text-foreground">{payer}</span>}
                </button>
              </li>
            )
          })}
          <li className="flex gap-3 sm:flex-col">
            <div className="flex items-center">
              <span aria-hidden className="flex size-8 shrink-0 items-center justify-center rounded-full border bg-sidebar">
                <Flag className="size-4" />
              </span>
            </div>
            <div className="flex min-w-0 flex-col gap-1 p-2.5">
              <span className="text-[15px] font-semibold">Target</span>
              <span className="line-clamp-3 text-[13px] text-muted-foreground [overflow-wrap:anywhere]">{target ?? "Not set yet. Add it in Edit Details."}</span>
            </div>
          </li>
        </ol>
      )}
      {/* Top right of the section from sm up (over the header's row), full width under the road on a phone. */}
      {!readOnly && <Button id="solution-add-step" variant="outline" size="lg" disabled={!canAdd} onClick={onAdd} className="max-sm:w-full sm:absolute sm:top-0 sm:right-0">
        <Plus aria-hidden /> Add Step
      </Button>}
    </section>
  )
}
