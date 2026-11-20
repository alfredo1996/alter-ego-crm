import type {
  Currency,
  DismissedSubscriptionPattern,
  RecurringTransaction,
  SuspectedSubscription,
  Transaction,
} from "../types"

// ─── Cadence bands (days) ────────────────────────────────────────────────────

const CADENCES = [
  { name: "weekly" as const, min: 6, max: 8 },
  { name: "monthly" as const, min: 27, max: 33 },
  { name: "yearly" as const, min: 350, max: 380 },
]

const CONFIDENCE_THRESHOLD = 0.6
const AMOUNT_TOLERANCE = 0.05 // ±5 %
const GAP_IRREGULARITY_MAX = 0.40 // drop if stdGap > 40 % of median
const WINDOW_DAYS_DEFAULT = 395 // 13 months
const CANCELLED_MULTIPLIER = 1.5

// ─── Public types ────────────────────────────────────────────────────────────

export interface DetectSubscriptionsInput {
  transactions: Transaction[]
  recurringTransactions: RecurringTransaction[]
  dismissedPatterns: DismissedSubscriptionPattern[]
  normalize: (raw: string) => string
  now?: Date
  windowDays?: number
}

// ─── Internal bucket ─────────────────────────────────────────────────────────

interface Bucket {
  accountId: string
  merchantName: string
  currency: Currency
  amounts: number[]
  dates: Date[]
  transactionIds: string[]
  categoryIds: (string | null)[]
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2
    : (sorted[mid] ?? 0)
}

function stdDev(values: number[], mean: number): number {
  if (values.length < 2) return 0
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length
  return Math.sqrt(variance)
}

function modalValue<T>(values: T[]): T | null {
  if (values.length === 0) return null
  const freq = new Map<string, { value: T; count: number }>()
  for (const v of values) {
    const key = String(v)
    const existing = freq.get(key)
    if (existing) existing.count++
    else freq.set(key, { value: v, count: 1 })
  }
  let best: { value: T; count: number } | null = null
  for (const entry of freq.values()) {
    if (!best || entry.count > best.count) best = entry
  }
  return best?.value ?? null
}

/** Compute a deterministic key for the (accountId, merchant, amount-bucket) triple. */
export function computePatternKey(
  accountId: string,
  merchantName: string,
  estimatedAmountCents: number,
): string {
  return `${accountId}|${merchantName}|${estimatedAmountCents}`
}

function addDays(date: Date, days: number): Date {
  const out = new Date(date)
  out.setDate(out.getDate() + days)
  return out
}

// ─── Main detector ───────────────────────────────────────────────────────────

