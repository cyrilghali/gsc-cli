import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import type { Command } from 'commander'
import pc from 'picocolors'
import { pickCanonical } from '../../cli-util.ts'
import { renderTable, truncate } from '../../format.ts'
import type { RankedQuery } from '../../trends/api.ts'
import type { SuggestRecord } from '../../trends/commands/suggest.ts'
import { opportunityScore, parseRisingValue, patternWeight } from '../scoring.ts'
import type { MinedSignal } from './mine.ts'

const OUTPUTS = ['table', 'json'] as const

export interface TopSignal {
  url: string
  matched_phrase: string
  weight: number
}

export interface ScoredTerm {
  term: string
  score: number
  breakdown: {
    keyword_signal: number
    trend_velocity: number | 'absent'
    pain_depth: number
    workaround_bonus_applied: boolean
  }
  contributing_sources: string[]
  multi_source_pain_match: boolean
  signal_count: number
  top_signals: TopSignal[]
}

/**
 * Collapse deduplicated sorted terms into a filesystem-safe slug ≤ 60 chars.
 * Steps: deduplicate → sort → join with '-' → lowercase →
 *        collapse non-alphanumerics to '-' → trim edges → truncate.
 */
export function snapshotSlug(terms: string[]): string {
  const deduped = [...new Set(terms)]
  deduped.sort()
  const joined = deduped.join('-')
  const lower = joined.toLowerCase()
  const slugged = lower.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return slugged.slice(0, 60)
}

export interface RisingEntry {
  query: string
  value: number
}

/**
 * Pure scoring helper: groups signals by term, computes per-term components,
 * calls opportunityScore, and returns results ranked by score desc.
 *
 * @param signals  - pain signals (from gpain mine -o json)
 * @param keywords - suggest records (from gtrends suggest -o json); pass [] when no file
 * @param rising   - rising entries from gtrends related -o json; null when the trend
 *                   file was not provided (marks breakdown as 'absent'). Velocity is
 *                   attributed per term: only entries whose query contains the term's
 *                   seed (or the term itself when no keyword record matches) count —
 *                   a global max would be driven by unrelated breakout noise.
 */
export function scoreTerms(
  signals: MinedSignal[],
  keywords: SuggestRecord[],
  rising: RisingEntry[] | null,
): ScoredTerm[] {
  // Group signals by term, preserving insertion order
  const byTerm = new Map<string, MinedSignal[]>()
  for (const signal of signals) {
    const existing = byTerm.get(signal.term)
    if (existing) {
      existing.push(signal)
    } else {
      byTerm.set(signal.term, [signal])
    }
  }

  const results: ScoredTerm[] = []

  for (const [term, termSignals] of byTerm) {
    // keyword_signal: max patternWeight over case-insensitively matching suggestions; 0.3 if none
    const matching = keywords.filter((k) => k.suggestion.toLowerCase() === term.toLowerCase())
    const keywordSignal =
      matching.length > 0 ? Math.max(...matching.map((k) => patternWeight(k.pattern))) : 0.3

    // trend_velocity: max parseRisingValue over the term's attributable rising entries
    const trendAbsent = rising === null
    const anchors =
      matching.length > 0
        ? [...new Set(matching.map((k) => k.seed.toLowerCase()))]
        : [term.toLowerCase()]
    const attributable = trendAbsent
      ? []
      : rising.filter((r) => anchors.some((a) => r.query.toLowerCase().includes(a)))
    const trendVelocity =
      attributable.length > 0 ? Math.max(...attributable.map((r) => parseRisingValue(r.value))) : 0

    // pain_depth: mean of signal weights
    const painDepth = termSignals.reduce((sum, s) => sum + s.weight, 0) / termSignals.length
    const workaroundDetected = termSignals.some((s) => s.workaround_detected)

    // contributing_sources: sorted distinct source values
    const sourcesSet = new Set(termSignals.map((s) => s.source))
    const contributing_sources = [...sourcesSet].sort()

    // multi_source_pain_match: any signal is flagged
    const multi_source_pain_match = termSignals.some((s) => s.multi_source_pain_match)

    // top_signals: top 3 by weight desc
    const sortedByWeight = [...termSignals].sort((a, b) => b.weight - a.weight)
    const top_signals: TopSignal[] = sortedByWeight.slice(0, 3).map((s) => ({
      url: s.url,
      matched_phrase: s.matched_phrase,
      weight: s.weight,
    }))

    const { score, breakdown } = opportunityScore({
      keywordSignal,
      trendVelocity,
      painDepth,
      workaroundDetected,
    })

    results.push({
      term,
      score,
      breakdown: {
        keyword_signal: breakdown.keyword_signal,
        trend_velocity: trendAbsent ? 'absent' : breakdown.trend_velocity,
        pain_depth: breakdown.pain_depth,
        workaround_bonus_applied: breakdown.workaround_bonus_applied,
      },
      contributing_sources,
      multi_source_pain_match,
      signal_count: termSignals.length,
      top_signals,
    })
  }

  results.sort((a, b) => b.score - a.score)
  return results
}

