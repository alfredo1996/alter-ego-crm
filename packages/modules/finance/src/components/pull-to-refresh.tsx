"use client"

import { cn } from "@alter-ego/ui/utils"
import { RefreshCw } from "lucide-react"
import { useRef, useState } from "react"


const THRESHOLD = 60
const MAX_PULL = 80

interface PullToRefreshProps {
  onRefresh: () => Promise<void> | void
  children: React.ReactNode
  className?: string
}

export function PullToRefresh({ onRefresh, children, className }: PullToRefreshProps) {
  const [pullY, setPullY] = useState(0)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const touchStartY = useRef<number | null>(null)
  const isDragging = useRef(false)

  function handleTouchStart(e: React.TouchEvent) {
    // only activate when page is scrolled to the top
    if (window.scrollY > 4) return
    touchStartY.current = e.touches[0].clientY
    isDragging.current = false
  }

  function handleTouchMove(e: React.TouchEvent) {
    if (touchStartY.current === null || isRefreshing) return
    const delta = e.touches[0].clientY - touchStartY.current
    if (delta < 0) return // only pulling down
    if (window.scrollY > 4) {
      // user scrolled before pulling — cancel
      touchStartY.current = null
      setPullY(0)
      return
    }
    isDragging.current = true
    const clamped = Math.min(MAX_PULL, delta * 0.45)
    setPullY(clamped)
  }

  async function handleTouchEnd() {
    if (!isDragging.current) {
      touchStartY.current = null
      return
    }

    if (pullY >= THRESHOLD * 0.5) {
      setIsRefreshing(true)
      setPullY(THRESHOLD * 0.5)
      try {
        await onRefresh()
      } finally {
        setIsRefreshing(false)
        setPullY(0)
      }
    } else {
      setPullY(0)
    }

    touchStartY.current = null
    isDragging.current = false
  }

  const indicatorVisible = pullY > 4 || isRefreshing
  const indicatorOpacity = isRefreshing ? 1 : Math.min(1, pullY / (THRESHOLD * 0.4))
  const indicatorRotation = (pullY / MAX_PULL) * 360

  return (
    <div
      className={cn(className)}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      {/* Pull indicator */}
      <div
        className="pointer-events-none flex items-center justify-center"
        style={{
          height: indicatorVisible ? pullY : 0,
          opacity: indicatorOpacity,
          // eslint-disable-next-line react-hooks/refs -- react-hooks 7 on existing code; rewrite left for 0.16
          transition: isDragging.current ? "none" : "height 0.2s ease, opacity 0.2s ease",
          overflow: "hidden",
        }}
      >
        <RefreshCw
          className={cn(
            "h-5 w-5 text-muted-foreground",
            isRefreshing && "animate-spin"
          )}
          style={{
            transform: isRefreshing ? undefined : `rotate(${indicatorRotation}deg)`,
          }}
        />
      </div>

      {/* Content */}
      <div
        style={{
          transform: `translateY(${pullY}px)`,
          // eslint-disable-next-line react-hooks/refs -- react-hooks 7 on existing code; rewrite left for 0.16
          transition: isDragging.current ? "none" : "transform 0.2s ease",
        }}
      >
        {children}
      </div>
    </div>
  )
}
