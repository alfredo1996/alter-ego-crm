/**
 * Import de-duplication: split hashed rows into the ones to import vs the ones
 * to surface as duplicates. A row is a duplicate if its importHash matches an
 * already-imported transaction (`existingHashes`) OR an earlier row in the same
 * file (in-file duplicate). Order is preserved.
 */
export interface Hashed<T> {
  row: T
  hash: string
}

export function partitionByImportHash<T>(
  items: Hashed<T>[],
  existingHashes: Set<string>,
): { newItems: Hashed<T>[]; duplicates: T[] } {
  const seen = new Set<string>()
  const newItems: Hashed<T>[] = []
  const duplicates: T[] = []
  for (const item of items) {
    if (existingHashes.has(item.hash) || seen.has(item.hash)) {
      duplicates.push(item.row)
    } else {
      seen.add(item.hash)
      newItems.push(item)
    }
  }
  return { newItems, duplicates }
}
