import { BrandMark } from "@alter-ego/ui/page/brand-mark"
import { ContentCard } from "@alter-ego/ui/page/content-card"
import { PageHeader } from "@alter-ego/ui/page/page-header"

import type { ReactNode } from "react"

/** The page around sign-in, sign-up and the OAuth consent: the brand over one 400px column. */
export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-8 px-4 py-10 sm:bg-sidebar">
      <BrandMark withName />
      <div className="w-full max-w-[400px]">{children}</div>
    </main>
  )
}

/** The h1 and its one-line subtitle in a card; a phone drops the card's chrome. */
export function AuthCard({ title, subtitle, children, footer }: { title: string; subtitle: ReactNode; children: ReactNode; footer?: ReactNode }) {
  return (
    <ContentCard as="div" className="max-sm:border-0 max-sm:bg-transparent max-sm:p-0 max-sm:shadow-none sm:p-8">
      <PageHeader title={title} subtitle={subtitle} className="mb-6" />
      {children}
      {footer && <div className="mt-6 text-sm text-muted-foreground">{footer}</div>}
    </ContentCard>
  )
}

/** A failed sign-in or approval, announced as it appears. */
export function AuthAlert({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2.5 text-sm text-danger-soft-foreground">
      {children}
    </p>
  )
}
