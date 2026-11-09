import type { Metadata } from "next"
import type { ReactNode } from "react"

import "./globals.css"

export const metadata: Metadata = {
  title: { default: "Alter Ego Docs", template: "%s · Alter Ego Docs" },
  description:
    "Documentation for Alter Ego — the company app of an Italian SRL, with a swappable backend and an MCP server.",
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  )
}
