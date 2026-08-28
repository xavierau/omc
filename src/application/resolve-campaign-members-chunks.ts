/**
 * Generic array chunking, extracted out of resolve-campaign-members.ts
 * (which sits at the 150-line budget) to keep `.in('id', ids)` calls under
 * PostgREST's URL-length limit — R-8 / B4.4.
 */
export function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size))
  }
  return chunks
}
