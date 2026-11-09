"use client"

import { cn } from "@alter-ego/ui/utils"
import { useCallback, useMemo, useState } from "react"

import { useElementWidth } from "@/hooks/use-element-width"
import { layoutSolutionGraph, type TextMeasure } from "@/lib/solution-graph"

import type { SolutionEntity, SolutionRelation } from "@/types"

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/**
 * Text widths from a canvas, in the families the graph draws with: its box's (the boxes' text) and the one a
 * font-mono element gets inside it (the labels'). Undefined with no canvas (happy-dom): the layout estimates.
 */
function canvasMeasure(box: HTMLElement): TextMeasure | undefined {
  const ctx = document.createElement("canvas").getContext("2d")
  if (!ctx) return undefined
  const probe = box.appendChild(document.createElement("span"))
  probe.className = "font-mono"
  const [sans, mono] = [getComputedStyle(box).fontFamily, getComputedStyle(probe).fontFamily]
  probe.remove()
  return (text, font) => {
    ctx.font = `${font.weight ?? 400} ${font.px}px ${font.mono ? mono : sans}`
    return ctx.measureText(text).width
  }
}

/**
 * The data model drawn: a box per entity, its source under its name ("derived"
 * when it has none), an arrow per relation with its type. Drawn at its
 * container's width, so its text stays 12 px and up on a phone, where it grows
 * taller rather than wider. The tables beside it stay the editable record.
 */
export function SolutionGraph({ entities, relations }: { entities: SolutionEntity[]; relations: SolutionRelation[] }) {
  const [observe, width] = useElementWidth<HTMLDivElement>()
  // Made when the box is on the page (never on the server, where the graph is not drawn), and again once
  // the web fonts are in: Geist still loading measures as its fallback, and a label would be cut short.
  const [measure, setMeasure] = useState<TextMeasure>()
  const box = useCallback(
    (el: HTMLDivElement | null) => {
      if (el) {
        const m = canvasMeasure(el)
        setMeasure(() => m)
        void document.fonts?.ready.then(() => setMeasure(() => canvasMeasure(el)))
      }
      return observe(el)
    },
    [observe],
  )
  // The sheet renders on every keystroke in its tables; the saved model it draws does not change with them.
  const layout = useMemo(
    () => (width > 0 ? layoutSolutionGraph(entities, relations, { width: Math.floor(width), measure }) : null),
    [entities, relations, width, measure],
  )
  const summary = `Data model graph: ${count(entities.length, "entity", "entities")}, ${count(relations.length, "relation", "relations")}`
  const said = (e: { from: string; type: string; to: string }) => `${e.from} ${e.type} ${e.to}`
  return (
    // Wider than its container only when not even one box fits: then it scrolls here, never the page.
    <div ref={box} className="overflow-x-auto">
      {layout && (
        <svg
          role="img"
          aria-label={summary}
          width={layout.width}
          height={layout.height}
          viewBox={`0 0 ${layout.width} ${layout.height}`}
          className="block"
        >
          <title>{summary}</title>
          <desc>{relations.map(said).join(". ")}</desc>
          {layout.edges.map((e, i) => (
            <g key={i}>
              <title>{said(e)}</title>
              <path d={e.d} fill="none" strokeWidth={1.5} strokeLinejoin="round" className="stroke-muted-foreground" />
              <polygon points={e.arrow.map((p) => `${p.x},${p.y}`).join(" ")} className="fill-muted-foreground" />
            </g>
          ))}
          {/* The fonts the layout measured: a name 500 13 px, its source 12 px, a label 12 px mono. */}
          {layout.nodes.map((n) => (
            <g key={n.name}>
              <title>{n.source ? `${n.name}, from ${n.source}` : `${n.name}, derived`}</title>
              <rect x={n.x} y={n.y} width={n.w} height={n.h} rx={6} className="fill-muted/50 stroke-muted-foreground/40" />
              <text x={n.x + n.w / 2} y={n.y + 19} textAnchor="middle" className="fill-foreground text-[13px] font-medium">
                {n.nameText}
              </text>
              <text
                x={n.x + n.w / 2}
                y={n.y + 35}
                textAnchor="middle"
                className={cn("fill-muted-foreground text-[12px]", !n.sourceText && "italic")}
              >
                {n.sourceText ?? "derived"}
              </text>
            </g>
          ))}
          {/* Over everything, each on the page's background: a label never hides under a line or a box. */}
          {layout.edges.map((e, i) => (
            <g key={i}>
              <title>{said(e)}</title>
              <rect x={e.label.x} y={e.label.y} width={e.label.w} height={e.label.h} rx={3} className="fill-background" />
              <text
                x={e.label.x + e.label.w / 2}
                y={e.label.y + e.label.h / 2}
                textAnchor="middle"
                dominantBaseline="central"
                className="fill-muted-foreground font-mono text-[12px]"
              >
                {e.label.text}
              </text>
            </g>
          ))}
        </svg>
      )}
    </div>
  )
}
