import { join } from "node:path"

import { createMDX } from "fumadocs-mdx/next";

import { securityHeaders } from "./src/lib/csp";

import type { NextConfig } from "next";

const withMDX = createMDX();

const nextConfig: NextConfig = {
  // Next 16.4 writes an AGENTS.md into the repo root on every `next dev`; it is not ours to commit.
  agentRules: false,
  poweredByHeader: false,
  // The workspace packages ship TypeScript source.
  transpilePackages: ["@alter-ego/kernel", "@alter-ego/ui", "@alter-ego/rent"],
  turbopack: {
    root: join(__dirname, "../.."),
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: securityHeaders(process.env.NODE_ENV !== "production"),
      },
    ];
  },
  // The company pages had Italian slugs until the app went English. Bookmarks
  // and installed-PWA links still point at them, and browsers cache a 308, so
  // the new slugs are final. `:path*` also matches the bare path; Next carries
  // the query string over.
  async redirects() {
    return [
      ["clienti", "clients"],
      ["attivita", "tasks"],
      ["piano", "plan"],
      ["scadenze", "deadlines"],
      ["costi", "costs"],
    ]
      .map(([from, to]) => ({
        source: `/${from}/:path*`,
        destination: `/${to}/:path*`,
        permanent: true,
      }))
      .concat(
        // Hours now live on /plan. Temporary (307): browsers do not cache it, so
        // /hours stays free to come back. Next carries ?week= over.
        { source: "/hours", destination: "/plan", permanent: false },
      );
  },
};

export default withMDX(nextConfig);
