import dns from "node:dns"
import https from "node:https"
import { BlockList, isIP } from "node:net"

import { INVOICE_FILE_MAX_BYTES } from "@/lib/invoice-files"
import { ToolInputError } from "@/lib/mcp/tools/helpers"

import type { IncomingMessage } from "node:http"

/**
 * Downloads a file from an https URL for attach_file, without letting the URL reach inside the server's
 * network: https only, every resolved address checked and the checked one connected to (no second
 * resolution), redirects followed by hand and re-checked, a total timeout and a byte cap.
 */

const MAX_REDIRECTS = 3
const TIMEOUT_MS = 20_000

const blocked = new BlockList()
for (const [net, bits] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12],
  ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const) {
  blocked.addSubnet(net, bits, "ipv4")
}
for (const [net, bits] of [["::", 128], ["::1", 128], ["fc00::", 7], ["fe80::", 10], ["ff00::", 8], ["2001:db8::", 32], ["64:ff9b::", 96], ["64:ff9b:1::", 48], ["2002::", 16], ["2001::", 32], ["::", 96], ["::ffff:0:0:0", 96]] as const) {
  blocked.addSubnet(net, bits, "ipv6")
}

/** True for an address on the public internet. An IPv4-mapped IPv6 address (::ffff:a.b.c.d) is judged as the IPv4 it carries. */
export function isPublicAddress(address: string): boolean {
  const family = isIP(address)
  if (family === 4) return !blocked.check(address, "ipv4")
  if (family !== 6) return false
  // The URL parser writes every spelling of a mapped address the same way: ::ffff:7f00:1.
  const canonical = new URL(`http://[${address}]/`).hostname
  const mapped = /^\[::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})\]$/.exec(canonical)
  if (mapped) {
    const [hi, lo] = [parseInt(mapped[1], 16), parseInt(mapped[2], 16)]
    return !blocked.check(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`, "ipv4")
  }
  return !blocked.check(address, "ipv6")
}

const BLOCKED = "That address is private or internal, so it is not fetched."

type LookupCallback = (err: NodeJS.ErrnoException | null, address: string | dns.LookupAddress[], family?: number) => void

/** dns.lookup that refuses when any address the name resolves to is not public; the socket then connects to what was checked. */
export function guardedLookup(hostname: string, options: dns.LookupOptions, callback: LookupCallback): void {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err, "", 0)
    const list = addresses as dns.LookupAddress[]
    if (list.some((a) => !isPublicAddress(a.address))) return callback(Object.assign(new Error(BLOCKED), { code: "EBLOCKED" }), "", 0)
    if (options.all) return callback(null, list)
    callback(null, list[0].address, list[0].family)
  })
}

export type HttpGet = (url: URL, options: https.RequestOptions, onResponse: (res: IncomingMessage) => void) => ReturnType<typeof https.get>

export interface DownloadOptions {
  maxBytes?: number
  timeoutMs?: number
  /** For tests: the transport. */
  get?: HttpGet
}

const where = (u: URL) => u.host

/** The bytes at `url`, or a ToolInputError that says why not (the message names the host, never the query string). */
export async function downloadPublicFile(url: string, { maxBytes = INVOICE_FILE_MAX_BYTES, timeoutMs = TIMEOUT_MS, get = https.get as HttpGet }: DownloadOptions = {}): Promise<Buffer> {
  const abort = new AbortController()
  const timer = setTimeout(() => abort.abort(), timeoutMs)
  let current: URL
  try {
    current = new URL(url)
  } catch {
    throw new ToolInputError("The url is not a valid address.")
  }
  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      if (current.protocol !== "https:") throw new ToolInputError("Only https addresses are accepted.")
      if (current.username || current.password) throw new ToolInputError("The address must not carry a user name or password.")
      const literal = current.hostname.replace(/^\[|\]$/g, "")
      if (isIP(literal) && !isPublicAddress(literal)) throw new ToolInputError(BLOCKED)
      const res = await request(current, get, abort.signal)
      const status = res.statusCode ?? 0
      if ([301, 302, 303, 307, 308].includes(status) && res.headers.location) {
        res.resume()
        if (hop === MAX_REDIRECTS) throw new ToolInputError(`${where(current)} redirected more than ${MAX_REDIRECTS} times.`)
        try {
          current = new URL(res.headers.location, current)
        } catch {
          throw new ToolInputError(`${where(current)} redirected to an invalid address.`)
        }
        continue
      }
      if (status !== 200) {
        res.resume()
        throw new ToolInputError(`${where(current)} answered ${status}, not the file.`)
      }
      return await readCapped(res, maxBytes, current)
    }
    throw new ToolInputError("Too many redirects.")
  } catch (e) {
    if (e instanceof ToolInputError) throw e
    if (abort.signal.aborted) throw new ToolInputError(`${where(current)} did not deliver the file within ${Math.round(timeoutMs / 1000)} seconds.`)
    if ((e as NodeJS.ErrnoException).code === "EBLOCKED") throw new ToolInputError(BLOCKED)
    throw new ToolInputError(`Could not download from ${where(current)}: ${(e as NodeJS.ErrnoException).code ?? "connection failed"}.`)
  } finally {
    clearTimeout(timer)
  }
}

function request(url: URL, get: HttpGet, signal: AbortSignal): Promise<IncomingMessage> {
  return new Promise((resolve, reject) => {
    const req = get(url, { lookup: guardedLookup as net_Lookup, signal, agent: false }, resolve)
    req.on("error", reject)
  })
}
type net_Lookup = NonNullable<https.RequestOptions["lookup"]>

function readCapped(res: IncomingMessage, maxBytes: number, url: URL): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    res.on("data", (chunk: Buffer) => {
      size += chunk.length
      if (size > maxBytes) {
        reject(new ToolInputError(`The file at ${where(url)} is over the 10 MB limit.`))
        res.destroy()
        return
      }
      chunks.push(chunk)
    })
    res.on("end", () => resolve(Buffer.concat(chunks)))
    res.on("error", reject)
    res.on("aborted", () => reject(new Error("aborted")))
  })
}
