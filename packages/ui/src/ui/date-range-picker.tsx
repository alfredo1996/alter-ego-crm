"use client"

import {
  format,
  subDays,
  startOfMonth,
  endOfMonth,
  subMonths,
  startOfYear,
} from "date-fns"
import { Calendar as CalendarIcon } from "lucide-react"
import * as React from "react"

import { Button } from "./button"
import { Calendar } from "./calendar"
import { Dialog, DialogContent, DialogTitle } from "./dialog"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "./popover"
import { cn } from "../utils"

import type { DateRange } from "react-day-picker"

export interface DateRangePickerProps {
  value?: DateRange
  onChange?: (range: DateRange | undefined) => void
  placeholder?: string
  className?: string
  align?: "start" | "center" | "end"
}

const presets = [
  {
    label: "Today",
    getValue: () => {
      const today = new Date()
      return { from: today, to: today }
    },
  },
  {
    label: "Yesterday",
    getValue: () => {
      const yesterday = subDays(new Date(), 1)
      return { from: yesterday, to: yesterday }
    },
  },
  {
    label: "Last 7 days",
    getValue: () => ({
      from: subDays(new Date(), 6),
      to: new Date(),
    }),
  },
  {
    label: "Last 30 days",
    getValue: () => ({
      from: subDays(new Date(), 29),
      to: new Date(),
    }),
  },
  {
    label: "This month",
    getValue: () => ({
      from: startOfMonth(new Date()),
      to: endOfMonth(new Date()),
    }),
  },
  {
    label: "Last month",
    getValue: () => {
      const d = subMonths(new Date(), 1)
      return { from: startOfMonth(d), to: endOfMonth(d) }
    },
  },
  {
    label: "Last 3 months",
    getValue: () => ({
      from: startOfMonth(subMonths(new Date(), 2)),
      to: endOfMonth(new Date()),
    }),
  },
  {
    label: "This year",
    getValue: () => ({
      from: startOfYear(new Date()),
      to: new Date(),
    }),
  },
]

function DateRangePicker({
  value,
  onChange,
  placeholder = "Pick a date range",
  className,
  align = "start",
}: DateRangePickerProps) {
  const [open, setOpen] = React.useState(false)
  // A phone gets one month in a dialog (the Mark Paid pattern): beside the trigger,
  // 44 px days ran past the room above or below and hid the month's last weeks in
  // an inner scroll. Read on each opening, as the window may have been resized.
  const [phone, setPhone] = React.useState(false)
  const trigger = React.useRef<HTMLButtonElement>(null)

  const handlePresetClick = (preset: (typeof presets)[0]) => {
    onChange?.(preset.getValue())
    setOpen(false)
  }

  // A phone stacks the presets, as chips, over the calendar; wider screens get a
  // fixed column beside it (left to its max-content, the column was all eight
  // buttons in one line wide, and pushed the popover over the sidebar).
  const body = (
    <div className="flex flex-col sm:flex-row">
      <div className="flex flex-wrap gap-1 border-b p-2 sm:w-36 sm:shrink-0 sm:flex-col sm:flex-nowrap sm:border-b-0 sm:border-r">
        {presets.map((preset) => (
          <Button
            key={preset.label}
            variant="ghost"
            size="sm"
            className="justify-start text-sm"
            onClick={() => handlePresetClick(preset)}
          >
            {preset.label}
          </Button>
        ))}
      </div>
      <Calendar
        initialFocus
        className="mx-auto"
        mode="range"
        defaultMonth={value?.from}
        selected={value}
        onSelect={onChange}
        numberOfMonths={phone ? 1 : 2}
      />
    </div>
  )

  return (
    <>
      {/* modal: inside a Dialog (Export), the dialog's scroll lock otherwise swallows the popover's own scroll. */}
      <Popover
        modal
        open={open && !phone}
        onOpenChange={(next) => {
          if (next) setPhone(window.matchMedia("(max-width: 639px)").matches)
          setOpen(next)
        }}
      >
        <PopoverTrigger asChild>
          <Button
            ref={trigger}
            variant="outline"
            // The field shell: an Input's 10px radius.
            className={cn(
              "w-full justify-start rounded-[10px] text-left font-normal",
              !value && "text-muted-foreground",
              className
            )}
          >
            <CalendarIcon className="mr-2 h-4 w-4" />
            {value?.from ? (
              value.to ? (
                <>
                  {format(value.from, "LLL dd, y")} -{" "}
                  {format(value.to, "LLL dd, y")}
                </>
              ) : (
                format(value.from, "LLL dd, y")
              )
            ) : (
              <span>{placeholder}</span>
            )}
          </Button>
        </PopoverTrigger>
        {/* Taller than the room above or below the trigger: it scrolls inside. */}
        <PopoverContent
          className="max-h-(--radix-popover-content-available-height) w-auto overflow-y-auto p-0"
          align={align}
          collisionPadding={8}
        >
          {body}
        </PopoverContent>
      </Popover>
      <Dialog open={open && phone} onOpenChange={setOpen}>
        {/* 1rem of gutter and no padding: a 44 px-day month is 332 px, a 360 px phone has 344. */}
        <DialogContent
          size="sm"
          className="w-[calc(100%-1rem)] gap-0 p-0"
          aria-describedby={undefined}
          onCloseAutoFocus={(ev) => {
            // No DialogTrigger: focus goes back to the button by hand.
            ev.preventDefault()
            trigger.current?.focus()
          }}
        >
          <DialogTitle className="p-4 pr-12">Date Range</DialogTitle>
          {body}
        </DialogContent>
      </Dialog>
    </>
  )
}

export { DateRangePicker }
