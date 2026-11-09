"use client"

import { EmptyPrompt } from "@alter-ego/ui/page/empty-prompt"
import { TagChip } from "@alter-ego/ui/page/status-pill"
import { Button } from "@alter-ego/ui/ui/button"
import { useToast } from "@alter-ego/ui/use-toast"
import { Copy, Key } from "lucide-react"
import { useState } from "react"

import { ConfirmDeleteDialog } from "@/components/confirm-delete-dialog"
import { SettingsRow } from "@/components/settings/settings-section"
import { useApiKeys, useCreateApiKey, useDeleteApiKey } from "@/hooks/use-api-keys"


export function ApiKeysSection({ userId }: { userId?: string }) {
  const { data: keys, isLoading } = useApiKeys()
  const createKey = useCreateApiKey()
  const deleteKey = useDeleteApiKey()
  const { toast } = useToast()
  const [newKey, setNewKey] = useState<string | null>(null)
  // A tap on the trash revoked the key outright, like the tag and rule deletes; it asks first now.
  const [revoking, setRevoking] = useState<string | null>(null)

  if (!userId) return <SettingsRow label="API Keys" hint="Sign in to manage API keys." />

  async function handleCreate() {
    try {
      const result = await createKey.mutateAsync()
      setNewKey(result.key)
      toast({ title: "API key created", description: "Copy it now — it won't be shown again." })
    } catch {
      toast({ title: "Failed to create API key", variant: "destructive" })
    }
  }

  async function handleCopy() {
    if (!newKey) return
    await navigator.clipboard.writeText(newKey)
    toast({ title: "Copied to clipboard" })
  }

  async function handleDelete(keyId: string) {
    try {
      await deleteKey.mutateAsync(keyId)
      setRevoking(null)
      toast({ title: "API key revoked" })
    } catch {
      toast({ title: "Failed to revoke key", variant: "destructive" })
    }
  }

  return (
    <SettingsRow
      label="API Keys"
      hint="For scripts and the MCP server. A key is shown once, when you create it."
      below={
        <>
          {newKey && (
            <div className="rounded-xl border border-warning/40 bg-warning-soft/60 p-3 text-warning-soft-foreground">
              <p className="mb-2 text-sm font-medium">Copy your API key now. It won&apos;t be shown again.</p>
              <div className="flex items-center gap-2">
                <code className="flex-1 truncate rounded-md bg-background px-2 py-1 font-mono text-xs text-foreground">{newKey}</code>
                <Button variant="outline" size="icon" aria-label="Copy API key" onClick={handleCopy}>
                  <Copy />
                </Button>
              </div>
            </div>
          )}

          {isLoading && <p className="text-sm text-muted-foreground">Loading...</p>}

          {keys && keys.length > 0 && (
            <ul className="flex flex-col divide-y divide-hairline rounded-xl border border-hairline">
              {keys.map((k) => (
                <li key={k.id} className="flex min-h-14 flex-wrap items-center gap-x-4 gap-y-1.5 py-1.5 pr-1.5 pl-3.5">
                  <TagChip className="px-2 py-[3px] text-[12.5px]">{k.prefix}</TagChip>
                  <span className="flex-1 text-[13px] text-muted-foreground">
                    Created <span className="font-mono text-xs">{new Date(k.createdAt).toLocaleDateString()}</span>
                  </span>
                  <Button variant="ghost" size="lg" onClick={() => setRevoking(k.id)} disabled={deleteKey.isPending} aria-label={`Revoke key ${k.prefix}`}>
                    Revoke
                  </Button>
                </li>
              ))}
            </ul>
          )}

          {keys && keys.length === 0 && !newKey && <EmptyPrompt variant="inline" title="No API keys yet." />}
        </>
      }
    >
      <Button variant="outline" size="lg" onClick={handleCreate} disabled={createKey.isPending}>
        <Key />
        {createKey.isPending ? "Creating..." : "Generate New API Key"}
      </Button>

      <ConfirmDeleteDialog
        open={!!revoking}
        onOpenChange={(open) => !open && setRevoking(null)}
        title="Revoke API Key"
        description="Anything using this key loses access at once. This cannot be undone."
        onConfirm={() => revoking && handleDelete(revoking)}
        isPending={deleteKey.isPending}
        confirmLabel="Revoke"
        pendingLabel="Revoking..."
      />
    </SettingsRow>
  )
}
