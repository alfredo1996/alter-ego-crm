import { readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

import { MCP_VERSION } from "@/lib/mcp/config"

describe("MCP version", () => {
  it.each(["src/app/api/mcp/route.ts", "scripts/mcp-stdio.ts"])("%s reports MCP_VERSION, not a literal", (file) => {
    const src = readFileSync(join(process.cwd(), file), "utf8")
    expect(MCP_VERSION).toMatch(/^\d+\.\d+\.\d+$/)
    expect(src).toMatch(/version:\s*MCP_VERSION/)
    expect(src).not.toMatch(/version:\s*["']\d/)
    expect(src).toMatch(/import \{[^}]*\bMCP_VERSION\b[^}]*\} from "@\/lib\/mcp\/config"/)
    expect(src).not.toMatch(/const MCP_VERSION/)
  })
})
