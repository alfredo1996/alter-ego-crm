"use client"

import { Button } from "@alter-ego/ui/ui/button"
import { useToast } from "@alter-ego/ui/use-toast"
import { Unplug } from "lucide-react"
import { useState } from "react"

import { ConfirmDeleteDialog } from "@/components/confirm-delete-dialog"
import { SettingsRow } from "@/components/settings/settings-section"
import { useAuth } from "@/hooks/use-auth"


/** Revokes every OAuth grant (Claude and other MCP connectors) of the signed-in user. */
export function ConnectorsSection() {
  const { getIdToken } = useAuth()
  const { toast } = useToast()
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState(false)

  async function disconnect() {
    setPending(true)
    try {
      const idToken = await getIdToken()
      const res = await fetch("/api/oauth/disconnect", {
        method: "POST",
        headers: { authorization: `Bearer ${idToken}` },
      })
      if (!res.ok) throw new Error("disconnect failed")
      const { revoked } = (await res.json()) as { revoked: number }
      toast({ title: "Connectors disconnected", description: `${revoked} ${revoked === 1 ? "token" : "tokens"} revoked.` })
      setOpen(false)
    } catch {
      toast({ title: "Failed to disconnect connectors", variant: "destructive" })
    } finally {
      setPending(false)
    }
  }

  return (
    <SettingsRow label="Connectors" hint="Apps you signed in to with Alter Ego, such as Claude. Disconnecting signs all of them out; each asks you to approve again.">
      <Button variant="outline" size="lg" onClick={() => setOpen(true)}>
        <Unplug />
        Disconnect All Connectors
      </Button>
      <ConfirmDeleteDialog
        open={open}
        onOpenChange={setOpen}
        title="Disconnect All Connectors"
        description="Every connected app loses access at once. You can connect them again later."
        onConfirm={disconnect}
        isPending={pending}
        confirmLabel="Disconnect"
        pendingLabel="Disconnecting..."
      />
    </SettingsRow>
  )
}