export function detectSuspectedSubscriptions(
  input: DetectSubscriptionsInput,
): SuspectedSubscription[] {
  const {
    transactions,
    recurringTransactions,
    dismissedPatterns,
    normalize,
    windowDays = WINDOW_DAYS_DEFAULT,
  } = input
  const now = input.now ?? new Date()
  const windowStart = addDays(now, -windowDays)

  const dismissedKeys = new Set(dismissedPatterns.map((d) => d.patternKey))

  // Build exclusion set from existing RecurringTransactions (normalized merchant + accountId + amount ±5%)
  const recurringExclusions: { accountId: string; merchant: string; amount: number }[] =
    recurringTransactions.map((r) => ({
      accountId: r.accountId,
      merchant: normalize(r.description),
      amount: r.amount,
    }))

  function isExcludedByRecurring(
    accountId: string,
    merchant: string,
    amount: number,
  ): boolean {
    return recurringExclusions.some(
      (r) =>
        r.accountId === accountId &&
        r.merchant === merchant &&
        Math.abs(r.amount - amount) / Math.max(r.amount, amount) <= AMOUNT_TOLERANCE,
    )
  }

  // Step 1: pre-filter
  const eligible = transactions.filter(
    (t) =>
      t.type === "expense" &&
      !t.isRecurring &&
      t.amount > 0 &&
      t.date >= windowStart &&
      t.date <= now,
  )

  // Step 2: bucket by (accountId, normalizedMerchant, amountCents)
  const bucketMap = new Map<string, Bucket>()

  for (const tx of eligible) {
    const merchant = normalize(tx.description) || tx.description.trim().toLowerCase()
    const amountCents = Math.round(tx.amount * 100)
    const key = computePatternKey(tx.accountId, merchant, amountCents)

    if (!bucketMap.has(key)) {
      bucketMap.set(key, {
        accountId: tx.accountId,
        merchantName: merchant,
        currency: tx.currency,
        amounts: [],
        dates: [],
        transactionIds: [],
        categoryIds: [],
      })
    }
    const bucket = bucketMap.get(key)!
    bucket.amounts.push(tx.amount)
    bucket.dates.push(tx.date)
    bucket.transactionIds.push(tx.id)
    bucket.categoryIds.push(tx.categoryId)
  }

  type Candidate = SuspectedSubscription & { estimatedMonthlyCost: number }
  const results: Candidate[] = []

  for (const [patternKey, bucket] of bucketMap) {
    if (bucket.dates.length < 2) continue

    // Sort by date ascending
    const sorted = bucket.dates
      .map((date, i) => ({
        date,
        amount: bucket.amounts[i]!,
        id: bucket.transactionIds[i]!,
        categoryId: bucket.categoryIds[i]!,
      }))
      .sort((a, b) => a.date.getTime() - b.date.getTime())

    const sortedDates = sorted.map((s) => s.date)
    const sortedAmounts = sorted.map((s) => s.amount)

    // Step 3: compute gap statistics
    const gaps: number[] = []
    for (let i = 1; i < sortedDates.length; i++) {
      const gapMs = sortedDates[i]!.getTime() - sortedDates[i - 1]!.getTime()
      gaps.push(gapMs / 86_400_000)
    }
    const medianGap = median(gaps)
    const meanGap = gaps.reduce((s, g) => s + g, 0) / gaps.length
    const gapStd = stdDev(gaps, meanGap)

    // Step 4: classify cadence
    const cadenceEntry = CADENCES.find(
      (c) => medianGap >= c.min && medianGap <= c.max,
    )
    if (!cadenceEntry) continue

    // Step 5: filter noise
    if (gapStd > GAP_IRREGULARITY_MAX * medianGap) continue

    const amountMedian = median(sortedAmounts)
    const amountStd = stdDev(sortedAmounts, amountMedian)
    if (amountStd / amountMedian > AMOUNT_TOLERANCE) continue

    // Exclusions
    if (isExcludedByRecurring(bucket.accountId, bucket.merchantName, amountMedian)) continue
    if (dismissedKeys.has(patternKey)) continue

    // Step 6: score
    const n = sorted.length
    const firstSeen = sortedDates[0]!
    const lastSeen = sortedDates[sortedDates.length - 1]!
    const daysSinceLastSeen =
      (now.getTime() - lastSeen.getTime()) / 86_400_000

    const looksCancelled = daysSinceLastSeen > CANCELLED_MULTIPLIER * medianGap

    const score =
      1.0 * Math.min(n / 6, 1) +
      0.5 * (1 - gapStd / Math.max(medianGap, 1)) +
      0.3 * (amountStd / amountMedian < 0.02 ? 1 : 0) -
      0.5 * (looksCancelled ? 1 : 0)

    if (score < CONFIDENCE_THRESHOLD) continue

    const confidence: SuspectedSubscription["confidence"] =
      score >= 1.2 ? "high" : score >= 0.9 ? "medium" : "low"

    const suggestedCategoryId = modalValue(
      sorted.map((s) => s.categoryId).filter((c): c is string => c !== null),
    )

    const estimatedMonthlyCost =
      cadenceEntry.name === "yearly"
        ? amountMedian / 12
        : cadenceEntry.name === "weekly"
          ? amountMedian * (365 / 7 / 12)
          : amountMedian

    results.push({
      id: patternKey,
      merchantName: bucket.merchantName,
      accountId: bucket.accountId,
      estimatedAmount: amountMedian,
      currency: bucket.currency,
      cadence: cadenceEntry.name,
      interval: 1,
      observationCount: n,
      firstSeen,
      lastSeen,
      daysSinceLastSeen,
      looksCancelled,
      confidence,
      transactionIds: sorted.map((s) => s.id),
      suggestedCategoryId: suggestedCategoryId ?? null,
      suggestedStartDate: addDays(lastSeen, Math.round(medianGap)),
      medianGap,
      estimatedMonthlyCost,
    })
  }

  // Sort: non-cancelled by monthly cost desc, cancelled appended at bottom
  const sortByCost = (a: Candidate, b: Candidate) =>
    b.estimatedMonthlyCost - a.estimatedMonthlyCost

  const active = results.filter((r) => !r.looksCancelled).sort(sortByCost)
  const cancelled = results.filter((r) => r.looksCancelled).sort(sortByCost)

  return [...active, ...cancelled].map(({ estimatedMonthlyCost: _, ...r }) => r)
}
