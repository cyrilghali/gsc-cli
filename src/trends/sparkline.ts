const BLOCKS = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'] as const

/** Render a series of numbers as a compact unicode sparkline, scaled to its own range. */
export function sparkline(values: number[]): string {
  if (values.length === 0) return ''
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || 1
  return values
    .map((v) => BLOCKS[Math.min(BLOCKS.length - 1, Math.round(((v - min) / span) * (BLOCKS.length - 1)))])
    .join('')
}

export type VolumeShape = 'ok' | 'seasonal' | 'noise'

/** Heuristic: a series with at least this fraction of zero points is treated as low-volume (tunable). */
const LOW_VOLUME_ZERO_FRACTION = 0.7

/**
 * Judge whether an interest series is near-empty, and if so whether its shape is
 * periodic (seasonal) or just noise. Google Trends normalizes every series to its
 * own peak (100), so a term with almost no volume still shows a `100` — this lets
 * the caller flag that honestly instead of presenting noise as popularity.
 */
export function assessVolume(values: number[]): { low: boolean; zeroFraction: number; shape: VolumeShape } {
  if (values.length === 0) return { low: false, zeroFraction: 0, shape: 'ok' }
  const zeros = values.filter((v) => v === 0).length
  const zeroFraction = zeros / values.length
  const low = zeroFraction >= LOW_VOLUME_ZERO_FRACTION
  if (!low) return { low, zeroFraction, shape: 'ok' }
  // A "block" is a contiguous non-zero run of length >= 2; scattered singletons don't count.
  // >= 2 blocks separated by zero gaps looks periodic (seasonal); otherwise it's nascent/negligible (noise).
  let blocks = 0
  let runLen = 0
  for (const v of values) {
    if (v > 0) {
      runLen++
    } else {
      if (runLen >= 2) blocks++
      runLen = 0
    }
  }
  if (runLen >= 2) blocks++
  return { low, zeroFraction, shape: blocks >= 2 ? 'seasonal' : 'noise' }
}

/** Downsample a series to at most `width` points by averaging buckets, preserving shape. */
export function resample(values: number[], width: number): number[] {
  if (values.length <= width) return values
  const out: number[] = []
  const bucket = values.length / width
  for (let i = 0; i < width; i++) {
    const slice = values.slice(Math.floor(i * bucket), Math.floor((i + 1) * bucket))
    out.push(slice.reduce((a, b) => a + b, 0) / (slice.length || 1))
  }
  return out
}
