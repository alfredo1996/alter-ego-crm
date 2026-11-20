import { describe, expect, it } from "vitest"

import { KNOWN_EDGES } from "./known-edges"
import { FINANCE_RULE, RULE, crossEdges, diffEdges, existsInSrc, financeImporters, isTestFile, pluginOf, readSource, resolveSpec, specifiers } from "./plugin-graph"

describe("which plugin a file belongs to", () => {
  it.each([
    ["app/(app)/pipeline/page.tsx", "consulting"],
    ["app/(app)/invoices/page.tsx", "accounting"],
    ["app/(app)/rent/page.tsx", "rent"],
    ["app/(app)/settings/page.tsx", "host"],
    ["components/crm/client-page.tsx", "consulting"],
    ["components/crm/invoice-sheet.tsx", "accounting"],
    ["components/cash-book/cash-book-shell.tsx", "accounting"],
    ["components/rent/rent-route.tsx", "rent"],
    ["hooks/use-invoices.ts", "accounting"],
    ["hooks/use-clients.ts", "consulting"],
    ["hooks/use-leases.ts", "rent"],
    ["lib/invoices.ts", "accounting"],
    ["lib/quarters.ts", "consulting"],
    ["lib/mcp/tools/rent.ts", "rent"],
    ["lib/mcp/tools/invoice-files.ts", "accounting"],
    ["app/(viewer)/costs/[id]/file/page.tsx", "accounting"],
    ["app/(viewer)/invoices/[id]/file/page.tsx", "accounting"],
    ["lib/mcp/tools/crm-write.ts", "host"],
    ["lib/backend/types.ts", "host"],
    ["types/crm.ts", "host"],
  ] as const)("%s is %s", (file, plugin) => {
    expect(pluginOf(file)).toBe(plugin)
  })

  it("is host when no rule names the file, so a new file is shared until it is placed", () => {
    expect(pluginOf("lib/brand-new.ts")).toBe("host")
  })
})

describe("import specifiers", () => {
  const source = `
import a from "./default"
import { b, c } from "@/named"
import type { D } from "../type-only"
import * as e from "./namespace"
import f, { g } from "./mixed"
import {
  h,
  i,
} from "./multi-line"
import "./side-effect"
export * from "./star"
export * as j from "./star-as"
export { k } from "./reexport"
export type { L } from "./reexport-type"
const lazy = () => import("./dynamic")
export const notAnImport = 1
// import commented from "./line-comment"
/**
 * import doc from "./block-comment"
 */
`
  it("finds every form: static, type, namespace, mixed, multi-line, side-effect, export-from, dynamic", () => {
    expect(specifiers(source).sort()).toEqual(
      ["./default", "@/named", "../type-only", "./namespace", "./mixed", "./multi-line", "./side-effect", "./star", "./star-as", "./reexport", "./reexport-type", "./dynamic"].sort(),
    )
  })

  // Each line is one form that once slipped past: a comment with a quote or `;` in a multi-line import,
  // a space before the paren, two statements on a line, a comment in a dynamic import, a leading block comment.
  it.each([
    ["a multi-line import with an apostrophe in a comment", "import {\n  a, // the client's name\n  b, // x; y\n} from \"./t\""],
    ["a space before the paren", 'const l = import ("./t")'],
    ["a second import after a semicolon", 'import a from "./other"; import b from "./t"'],
    ["a comment inside a dynamic import", 'import(/* webpackChunkName: "x" */ "./t")'],
    ["a block comment before an import", '/* eslint-disable */ import a from "./t"'],
    ["a template literal", "const l = import(`./t`)"],
    ["require", 'const t = require("./t")'],
    ["import = require", 'import t = require("./t")'],
  ])("finds the specifier in %s", (_name, code) => {
    expect(specifiers(code)).toContain("./t")
  })

  it("finds nothing in a commented-out import", () => {
    expect(specifiers('/* import a from "./t" */\n// import("./t")')).toEqual([])
  })
})

describe("resolving a specifier", () => {
  const files = new Set(["lib/a.ts", "lib/b/index.ts", "components/crm/x.tsx"])
  const exists = (r: string) => files.has(r)

  it.each([
    ["@/lib/a", "components/crm/x.tsx", "lib/a.ts"],
    ["../../lib/a", "components/crm/x.tsx", "lib/a.ts"],
    ["@/lib/b", "components/crm/x.tsx", "lib/b/index.ts"],
    ["./x", "components/crm/y.tsx", "components/crm/x.tsx"],
    ["@alter-ego/rent/tools", "lib/a.ts", "@alter-ego/rent/tools"],
    ["@alter-ego/rent", "lib/a.ts", "@alter-ego/rent"],
  ])("%s from %s is %s", (spec, from, expected) => {
    expect(resolveSpec(spec, from, exists)).toBe(expected)
  })

  it("leaves a package alone and fails loudly on a path it cannot find", () => {
    expect(resolveSpec("react", "lib/a.ts", exists)).toBeNull()
    expect(resolveSpec("@alter-ego/ui/ui/button", "lib/a.ts", exists)).toBeNull()
    expect(() => resolveSpec("@/lib/missing", "lib/a.ts", exists)).toThrow('lib/a.ts: cannot resolve "@/lib/missing"')
  })
})

