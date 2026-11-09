import { describe, expect, it } from "vitest"

import { safeNextPath } from "@/lib/safe-next-path"

describe("safeNextPath", () => {
  it("keeps a rooted relative path", () => {
    expect(safeNextPath("/oauth/authorize?client_id=x")).toBe("/oauth/authorize?client_id=x")
  })

  it("falls back when absent", () => {
    expect(safeNextPath(null)).toBe("/")
    expect(safeNextPath(undefined)).toBe("/")
    expect(safeNextPath("")).toBe("/")
  })

  it("rejects absolute URLs", () => {
    expect(safeNextPath("https://evil.example.com")).toBe("/")
    expect(safeNextPath("javascript:alert(1)")).toBe("/")
  })

  // Browsers resolve these to another origin despite the leading slash.
  it("rejects protocol-relative paths", () => {
    expect(safeNextPath("//evil.example.com")).toBe("/")
    expect(safeNextPath("/\\evil.example.com")).toBe("/")
  })

  // The URL parser strips tab, newline and CR, so these become "//evil.example".
  it.each(["/\t/evil.example", "/\n/evil.example", "/\r/evil.example", "/ /evil.example", "/a\u0000b"])(
    "rejects control characters and whitespace: %j",
    (value) => expect(safeNextPath(value)).toBe("/"),
  )

  it("keeps a path with a query", () => {
    expect(safeNextPath("/clients?x=1")).toBe("/clients?x=1")
  })

  it("honours a custom fallback", () => {
    expect(safeNextPath(null, "/clients")).toBe("/clients")
  })
})
