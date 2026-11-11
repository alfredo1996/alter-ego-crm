"use client"

import { ContentCard } from "@alter-ego/ui/page/content-card"
import { EmptyPrompt } from "@alter-ego/ui/page/empty-prompt"
import { SectionHeader } from "@alter-ego/ui/page/section-header"
import { Button } from "@alter-ego/ui/ui/button"
import { cn } from "@alter-ego/ui/utils"
import { Flag, Plus } from "lucide-react"
import { useRef } from "react"

import { STAGE_LABELS } from "@/lib/opportunities"
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

/**
 * The road to the target: the steps in order, left to right on a desktop and top to bottom on a phone, the flag
 * at the end. A step opens Edit Step; steps reorder by the native drag of the task board's cards, and by
 * Move Earlier / Move Later in the dialog.
 */
export function SolutionRoad({
  steps,
  engagements,
  opportunities,
  onOpen,
  onAdd,
  onMove,
  canAdd,
}: {
  steps: SolutionStep[]
  engagements: Pick<Engagement, "id" | "isActive">[]
  opportunities: Pick<Opportunity, "id" | "stage" | "engagementId">[]
  onOpen: (index: number) => void
  onAdd: () => void
  onMove: (from: number, to: number) => void
  canAdd: boolean
}) {
  const dragging = useRef<number | null>(null)
  const now = steps.findIndex((s) => s.state === "now")
  const add = (
    <Button id="solution-add-step" variant="outline" size="lg" disabled={!canAdd} onClick={onAdd}>
      <Plus aria-hidden /> Add Step
    </Button>
  )
  return (
    <section aria-labelledby="solution-roadmap" className="flex flex-col gap-3">
      <SectionHeader
        id="solution-roadmap"
        title="Roadmap"
        variant="card"
        description={steps.length === 0 ? null : now >= 0 ? `Step ${now + 1} of ${steps.length}` : `${steps.length} ${steps.length === 1 ? "step" : "steps"}`}
        actions={add}
      />
      {steps.length === 0 ? (
        <EmptyPrompt title="No steps yet" description="Add the steps that lead to the target, in order." />
      ) : (
        <ol className="flex flex-col gap-3 sm:grid sm:grid-flow-col sm:auto-cols-[minmax(11.5rem,1fr)] sm:overflow-x-auto sm:pb-2">
          {steps.map((step, i) => {
            const payer = payerLine(step, engagements, opportunities)
            const isNow = step.state === "now"
            return (
              <li
                key={i}
                draggable
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
                  if (from !== null) onMove(from, i)
                }}
                className="flex"
              >
                <ContentCard
                  as="div"
                  padding="none"
                  variant={isNow ? "warning" : "default"}
                  className={cn("flex w-full flex-col", step.state === "later" && "border-dashed", isNow && "border-warning")}
                >
                  <button
                    type="button"
                    aria-haspopup="dialog"
                    aria-current={isNow ? "step" : undefined}
                    onClick={() => onOpen(i)}
                    className="flex min-h-11 w-full flex-1 cursor-grab flex-col gap-1.5 rounded-xl p-4 text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none"
                  >
                    <span className="text-meta text-muted-foreground">
                      <span className={cn("font-semibold", isNow ? "text-warning-soft-foreground" : "text-foreground")}>{STEP_STATE[step.state]}</span>
                      {" · "}
                      {stepWhen(step)}
                    </span>
                    <span className="text-[15px] leading-snug font-medium [overflow-wrap:anywhere]">
                      <span className="mr-1.5 text-muted-foreground tabular-nums">{i + 1}.</span>
                      {step.title}
                    </span>
                    {step.state === "done" && step.outcome && <span className="text-sm text-muted-foreground [overflow-wrap:anywhere]">{step.outcome}</span>}
                    {payer && <span className="mt-auto pt-1 text-meta text-muted-foreground">{payer}</span>}
                  </button>
                </ContentCard>
              </li>
            )
          })}
          <li aria-hidden className="flex items-center justify-center text-muted-foreground max-sm:hidden">
            <Flag />
          </li>
        </ol>
      )}
    </section>
  )
}
