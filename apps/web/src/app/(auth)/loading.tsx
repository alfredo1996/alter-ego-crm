import { Loader2 } from "lucide-react"

export default function AuthLoading() {
  return (
    <div className="flex items-center justify-center">
      <Loader2 className="text-muted-foreground h-8 w-8 animate-spin" />
    </div>
  )
}
