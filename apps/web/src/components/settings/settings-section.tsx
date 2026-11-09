import { SectionHeader } from "@alter-ego/ui/page/section-header"
import { cn } from "@alter-ego/ui/utils"

import type { ReactNode } from "react"

interface SettingsSectionProps {
  /** The anchor the index links to; the heading is `${id}-title`. */
  id: string
  title: string
  description: string
  /** A header action (Profile's Edit). */
  actions?: ReactNode
  /** The red-tinted card of the Danger Zone. */
  danger?: boolean
  children: ReactNode
}

/** A section of the page: its heading and one line, over a card of rows. */
export function SettingsSection({ id, title, description, actions, danger, children }: SettingsSectionProps) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="flex scroll-mt-20 flex-col gap-3.5">
      <SectionHeader id={`${id}-title`} title={title} description={description} actions={actions} className="[&>div:first-child]:flex-col [&>div:first-child]:items-start [&>div:first-child]:gap-1" />
      <div
        className={cn(
          "flex flex-col divide-y rounded-xl border bg-card px-[18px] text-card-foreground sm:px-[22px]",
          danger ? "divide-danger/15 border-danger/30" : "divide-hairline shadow-xs",
        )}
      >
        {children}
      </div>
    </section>
  )
}

interface SettingsRowProps {
  label: ReactNode
  /** The label's id, when a group of buttons is named by it. */
  labelId?: string
  /** For a field: the label is a `<label htmlFor>`. */
  htmlFor?: string
  hint?: ReactNode
  /** The control, on the right; under the text on a phone. */
  children?: ReactNode
  /** The control takes the row's full width under the text (a three-way choice, a list, a form). */
  stacked?: boolean
  /** The label is an h3: the row introduces a group (Tags, Rules) rather than one setting. */
  heading?: boolean
  /** Under the row, inside it: a list that belongs to the label above. */
  below?: ReactNode
}

/** A row: label and hint on the left, the control on the right (under them on a phone). */
export function SettingsRow({ label, labelId, htmlFor, hint, children, stacked, heading, below }: SettingsRowProps) {
  const Label = htmlFor ? "label" : heading ? "h3" : "span"
  return (
    <div className={cn("py-4", below && "flex flex-col gap-3.5")}>
      <div className={cn("flex gap-3", stacked ? "flex-col" : "min-h-10 flex-wrap items-center justify-between gap-x-6")}>
        <span className={cn("flex flex-col gap-[3px]", !stacked && "min-w-60 flex-1")}>
          <Label id={labelId} htmlFor={htmlFor} className="text-[15px] font-medium">
            {label}
          </Label>
          {hint && <span className="text-[13px] text-muted-foreground">{hint}</span>}
        </span>
        {children}
      </div>
      {below}
    </div>
  )
}
