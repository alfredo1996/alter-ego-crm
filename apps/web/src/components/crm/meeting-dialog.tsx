"use client"

import { isoDate } from "@alter-ego/kernel/dates"
import { Button } from "@alter-ego/ui/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@alter-ego/ui/ui/dialog"
import { Input } from "@alter-ego/ui/ui/input"
import { Label } from "@alter-ego/ui/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@alter-ego/ui/ui/select"
import { Textarea } from "@alter-ego/ui/ui/textarea"
import { cn } from "@alter-ego/ui/utils"
import { format } from "date-fns"
import { Trash2 } from "lucide-react"
import { useState } from "react"

import { ConfirmDeleteDialog } from "@/components/confirm-delete-dialog"
import { useEngagements } from "@/hooks/use-engagements"
import { useCreateMeeting, useDeleteMeeting, useMeetings, useUpdateMeeting } from "@/hooks/use-meetings"
import { engagementLabel } from "@/lib/engagements"
import { MEETING_HEALTH, formatMeetingDate, healthByContract } from "@/lib/meetings"
import { MEETING_TEXT_MAX, createMeetingSchema, updateMeetingSchema } from "@/types/schemas"

import type { Meeting, MeetingHealth, UpdateMeetingInput } from "@/types"

/** A Radix Select item cannot hold "" or null: the Contract choice for client level. */
const NO_CONTRACT = "none"
/** The counter shows only near the cap, where it is worth reading. */
const COUNTER_FROM = 4500
const HEALTHS: (MeetingHealth | null)[] = [null, "green", "yellow", "red"]

/** What the dialog edits, in the shape its inputs hold it. */
export interface MeetingForm {
  /** "yyyy-MM-dd" as the date input gives it. */
  date: string
  /** "HH:mm" as the time input gives it; "" = no time. */
  time: string
  /** null = a client-level verbale. */
  engagementId: string | null
  health: MeetingHealth | null
  text: string
}

/**
 * A new verbale starts today, with no time (a call is logged afterwards, so
 * "now" would be wrong), no light, on the section it was opened from.
 */
export function meetingForm(meeting: Meeting | null, engagementId: string | null, today: string): MeetingForm {
  if (!meeting) return { date: today, time: "", engagementId, health: null, text: "" }
  return {
    date: meeting.date,
    time: meeting.time ?? "",
    engagementId: meeting.engagementId,
    health: meeting.health,
    text: meeting.text,
  }
}

/**
 * The single update Save writes: only the fields that changed, so one left
 * alone never overwrites what the MCP wrote meanwhile. The stored text is
 * trimmed, so it is compared trimmed.
 */
export function meetingUpdate(opened: Meeting, form: MeetingForm): UpdateMeetingInput {
  const input: UpdateMeetingInput = {}
  const time = form.time || null
  const text = form.text.trim()
  if (form.date !== opened.date) input.date = form.date
  if (time !== opened.time) input.time = time
  if (form.engagementId !== opened.engagementId) input.engagementId = form.engagementId
  if (form.health !== opened.health) input.health = form.health
  if (text !== opened.text) input.text = text
  return input
}

/** Creates a verbale (`meeting` null) or opens one to edit or delete. */
export function MeetingDialog({
  open,
  meeting,
  ...props
}: {
  open: boolean
  meeting: Meeting | null
  userId: string | undefined
  clientId: string
  clientName: string
  /** The section it was opened from: a new verbale's contract, null = client level. */
  engagementId: string | null
  onClose: () => void
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && props.onClose()}>
      {/* Mounted per opening, so each one starts from the verbale as it is now. */}
      {open && <MeetingDetails meeting={meeting} {...props} />}
    </Dialog>
  )
}

