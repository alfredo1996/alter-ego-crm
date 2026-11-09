/**
 * The data model graph's layout, on made-up models: the fictional Nordwind
 * Retail S.p.A. "Product knowledge graph", and generated shapes from 0 to 20
 * entities (plus one of 100) at a phone's width and a desktop's. What it must
 * never do: lay two boxes on each other, draw a line through a box it does not
 * join, put anything outside its own width and height, or throw on a relation
 * naming nothing. What it must not do on these models: put a label on a box's
 * text or on a loop, a loop's label on another label, give two of a box's loops
 * an end in common, or run a line through a loop; nor, with up to four loops on
 * a box, put two arrowheads on each other.
 */
import { describe, expect, it } from "vitest"

import { layoutSolutionGraph, type GraphBox, type GraphEdge, type GraphLayout, type GraphPoint, type TextMeasure } from "../solution-graph"

import type { SolutionRelation } from "@/types"

const entity = (name: string, source: string | null = null) => ({ name, source })
const rel = (from: string, to: string, type = "RELATES_TO"): SolutionRelation => ({ from, to, type })

const nordwind = {
  entities: [
    entity("Product", "SAP MARA"),
    entity("Category", "SAP T179"),
    entity("Supplier", "SAP LFA1"),
    entity("Order", "Shop orders"),
    entity("Customer", "CRM contacts"),
    entity("SearchQuery", null),
  ],
  relations: [
    rel("Supplier", "Product", "SUPPLIES"),
    rel("Product", "Category", "IN_CATEGORY"),
    rel("Order", "Product", "CONTAINS"),
    rel("Customer", "Order", "PLACED"),
    rel("SearchQuery", "Product", "RETURNED"),
    rel("Product", "Product", "SIMILAR_TO"),
  ],
}

/** The same shop grown to 13 entities, two of them with a loop: a busier model. */
const nordwindGrown = {
  entities: [
    ...nordwind.entities,
    entity("Brand", "PIM brands"),
    entity("Store", "Store master data"),
    entity("Inventory", "WMS stock"),
    entity("Promotion", "Pricing engine"),
    entity("Review", "Ratings feed"),
    entity("Customer lifetime value by channel", "Marketing mart"),
    entity("Warehouse", "WMS"),
  ],
  relations: [
    ...nordwind.relations,
    rel("Product", "Brand", "MADE_BY"),
    rel("Inventory", "Product", "STOCKS"),
    rel("Inventory", "Store", "AT"),
    rel("Promotion", "Product", "DISCOUNTS"),
    rel("Customer", "Review", "WROTE"),
    rel("Review", "Product", "ABOUT"),
    rel("Order", "Store", "FULFILLED_BY"),
    rel("Customer lifetime value by channel", "Customer", "DESCRIBES"),
    rel("Category", "Category", "CHILD_OF"),
    rel("Customer", "Product", "VIEWED"),
    rel("Product", "Order", "LISTED_IN"),
  ],
}

const names = (n: number) => Array.from({ length: n }, (_, i) => `Entity ${i + 1}`)
const ents = (n: number) => names(n).map((name) => entity(name, `System ${i(name)}`))
const i = (name: string) => Number(name.split(" ")[1]) - 1

/** The shapes a real model takes, each for n entities. */
const SHAPES: Record<string, (n: number) => SolutionRelation[]> = {
  chain: (n) => names(n).slice(1).map((to, k) => rel(names(n)[k], to)),
  star: (n) => names(n).slice(1).map((to) => rel("Entity 1", to)),
  "reverse star": (n) => names(n).slice(1).map((from) => rel(from, "Entity 1")),
  cycle: (n) => (n < 2 ? [] : names(n).map((from, k) => rel(from, names(n)[(k + 1) % n]))),
  "complete-ish": (n) => names(n).flatMap((from, k) => names(n).slice(k + 1, k + 4).map((to) => rel(from, to))),
  disconnected: () => [],
  "self-loops": (n) => [...names(n).map((x) => rel(x, x, "SIMILAR_TO")), ...SHAPES.chain(n)],
  duplicates: (n) => SHAPES.chain(n).flatMap((r) => [r, { ...r, type: "ALSO" }, { from: r.to, to: r.from, type: "BACK" }]),
}

const overlap = (a: GraphBox, b: GraphBox) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
const inside = (p: GraphPoint, l: GraphLayout) => p.x >= 0 && p.x <= l.width && p.y >= 0 && p.y <= l.height

