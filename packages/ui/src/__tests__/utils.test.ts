import { describe, it, expect } from "vitest"

import { cn } from "../utils"

describe("cn", () => {
  it("merges multiple class names into a single string", () => {
    expect(cn("foo", "bar")).toBe("foo bar")
  })

  it("ignores falsy values", () => {
    expect(cn("foo", false && "bar", undefined, null, "baz")).toBe("foo baz")
  })

  it("deduplicates conflicting Tailwind utility classes", () => {
    // tailwind-merge resolves conflicts: last wins
    expect(cn("p-4", "p-8")).toBe("p-8")
  })

  it("keeps the text-meta size beside a text colour", () => {
    expect(cn("text-meta", "text-destructive")).toBe("text-meta text-destructive")
    expect(cn("text-meta", "text-sm")).toBe("text-sm")
  })

  it("handles conditional class objects", () => {
    expect(cn({ active: true, disabled: false })).toBe("active")
  })

  it("returns an empty string when given no arguments", () => {
    expect(cn()).toBe("")
  })
})
