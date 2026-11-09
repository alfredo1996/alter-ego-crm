/**
 * The data model graph's layout: where each entity's box and each relation's
 * line and label go, as plain numbers for an SVG. Pure, with no React and no
 * DOM, so it is tested on its own; components/crm/solution-graph.tsx draws it.
 *
 * Layered, on a grid: who points at whom reads top to bottom, and a layer too
 * wide for the width wraps onto more rows. Each box has a grid slot of its own,
 * so no two ever overlap. A line runs in the gap between two rows; one that
 * would cross a row with a box in its way goes down the lane between two
 * columns instead, so no line runs through a box it does not join.
 */
import type { SolutionEntity, SolutionRelation } from "@/types"

export interface GraphPoint {
  x: number
  y: number
}

export interface GraphBox extends GraphPoint {
  w: number
  h: number
}

export interface GraphNode extends GraphBox {
  name: string
  source: string | null
  /** The name and the source as they fit the box, shortened with "…": the full text is for a tooltip. */
  nameText: string
  sourceText: string | null
}

export interface GraphEdge {
  from: string
  to: string
  type: string
  /** A relation from an entity to itself: a loop over one of its box's top corners or under a bottom one. */
  loop: boolean
  /** The first on the source's border, the last the arrow's tip on the target's; a loop's are its curve's four. */
  points: GraphPoint[]
  /** The SVG path: it stops inside the arrowhead, so the line never pokes through its tip. */
  d: string
  /** The arrowhead, its tip first. */
  arrow: GraphPoint[]
  /** The relation's type on a background, at the line's midpoint unless that spot is taken. */
  label: GraphBox & { text: string }
}

export interface GraphLayout {
  width: number
  height: number
  nodes: GraphNode[]
  edges: GraphEdge[]
}

/** A text's font, as the drawing sets it: the boxes' family, or the labels' monospace. */
export interface GraphFont {
  px: number
  weight?: number
  mono?: boolean
}

/** A text's width in px, in that font. */
export type TextMeasure = (text: string, font: GraphFont) => number

/** What the drawing must set on each: a box's name, its source, a relation's label. */
const NAME_FONT: GraphFont = { px: 13, weight: 500 }
const SOURCE_FONT: GraphFont = { px: 12 }
const LABEL_FONT: GraphFont = { px: 12, mono: true }

const NODE_H = 44
const MIN_NODE_W = 112
const MAX_NODE_W = 160
/** Between two columns: the lane a line takes past a row. */
const GAP_X = 20
/** Between two rows: room for a line and its label. */
const GAP_Y = 56
const PAD = 8
const LABEL_H = 16
const MAX_LABEL_W = 120
const ARROW = 7
/** Where a box's top and bottom take lines: clear of its rounded corners. */
const PORT_INSET = 10
/** A self-relation's loop leaves the box here and comes back there, from the corner it takes; its label sits beyond it. */
const LOOP_OUT = 44
const LOOP_IN = 16
const LOOP_H = 30
/** A loop round another at its corner: its ends NEST px further apart each side, its height LOOP_STEP px more. */
const NEST = 8
const LOOP_STEP = 16
/** A loop's label beyond the side's tallest apex, a row further out for each loop before it on that side, so none sits on another. */
const loopLabel = (h: number, level: number) => 0.75 * h + 2 + LABEL_H / 2 + level * (LABEL_H + 2)
/** The least room a side's lines may have each between its loops: an arrowhead is 8 px wide. */
const MIN_PORT_GAP = 10
/** Lines sharing a lane sit side by side, never more than 8 px off its middle: a lane is 20 px wide. */
const LANE_OFFSETS = [0, -4, 4, -8, 8]
const TEXT_PAD = 8
/**
 * The widths when no measure is given (no DOM here, and the tests stay exact): a monospace character 0.6 em;
 * in the boxes' family a capital 0.72 em, above Arial's and Geist's average, f i j l r t 0.3 em, anything
 * else 0.6 em, "…" 1 em. A run of M, W or m overflows these: the drawing measures on a canvas instead.
 */
