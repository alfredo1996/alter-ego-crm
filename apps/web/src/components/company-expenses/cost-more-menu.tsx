"use client"

import { Button } from "@alter-ego/ui/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@alter-ego/ui/ui/dropdown-menu"
import { MoreHorizontal, Pencil, Trash2 } from "lucide-react"
import { useRef } from "react"


/** A "More for X" menu with Edit and Delete; `onEdit` gets the trigger, which a dialog hands focus back to. */
export function CostMoreMenu({
  name,
  noun,
  onEdit,
  onDelete,
}: {
  name: string
  noun: string
  onEdit: (opener: HTMLElement | null) => void
  onDelete: () => void
}) {
  const trigger = useRef<HTMLButtonElement>(null)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button ref={trigger} variant="ghost" size="icon-lg" aria-label={`More for ${name}`} className="text-subtle-foreground">
          <MoreHorizontal aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => onEdit(trigger.current)}>
          <Pencil aria-hidden /> Edit {noun}
        </DropdownMenuItem>
        <DropdownMenuItem variant="destructive" onSelect={onDelete}>
          <Trash2 aria-hidden /> Delete {noun}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
