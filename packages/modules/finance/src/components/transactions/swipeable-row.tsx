"use client"

import { cn } from "@alter-ego/ui/utils"
import { Pencil, Trash2 } from "lucide-react"
import { useRef, useState } from "react"


const SWIPE_THRESHOLD = 60
const MAX_SWIPE = 80

interface SwipeableRowProps {
  onEdit?: () => void
  onDelete: () => void
  children: React.ReactNode
}

export function SwipeableRow({ onEdit, onDelete, children }: SwipeableRowProps) {
  const [offset, setOffset] = useState(0)
  const [isTransitioning, setIsTransitioning] = useState(false)
  const touchStart = useRef<{ x: number; y: number } | null>(null)
  // Locked on the first 8 px of movement: a mostly vertical gesture is a scroll
  // and never moves the row, so scrolling the list cannot open Delete.
  const axis = useRef<"x" | "y" | null>(null)

  function handleTouchStart(e: React.TouchEvent) {
    touchStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }
    axis.current = null
    setIsTransitioning(false)
  }

  function handleTouchMove(e: React.TouchEvent) {
    if (!touchStart.current) return
    const dx = e.touches[0].clientX - touchStart.current.x
    const dy = e.touches[0].clientY - touchStart.current.y
    if (axis.current === null) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 8) return
      axis.current = Math.abs(dx) > 2 * Math.abs(dy) ? "x" : "y"
    }
    if (axis.current !== "x") return
    // clamp to [-MAX_SWIPE, MAX_SWIPE]
    setOffset(Math.max(-MAX_SWIPE, Math.min(MAX_SWIPE, dx)))
  }

  function handleTouchEnd() {
    setIsTransitioning(true)
    setOffset(0)
    if (axis.current === "x") {
      if (offset <= -SWIPE_THRESHOLD) onDelete() // swiped left → delete
      else if (offset >= SWIPE_THRESHOLD && onEdit) onEdit() // swiped right → edit
    }
    touchStart.current = null
    axis.current = null
  }

  const showDelete = offset < -8
  const showEdit = offset > 8

  return (
    <div className="relative overflow-hidden rounded-lg">
      {/* Action backgrounds */}
      <div
        className={cn(
          "absolute inset-y-0 right-0 flex items-center justify-end px-4 transition-opacity duration-150",
          "rounded-lg bg-destructive",
          showDelete ? "opacity-100" : "opacity-0"
        )}
        style={{ width: MAX_SWIPE }}
      >
        <Trash2 className="h-5 w-5 text-destructive-foreground" />
      </div>
      <div
        className={cn(
          "absolute inset-y-0 left-0 flex items-center justify-start px-4 transition-opacity duration-150",
          "rounded-lg bg-primary",
          showEdit ? "opacity-100" : "opacity-0"
        )}
        style={{ width: MAX_SWIPE }}
      >
        <Pencil className="h-5 w-5 text-primary-foreground" />
      </div>

      {/* Row content */}
      <div
        style={{
          transform: `translateX(${offset}px)`,
          transition: isTransitioning ? "transform 0.2s ease" : "none",
        }}
        // The browser keeps vertical panning; horizontal moves reach the handlers.
        className="touch-pan-y"
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        {children}
      </div>
    </div>
  )
}
