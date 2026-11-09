import { describe, expect, it } from "vitest"

import { clientIp } from "../client-ip"

describe("clientIp", () => {
  it.each([
    ["plain App Hosting request (3 entries)", "198.51.100.1, 35.219.200.5, 74.125.212.9", "198.51.100.1"],
    [
      "spoofed header (5 entries)",
      "203.0.113.9, 198.51.100.7, 192.0.2.44, 35.219.200.5, 64.233.172.3",
      "192.0.2.44",
    ],
    ["many spoofed entries", "1.1.1.1, 2.2.2.2, 3.3.3.3, 4.4.4.4, 5.5.5.5, 6.6.6.6, 35.0.0.1, 74.0.0.2", "6.6.6.6"],
    ["exactly 3 entries", "a, b, c", "a"],
    ["2 entries falls back to the last", "a, b", "b"],
    ["1 entry", "a", "a"],
    ["whitespace is trimmed", "  a ,\tb  ,  c  ", "a"],
    ["empty segments are ignored before counting", "x,, a, ,b,c,", "a"],
    ["empty header", "", "unknown"],
    ["only separators", " , ,", "unknown"],
    ["missing header", null, "unknown"],
  ])("%s", (_n, header, expected) => {
    expect(clientIp(header)).toBe(expected)
  })
})
