import { Geist, Geist_Mono } from "next/font/google"

import { Providers } from "@/components/providers"

import type { Metadata, Viewport } from "next"
import "./globals.css"

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
})

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
})

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // No maximumScale: pinch-zoom stays available. Inputs are 16 px on touch screens,
  // which is what stops iOS zooming in on focus.
  themeColor: "#111111",
}

export const metadata: Metadata = {
  title: "Alter Ego",
  description: "Pipeline, contracts, invoices and the cash book of a small Italian SRL",
  applicationName: "Alter Ego",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Alter Ego",
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    // The font variables go on <html>: the preflight sets html's font-family from
    // var(--font-geist-sans) at :root, and on <body> that variable did not exist there yet.
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable}`} suppressHydrationWarning>
      <body className="antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
