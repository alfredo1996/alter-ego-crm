"use client"

import { isoDate } from "@alter-ego/kernel/dates"
import { Button } from "@alter-ego/ui/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@alter-ego/ui/ui/dialog"
import { Form, FormField, FormItem, FormLabel, FormControl, FormMessage } from "@alter-ego/ui/ui/form"
import { Input } from "@alter-ego/ui/ui/input"
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@alter-ego/ui/ui/select"
import { Textarea } from "@alter-ego/ui/ui/textarea"
import { zodResolver } from "@hookform/resolvers/zod"
import { Trash2 } from "lucide-react"
import { useEffect, useState } from "react"
import { useForm } from "react-hook-form"
import { type z } from "zod"

import { ConfirmDeleteDialog } from "@/components/confirm-delete-dialog"
import { createCompanyDeadlineSchema } from "@/types/schemas"

import type { CompanyDeadline, CompanyDeadlineKind } from "@/types"

type FormValues = z.infer<typeof createCompanyDeadlineSchema>

export const KIND_LABELS: Record<CompanyDeadlineKind, string> = {
  tax: "Tax",
  contract: "Contract",
  admin: "Admin",
  other: "Other",
}

const KINDS: CompanyDeadlineKind[] = ["tax", "contract", "admin", "other"]

const EMPTY: FormValues = {
  title: "",
  date: new Date(),
  kind: "admin",
  amount: null,
  notes: null,
}

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  deadline?: CompanyDeadline | null
  onSubmit: (values: FormValues) => void
  isPending: boolean
  /** Given when editing: the footer offers Delete Deadline, confirmed first. */
  onDelete?: () => void
  isDeleting?: boolean
}

/** New and Edit, with Delete in an edit's footer. Key it by the deadline, so a confirm left open never carries over. */
export function DeadlineFormDialog({ open, onOpenChange, deadline, onSubmit, isPending, onDelete, isDeleting = false }: Props) {
  const isEditing = !!deadline
  const [confirmDelete, setConfirmDelete] = useState(false)
  const form = useForm<FormValues>({
    resolver: zodResolver(createCompanyDeadlineSchema),
    defaultValues: EMPTY,
  })

  useEffect(() => {
    if (!open) return
    form.reset(
      deadline
        ? {
            title: deadline.title,
            date: deadline.date,
            kind: deadline.kind,
            amount: deadline.amount,
            notes: deadline.notes,
          }
        : { ...EMPTY, date: new Date() },
    )
  }, [open, deadline, form])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>{isEditing ? "Edit Deadline" : "New Deadline"}</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="title"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>What&apos;s due</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g. Accountant fee Q3" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="date"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Date</FormLabel>
                    <FormControl>
                      <Input
                        type="date"
                        value={field.value instanceof Date ? isoDate(field.value) : ""}
                        onChange={(e) =>
                          field.onChange(e.target.value ? new Date(e.target.value + "T00:00:00") : new Date())
                        }
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="kind"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Type</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {KINDS.map((kind) => (
                          <SelectItem key={kind} value={kind}>
                            {KIND_LABELS[kind]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="amount"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Amount</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder="empty = not known yet"
                      value={field.value ?? ""}
                      onChange={(e) => field.onChange(e.target.valueAsNumber || null)}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="notes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Notes</FormLabel>
                  <FormControl>
                    <Textarea
                      rows={2}
                      value={field.value ?? ""}
                      onChange={(e) => field.onChange(e.target.value || null)}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <DialogFooter className="justify-between">
              {isEditing && onDelete && (
                <Button
                  type="button"
                  variant="ghost"
                  className="text-destructive hover:text-destructive"
                  onClick={() => setConfirmDelete(true)}
                >
                  <Trash2 className="h-4 w-4 sm:mr-2" />
                  <span className="max-sm:sr-only">Delete Deadline</span>
                </Button>
              )}
              {/* ml-auto: wrapped onto its own line, the group still ends at the right. */}
              <div className="ml-auto flex flex-wrap justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={isPending}>
                  {isPending ? "Saving…" : isEditing ? "Save" : "Add Deadline"}
                </Button>
              </div>
            </DialogFooter>
          </form>
        </Form>

        {deadline && onDelete && (
          <ConfirmDeleteDialog
            open={open && confirmDelete}
            onOpenChange={setConfirmDelete}
            title="Delete Deadline"
            description={`"${deadline.title}" is removed from the calendar.`}
            isPending={isDeleting}
            onConfirm={onDelete}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}
