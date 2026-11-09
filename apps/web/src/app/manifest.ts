import type { MetadataRoute } from "next"

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Alter Ego CRM",
    short_name: "Alter Ego",
    description: "Pipeline, contracts, invoices and the cash book of a small Italian SRL",
    start_url: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#111111",
    icons: [
      { src: "/icon", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon", sizes: "192x192", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Pipeline", short_name: "Pipeline", url: "/pipeline" },
      { name: "Invoices", short_name: "Invoices", url: "/invoices" },
    ],
  }
}