const estimate: TextMeasure = (text, { px, mono }) =>
  [...text].reduce((sum, ch) => sum + px * (mono ? 0.6 : ch === "…" ? 1 : /[A-Z]/.test(ch) ? 0.72 : /[fijlrt]/.test(ch) ? 0.3 : 0.6), 0)

/** A label's spots along its line, nearest the midpoint first: 45%, 55%, 40%, 60% … 5%, 95%. */
const ALONG = Array.from({ length: 9 }, (_, i) => [0.45 - i * 0.05, 0.55 + i * 0.05]).flat()

const round = (v: number) => Math.round(v * 10) / 10
const pt = (x: number, y: number): GraphPoint => ({ x: round(x), y: round(y) })

/** The text as it fits `room` px, `width` wide, shortened with "…". */
function fit(text: string, room: number, width: (text: string) => number): string {
  if (width(text) <= room) return text
  const chars = [...text]
  let n = 0
  while (n < chars.length && width(`${chars.slice(0, n + 1).join("")}…`) <= room) n++
  return `${chars.slice(0, n).join("").trimEnd()}…`
}

/** Whether the segment p→q passes through the box (Liang–Barsky). */
function crosses(p: GraphPoint, q: GraphPoint, b: GraphBox): boolean {
  if (Math.max(p.x, q.x) < b.x || Math.min(p.x, q.x) > b.x + b.w || Math.max(p.y, q.y) < b.y || Math.min(p.y, q.y) > b.y + b.h) return false
  let [t0, t1] = [0, 1]
  const sides: [number, number][] = [
    [p.x - b.x, p.x - q.x],
    [b.x + b.w - p.x, q.x - p.x],
    [p.y - b.y, p.y - q.y],
    [b.y + b.h - p.y, q.y - p.y],
  ]
  for (const [num, den] of sides) {
    if (den === 0) {
      if (num < 0) return false
    } else if (den < 0) t0 = Math.max(t0, num / den)
    else t1 = Math.min(t1, num / den)
  }
  return t0 < t1
}

/** The point `share` of the way along the polyline. */
function along(points: GraphPoint[], share: number): GraphPoint {
  const lengths = points.slice(1).map((q, k) => Math.hypot(q.x - points[k].x, q.y - points[k].y))
  let left = share * lengths.reduce((s, l) => s + l, 0)
  for (let k = 0; k < lengths.length; k++) {
    if (left <= lengths[k] || k === lengths.length - 1) {
      const t = lengths[k] === 0 ? 0 : Math.min(1, left / lengths[k])
      return { x: points[k].x + (points[k + 1].x - points[k].x) * t, y: points[k].y + (points[k + 1].y - points[k].y) * t }
    }
    left -= lengths[k]
  }
  return points[0]
}

/** The arrowhead at `tip`, coming from `from`, and where the line should stop under it. */
function arrowhead(from: GraphPoint, tip: GraphPoint): { arrow: GraphPoint[]; stop: GraphPoint } {
  const len = Math.hypot(tip.x - from.x, tip.y - from.y) || 1
  const [dx, dy] = [(tip.x - from.x) / len, (tip.y - from.y) / len]
  const [bx, by] = [tip.x - dx * ARROW, tip.y - dy * ARROW]
  return {
    arrow: [tip, pt(bx - dy * 4, by + dx * 4), pt(bx + dy * 4, by - dx * 4)],
    stop: pt(tip.x - dx * (ARROW - 1), tip.y - dy * (ARROW - 1)),
  }
}

type Entity = Pick<SolutionEntity, "name" | "source">
type Relation = SolutionRelation & { u: number; v: number }

