import { CostInvoiceFile } from "@/components/company-files/record-invoice-file"

export const metadata = { title: "Invoice File" }

export default async function CostFilePage({ params }: { params: Promise<{ id: string }> }) {
  return <CostInvoiceFile id={(await params).id} />
}