/** Whether the segment p→q enters the box's interior (Liang–Barsky, the box shrunk by half a pixel). */
function crosses(p: GraphPoint, q: GraphPoint, b: GraphBox): boolean {
  const [x0, y0, x1, y1] = [b.x + 0.5, b.y + 0.5, b.x + b.w - 0.5, b.y + b.h - 0.5]
  let [t0, t1] = [0, 1]
  const dx = q.x - p.x
  const dy = q.y - p.y
  for (const [num, den] of [
    [p.x - x0, -dx],
    [x1 - p.x, dx],
    [p.y - y0, -dy],
    [y1 - p.y, dy],
  ]) {
    if (den === 0) {
      if (num < 0) return false
    } else {
      const t = num / den
      if (den < 0) t0 = Math.max(t0, t)
      else t1 = Math.min(t1, t)
    }
  }
  return t0 < t1
}

/** A loop's curve, from its box's side to its apex: 3/4 of the way to its control points. */
function curve({ points }: GraphEdge): GraphBox {
  const [p, c] = points
  const xs = points.map((q) => q.x)
  const apex = p.y + 0.75 * (c.y - p.y)
  return { x: Math.min(...xs), y: Math.min(p.y, apex), w: Math.max(...xs) - Math.min(...xs), h: Math.abs(apex - p.y) }
}

/** How far two segments run along each other, on one line: 0 when they only cross or touch. */
function alongside([p, q]: GraphPoint[], [r, s]: GraphPoint[]): number {
  const len = Math.hypot(q.x - p.x, q.y - p.y)
  if (len === 0) return 0
  const [ux, uy] = [(q.x - p.x) / len, (q.y - p.y) / len]
  if ([r, s].some((z) => Math.abs((z.x - p.x) * uy - (z.y - p.y) * ux) > 0.5)) return 0
  const [a, b] = [r, s].map((z) => (z.x - p.x) * ux + (z.y - p.y) * uy)
  return Math.max(0, Math.min(len, Math.max(a, b)) - Math.max(0, Math.min(a, b)))
}

/** Two arrowheads at one side of a box further apart than one's 8 px, and no two lines along each other. */
function expectApart(l: GraphLayout) {
  const lines = l.edges.filter((e) => !e.loop)
  const tips = lines.map((e) => ({ to: e.to, ...e.arrow[0] }))
  for (const [k, a] of tips.entries())
    for (const b of tips.slice(k + 1)) if (a.to === b.to && a.y === b.y) expect(Math.abs(a.x - b.x), `two arrowheads on ${a.to}`).toBeGreaterThanOrEqual(8)
  const runs = lines.map((e) => e.points.slice(1).map((q, k) => [e.points[k], q]))
  for (const [k, a] of runs.entries())
    for (const [j, b] of runs.slice(k + 1).entries())
      expect(Math.max(...a.flatMap((x) => b.map((y) => alongside(x, y)))), `${lines[k].type} along ${lines[k + 1 + j].type}`).toBeLessThan(2)
}

