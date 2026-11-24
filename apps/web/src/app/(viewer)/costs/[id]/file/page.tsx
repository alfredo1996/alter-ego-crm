import { CostInvoiceFile } from "@/components/company-files/record-invoice-file"

export const metadata = { title: "Invoice File" }

export default async function CostFilePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ file?: string | string[] }> }) {
  const { file } = await searchParams
  return <CostInvoiceFile id={(await params).id} fileId={typeof file === "string" && file !== "" ? file : undefined} />
}
