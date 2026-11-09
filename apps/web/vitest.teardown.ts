// In vitest's happy-dom environment window.setTimeout is Node's own, so happy-dom's abort() cannot
// cancel it. Track the timers a file arms and clear the survivors at its end (#454).
// ponytail: only setTimeout is tracked; setInterval, setImmediate, requestAnimationFrame and a
// timeout.refresh() after it fired escape. Wrap those the same way if one ever bites.
const pending = new Set<ReturnType<typeof setTimeout>>()

export function trackTimers(): void {
  const set = globalThis.setTimeout
  const clear = globalThis.clearTimeout
  globalThis.setTimeout = ((cb: (...a: unknown[]) => void, ms?: number, ...args: unknown[]) => {
    const id: ReturnType<typeof setTimeout> = set(
      (...a: unknown[]) => {
        pending.delete(id)
        cb(...a)
      },
      ms,
      ...args,
    )
    pending.add(id)
    return id
  }) as typeof setTimeout
  globalThis.clearTimeout = ((id?: ReturnType<typeof setTimeout>) => {
    if (id !== undefined) pending.delete(id)
    clear(id)
  }) as typeof clearTimeout
}

export function cancelWindowTimers(): void {
  for (const id of pending) clearTimeout(id)
  pending.clear()
}

export function pendingTimerCount(): number {
  return pending.size
}