describe("the edges a set of files makes", () => {
  const files = {
    "lib/invoices.ts": "export const x = 1",
    "lib/quarters.ts": "export const y = 1",
    "lib/shared.ts": "export const z = 1",
    "components/rent/rent-route.tsx": "export const r = 1",
    "components/crm/a.tsx": `import { x } from "@/lib/invoices"\nimport { z } from "@/lib/shared"`,
    "components/cash-book/b.tsx": `import type { y } from "../../lib/quarters"\nimport "@/components/rent/rent-route"`,
    "lib/mcp/tools/rent.ts": `import { t } from "@alter-ego/rent/tools"\nimport { x } from "@/lib/invoices"`,
    "lib/mcp/tools/crm-write.ts": `import { x } from "@/lib/invoices"`,
    "components/crm/__tests__/a.test.tsx": `import { x } from "@/lib/invoices"`,
  }

  it("counts an import across plugins, by alias or by relative path, and none that is within one, into the host, out of the host, or from a test", () => {
    expect(crossEdges(files)).toEqual([
      "accounting:components/cash-book/b.tsx -> consulting:lib/quarters.ts",
      "accounting:components/cash-book/b.tsx -> rent:components/rent/rent-route.tsx",
      "consulting:components/crm/a.tsx -> accounting:lib/invoices.ts",
      "rent:lib/mcp/tools/rent.ts -> accounting:lib/invoices.ts",
    ])
  })

  it("counts the Rent package as Rent where Accounting imports it", () => {
    expect(crossEdges({ "lib/invoices.ts": `import { t } from "@alter-ego/rent/tools"` }, () => false)).toEqual([
      "accounting:lib/invoices.ts -> rent:@alter-ego/rent/tools",
    ])
  })

  it("is a test file by folder or by name", () => {
    expect(["lib/__tests__/x.ts", "lib/x.test.ts", "components/a/b.test.tsx"].every(isTestFile)).toBe(true)
    expect(isTestFile("lib/invoices.ts")).toBe(false)
  })
})

// Rule 4: Finance is imported only by the host. Its files live in a package, so no app file maps to it;
// what is left to guard is that no plugin's file, nor a file placed under a plugin, reaches for it.
describe("who may import Finance", () => {
  const files = {
    "lib/nav.ts": `import { FINANCE_NAV } from "@alter-ego/finance/nav"`,
    "app/(app)/dashboard/page.tsx": `import { DashboardPage } from "@alter-ego/finance/pages/dashboard-page"`,
    "lib/invoices.ts": `import { x } from "@alter-ego/finance/lib/categories"`,
    "components/crm/a.tsx": `export { y } from "@alter-ego/finance/host"`,
    "components/rent/b.tsx": `const l = () => import("@alter-ego/finance/types")`,
    "hooks/use-leases.ts": `import { z } from "@alter-ego/kernel/currency"`,
    "components/cash-book/__tests__/c.test.tsx": `import { x } from "@alter-ego/finance/contract"`,
  }

  it("flags a file of Consulting, Accounting or Rent that imports the package, in any form, and no host file or test", () => {
    expect(financeImporters(files)).toEqual([
      "accounting:lib/invoices.ts -> @alter-ego/finance/lib/categories",
      "consulting:components/crm/a.tsx -> @alter-ego/finance/host",
      "rent:components/rent/b.tsx -> @alter-ego/finance/types",
    ])
  })

  it("does not take a package that only starts with the name for Finance", () => {
    expect(financeImporters({ "lib/invoices.ts": `import { x } from "@alter-ego/finance-tools"` })).toEqual([])
  })

  it("finds no file of a plugin that imports Finance", () => {
    expect(financeImporters(readSource()), FINANCE_RULE).toEqual([])
  })
})

describe("the ratchet", () => {
  const known = ["accounting:a.tsx -> consulting:b.ts", "consulting:c.tsx -> accounting:d.ts"]

  it("passes when the found edges are the listed ones, in any order", () => {
    expect(diffEdges([...known].reverse(), known)).toEqual({ added: [], gone: [] })
  })

  it("fails on a new edge", () => {
    expect(diffEdges([...known, "rent:e.tsx -> accounting:f.ts"], known)).toEqual({ added: ["rent:e.tsx -> accounting:f.ts"], gone: [] })
  })

  it("fails on a listed edge that is gone", () => {
    expect(diffEdges([known[0]], known)).toEqual({ added: [], gone: [known[1]] })
  })

  it("sees a new import in a plugin's file as an added edge", () => {
    const files = { "lib/invoices.ts": "export const x = 1", "lib/quarters.ts": `import { x } from "./invoices"` }
    expect(diffEdges(crossEdges(files), [])).toEqual({ added: ["consulting:lib/quarters.ts -> accounting:lib/invoices.ts"], gone: [] })
    const without = { ...files, "lib/quarters.ts": "export const y = 1" }
    expect(diffEdges(crossEdges(without), ["consulting:lib/quarters.ts -> accounting:lib/invoices.ts"]).gone).toHaveLength(1)
  })

  const { added, gone } = diffEdges(
    crossEdges(readSource(), existsInSrc),
    KNOWN_EDGES,
  )

  it("finds no import across plugins that KNOWN_EDGES does not list", () => {
    expect(added, `New import across plugins:\n  ${added.join("\n  ")}\nRule: ${RULE}`).toEqual([])
  })

  it("finds every listed edge still in the source", () => {
    expect(gone, `Listed edge no longer in the source: delete it from known-edges.ts (the list only shrinks):\n  ${gone.join("\n  ")}`).toEqual([])
  })

  it("lists each edge once, sorted", () => {
    expect(KNOWN_EDGES).toEqual([...new Set(KNOWN_EDGES)].sort())
  })
})
