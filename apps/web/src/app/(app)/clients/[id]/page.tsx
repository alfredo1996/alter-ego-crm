import { use } from "react"

import { ClientPage } from "@/components/crm/client-page"

export const metadata = { title: "Client" }

export default function ClientRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  return <ClientPage clientId={id} />
}