/** Every rule the drawing depends on, for one layout: each broken one named, so a failure says which. */
function expectSound(l: GraphLayout, entities: number, relations: number) {
  expect(l.nodes).toHaveLength(entities)
  expect(l.edges).toHaveLength(relations)
  const broken: string[] = []
  const check = (ok: boolean, rule: string) => ok || broken.push(rule)
  const within = (b: GraphBox) => inside(b, l) && inside({ x: b.x + b.w, y: b.y + b.h }, l)
  l.nodes.forEach((a, k) => {
    for (const b of l.nodes.slice(k + 1)) check(!overlap(a, b), `${a.name} on ${b.name}`)
    check(within(a), `${a.name} inside`)
  })
  const box = new Map(l.nodes.map((n) => [n.name, n]))
  const loops = l.edges.filter((e) => e.loop)
  for (const e of l.edges) {
    const label = `${e.from} ${e.type} ${e.to}`
    check([...e.points, ...e.arrow].every((p) => inside(p, l)), `${label} inside`)
    check(within(e.label), `${label} label inside`)
    // A label hides no box's name or source, and no other box's loop.
    for (const n of l.nodes) check(!overlap(e.label, { x: n.x + 8, y: n.y + 6, w: n.w - 16, h: 32 }), `${label} label on ${n.name}`)
    for (const o of loops) check(!overlap(e.label, curve(o)), `${label} label on ${o.from} ${o.type}'s loop`)
    if (e.loop) for (const o of l.edges) if (o !== e) check(!overlap(e.label, o.label), `${label} label on ${o.from} ${o.type} ${o.to}'s`)
    if (e.loop) continue
    const through = (b: GraphBox) => e.points.slice(1).some((q, k) => crosses(e.points[k], q, b))
    // A line never runs through a box it does not join, nor through a loop.
    for (const n of l.nodes) if (n.name !== e.from && n.name !== e.to) check(!through(n), `${label} through ${n.name}`)
    for (const o of loops) check(!through(curve(o)), `${label} through ${o.from}'s loop`)
    // It leaves its source's border and its arrow's tip is on the target's border.
    const [from, to] = [box.get(e.from)!, box.get(e.to)!]
    const tip = e.points[e.points.length - 1]
    check((tip.y === to.y || tip.y === to.y + to.h) && tip.x >= to.x && tip.x <= to.x + to.w, `${label} tip on the border`)
    check(e.points[0].y === from.y || e.points[0].y === from.y + from.h, `${label} starts on the border`)
    check(e.arrow[0].x === tip.x && e.arrow[0].y === tip.y, `${label} arrow at the tip`)
  }
  // A box's loops each leave and come back at points of their own.
  const ends = loops.flatMap((o) => [o.points[0], o.points[3]].map((p) => `${o.from} at ${p.x},${p.y}`))
  for (const [k, end] of ends.entries()) check(ends.indexOf(end) === k, `two loops of ${end}`)
  expect(broken).toEqual([])
}

