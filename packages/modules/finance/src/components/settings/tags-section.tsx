"use client"

import { EmptyPrompt } from "@alter-ego/ui/page/empty-prompt"
import { Button } from "@alter-ego/ui/ui/button"
import { Input } from "@alter-ego/ui/ui/input"
import { useToast } from "@alter-ego/ui/use-toast"
import { Plus, X } from "lucide-react"
import { useState } from "react"

import { useTags, useCreateTag, useDeleteTag } from "../../hooks/use-tags"
import { ConfirmDeleteDialog } from "../confirm-delete-dialog"
import { SettingsRow } from "./settings-section"


const DEFAULT_COLOR = "#6366f1"

interface TagsSectionProps {
  userId: string | undefined
}

export function TagsSection({ userId }: TagsSectionProps) {
  const { data: tags, isLoading } = useTags(userId)
  const createTag = useCreateTag(userId)
  const deleteTag = useDeleteTag(userId)
  const { toast } = useToast()

  const [name, setName] = useState("")
  const [color, setColor] = useState(DEFAULT_COLOR)
  // One tap on the trash deleted the tag outright; it asks first now.
  const [deleting, setDeleting] = useState<{ id: string; name: string } | null>(null)

  async function handleAdd() {
    const trimmed = name.trim()
    if (!trimmed) return
    try {
      await createTag.mutateAsync({ name: trimmed, color })
      setName("")
      setColor(DEFAULT_COLOR)
    } catch (err) {
      toast({
        title: "Failed to create tag",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      })
    }
  }

  async function handleDelete(tagId: string) {
    try {
      await deleteTag.mutateAsync(tagId)
      setDeleting(null)
    } catch (err) {
      toast({
        title: "Failed to delete tag",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      })
    }
  }

  return (
    <SettingsRow label="Tags" heading stacked hint="Labels that cut across categories, like a trip or a shared cost.">
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading...</p>
      ) : tags && tags.length > 0 ? (
        <ul className="flex flex-wrap gap-2">
          {tags.map((tag) => (
            <li key={tag.id} className="inline-flex items-center rounded-lg bg-muted pl-2.5">
              <span className="inline-flex items-center gap-[7px] font-mono text-[12.5px] text-subtle-foreground">
                <span aria-hidden className="size-2 rounded-full" style={{ backgroundColor: tag.color }} />
                {tag.name}
              </span>
              <button
                type="button"
                onClick={() => setDeleting(tag)}
                disabled={deleteTag.isPending}
                className="inline-flex size-8 items-center justify-center rounded-lg text-subtle-foreground transition-colors hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 pointer-coarse:size-11"
                aria-label={`Delete tag ${tag.name}`}
              >
                <X className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyPrompt variant="inline" title="No tags yet." />
      )}

      <div className="flex gap-2">
        <Input
          aria-label="Tag name"
          placeholder="Tag name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleAdd()
          }}
          className="min-w-0 flex-1"
        />
        <input
          type="color"
          value={color}
          onChange={(e) => setColor(e.target.value)}
          className="h-10 w-10 shrink-0 cursor-pointer rounded-[10px] border border-input bg-transparent p-1 pointer-coarse:size-11"
          aria-label="Tag color"
        />
        <Button type="button" variant="outline" onClick={handleAdd} disabled={!name.trim() || createTag.isPending}>
          <Plus />
          {createTag.isPending ? "Adding..." : "Add Tag"}
        </Button>
      </div>

      <ConfirmDeleteDialog
        open={!!deleting}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Delete Tag"
        description={`Delete the tag “${deleting?.name}”? This cannot be undone.`}
        onConfirm={() => deleting && handleDelete(deleting.id)}
        isPending={deleteTag.isPending}
      />
    </SettingsRow>
  )
}
