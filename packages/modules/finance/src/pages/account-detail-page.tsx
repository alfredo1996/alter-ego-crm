import { AccountDetailShell } from "../components/accounts/account-detail-shell"

export function AccountDetailPage({ accountId }: { accountId: string }) {
  return <AccountDetailShell accountId={accountId} />
}