describe("layoutSolutionGraph", () => {
  it("lays out nothing for no entities", () => {
    expect(layoutSolutionGraph([], [], { width: 343 })).toEqual({ width: 343, height: 0, nodes: [], edges: [] })
    expect(layoutSolutionGraph([], [rel("A", "B")], { width: 700 }).edges).toEqual([])
  })

  it.each([343, 700])("lays out the Nordwind model at %i px with no box on another", (width) => {
    const l = layoutSolutionGraph(nordwind.entities, nordwind.relations, { width })
    expect(l.width).toBe(width)
    expectSound(l, 6, 6)
    expect(l.nodes.map((n) => n.name).sort()).toEqual(nordwind.entities.map((e) => e.name).sort())
    const product = l.nodes.find((n) => n.name === "Product")!
    expect(product).toMatchObject({ source: "SAP MARA", nameText: "Product", sourceText: "SAP MARA" })
    expect(l.nodes.find((n) => n.name === "SearchQuery")).toMatchObject({ source: null, sourceText: null })
    // Product SIMILAR_TO Product is a loop under Product's bottom: three lines come in over its top, one leaves below.
    const similar = l.edges.find((e) => e.type === "SIMILAR_TO")!
    expect(similar.loop).toBe(true)
    expect(similar.points[0].y).toBe(product.y + product.h)
    expect(Math.max(...similar.points.map((p) => p.y))).toBeGreaterThan(product.y + product.h)
    // Who feeds whom reads top to bottom: Customer above Order above Product above Category.
    const y = (name: string) => l.nodes.find((n) => n.name === name)!.y
    expect(y("Customer")).toBeLessThan(y("Order"))
    expect(y("Order")).toBeLessThan(y("Product"))
    expect(y("Product")).toBeLessThan(y("Category"))
  })

  it.each([343, 700])("lays out the grown Nordwind model at %i px with no line through a loop nor a label on one", (width) => {
    expectSound(layoutSolutionGraph(nordwindGrown.entities, nordwindGrown.relations, { width }), 13, 17)
  })

  /** Up to six self-relations on one entity: Product's in the Nordwind model, and with four lines into its top; Category's in the grown one; a star's leaf's; a lone box's. */
  const SELF = ["SIMILAR_TO", "VARIANT_OF", "REPLACES", "BUNDLED_WITH", "UPSELLS", "SUCCEEDS"]
  const self = (name: string, n: number, from = 1) => SELF.slice(from, n).map((t) => rel(name, name, t))
  const LEAVES = ["Category", "Brand", "Supplier", "Warehouse", "Store", "Promotion", "Review", "Inventory"]
  const fourIn = {
    entities: [...nordwind.entities, entity("WAREHOUSE_MOVEMENT_LOG", "WMS MSEG")],
    relations: [...nordwind.relations, rel("WAREHOUSE_MOVEMENT_LOG", "Product", "MOVES")],
  }
  const withLoops = (n: number) => [
    { entities: nordwind.entities, relations: [...nordwind.relations, ...self("Product", n)] },
    { entities: fourIn.entities, relations: [...fourIn.relations, ...self("Product", n)] },
    { entities: nordwindGrown.entities, relations: [...nordwindGrown.relations, ...self("Category", n)] },
    // Product's lines fan out across the leaves' row, past Review's loops.
    {
      entities: [entity("Product", "SAP MARA"), ...LEAVES.map((name) => entity(name, "PIM"))],
      relations: [...LEAVES.map((leaf) => rel("Product", leaf, "HAS")), ...self("Review", n, 0)],
    },
    { entities: [entity("Product", "SAP MARA")], relations: self("Product", n, 0) },
  ]
  /** Which of its box's corners a loop takes: over its top or under its bottom, at its right end or its left. */
  const corner = (l: GraphLayout, e: GraphEdge) => {
    const box = l.nodes.find((b) => b.name === e.from)!
    return `${e.points[1].y < box.y ? "top" : "bottom"} ${e.points[0].x > box.x + box.w / 2 ? "right" : "left"}`
  }

  describe.each([2, 3, 4])("%i self-relations on one entity", (n) => {
    it.each([343, 700, 1280])("gives each loop its own place and its label a spot clear of every loop and label, at %i px", (width) => {
      for (const { entities, relations } of withLoops(n)) {
        const l = layoutSolutionGraph(entities, relations, { width })
        expectSound(l, entities.length, relations.length)
        const labels = l.edges.map((e) => e.label)
        for (const [k, a] of labels.entries()) for (const b of labels.slice(k + 1)) expect(overlap(a, b), `${a.text} on ${b.text}`).toBe(false)
        expectApart(l)
      }
    })
  })

  it.each([343, 500, 700])("turns each lead-in past the loops where it is, so no two lines run along each other, at %i px", (width) => {
    // Lines leave Product's bottom past two loops there, side by side, for the lane down to Category and Brand.
    const relations = [...nordwindGrown.relations, ...self("Product", 3)]
    const l = layoutSolutionGraph(nordwindGrown.entities, relations, { width })
    expectSound(l, 13, 19)
    expectApart(l)
  })

  it("puts a lone box's first four loops at a corner each", () => {
    const [, , , , lone] = withLoops(4)
    const l = layoutSolutionGraph(lone.entities, lone.relations, { width: 343 })
    expect(new Set(l.edges.map((e) => corner(l, e))).size).toBe(4)
  })

  it.each([300, 343])("keeps a busy side's lines room for their arrowheads: loops go where the lines are fewer, then round another, at %i px", (width) => {
    // Four lines come into Product's top and one leaves its bottom.
    const [, fourLines] = withLoops(2)
    const two = layoutSolutionGraph(fourLines.entities, fourLines.relations, { width })
    expect(two.edges.filter((e) => e.loop).map((e) => corner(two, e))).toEqual(["bottom right", "bottom left"])
    const [, four] = withLoops(4)
    const l = layoutSolutionGraph(four.entities, four.relations, { width })
    const loops = l.edges.filter((e) => e.loop)
    // Two corners of a side would leave the top's four arrowheads under 10 px each: the fourth loop goes round one instead.
    expect(new Set(loops.map((e) => corner(l, e))).size).toBe(3)
    const [inner, outer] = loops.filter((e) => loops.some((o) => o !== e && corner(l, o) === corner(l, e)))
    const span = (e: GraphEdge) => [Math.min(e.points[0].x, e.points[3].x), Math.max(e.points[0].x, e.points[3].x)]
    expect(span(outer)[0]).toBeLessThan(span(inner)[0])
    expect(span(outer)[1]).toBeGreaterThan(span(inner)[1])
  })

  it("lays out more than four loops on one box the same every time, inside its bounds, no two drawn alike", () => {
    for (const width of [343, 700]) {
      for (const { entities, relations } of withLoops(6)) {
        const run = () => layoutSolutionGraph(entities, relations, { width })
        const l = run()
        expect(run()).toEqual(l)
        const loops = l.edges.filter((e) => e.loop)
        expect(loops.length).toBeGreaterThanOrEqual(6)
        // A fifth and a sixth loop go round two of the first four: up to eight, no two share an end.
        const ends = loops.flatMap((e) => [e.points[0], e.points[3]].map((p) => `${e.from} ${p.x},${p.y}`))
        expect(new Set(ends).size).toBe(ends.length)
        const corners = l.edges.flatMap((e) => [...e.points, ...e.arrow, e.label, { x: e.label.x + e.label.w, y: e.label.y + e.label.h }])
        expect(corners.filter((p) => !inside(p, l))).toEqual([])
        l.nodes.forEach((a, k) => l.nodes.slice(k + 1).forEach((b) => expect(overlap(a, b)).toBe(false)))
      }
    }
  })

  it("keeps a label off a box's text when every spot near its line's middle is taken", () => {
    // On a phone the relation closing this cycle runs up the left lane past Account, whose name its label once hid.
    const crm = ["Customer", "Account", "Order", "Invoice", "Address"].map((name) => entity(name, "CRM"))
    const l = layoutSolutionGraph(
      crm,
      [
        rel("Customer", "Account", "BELONGS_TO"),
        rel("Account", "Order", "HAS"),
        rel("Order", "Invoice", "IN_CATEGORY"),
        rel("Account", "Address", "IN_CATEGORY"),
        rel("Invoice", "Customer", "BELONGS_TO"),
      ],
      { width: 343 },
    )
    expectSound(l, 5, 5)
    expect(l.edges[4].points.length).toBe(4)
  })

  it("puts fewer boxes on a row on a phone, so the graph grows taller, not wider", () => {
    const perRow = (l: GraphLayout) => Math.max(...[...Map.groupBy(l.nodes, (n) => n.y).values()].map((r) => r.length))
    const phone = layoutSolutionGraph(nordwind.entities, nordwind.relations, { width: 343 })
    const desktop = layoutSolutionGraph(nordwind.entities, nordwind.relations, { width: 700 })
    expect(perRow(phone)).toBe(2)
    expect(perRow(desktop)).toBe(3)
    expect(phone.height).toBeGreaterThan(desktop.height)
  })

  describe.each(Object.keys(SHAPES))("%s", (shape) => {
    it.each([343, 700])("never overlaps, from 0 to 20 entities, at %i px", (width) => {
      for (let n = 0; n <= 20; n++) {
        const relations = SHAPES[shape](n)
        const l = layoutSolutionGraph(ents(n), relations, { width })
        expect(l.width).toBe(width)
        expectSound(l, n, relations.length)
      }
    })
  })

  it("lays out 100 entities and 300 relations without overlap, in well under a second", () => {
    // A fixed pseudo-random graph: the same every run.
    let seed = 7
    const next = (m: number) => ((seed = (seed * 48271) % 2147483647), seed % m)
    const relations = Array.from({ length: 300 }, () => rel(`Entity ${next(100) + 1}`, `Entity ${next(100) + 1}`, `TYPE_${next(9)}`))
    const started = performance.now()
    const l = layoutSolutionGraph(ents(100), relations, { width: 343 })
    // Some 80 ms on a laptop: the budget is for a blow-up, not for a loaded machine (three modes at once took 1.5 s+).
    expect(performance.now() - started).toBeLessThan(10_000)
    expectSound(l, 100, 300)
    expectSound(layoutSolutionGraph(ents(100), relations, { width: 700 }), 100, 300)
  })

  it("ignores a relation naming a missing entity, and a repeated name, without throwing", () => {
    const l = layoutSolutionGraph(
      [entity("Product"), entity("Category"), entity("Product", "second")],
      [rel("Product", "Category", "IN_CATEGORY"), rel("Product", "Ghost", "HAUNTS"), rel("Ghost", "Ghost")],
      { width: 700 },
    )
    expect(l.nodes.map((n) => [n.name, n.source])).toEqual([
      ["Product", null],
      ["Category", null],
    ])
    expect(l.edges.map((e) => e.type)).toEqual(["IN_CATEGORY"])
  })

  it("is deterministic: the same model lays out the same", () => {
    const run = () => layoutSolutionGraph(nordwind.entities, nordwind.relations, { width: 343 })
    expect(run()).toEqual(run())
    const cycle = () => layoutSolutionGraph(ents(12), SHAPES["complete-ish"](12).concat(SHAPES.cycle(12)), { width: 700 })
    expect(cycle()).toEqual(cycle())
  })

  it("puts each label at its line's midpoint, on a background as wide as its text", () => {
    const l = layoutSolutionGraph([entity("Customer"), entity("Order"), entity("Product")], [rel("Customer", "Order", "PLACED"), rel("Order", "Product", "CONTAINS")], {
      width: 700,
    })
    for (const e of l.edges) {
      const [p, q] = e.points
      expect(e.points).toHaveLength(2)
      expect(e.label.x + e.label.w / 2).toBeCloseTo((p.x + q.x) / 2, 0)
      expect(e.label.y + e.label.h / 2).toBeCloseTo((p.y + q.y) / 2, 0)
      expect(e.label.text).toBe(e.type)
    }
    expect(l.edges[1].label.w).toBeGreaterThan(l.edges[0].label.w)
  })

  it("gives two relations between the same pair lines of their own, in either direction", () => {
    const l = layoutSolutionGraph([entity("Order"), entity("Product")], [rel("Order", "Product", "CONTAINS"), rel("Product", "Order", "LISTED_IN")], {
      width: 700,
    })
    const [a, b] = l.edges
    expect(a.points[0].x).not.toBe(b.points[b.points.length - 1].x)
    expect(overlap(a.label, b.label)).toBe(false)
  })

  it("shortens a long name and source with an ellipsis, keeping the full text", () => {
    const long = "Customer lifetime value by acquisition channel"
    const l = layoutSolutionGraph([entity(long, "Data warehouse mart: marketing attribution v2")], [], { width: 343 })
    const [n] = l.nodes
    expect(n.name).toBe(long)
    expect(n.nameText).toMatch(/^Customer .*…$/)
    expect(n.nameText.length).toBeLessThan(long.length)
    expect(n.sourceText).toMatch(/…$/)
    expect(n.source).toBe("Data warehouse mart: marketing attribution v2")
  })

  it("shortens an all-caps name its box cannot hold, and keeps a mixed-case one as long whole", () => {
    // 16 and 17 characters: capitals are wider than the letters of a mixed-case name.
    const l = layoutSolutionGraph([entity("CUSTOMER_ACCOUNT", "SAP KNA1"), entity("PurchaseOrderLine")], [], { width: 343 })
    expect(l.nodes[0].w).toBe(141)
    expect(l.nodes.map((n) => n.nameText)).toEqual(["CUSTOMER_ACC…", "PurchaseOrderLine"])
  })

  it("fits names, sources and labels to the widths a measure function gives, each in its font: a wide W shortens what the estimate keeps whole", () => {
    const model = [entity("Web Order", "WMS"), entity("Product", "WW stock")]
    const relations = [rel("Web Order", "Product", "WRAPS"), rel("Product", "Web Order", "PLACED")]
    const estimated = layoutSolutionGraph(model, relations, { width: 343 })
    expect(estimated.nodes.map((n) => [n.nameText, n.sourceText])).toEqual([
      ["Web Order", "WMS"],
      ["Product", "WW stock"],
    ])
    expect(estimated.edges.map((e) => e.label.text)).toEqual(["WRAPS", "PLACED"])
    // 6 px a character and a W 100 in a 12 px font, wider in a larger or heavier one, as a real font is. A box
    // has 144 px of room: a name (500 13 px) "W…" is 143.5 px, "We…" 151.7; a source (12 px) "WMS" 112, though
    // it would be 151.7 as a name, and "WW…" 206. A label has 112: "WRAPS" is 124 px of it, "WR…" 112.
    const wideW: TextMeasure = (text, { px, weight = 400, mono }) =>
      [...text].reduce((sum, ch) => sum + (ch === "W" ? 100 : 6), 0) * (mono ? 1 : (px / 12) * (weight / 400))
    const measured = layoutSolutionGraph(model, relations, { width: 343, measure: wideW })
    expect(measured.nodes.map((n) => [n.nameText, n.sourceText])).toEqual([
      ["W…", "WMS"],
      ["Product", "W…"],
    ])
    expect(measured.edges.map((e) => [e.label.text, e.label.w])).toEqual([
      ["WR…", 120],
      ["PLACED", 44],
    ])
    expectSound(measured, 2, 2)
  })

  it("keeps a box its minimum width on a very narrow screen: the graph is wider than asked, one box per row", () => {
    const l = layoutSolutionGraph(ents(3), SHAPES.disconnected(3), { width: 100 })
    expect(l.width).toBeGreaterThan(100)
    expect(new Set(l.nodes.map((n) => n.x)).size).toBe(1)
    expectSound(l, 3, 0)
  })

  it("shows an entity with no relation", () => {
    const l = layoutSolutionGraph([...nordwind.entities, entity("Warehouse", "WMS")], nordwind.relations, { width: 700 })
    expectSound(l, 7, 6)
    expect(l.nodes.map((n) => n.name)).toContain("Warehouse")
  })
})
