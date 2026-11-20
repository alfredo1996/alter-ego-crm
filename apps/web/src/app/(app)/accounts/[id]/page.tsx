import { AccountDetailPage } from "@alter-ego/finance/pages/account-detail-page"
import { use } from "react"

export const metadata = { title: "Account" }

export default function Route({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  return <AccountDetailPage accountId={id} />
}