interface ScoreOptions {
  keywordsFile?: string
  trendFile?: string
  enrichmentFile?: string
  out?: string
  output: string
}

export function registerScoreCommand(program: Command): void {
  program
    .command('score')
    .description('Score and rank pain signals from a mine output file')
    .argument('<signals-file>', 'path to gpain mine -o json output (use /dev/stdin to pipe)')
    .option('--keywords-file <path>', 'gtrends suggest -o json output (keyword signal enrichment)')
    .option('--trend-file <path>', 'gtrends related -o json output (trend velocity enrichment)')
    .option('--enrichment-file <path>', 'arbitrary JSON forwarded verbatim as enrichment (not scored)')
    .option(
      '--out <path>',
      'write ranked snapshot JSON here (default: ~/.claude/saas-suite/snapshots/…)',
    )
    .option('-o, --output <format>', OUTPUTS.join(' | '), 'json')
    .addHelpText(
      'after',
      `
Examples:
  gpain mine "zapier alternative" -o json | gpain score /dev/stdin
  gpain score signals.json --keywords-file suggest.json --trend-file related.json -o table`,
    )
    .action((signalsFile: string, opts: ScoreOptions) => {
      const output = pickCanonical(opts.output, OUTPUTS, '--output')

      // Read signals file (works for /dev/stdin via readFileSync path)
      const signals = JSON.parse(readFileSync(signalsFile, 'utf8')) as MinedSignal[]

      // Optional keywords file (gtrends suggest -o json → SuggestRecord[])
      const keywords: SuggestRecord[] = opts.keywordsFile
        ? (JSON.parse(readFileSync(opts.keywordsFile, 'utf8')) as SuggestRecord[])
        : []

      // Optional trend file (gtrends related -o json → { top, rising })
      // Keep query + numeric .value per entry (never formattedValue)
      let rising: RisingEntry[] | null = null
      if (opts.trendFile) {
        const trendData = JSON.parse(readFileSync(opts.trendFile, 'utf8')) as {
          top: RankedQuery[]
          rising: RankedQuery[]
        }
        rising = trendData.rising.map((r) => ({ query: r.query, value: r.value }))
      }

      // Optional enrichment file — forwarded verbatim, never enters the formula
      let enrichment: unknown
      if (opts.enrichmentFile) {
        enrichment = JSON.parse(readFileSync(opts.enrichmentFile, 'utf8'))
      }

      const ranked = scoreTerms(signals, keywords, rising)

      // Snapshot write (R7)
      const terms = [...new Set(signals.map((s) => s.term))]
      const slug = snapshotSlug(terms)
      const now = new Date()
      const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
      const snapshotPath =
        opts.out ??
        join(homedir(), '.claude', 'saas-suite', 'snapshots', `${slug}-${date}.json`)
      const snapshotPayload =
        enrichment !== undefined ? { results: ranked, enrichment } : ranked
      mkdirSync(dirname(snapshotPath), { recursive: true })
      writeFileSync(snapshotPath, JSON.stringify(snapshotPayload, null, 2))
      console.error(pc.dim(`snapshot → ${snapshotPath}`))

      // Render
      const payload = enrichment !== undefined ? { results: ranked, enrichment } : ranked

      if (output === 'json') {
        console.log(JSON.stringify(payload, null, 2))
        return
      }

      // table: TERM / SCORE / SOURCES / SIGNALS
      console.log(
        renderTable(
          ['TERM', 'SCORE', 'SOURCES', 'SIGNALS'],
          ranked.map((t) => [
            truncate(t.term, 30),
            t.score.toFixed(3),
            t.contributing_sources.join(', '),
            String(t.signal_count),
          ]),
          [false, true, false, true],
        ),
      )
      console.error(pc.dim(`${ranked.length} terms scored`))
    })
}
