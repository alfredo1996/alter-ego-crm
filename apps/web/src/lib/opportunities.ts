/**
 * Pipeline vocabulary and the arithmetic the CRM views repeat.
 *
 * An opportunity is priced exactly like a contract — days per month at a daily
 * rate, for a number of months — so these figures line up with what the
 * projection produces once the deal is won.
 */

import { startOfDay } from "date-fns"

import type { Opportunity, OpportunityStage } from "@/types"

/** Stages still in play. Won became a contract; lost is not happening. */
export const OPEN_STAGES = ["lead", "proposal", "negotiation"] as const

export const STAGE_LABELS: Record<OpportunityStage, string> = {
  lead: "Lead",
  proposal: "Proposal",
  negotiation: "Negotiation",
  won: "Won",
  lost: "Lost",
}

/** Each stage's StatusPill tone: the further along, the warmer; a lost deal is neutral, never red. */
export const STAGE_TONE: Record<OpportunityStage, "neutral" | "info" | "warning" | "success"> = {
  lead: "neutral",
  proposal: "info",
  negotiation: "warning",
  won: "success",
  lost: "neutral",
}

/**
 * Probability the form seeds when you move a deal to a stage. It is a starting
 * point, not a rule — the stored value stays editable per deal.
 */
export const STAGE_PROBABILITY: Record<OpportunityStage, number> = {
  lead: 20,
  proposal: 50,
  negotiation: 75,
  won: 100,
  lost: 0,
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

export function isOpen(opportunity: Opportunity): boolean {
  return opportunity.stage !== "won" && opportunity.stage !== "lost"
}

/** Gross value of the whole engagement: days/month × rate × months. */
export function opportunityValue(o: Opportunity): number {
  return round2(o.estimatedDaysPerMonth * o.dailyRate * o.estimatedDurationMonths)
}

/** What it adds per month while it runs. */
export function monthlyValue(o: Opportunity): number {
  return round2(o.estimatedDaysPerMonth * o.dailyRate)
}

export function weightedMonthlyValue(o: Opportunity): number {
  return round2(monthlyValue(o) * (o.probability / 100))
}

/**
 * Weighted €/month across the open pipeline — the headline figure: what you'd
 * add per month if every open deal closed at its own odds.
 */
export function weightedPipelineMonthly(opportunities: Opportunity[]): number {
  return round2(opportunities.filter(isOpen).reduce((sum, o) => sum + weightedMonthlyValue(o), 0))
}

/**
 * A follow-up whose date has passed. The one thing the pipeline should nag about.
 * By calendar day: one dated today is due, not overdue, at any hour.
 */
export function isActionOverdue(o: Opportunity, today: Date): boolean {
  if (!isOpen(o) || !o.nextActionDate) return false
  return o.nextActionDate < startOfDay(today)
}

/**
 * Open deals closest to signing first: the likelier one, then the later stage, then the
 * one worth more. A sort comparator.
 */
export function closestToSigning(a: Opportunity, b: Opportunity): number {
  const stage = (o: Opportunity) => OPEN_STAGES.indexOf(o.stage as (typeof OPEN_STAGES)[number])
  return b.probability - a.probability || stage(b) - stage(a) || weightedMonthlyValue(b) - weightedMonthlyValue(a)
}

/** Weighted €/month per open stage, the furthest along first. */
export function weightedByStage(opportunities: Opportunity[]): { stage: OpportunityStage; value: number }[] {
  return [...OPEN_STAGES].reverse().map((stage) => ({
    stage,
    value: round2(opportunities.filter((o) => o.stage === stage).reduce((sum, o) => sum + weightedMonthlyValue(o), 0)),
  }))
}

/** The open deal whose follow-up comes first, so an overdue one before any still ahead. */
export function nextFollowUp(opportunities: Opportunity[]): Opportunity | null {
  return (
    opportunities
      .filter((o) => isOpen(o) && o.nextActionDate)
      .sort((a, b) => a.nextActionDate!.getTime() - b.nextActionDate!.getTime())[0] ?? null
  )
}