/**
 * The graph laid out for `width` px: wider only when not even one box fits.
 * Entities sharing a name keep the first, as normalizeSolutionGraph does, and a
 * relation naming an entity not in the list is left out. Text is shortened to
 * the widths `measure` gives, estimated without one. Deterministic: the same
 * model at the same width, measured the same, always lays out the same.
 */
export function layoutSolutionGraph(
  entities: Entity[],
  relations: SolutionRelation[],
  { width, measure = estimate }: { width: number; measure?: TextMeasure },
): GraphLayout {
  const list: Entity[] = []
  const index = new Map<string, number>()
  for (const e of entities) {
    if (index.has(e.name)) continue
    index.set(e.name, list.length)
    list.push(e)
  }
  const rels: Relation[] = relations.flatMap((r) => {
    const [u, v] = [index.get(r.from), index.get(r.to)]
    return u === undefined || v === undefined ? [] : [{ ...r, u, v }]
  })
  if (list.length === 0) return { width, height: 0, nodes: [], edges: [] }
  const n = list.length

  // Layers. A cycle is broken where a depth-first walk, in input order, meets an
  // entity still on its own path: that relation is drawn upwards.
  const out = list.map(() => [] as number[])
  rels.forEach((r, k) => {
    if (r.u !== r.v) out[r.u].push(k)
  })
  const back = new Set<number>()
  const state = new Array<0 | 1 | 2>(n).fill(0)
  const walk = (u: number) => {
    state[u] = 1
    for (const k of out[u]) {
      if (state[rels[k].v] === 1) back.add(k)
      else if (state[rels[k].v] === 0) walk(rels[k].v)
    }
    state[u] = 2
  }
  list.forEach((_, u) => {
    if (state[u] === 0) walk(u)
  })
  // The longest way down to an entity pointing at nothing: those sit at the bottom, the rest above what they point at.
  const depth = new Array<number>(n).fill(-1)
  const down = (u: number): number =>
    depth[u] >= 0 ? depth[u] : (depth[u] = Math.max(0, ...out[u].filter((k) => !back.has(k)).map((k) => 1 + down(rels[k].v))))
  const linked = new Array<boolean>(n).fill(false)
  rels.forEach((r) => {
    if (r.u !== r.v) linked[r.u] = linked[r.v] = true
  })
  const deepest = Math.max(-1, ...list.map((_, u) => (linked[u] ? down(u) : -1)))
  // An entity with no relation to another goes in a last layer of its own.
  const layers: number[][] = []
  list.forEach((_, u) => (layers[linked[u] ? deepest - down(u) : deepest + 1] ??= []).push(u))

  // The grid: as many columns as the width holds at the narrowest box, no more than the widest row needs. A
  // layer too wide for them wraps onto as few rows as hold it, as evenly as can be: 5 on 4 columns is 3 and 2.
  const fits = Math.max(1, Math.floor((width - GAP_X) / (MIN_NODE_W + GAP_X)))
  const perRow = (count: number) => Math.ceil(count / Math.ceil(count / fits))
  const cols = Math.max(...layers.filter(Boolean).map((l) => perRow(l.length)))
  const w = Math.floor(Math.min(MAX_NODE_W, Math.max(MIN_NODE_W, (width - (cols + 1) * GAP_X) / cols)))
  const gridW = cols * w + (cols + 1) * GAP_X
  const W = Math.max(width, gridW)
  const left = Math.floor((W - gridW) / 2) + GAP_X
  const colX = (c: number) => left + c * (w + GAP_X)
  /** Lane l runs down the left of column l; lane `cols` down the right of the last. */
  const laneX = (l: number) => colX(l) - GAP_X / 2

  // Rows: each layer ordered under the entities it joins above (the barycentre), then wrapped.
  const neighbours = list.map(() => [] as number[])
  rels.forEach((r) => {
    if (r.u === r.v) return
    neighbours[r.u].push(r.v)
    neighbours[r.v].push(r.u)
  })
  const col = new Array<number>(n).fill(-1)
  const row = new Array<number>(n).fill(-1)
  const rows: number[][] = []
  for (const layer of layers.filter(Boolean)) {
    const wants = layer.map((u) => {
      const placed = neighbours[u].filter((v) => col[v] >= 0)
      return { u, want: placed.length ? placed.reduce((s, v) => s + col[v], 0) / placed.length : undefined }
    })
    // One joining nothing above goes after the rest, in input order.
    wants.sort((a, b) => (a.want ?? Infinity) - (b.want ?? Infinity) || a.u - b.u)
    for (let s = 0; s < wants.length; s += perRow(wants.length)) {
      const chunk = wants.slice(s, s + perRow(wants.length))
      // Each in the free column nearest where it wants to be, keeping their order; the rest centred.
      let prev = -1
      chunk.forEach(({ u, want }, i) => {
        const at = Math.ceil((want ?? (cols - chunk.length) / 2 + i) - 0.5)
        col[u] = prev = Math.max(prev + 1, Math.min(cols - chunk.length + i, at))
        row[u] = rows.length
      })
      rows.push(chunk.map((c) => c.u))
    }
  }

  // Each of a box's self-relations takes a corner, over its top or under its bottom, in turn: one with at most
  // one loop, then one leaving the side's lines room for their arrowheads (else the most room), then one no
  // loop has taken yet, then where the fewest of its lines head past it (to a box in a column beyond), then
  // where it has the fewest lines. One on a taken corner goes round the loop there, its ends further apart and
  // its apex further out, so no two share an end. Every label sits beyond the side's tallest loop, a row
  // further out for each loop before it on that side. The loops get room of their own on that side, past the
  // gap the rows keep for lines.
  // ponytail: past eight loops on one box, a corner's third loop and on keep its second's inner end, and the
  // lines of a side with no room left squeeze between its loops. Four corners nested once are a box's worth; a
  // model needing more self-relations on one entity wants a side of its own for them.
  type Loop = { top: boolean; right: boolean; nest: number; h: number; level: number }
  const corners = list.map(() => [] as Loop[])
  /** How far in from the box's end its lines start at that corner: past the outer loop there, if any. */
  const inset = (u: number, top: boolean, right: boolean, nest = corners[u].filter((c) => c.top === top && c.right === right).length) =>
    nest ? LOOP_OUT + 10 + NEST * (nest - 1) : PORT_INSET
  const loopOf = new Map<number, Loop>()
  rels.forEach((r, k) => {
    if (r.u !== r.v) return
    const u = r.u
    const options = [true, false].flatMap((right) =>
      [true, false].map((top) => {
        const side = neighbours[u].filter((v) => (row[v] < row[u]) === top)
        const nest = corners[u].filter((c) => c.top === top && c.right === right).length
        const gap = side.length ? (w - inset(u, top, right, nest + 1) - inset(u, top, !right)) / side.length : Infinity
        const past = side.filter((v) => col[v] !== col[u] && (col[v] > col[u]) === right).length
        return { top, right, nest, cost: [Number(nest > 1), Math.max(0, MIN_PORT_GAP - gap), nest, past, side.length] }
      }),
    )
    const { top, right, nest } = options.reduce((best, o) => {
      const d = o.cost.findIndex((c, i) => c !== best.cost[i])
      return d >= 0 && o.cost[d] < best.cost[d] ? o : best
    })
    const loop = { top, right, nest, h: LOOP_H + LOOP_STEP * nest, level: corners[u].filter((c) => c.top === top).length }
    corners[u].push(loop)
    loopOf.set(k, loop)
  })
  /** The tallest of a side's loops: its labels sit beyond it. */
  const tallest = (u: number, top: boolean) => Math.max(0, ...corners[u].filter((c) => c.top === top).map((c) => c.h))
  /** How far a side's loops reach from the box: the apex, or the outermost label beyond it. */
  const reach = (u: number, top: boolean) => {
    const levels = corners[u].filter((c) => c.top === top).length
    return levels ? Math.max(tallest(u, top), loopLabel(tallest(u, top), levels - 1) + LABEL_H / 2) + 4 : 0
  }
  const room = (r: number, top: boolean) => Math.max(0, ...rows[r].map((u) => reach(u, top)))
  const rowY: number[] = []
  rows.forEach((_, r) => rowY.push(r === 0 ? PAD + room(0, true) : rowY[r - 1] + NODE_H + GAP_Y + room(r - 1, false) + room(r, true)))
  /** The middle of the gap between row r and the one below. */
  const gapBelow = (r: number) => (rowY[r] + NODE_H + rowY[r + 1]) / 2

  const nodes: GraphNode[] = list.map((e, u) => ({
    name: e.name,
    source: e.source,
    x: colX(col[u]),
    y: rowY[row[u]],
    w,
    h: NODE_H,
    nameText: fit(e.name, w - 2 * TEXT_PAD, (t) => measure(t, NAME_FONT)),
    sourceText: e.source ? fit(e.source, w - 2 * TEXT_PAD, (t) => measure(t, SOURCE_FONT)) : null,
  }))
  const cx = (u: number) => nodes[u].x + w / 2
  /** A point of the box's loop: `d` px in from the end of the box it takes; out, away from the box, `o` px from its side. */
  const loopPoint = (u: number, { top, right }: Loop) => (d: number, o: number) =>
    pt(right ? nodes[u].x + w - d : nodes[u].x + d, top ? nodes[u].y - o : nodes[u].y + NODE_H + o)
  /** Where the loop leaves the box and where it comes back, `d` px in from its end: a nested one round the one inside. */
  const loopEnds = ({ nest }: Loop) => [LOOP_OUT + NEST * nest, LOOP_IN - NEST * Math.min(nest, 1)]
  /** The loop's curve, from the box's side to its apex 3/4 of its height out: what labels and lines keep off. */
  const curveOf = (u: number, loop: Loop): GraphBox => {
    const [out, back] = loopEnds(loop)
    const [a, b] = [loopPoint(u, loop)(out + 10, 0.75 * loop.h), loopPoint(u, loop)(back - 10, 0)]
    return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) }
  }

  // Routes. A line between rows next to each other runs straight across their gap. Further apart it runs
  // straight only when no box lies within half a box of its middle line (its ends sit at most that far off
  // it); otherwise it takes the nearest lane. Of two as near, one down a column of its own, it takes the
  // emptier: a loop in its way it passes with a lead-in, below.
  const laneUse = new Array<number>(cols + 1).fill(0)
  const lane = new Map<number, number>()
  rels.forEach((r, k) => {
    if (r.u === r.v || Math.abs(row[r.u] - row[r.v]) === 1) return
    const [a, b] = [Math.min(row[r.u], row[r.v]), Math.max(row[r.u], row[r.v])]
    const [p, q] = row[r.u] < row[r.v] ? [pt(cx(r.u), rowY[a] + NODE_H), pt(cx(r.v), rowY[b])] : [pt(cx(r.v), rowY[a] + NODE_H), pt(cx(r.u), rowY[b])]
    const blocked = rows
      .slice(a + 1, b)
      .flat()
      .some((m) => crosses(p, q, { x: nodes[m].x - w / 2, y: nodes[m].y, w: 2 * w, h: NODE_H }))
    if (!blocked) return
    const at = ((cx(r.u) + cx(r.v)) / 2 - laneX(0)) / (w + GAP_X)
    const [lo, hi] = [Math.max(0, Math.floor(at)), Math.min(cols, Math.ceil(at))]
    const l = at - lo !== hi - at ? (at - lo < hi - at ? lo : hi) : laneUse[lo] <= laneUse[hi] ? lo : hi
    lane.set(k, laneX(l) + LANE_OFFSETS[laneUse[l]++ % LANE_OFFSETS.length])
  })

  // Ports: a box's lines leave its top or bottom side by side, in the order of where they head, so they
  // neither cross at the box nor share an arrowhead (the loops leave them room for that, above). Loops keep
  // their corners to themselves.
  type End = { k: number; u: number; top: boolean; toward: number }
  const ends: End[] = rels.flatMap((r, k) => {
    if (r.u === r.v) return []
    const goesDown = row[r.u] < row[r.v]
    return [
      { k, u: r.u, top: !goesDown, toward: lane.get(k) ?? cx(r.v) },
      { k, u: r.v, top: goesDown, toward: lane.get(k) ?? cx(r.u) },
    ]
  })
  const sides = new Map<string, End[]>()
  for (const e of ends) {
    const key = `${e.u}:${e.top}`
    sides.set(key, [...(sides.get(key) ?? []), e])
  }
  const port = new Map<string, GraphPoint>()
  for (const [key, side] of sides) {
    const { u, top } = side[0]
    const from = nodes[u].x + inset(u, top, false)
    const to = nodes[u].x + w - inset(u, top, true)
    side
      .sort((a, b) => a.toward - b.toward || a.k - b.k)
      .forEach((e, i) => port.set(`${e.k}:${key}`, pt(from + ((to - from) * (i + 0.5)) / side.length, top ? nodes[u].y : nodes[u].y + NODE_H)))
  }

  const routed = rels.map((r, k) => {
    if (r.u === r.v) {
      const loop = loopOf.get(k)!
      const at = loopPoint(r.u, loop)
      const [out, back] = loopEnds(loop)
      const points = [at(out, 0), at(out + 10, loop.h), at(back - 10, loop.h), at(back, 0)]
      const { arrow, stop } = arrowhead(points[2], points[3])
      const [p0, c1, c2] = points
      const d = `M${p0.x} ${p0.y}C${c1.x} ${c1.y} ${c2.x} ${c2.y} ${stop.x} ${stop.y}`
      const mid = [at((out + back) / 2, loopLabel(tallest(r.u, loop.top), loop.level))]
      return { r, points, arrow, d, curve: curveOf(r.u, loop), mid }
    }
    const goesDown = row[r.u] < row[r.v]
    const start = port.get(`${k}:${r.u}:${!goesDown}`)!
    const end = port.get(`${k}:${r.v}:${goesDown}`)!
    const x = lane.get(k)
    // The middle of the first gap the line crosses, and of the last.
    const [g0, g1] = goesDown ? [gapBelow(row[r.u]), gapBelow(row[r.v] - 1)] : [gapBelow(row[r.u] - 1), gapBelow(row[r.v])]
    const via = x === undefined ? [] : [pt(x, g0), pt(x, g1)]
    // One that would cut through a loop of its row, on that side, on the way to the gap's middle first runs
    // straight out past the tallest of them: from there no loop is in its way, and each such line turns where
    // it is, so none runs along another.
    const lead = (u: number, p: GraphPoint, top: boolean, toward: number, g: number) => {
      const loops = rows[row[u]].flatMap((m) => corners[m].filter((c) => c.top === top).map((c) => ({ c, curve: curveOf(m, c) })))
      if (!loops.some(({ curve }) => crosses(p, { x: toward, y: g }, curve))) return []
      const out = Math.max(...loops.map(({ c }) => c.h))
      return [pt(p.x, top ? Math.max(p.y - out, g) : Math.min(p.y + out, g))]
    }
    const points = [
      start,
      ...lead(r.u, start, !goesDown, (via[0] ?? end).x, g0),
      ...via,
      ...lead(r.v, end, goesDown, (via[1] ?? start).x, g1),
      end,
    ]
    const { arrow, stop } = arrowhead(points[points.length - 2], end)
    const d = `M${[...points.slice(0, -1), stop].map((p) => `${p.x} ${p.y}`).join("L")}`
    // Where the label may go, best first: the midpoint, a lane's turns (always in a gap), then along the line
    // every 5%, nearest the midpoint first.
    const mid = [0.5, ...points.slice(1, -1), ...ALONG].map((c) => (typeof c === "number" ? along(points, c) : c))
    return { r, points, arrow, d, curve: undefined, mid }
  })

  // Labels, loops' first, each at the best of its spots: on its line at the midpoint, at a lane's turn or
  // further along, then beside the line at each of those. Best is, in order: hiding the least of the labels
  // already placed, then of the boxes, then of the arrowheads and loops, then crossing the fewest other lines;
  // the first such spot wins, so a label sits on its midpoint whenever that is clear.
  const marks = routed.flatMap(({ arrow, curve }) => {
    const [xs, ys] = [arrow.map((p) => p.x), arrow.map((p) => p.y)]
    const head = { x: Math.min(...xs) - 1, y: Math.min(...ys) - 1, w: Math.max(...xs) - Math.min(...xs) + 2, h: Math.max(...ys) - Math.min(...ys) + 2 }
    return curve ? [head, curve] : [head]
  })
  const segments = routed.flatMap(({ r, points }, k) => (r.u === r.v ? [] : points.slice(1).map((q, i) => ({ k, p: points[i], q }))))
  const placed: GraphBox[] = []
  const hidden = (b: GraphBox, under: GraphBox[]) =>
    under.reduce((s, o) => s + Math.max(0, Math.min(b.x + b.w, o.x + o.w) - Math.max(b.x, o.x)) * Math.max(0, Math.min(b.y + b.h, o.y + o.h) - Math.max(b.y, o.y)), 0)
  const costs = (b: GraphBox, k: number) => [
    () => hidden(b, placed),
    () => hidden(b, nodes),
    () => hidden(b, marks),
    () => new Set(segments.filter((o) => o.k !== k && crosses(o.p, o.q, b)).map((o) => o.k)).size,
  ]
  const labels = new Map<number, GraphBox & { text: string }>()
  const order = routed.map((_, k) => k).sort((a, b) => Number(rels[b].u === rels[b].v) - Number(rels[a].u === rels[a].v) || a - b)
  for (const k of order) {
    const text = fit(rels[k].type, MAX_LABEL_W - 8, (t) => measure(t, LABEL_FONT))
    const lw = Math.min(MAX_LABEL_W, measure(text, LABEL_FONT) + 8)
    const box = (x: number, y: number) => ({ x: round(Math.min(Math.max(x, 2), W - lw - 2)), y: round(y - LABEL_H / 2), w: round(lw), h: LABEL_H })
    const { mid } = routed[k]
    const spots = [...mid.map((c) => box(c.x - lw / 2, c.y)), ...mid.flatMap((c) => [box(c.x + 4, c.y), box(c.x - 4 - lw, c.y)])]
    let best = { spot: spots[0], cost: [Infinity, Infinity, Infinity, Infinity] }
    for (const spot of spots) {
      // Each cost only as far as it decides against the best so far: the line count is the dear one.
      const parts = costs(spot, k)
      const c: number[] = []
      for (const part of parts) {
        c.push(part())
        if (c[c.length - 1] !== best.cost[c.length - 1]) break
      }
      if (c[c.length - 1] < best.cost[c.length - 1]) best = { spot, cost: [...c, ...parts.slice(c.length).map((f) => f())] }
      if (best.cost.every((v) => v === 0)) break
    }
    placed.push(best.spot)
    labels.set(k, { ...best.spot, text })
  }

  const edges: GraphEdge[] = routed.map(({ r, points, arrow, d }, k) => ({
    from: r.from,
    to: r.to,
    type: r.type,
    loop: r.u === r.v,
    points,
    d,
    arrow,
    label: labels.get(k)!,
  }))
  const bottom = Math.max(...nodes.map((b) => b.y + b.h), ...edges.map((e) => e.label.y + e.label.h))
  return { width: W, height: bottom + PAD, nodes, edges }
}
