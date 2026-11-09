import { defineDocs, defineConfig } from "fumadocs-mdx/config"

export const docs = defineDocs({
  // The same prose the main app serves — this site is a second renderer, not a
  // second copy.
  dir: "../content/docs",
})

export default defineConfig({ mdxOptions: {} })
