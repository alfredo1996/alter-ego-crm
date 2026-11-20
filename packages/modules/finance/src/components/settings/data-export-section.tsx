"use client"

import { Button } from "@alter-ego/ui/ui/button"
import { useToast } from "@alter-ego/ui/use-toast"
import { Download } from "lucide-react"
import { useState } from "react"

import { SettingsRow } from "./settings-section"
import { getBackend, useAuth } from "../../host"
import { fetchFullExport, downloadJson, fullExportFileName } from "../../lib/full-export"

export function DataExportSection() {
  const { user } = useAuth()
  const { toast } = useToast()
  const [busy, setBusy] = useState(false)

  async function handleExport() {
    if (!user) return
    setBusy(true)
    try {
      const now = new Date()
      const data = await fetchFullExport(getBackend().db, user.id, now)
      downloadJson(data, fullExportFileName(now))
      toast({ title: "Backup downloaded", description: "A full JSON export of your data was saved." })
    } catch (err) {
      toast({
        title: "Export failed",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <SettingsRow label="Backup" hint="One JSON file with accounts, transactions, budgets, goals, tags and rules.">
      <Button variant="outline" size="lg" onClick={handleExport} disabled={busy}>
        <Download />
        {busy ? "Preparing…" : "Export All Data (JSON)"}
      </Button>
    </SettingsRow>
  )
}
