"use client"

import { PageLoader } from "@alter-ego/ui/page/page-state"

import { InvoiceFileView, ViewerToolbar } from "@/components/company-files/invoice-file-view"
import { useAuth } from "@/hooks/use-auth"
import { useCompanyExpenses } from "@/hooks/use-company-expenses"
import { useInvoices } from "@/hooks/use-invoices"

import type { InvoiceFile } from "@/types"

const NOUN = { cost: { label: "Open the Cost", list: "/costs" }, invoice: { label: "Open the Invoice", list: "/invoices" } } as const

/** A viewer page that has no invoice to show: the toolbar with its h1, and why. */
function Notice({ noun, title, children }: { noun: keyof typeof NOUN; title: string; children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-muted">
      <ViewerToolbar heading={title} back={{ href: NOUN[noun].list }} />
      <div className="mx-auto max-w-xl p-4 text-sm sm:p-6">
        <p role="alert" className="rounded-xl border bg-background p-5">
          {children}
        </p>
      </div>
    </div>
  )
}

/** The file of one cost or one invoice, read as an invoice. Back and Open the Cost return to the record's own dialog. */
function Shown({ noun, id, title, file }: { noun: keyof typeof NOUN; id: string; title: string; file: InvoiceFile | null | undefined }) {
  if (!file) return <Notice noun={noun} title={title}>{title} has no invoice file.</Notice>
  return <InvoiceFileView file={file} title={title} back={{ href: `${NOUN[noun].list}?open=${encodeURIComponent(id)}`, label: NOUN[noun].label }} />
}

export function CostInvoiceFile({ id }: { id: string }) {
  const { user } = useAuth()
  const { data, isPending, isError } = useCompanyExpenses(user?.id)
  if (isPending) return <PageLoader />
  if (isError) return <Notice noun="cost" title="Cost">The cost could not be loaded. Go back and try again.</Notice>
  const cost = data?.find((c) => c.id === id)
  if (!cost) return <Notice noun="cost" title="Cost">This cost was not found. It may have been deleted.</Notice>
  return <Shown noun="cost" id={id} title={cost.description} file={cost.file} />
}

export function InvoiceInvoiceFile({ id }: { id: string }) {
  const { user } = useAuth()
  const { data, isPending, isError } = useInvoices(user?.id)
  if (isPending) return <PageLoader />
  if (isError) return <Notice noun="invoice" title="Invoice">The invoice could not be loaded. Go back and try again.</Notice>
  const invoice = data?.find((i) => i.id === id)
  if (!invoice) return <Notice noun="invoice" title="Invoice">This invoice was not found. It may have been deleted.</Notice>
  return <Shown noun="invoice" id={id} title={`Invoice ${invoice.number}`} file={invoice.file} />
}