function MeetingDetails({
  userId,
  clientId,
  clientName,
  engagementId,
  meeting: opened,
  onClose,
}: {
  userId: string | undefined
  clientId: string
  clientName: string
  engagementId: string | null
  meeting: Meeting | null
  onClose: () => void
}) {
  const { data: engagements = [] } = useEngagements(userId)
  const { data: meetings = [] } = useMeetings(userId)
  const createMeeting = useCreateMeeting(userId)
  const updateMeeting = useUpdateMeeting(userId)
  const deleteMeeting = useDeleteMeeting(userId)
  // The verbale as opened: a refetch or an MCP edit while the dialog is open
  // must not turn an untouched field into an "edit" that reverts it.
  const [meeting] = useState(opened)
  // The browser's day, not the server's: a call cannot be logged in the future.
  const [today] = useState(() => isoDate(new Date()))
  const [initial] = useState(() => meetingForm(meeting, engagementId, today))
  const [form, setForm] = useState(initial)
  const [error, setError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const set = (patch: Partial<MeetingForm>) => {
    setForm((f) => ({ ...f, ...patch }))
    setError(null)
  }
  const contracts = engagements.filter((e) => e.clientId === clientId)
  const current = form.engagementId ? healthByContract(meetings).get(form.engagementId) : undefined
  const dirty = (Object.keys(form) as (keyof MeetingForm)[]).some((k) => form[k] !== initial[k])
  const failed = createMeeting.isError || updateMeeting.isError

  function save() {
    if (form.date > today) {
      return setError("A future call is a task with a due date: add it under Tasks.")
    }
    if (meeting) {
      const update = meetingUpdate(meeting, form)
      if (Object.keys(update).length === 0) return onClose()
      const parsed = updateMeetingSchema.safeParse(update)
      if (!parsed.success) return setError(parsed.error.issues[0].message)
      updateMeeting.mutate({ id: meeting.id, input: parsed.data }, { onSuccess: onClose })
    } else {
      const parsed = createMeetingSchema.safeParse({ clientId, ...form, time: form.time || null })
      if (!parsed.success) return setError(parsed.error.issues[0].message)
      createMeeting.mutate(parsed.data, { onSuccess: onClose })
    }
  }

  // Unsaved edits go only through Cancel or the close button, never through
  // a stray click beside the dialog or an Escape meant for a field.
  const keepEdits = (e: Event) => {
    if (dirty) e.preventDefault()
  }

  return (
    <DialogContent size="lg" onInteractOutside={keepEdits} onEscapeKeyDown={keepEdits}>
      <DialogHeader>
        <DialogTitle className="pr-6">
          {meeting ? `Meeting on ${formatMeetingDate(meeting.date)}` : "Log Meeting"}
        </DialogTitle>
        <DialogDescription>{clientName}</DialogDescription>
      </DialogHeader>

      {/* noValidate: a typed future date gets the line below, not the browser's tooltip. */}
      <form
        noValidate
        className="space-y-6"
        onSubmit={(e) => {
          e.preventDefault()
          save()
        }}
      >
        {/* minmax(0,1fr): a phone's single auto column would grow to its widest select. */}
        <div className="grid grid-cols-[minmax(0,1fr)] gap-6 sm:grid-cols-[1fr_13rem]">
          <div className="min-w-0 space-y-2">
            <Label htmlFor="meeting-text">What happened</Label>
            <Textarea
              id="meeting-text"
              rows={10}
              maxLength={MEETING_TEXT_MAX}
              autoFocus
              placeholder="Decisions, open points, what the client asked for. Things to do go in Tasks."
              value={form.text}
              onChange={(e) => set({ text: e.target.value })}
            />
            {form.text.length > COUNTER_FROM && (
              <p className="text-right text-xs text-muted-foreground">
                {form.text.length} / {MEETING_TEXT_MAX}
              </p>
            )}
          </div>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="meeting-date">Date</Label>
              <Input
                id="meeting-date"
                type="date"
                max={today}
                value={form.date}
                onChange={(e) => set({ date: e.target.value })}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="meeting-time">Time</Label>
              <Input
                id="meeting-time"
                type="time"
                value={form.time}
                onChange={(e) => set({ time: e.target.value })}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="meeting-engagement">Contract</Label>
              <Select
                value={form.engagementId ?? NO_CONTRACT}
                onValueChange={(value) => set({ engagementId: value === NO_CONTRACT ? null : value })}
              >
                <SelectTrigger id="meeting-engagement">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_CONTRACT}>No contract</SelectItem>
                  {contracts.map((e) => (
                    <SelectItem key={e.id} value={e.id}>
                      {engagementLabel(e)}
                      {!e.isActive && " (closed)"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <p id="meeting-health" className="text-sm font-medium">
                {form.engagementId ? "Contract status" : "Status"}
              </p>
              <div role="group" aria-labelledby="meeting-health" className="grid grid-cols-2 gap-1.5">
                {HEALTHS.map((h) => {
                  const on = form.health === h
                  return (
                    <Button
                      key={h ?? "none"}
                      type="button"
                      variant="outline"
                      size="sm"
                      aria-pressed={on}
                      className={cn("justify-start", on && (h ? MEETING_HEALTH[h].chip : "bg-accent"))}
                      onClick={() => set({ health: h })}
                    >
                      <span aria-hidden="true" className={cn(!on && (h ? MEETING_HEALTH[h].dot : "text-muted-foreground"))}>
                        {h ? "●" : "○"}
                      </span>
                      {h ? MEETING_HEALTH[h].label : "None"}
                    </Button>
                  )
                })}
              </div>
              {current?.health && (
                <p className="text-xs text-muted-foreground">
                  Current: {MEETING_HEALTH[current.health].label} since {formatMeetingDate(current.date, "d MMM")}
                </p>
              )}
            </div>

            {meeting && (
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs text-muted-foreground">
                <dt>Created</dt>
                <dd>{format(meeting.createdAt, "d MMM yyyy")}</dd>
                <dt>Updated</dt>
                <dd>{format(meeting.updatedAt, "d MMM yyyy")}</dd>
              </dl>
            )}
          </div>
        </div>

        {(error || failed) && (
          <p role="alert" className="text-sm text-destructive">
            {error ?? "Save failed. Try again."}
          </p>
        )}

        <DialogFooter className={cn(meeting && "justify-between")}>
          {meeting && (
            <Button
              type="button"
              variant="ghost"
              className="text-destructive hover:text-destructive"
              onClick={() => setConfirmDelete(true)}
            >
              <Trash2 className="h-4 w-4 sm:mr-2" />
              <span className="max-sm:sr-only">Delete</span>
            </Button>
          )}
          <div className="ml-auto flex flex-wrap justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={createMeeting.isPending || updateMeeting.isPending}>
              Save
            </Button>
          </div>
        </DialogFooter>
      </form>

      {meeting && (
        <ConfirmDeleteDialog
          open={confirmDelete}
          onOpenChange={setConfirmDelete}
          title="Delete Meeting"
          description="It leaves the history. If it set the latest status, the contract goes back to the one before."
          isPending={deleteMeeting.isPending}
          onConfirm={() => deleteMeeting.mutate(meeting.id, { onSuccess: onClose })}
        />
      )}
    </DialogContent>
  )
}
