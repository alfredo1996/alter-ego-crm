"use client"


import { Button } from "@alter-ego/ui/ui/button"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@alter-ego/ui/ui/command"
import { Popover, PopoverContent, PopoverTrigger } from "@alter-ego/ui/ui/popover"
import { cn } from "@alter-ego/ui/utils"
import { Check, ChevronsUpDown, Plus } from "lucide-react"
import { useState } from "react"

import type { Client } from "@/types"

interface Props {
  clients: Client[]
  value: string | null
  onChange: (clientId: string) => void
  /** Creates the client and resolves with its new id. */
  onCreate: (name: string) => Promise<string>
  disabled?: boolean
  /** For a Label's htmlFor. */
  id?: string
  /** A field error: the id of its message. */
  errorId?: string
}

/**
 * Client picker that creates on the fly.
 *
 * Registering an opportunity is the most frequent action in the app, so forcing a
 * trip to a separate "new client" form first would be the wrong tax to charge.
 * Type a name that doesn't exist and it becomes a client.
 */
export function ClientCombobox({ clients, value, onChange, onCreate, disabled, id, errorId }: Props) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState("")
  const [creating, setCreating] = useState(false)

  const selected = clients.find((c) => c.id === value)
  const trimmed = search.trim()
  const alreadyExists = clients.some((c) => c.name.toLowerCase() === trimmed.toLowerCase())

  async function handleCreate() {
    if (!trimmed || creating) return
    setCreating(true)
    try {
      onChange(await onCreate(trimmed))
      setSearch("")
      setOpen(false)
    } finally {
      setCreating(false)
    }
  }

  return (
    // modal: in a Dialog (its usual home), the dialog's scroll lock otherwise swallows
    // the list's wheel and touch scroll, leaving the later options out of reach.
    <Popover modal open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-invalid={errorId ? true : undefined}
          aria-describedby={errorId}
          disabled={disabled}
          className={cn("w-full justify-between font-normal", !selected && "text-muted-foreground")}
        >
          <span className="min-w-0 truncate">{selected?.name ?? "Choose or type a client"}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-(--radix-popover-trigger-width) p-0" align="start">
        <Command>
          <CommandInput
            placeholder="Search or type a new name…"
            value={search}
            onValueChange={setSearch}
          />
          <CommandList>
            <CommandEmpty>
              {trimmed ? (
                <button
                  type="button"
                  onClick={handleCreate}
                  disabled={creating}
                  className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-sm hover:bg-accent"
                >
                  <Plus className="h-4 w-4" />
                  {creating ? "Creating…" : `Create "${trimmed}"`}
                </button>
              ) : (
                <span className="px-2 py-1.5 text-sm text-muted-foreground">No clients</span>
              )}
            </CommandEmpty>
            <CommandGroup>
              {clients.map((client) => (
                <CommandItem
                  key={client.id}
                  value={client.name}
                  onSelect={() => {
                    onChange(client.id)
                    setSearch("")
                    setOpen(false)
                  }}
                >
                  <Check
                    className={cn(
                      "mr-2 h-4 w-4",
                      client.id === value ? "opacity-100" : "opacity-0",
                    )}
                  />
                  {client.name}
                </CommandItem>
              ))}
              {/* cmdk hides CommandEmpty as soon as one item matches, so the create
                  row also lives here for the "partial match, new name" case. */}
              {trimmed && !alreadyExists && (
                <CommandItem value={`__create__${trimmed}`} onSelect={handleCreate}>
                  <Plus className="mr-2 h-4 w-4" />
                  {creating ? "Creating…" : `Create "${trimmed}"`}
                </CommandItem>
              )}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
