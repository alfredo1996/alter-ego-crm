import { describe, expect, it } from "vitest"

import { isOwner, OWNER_UID, OWNER_UID_PLACEHOLDER } from "../owner-uid"

describe("isOwner", () => {
  it("refuses the placeholder itself, so a copy nobody configured has no owner", () => {
    expect(isOwner(OWNER_UID_PLACEHOLDER)).toBe(false)
    expect(OWNER_UID_PLACEHOLDER).toBe("OWNER_UID_NOT_SET")
  })

  it("refuses a stranger and an empty uid", () => {
    expect(isOwner("some-other-user-uid")).toBe(false)
    expect(isOwner("")).toBe(false)
  })

  it("admits the configured uid, and nobody when none is configured", () => {
    expect(isOwner(OWNER_UID)).toBe(OWNER_UID !== OWNER_UID_PLACEHOLDER)
  })
})
