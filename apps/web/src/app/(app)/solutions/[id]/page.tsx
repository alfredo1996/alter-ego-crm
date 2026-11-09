import { use } from "react"

import { SolutionPage } from "@/components/crm/solution-page"

export const metadata = { title: "Solution" }

export default function SolutionRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  return <SolutionPage id={id} />
}
