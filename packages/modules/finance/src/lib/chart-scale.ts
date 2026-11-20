const STEPS = [1, 2, 2.5, 5, 10]

/**
 * Round axis ticks that span [min, max] in about `steps` intervals: 0, 1000, 2000, 3000, 4000 for
 * 3450, never 0, 862, 1724. A flat series gets a scale from zero so it still has a height.
 */
export function niceScale(min: number, max: number, steps = 4): number[] {
  if (min === 0 && max === 0) return [0, 1]
  if (min === max) return niceScale(Math.min(0, min), Math.max(0, max), steps)
  const raw = (max - min) / steps
  const magnitude = 10 ** Math.floor(Math.log10(raw))
  const step = STEPS.find((s) => s * magnitude >= raw - 1e-9)! * magnitude
  const first = Math.floor(min / step)
  const last = Math.ceil(max / step)
  // toFixed: 0.1 * 3 is 0.30000000000000004, and that would be an axis label.
  return Array.from({ length: last - first + 1 }, (_, i) => +((first + i) * step).toFixed(10))
}
