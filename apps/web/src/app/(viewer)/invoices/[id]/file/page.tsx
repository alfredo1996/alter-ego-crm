import { InvoiceInvoiceFile } from "@/components/company-files/record-invoice-file"

export const metadata = { title: "Invoice File" }

export default async function InvoiceFilePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ file?: string | string[] }> }) {
  const { file } = await searchParams
  return <InvoiceInvoiceFile id={(await params).id} fileId={typeof file === "string" && file !== "" ? file : undefined} />
}
