import { InvoiceInvoiceFile } from "@/components/company-files/record-invoice-file"

export const metadata = { title: "Invoice File" }

export default async function InvoiceFilePage({ params }: { params: Promise<{ id: string }> }) {
  return <InvoiceInvoiceFile id={(await params).id} />
}
