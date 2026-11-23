// @vitest-environment node
import http, { createServer } from "node:http"

import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { downloadPublicFile, guardedLookup, isPublicAddress } from "@/lib/safe-download"

import type { HttpGet } from "@/lib/safe-download"
import type { AddressInfo } from "node:net"

describe("isPublicAddress", () => {
  it.each([
    "0.0.0.0", "10.1.2.3", "100.64.0.1", "127.0.0.1", "169.254.169.254", "172.16.0.1", "172.31.255.255", "192.168.1.1", "192.0.0.8", "198.18.0.1", "224.0.0.1", "240.0.0.1", "255.255.255.255",
    "::", "::1", "fc00::1", "fd12:3456::1", "fe80::1", "ff02::1", "::ffff:127.0.0.1", "::ffff:10.0.0.1", "::ffff:a9fe:a9fe", "0:0:0:0:0:ffff:7f00:1", "64:ff9b::7f00:1",
  ])("%s is refused", (address) => {
    expect(isPublicAddress(address)).toBe(false)
  })

  it.each(["8.8.8.8", "93.184.216.34", "172.32.0.1", "100.63.255.255", "2606:4700:4700::1111", "::ffff:8.8.8.8"])("%s is public", (address) => {
    expect(isPublicAddress(address)).toBe(true)
  })

  it("refuses what is not an address", () => {
    expect(isPublicAddress("localhost")).toBe(false)
  })
})

describe("guardedLookup", () => {
  it("refuses a name that resolves to a loopback address", async () => {
    const err = await new Promise<NodeJS.ErrnoException | null>((resolve) => guardedLookup("localhost", { all: true }, (e) => resolve(e)))
    expect(err?.code).toBe("EBLOCKED")
  })
})

describe("downloadPublicFile refuses before it connects", () => {
  it.each([
    ["http", "http://files.example.com/a.xml", /Only https/],
    ["credentials", "https://user:pw@files.example.com/a.xml", /user name or password/],
    ["a loopback literal", "https://127.0.0.1/a.xml", /private or internal/],
    ["the metadata address", "https://169.254.169.254/latest/meta-data", /private or internal/],
    ["a private IPv4 literal", "https://10.0.0.5/a.xml", /private or internal/],
    ["an IPv6 loopback literal", "https://[::1]/a.xml", /private or internal/],
    ["an IPv6 unique-local literal", "https://[fd00::1]/a.xml", /private or internal/],
    ["a mapped private literal", "https://[::ffff:192.168.0.1]/a.xml", /private or internal/],
    ["a decimal-spelled loopback", "https://2130706433/a.xml", /private or internal/],
    ["a name that resolves to loopback", "https://localhost:9/a.xml", /private or internal/],
    ["a malformed address", "not a url", /not a valid address/],
  ])("%s", async (_l, url, message) => {
    await expect(downloadPublicFile(url)).rejects.toThrow(message)
  })
})

/** A local plain-http stub standing in for the https server: the transport is injected, the checks around it are the real ones. */
describe("downloadPublicFile against a stub", () => {
  const big = Buffer.alloc(200_000, 7)
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://stub").pathname
    if (url === "/file") return void res.end("<a/>")
    if (url === "/big") return void res.end(big)
    if (url === "/slow") return void res.writeHead(200).write("x") // never ends
    if (url === "/hang") return // never answers
    if (url === "/missing") return void res.writeHead(404).end()
    if (url === "/to-private") return void res.writeHead(302, { location: "https://10.0.0.5/secret" }).end()
    if (url === "/to-http") return void res.writeHead(302, { location: "http://files.example.com/a" }).end()
    const hop = /^\/hop\/(\d+)$/.exec(url)
    if (hop) return void res.writeHead(302, { location: `/hop/${Number(hop[1]) + 1}` }).end()
    if (url === "/one-hop") return void res.writeHead(302, { location: "/file" }).end()
    res.writeHead(500).end()
  })
  let get: HttpGet
  const asked: string[] = []
  beforeAll(async () => {
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r))
    const { port } = server.address() as AddressInfo
    get = (url, options, onResponse) => {
      asked.push(url.pathname)
      return http.get({ host: "127.0.0.1", port, path: url.pathname + url.search, signal: options.signal }, onResponse) as unknown as ReturnType<HttpGet>
    }
  })
  afterAll(() => new Promise<void>((r) => (server.closeAllConnections(), server.close(() => r()))))

  const run = (path: string, opts: { maxBytes?: number; timeoutMs?: number } = {}) => downloadPublicFile(`https://files.example.com${path}`, { get, ...opts })

  it("returns the bytes, following a redirect", async () => {
    expect((await run("/file")).toString()).toBe("<a/>")
    expect((await run("/one-hop")).toString()).toBe("<a/>")
  })

  it("refuses a redirect to a private address and to http", async () => {
    await expect(run("/to-private")).rejects.toThrow(/private or internal/)
    await expect(run("/to-http")).rejects.toThrow(/Only https/)
  })

  it("follows three redirects and refuses a fourth", async () => {
    asked.length = 0
    await expect(run("/hop/0")).rejects.toThrow(/redirected more than 3 times/)
    expect(asked).toEqual(["/hop/0", "/hop/1", "/hop/2", "/hop/3"])
  })

  it("holds the byte cap while streaming", async () => {
    await expect(run("/big", { maxBytes: 100_000 })).rejects.toThrow(/over the 10 MB limit/)
    expect((await run("/big")).length).toBe(200_000)
  })

  it("holds the timeout, for a server that never answers and one that never finishes", async () => {
    await expect(run("/hang", { timeoutMs: 100 })).rejects.toThrow(/did not deliver the file within/)
    await expect(run("/slow", { timeoutMs: 100 })).rejects.toThrow(/did not deliver the file within/)
  })

  it("names the status and the host, never the query string", async () => {
    await expect(downloadPublicFile("https://files.example.com/missing?sig=secret", { get })).rejects.toThrow("files.example.com answered 404, not the file.")
  })
})
