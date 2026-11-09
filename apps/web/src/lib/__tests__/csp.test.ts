import { describe, it, expect, vi } from "vitest"



import { POST } from "@/app/api/csp-report/route"
import { buildCsp, CSP_REPORT_PATH, securityHeaders } from "@/lib/csp"


const post = (body: string, headers: Record<string, string> = {}) =>
  POST(new Request("http://x/api/csp-report", { method: "POST", body, headers }))

const directives = (s: string) =>
  Object.fromEntries(s.split("; ").map((d) => [d.split(" ")[0], d.split(" ").slice(1)]))

describe("buildCsp", () => {
  it("locks the frame, plugins, base and forms", () => {
    const d = directives(buildCsp(false))
    expect(d["default-src"]).toEqual(["'self'"])
    expect(d["frame-ancestors"]).toEqual(["'none'"])
    expect(d["object-src"]).toEqual(["'none'"])
    expect(d["base-uri"]).toEqual(["'self'"])
    expect(d["form-action"]).toEqual(["'self'"])
    expect(d["report-uri"]).toEqual([CSP_REPORT_PATH])
  })

  it("lets the Firebase and Google endpoints through", () => {
    const d = directives(buildCsp(false))
    expect(d["connect-src"]).toEqual(
      expect.arrayContaining([
        "'self'",
        "https://*.googleapis.com",
        "https://*.firebaseio.com",
        "https://*.firebaseapp.com",
      ]),
    )
    expect(d["script-src"]).toEqual(
      expect.arrayContaining(["https://apis.google.com", "https://www.gstatic.com"]),
    )
    expect(d["frame-src"]).toEqual(
      expect.arrayContaining(["https://*.firebaseapp.com", "https://apis.google.com"]),
    )
  })

  it("lets Firebase Storage through connect-src without opening img, frame or object", () => {
    const d = directives(buildCsp(false))
    expect(d["connect-src"]).toContain("https://*.googleapis.com") // firebasestorage.googleapis.com
    expect(d["img-src"]).toEqual(["'self'", "data:", "blob:"])
    expect(d["frame-src"]).toEqual(["'self'", "https://*.firebaseapp.com", "https://apis.google.com"])
    expect(d["object-src"]).toEqual(["'none'"])
  })

  it("allows eval and the local emulators only outside production", () => {
    expect(buildCsp(false)).not.toContain("'unsafe-eval'")
    expect(buildCsp(false)).not.toContain("127.0.0.1")
    expect(buildCsp(true)).toContain("'unsafe-eval'")
    expect(buildCsp(true)).toContain("http://127.0.0.1:*")
  })
})

// Never import next.config.ts here: Firebase App Hosting swaps it for a
// stand-in with no default export, and `next build` type-checks tests too.
// X-Powered-By (poweredByHeader: false) is pinned by e2e/security-headers.spec.ts.
describe("securityHeaders", () => {
  it("sends the policy report-only, never enforced, with the other headers", () => {
    const headers = securityHeaders(false)
    const csp = headers.filter((h) => h.key.toLowerCase().startsWith("content-security-policy"))
    expect(csp.map((h) => h.key)).toEqual(["Content-Security-Policy-Report-Only"])
    expect(csp[0].value).toContain("default-src 'self'")
    expect(Object.fromEntries(headers.map((h) => [h.key, h.value]))).toMatchObject({
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "strict-origin-when-cross-origin",
    })
  })
})

describe("POST /api/csp-report", () => {
  it("accepts a report with 204", async () => {
    const res = await post(JSON.stringify({ "csp-report": { "blocked-uri": "https://evil.test" } }), {
      "content-type": "application/csp-report",
    })
    expect(res.status).toBe(204)
  })

  it("rejects an oversized body with 413, by header or by actual size", async () => {
    // Request drops a forged content-length, so hand the route a stand-in.
    const declared = {
      headers: new Headers({ "content-length": "100000" }),
      text: () => Promise.reject(new Error("body must not be read")),
    } as unknown as Request
    expect((await POST(declared)).status).toBe(413)
    expect((await post("x".repeat(20_000))).status).toBe(413)
  })

  it("logs a body with newlines as one line", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    await post("a\n[mcp-audit] forged line\n")
    const logged = warn.mock.calls[0].join(" ")
    warn.mockRestore()
    expect(logged).not.toContain("\n")
    expect(logged).toContain("forged line")
  })

  it("stops reading a chunked body at the cap", async () => {
    let pulls = 0
    const stream = new ReadableStream<Uint8Array>({
      pull(c) {
        pulls++
        c.enqueue(new Uint8Array(1024))
        if (pulls >= 2000) c.close()
      },
    })
    const req = new Request("http://x/api/csp-report", { method: "POST", body: stream, duplex: "half" } as RequestInit)
    expect((await POST(req)).status).toBe(413)
    expect(pulls).toBeLessThan(20)
  })
})

describe("zod in the browser", () => {
  it("runs jitless, so its Function probe does not trip script-src", async () => {
    // Fresh module graph, and read zod's config without going through @/lib/zod, so only
    // the schema module's own import can have set it.
    vi.resetModules()
    const { globalConfig } = await import("zod/v4/core")
    expect(globalConfig.jitless).toBeFalsy()
    await import("@/types/schemas")
    expect(globalConfig.jitless).toBe(true)
  })
})
