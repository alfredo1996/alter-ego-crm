import path from "node:path"
import { fileURLToPath } from "node:url"

import { createMDX } from "fumadocs-mdx/next"

import type { NextConfig } from "next"

/**
 * The documentation site, built as static HTML for GitHub Pages.
 *
 * Separate from the main app because that one cannot be exported: it has API
 * route handlers and middleware, neither of which survives `output: "export"`.
 * This app carries only the docs routes and reads the same ../content/docs, so
 * there is one copy of the prose.
 *
 * DOCS_BASE_PATH is the sub-path Pages serves a project site from — "/alter-ego-crm"
 * for github.io/<user>/alter-ego-crm. Leave it unset for a user/organisation site or a
 * local build.
 */
const basePath = process.env.DOCS_BASE_PATH ?? ""

const config: NextConfig = {
  output: "export",
  basePath,
  // Pages has no rewrite layer, so every route needs its own directory and
  // index.html rather than an extensionless file.
  trailingSlash: true,
  images: { unoptimized: true },
  // Turbopack cannot infer a workspace root it can resolve next/package.json
  // from here, so the scripts build with --webpack. Kept pinned in case that
  // changes; it is harmless either way.
  turbopack: { root: path.dirname(fileURLToPath(import.meta.url)) },
}

export default createMDX()(config)
