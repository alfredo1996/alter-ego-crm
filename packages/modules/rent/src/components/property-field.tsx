"use client"

import { Input } from "@alter-ego/ui/ui/input"
import { cn } from "@alter-ego/ui/utils"
import { Plus } from "lucide-react"
import { useState } from "react"

import { trimProperty } from "../lease"

export interface PropertyChoice {
  name: string
  leases: number
}

interface Props {
  id: string
  value: string
  onChange: (value: string) => void
  /** The houses that have leases. */
  properties: PropertyChoice[]
  invalid?: boolean
  describedBy?: string
}

/**
 * The house is the cost-centre name: pick one that has leases, or type a new one and the
 * list offers to add it. Typing is always enough; the list only saves the typing.
 * Arrow keys walk the list, Enter picks, Escape closes the list (LeaseDialog keeps itself open meanwhile).
 */
export function PropertyField({ id, value, onChange, properties, invalid, describedBy }: Props) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const typed = trimProperty(value)
  const lower = typed.toLowerCase()
  const shown = properties.filter((p) => p.name.toLowerCase().includes(lower))
  // Case-insensitive, like the list: "via roma" is the house Via Roma, not a second one.
  const isNew = typed !== "" && !properties.some((p) => p.name.toLowerCase() === lower)
  const names = [...shown.map((p) => p.name), ...(isNew ? [typed] : [])]
  const visible = open && names.length > 0
  const optionId = (i: number) => `${id}-option-${i}`
  const pick = (name: string) => {
    onChange(name)
    setOpen(false)
    setActive(-1)
  }
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape" && open) {
      e.stopPropagation()
      setOpen(false)
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (!names.length) return
      e.preventDefault()
      setOpen(true)
      setActive(e.key === "ArrowDown" ? (active + 1) % names.length : active <= 0 ? names.length - 1 : active - 1)
    } else if (e.key === "Enter" && visible && active >= 0 && names[active] !== undefined) {
      e.preventDefault() // picks the option; it must not also submit the form
      pick(names[active])
    }
  }

  return (
    <div className="relative">
      <Input
        id={id}
        role="combobox"
        aria-expanded={visible}
        aria-controls={`${id}-list`}
        aria-autocomplete="list"
        aria-activedescendant={visible && active >= 0 ? optionId(active) : undefined}
        aria-invalid={invalid}
        aria-describedby={describedBy}
        autoComplete="off"
        value={value}
        onChange={(e) => {
          onChange(e.target.value)
          setOpen(true)
          setActive(-1)
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={onKeyDown}
      />
      {visible && (
        // mousedown must not blur the input, or the option goes away before its click lands.
        <div
          id={`${id}-list`}
          role="listbox"
          aria-label="Properties"
          onMouseDown={(e) => e.preventDefault()}
          className="absolute inset-x-0 top-full z-10 mt-1 overflow-hidden rounded-lg border bg-popover p-1 text-popover-foreground shadow-md"
        >
          {shown.map((p, i) => (
            <div
              key={p.name}
              id={optionId(i)}
              role="option"
              aria-selected={i === active}
              onClick={() => pick(p.name)}
              className={cn(
                "flex min-h-9 cursor-pointer items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm hover:bg-accent pointer-coarse:min-h-11",
                i === active && "bg-accent",
              )}
            >
              {p.name}
              <span className="text-muted-foreground">· {p.leases === 1 ? "1 lease" : `${p.leases} leases`}</span>
            </div>
          ))}
          {isNew && (
            <div
              id={optionId(shown.length)}
              role="option"
              aria-selected={active === shown.length}
              onClick={() => pick(typed)}
              className={cn(
                "flex min-h-9 cursor-pointer items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm font-medium hover:bg-accent pointer-coarse:min-h-11",
                active === shown.length && "bg-accent",
              )}
            >
              <Plus aria-hidden className="size-3.5" />
              Add “{typed}” as a new house
            </div>
          )}
        </div>
      )}
    </div>
  )
}
