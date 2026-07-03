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
