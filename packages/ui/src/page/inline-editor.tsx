"use client"

import { useEffect, useId, useRef } from "react"

import { Button } from "../ui/button"
import { Textarea } from "../ui/textarea"
import { cn } from "../utils"

import type { ReactNode } from "react"

interface InlineEditorProps {
  /** The id of the heading that names the textbox: the section's own title. */
  labelledBy: string
  /** The guiding question, over the textbox. */
  question: ReactNode
  value: string
  onChange: (value: string) => void
  maxLength: number
  /** Save's words, which say what it saves: "Save Requirements". */
  saveLabel: string
  onSave: () => void
  onCancel: () => void
  /** One line under the textbox, before the counter. */
  hint?: ReactNode
  /** Read-only while it saves: what is typed then would be lost when the editor closes. */
  saving?: boolean
  error?: string | null
  id?: string
  className?: string
}

/**
 * Prose edited in place (Editing.dc): the question, a 16px textarea, a mono "n / max" counter,
 * Cancel then Save; it opens with the caret after the text. Controlled: the page keeps the drafts, and shows "Unsaved changes" by the heading.
 */
export function InlineEditor({
  labelledBy,
  question,
  value,
  onChange,
  maxLength,
  saveLabel,
  onSave,
  onCancel,
  hint,
  saving = false,
  error,
  id,
  className,
}: InlineEditorProps) {
  const questionId = useId()
  const box = useRef<HTMLTextAreaElement>(null)
  // autoFocus leaves the caret at the start: it goes after the text, where History's line for today waits.
  useEffect(() => {
    const el = box.current
    if (!el) return
    el.setSelectionRange(el.value.length, el.value.length)
    el.scrollTop = el.scrollHeight
  }, [])
  return (
    <div id={id} className={cn("flex flex-col gap-3.5", className)}>
      <p id={questionId} className="text-sm text-subtle-foreground">
        {question}
      </p>
      <Textarea
        ref={box}
        aria-labelledby={labelledBy}
        aria-describedby={questionId}
        rows={7}
        maxLength={maxLength}
        autoFocus
        readOnly={saving}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-xl px-4 py-3.5 leading-[1.65]"
      />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-meta text-muted-foreground">
          {hint && <>{hint} </>}
          <span className="font-mono tabular-nums">
            {value.length.toLocaleString("en")} / {maxLength.toLocaleString("en")}
          </span>
        </p>
        {/* On the right, under the hint when the line is full. */}
        <div className="ml-auto flex flex-wrap gap-2">
          <Button variant="outline" size="lg" onClick={onCancel}>
            Cancel
          </Button>
          {/* Named while it saves too. */}
          <Button size="lg" aria-label={saveLabel} disabled={saving} onClick={onSave}>
            {saving ? "Saving…" : saveLabel}
          </Button>
        </div>
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}
