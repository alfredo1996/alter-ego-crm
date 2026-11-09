import { describe, expect, it } from "vitest"

import { normalizeSolutionSections } from "@/types/schemas"

import { solutionForm, solutionUpdate, withClient } from "../solution-form-dialog"
import { dataModelDraft, dataModelUpdate, removeEntity } from "../solution-page"

import type { Solution } from "@/types"

const ENGAGEMENTS = [
  { id: "e1", clientId: "c1" },
  { id: "e2", clientId: "c2" },
]
const at = new Date(2026, 0, 1)
const OPENED: Solution = {
  id: "s1", userId: "u1", clientId: "c1", engagementId: "e1", name: "Product knowledge graph", status: "building",
  domain: "retail", stack: ["neo4j", "kafka"], sections: normalizeSolutionSections({}), entities: [], relations: [],
  createdAt: at, updatedAt: at,
}

describe("withClient", () => {
  it("clears a contract of another client: the solution goes back to pre-sales", () => {
    const form = { ...solutionForm(null, "c1"), engagementId: "e1" }
    expect(withClient(form, "c2", ENGAGEMENTS)).toMatchObject({ clientId: "c2", engagementId: null })
  })

  it("keeps the contract when it is the new client's", () => {
    const form = { ...solutionForm(null, null), engagementId: "e2" }
    expect(withClient(form, "c2", ENGAGEMENTS)).toMatchObject({ clientId: "c2", engagementId: "e2" })
  })
})

describe("solutionUpdate", () => {
  it("writes nothing when nothing changed", () => {
    expect(solutionUpdate(OPENED, solutionForm(OPENED, null))).toEqual({})
  })

  it("writes only the fields that changed; a blank domain is null", () => {
    const form = { ...solutionForm(OPENED, null), status: "delivered" as const, domain: " ", stack: ["neo4j", "kafka", "gds"] }
    expect(solutionUpdate(OPENED, form)).toEqual({ status: "delivered", domain: null, stack: ["neo4j", "kafka", "gds"] })
  })
})

describe("dataModelDraft", () => {
  it("holds each relation end as its entity's row", () => {
    const entities = [
      { name: "Product", source: "SAP MARA", notes: null },
      { name: "Category", source: null, notes: null },
    ]
    expect(dataModelDraft({ entities, relations: [{ from: "Product", to: "Category", type: "IN_CATEGORY" }] })).toEqual({
      entities: [
        { name: "Product", source: "SAP MARA", notes: "" },
        { name: "Category", source: "", notes: "" },
      ],
      relations: [{ from: 0, to: 1, type: "IN_CATEGORY" }],
    })
  })
})

describe("dataModelUpdate", () => {
  const draft = {
    entities: [
      { name: "Product", source: "SAP MARA", notes: " " },
      { name: "Category", source: "", notes: "" },
    ],
    relations: [{ from: 0, to: 1, type: "IN_CATEGORY" }],
  }

  it("sends the entities and the relations together, blanks as null, each end by its entity's name", () => {
    expect(dataModelUpdate(draft)).toEqual({
      input: {
        entities: [
          { name: "Product", source: "SAP MARA", notes: null },
          { name: "Category", source: null, notes: null },
        ],
        relations: [{ from: "Product", to: "Category", type: "IN_CATEGORY" }],
      },
    })
  })

  it("names the row of a relation with an end empty, and of a twice-listed entity", () => {
    expect(dataModelUpdate({ ...draft, relations: [{ from: 0, to: null, type: "IN" }] })).toEqual({
      errors: ["Relation 1: pick an entity at each end"],
    })
    expect(dataModelUpdate({ ...draft, entities: [...draft.entities, { name: "Product", source: "", notes: "" }] })).toEqual({
      errors: ['Entity 3: "Product" is listed twice'],
    })
  })

  it("reports an unnamed entity once, on the entity, not again on its relations", () => {
    expect(dataModelUpdate({ ...draft, entities: [draft.entities[0], { name: " ", source: "", notes: "" }] })).toEqual({
      errors: ["Entity 2: Name the entity"],
    })
  })

  it("keeps a relation on its entity through a rename that passes another entity's name", () => {
    // OrderLine to OrderItem, a keystroke at a time, is "Order" for a moment: entity 1's name.
    let d = {
      entities: ["Order", "OrderLine", "Product"].map((name) => ({ name, source: "", notes: "" })),
      relations: [
        { from: 0, to: 1, type: "HAS_LINE" },
        { from: 1, to: 2, type: "OF_PRODUCT" },
      ],
    }
    for (const name of ["OrderLin", "OrderLi", "OrderL", "Order", "OrderI", "OrderIt", "OrderIte", "OrderItem"]) {
      d = { ...d, entities: d.entities.map((e, j) => (j === 1 ? { ...e, name } : e)) }
    }
    expect(dataModelUpdate(d)).toMatchObject({
      input: {
        relations: [
          { from: "Order", to: "OrderItem", type: "HAS_LINE" },
          { from: "OrderItem", to: "Product", type: "OF_PRODUCT" },
        ],
      },
    })
  })
})

describe("removeEntity", () => {
  it("empties the ends that held it, and moves the later rows up", () => {
    const d = {
      entities: ["Order", "OrderLine", "Product"].map((name) => ({ name, source: "", notes: "" })),
      relations: [
        { from: 0, to: 2, type: "OF_PRODUCT" },
        { from: 1, to: 2, type: "OF_PRODUCT" },
      ],
    }
    expect(removeEntity(d, 1)).toEqual({
      entities: [d.entities[0], d.entities[2]],
      relations: [
        { from: 0, to: 1, type: "OF_PRODUCT" },
        { from: null, to: 1, type: "OF_PRODUCT" },
      ],
    })
  })
})
