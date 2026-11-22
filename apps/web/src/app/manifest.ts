import { appDescription } from "@/lib/app-description"
import { isRouteEnabled } from "@/lib/nav"

import type { MetadataRoute } from "next"

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Alter Ego CRM",
    short_name: "Alter Ego",
    description: appDescription(),
    start_url: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#111111",
    icons: [
      { src: "/icon", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon", sizes: "192x192", type: "image/png", purpose: "maskable" },
    ],
    // The same check the RouteGuard makes: a shortcut never opens a page the build lacks.
    shortcuts: [
      { name: "Pipeline", short_name: "Pipeline", url: "/pipeline" },
      { name: "Invoices", short_name: "Invoices", url: "/invoices" },
    ].filter((s) => isRouteEnabled(s.url)),
  }
}
