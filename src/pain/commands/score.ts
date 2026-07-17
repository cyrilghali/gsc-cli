import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import type { Command } from 'commander'
import pc from 'picocolors'
import { pickCanonical, slugify } from '../../cli-util.ts'
import { renderTable, truncate } from '../../format.ts'
import { CliError } from '../../config.ts'
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
  multi_url_pain_match: boolean
  signal_count: number
  top_signals: TopSignal[]
}

/** Collapse deduplicated sorted terms into a filesystem-safe slug ≤ 60 chars. */
export function snapshotSlug(terms: string[]): string {
  const deduped = [...new Set(terms)]
  deduped.sort()
  return slugify(deduped.join('-')).slice(0, 60)
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
    // keyword_signal: max patternWeight over case-insensitively matching records; 0.3 if none.
    // A term matches on its exact suggestion, or on its seed — mining runs at seed level
    // (pain phrases anchor on the topic word), while patterns are confirmed per suggestion.
    const termLower = term.toLowerCase()
    const matching = keywords.filter(
      (k) => k.suggestion.toLowerCase() === termLower || k.seed.toLowerCase() === termLower,
    )
    const keywordSignal =
      matching.length > 0 ? Math.max(...matching.map((k) => patternWeight(k.pattern))) : 0.3

    // trend_velocity: max parseRisingValue over the term's attributable rising entries.
    // Word-boundary matching — a bare substring test lets a short seed like "ai"
    // inherit unrelated breakouts ("ukraine" contains "ai").
    const trendAbsent = rising === null
    const anchors =
      matching.length > 0
        ? [...new Set(matching.map((k) => k.seed.toLowerCase()))]
        : [term.toLowerCase()]
    const anchorPatterns = anchors.map(
      (a) => new RegExp(`\\b${a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`),
    )
    const attributable = trendAbsent
      ? []
      : rising.filter((r) => anchorPatterns.some((p) => p.test(r.query.toLowerCase())))
    const trendVelocity =
      attributable.length > 0 ? Math.max(...attributable.map((r) => parseRisingValue(r.value))) : 0

    const painDepth = termSignals.reduce((sum, s) => sum + s.weight, 0) / termSignals.length
    const workaroundDetected = termSignals.some((s) => s.workaround_detected)

    const sourcesSet = new Set(termSignals.map((s) => s.source))
    const contributing_sources = [...sourcesSet].sort()

    const multi_url_pain_match = termSignals.some((s) => s.multi_url_pain_match)

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
      multi_url_pain_match,
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

      // readFileSync also covers /dev/stdin for piped input
      const readJsonInput = (path: string, label: string, hint: string): unknown => {
        let text: string
        try {
          text = readFileSync(path, 'utf8')
        } catch (err) {
          const code = err instanceof Error && 'code' in err ? String(err.code) : ''
          throw new CliError(`${label}: cannot read ${path}${code ? ` (${code})` : ''}.`, hint)
        }
        try {
          return JSON.parse(text)
        } catch {
          throw new CliError(`${label}: ${path} is not valid JSON.`, hint)
        }
      }

      const signalsRaw = readJsonInput(
        signalsFile,
        'signals',
        'Pass gpain mine -o json output (a JSON array of signals).',
      )
      if (!Array.isArray(signalsRaw)) {
        throw new CliError(
          'signals: expected a JSON array (gpain mine -o json output).',
          'Snapshot files wrap results in { results, … } — pass the mine output, not a snapshot.',
        )
      }
      if (signalsRaw.length === 0) {
        throw new CliError(
          'signals: the file contains no signals — nothing to score.',
          'An empty mine result means no pain was found for these terms (the RAS branch).',
        )
      }
      const signals = signalsRaw as MinedSignal[]

      let keywords: SuggestRecord[] = []
      if (opts.keywordsFile) {
        const raw = readJsonInput(
          opts.keywordsFile,
          'keywords-file',
          'Pass gtrends suggest -o json output ({ seed, pattern, suggestion } records).',
        )
        if (!Array.isArray(raw)) {
          throw new CliError('keywords-file: expected a JSON array of suggest records.')
        }
        keywords = raw as SuggestRecord[]
      }

      // Keep query + numeric .value per entry (never formattedValue)
      let rising: RisingEntry[] | null = null
      if (opts.trendFile) {
        const raw = readJsonInput(
          opts.trendFile,
          'trend-file',
          'Pass gtrends related -o json output (an object with top/rising arrays).',
        ) as { rising?: unknown }
        if (raw === null || typeof raw !== 'object' || !Array.isArray(raw.rising)) {
          throw new CliError(
            'trend-file: expected { top: [...], rising: [...] }.',
            'Merge multiple related outputs into one object whose rising field concatenates the arrays.',
          )
        }
        rising = (raw.rising as { query: string; value: number }[]).map((r) => ({
          query: r.query,
          value: r.value,
        }))
      }

      // Optional enrichment file — forwarded verbatim, never enters the formula
      let enrichment: unknown
      if (opts.enrichmentFile) {
        enrichment = readJsonInput(opts.enrichmentFile, 'enrichment-file', 'Any JSON document.')
      }

      const ranked = scoreTerms(signals, keywords, rising)

      const terms = [...new Set(signals.map((s) => s.term))]
      const slug = snapshotSlug(terms)
      const now = new Date()
      const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
      const snapshotPath =
        opts.out ??
        join(homedir(), '.claude', 'saas-suite', 'snapshots', `${slug}-${date}.json`)
      const snapshot = {
        slug,
        results: ranked,
        ...(enrichment !== undefined ? { enrichment } : {}),
      }
      mkdirSync(dirname(snapshotPath), { recursive: true })
      writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 2))
      console.error(pc.dim(`snapshot → ${snapshotPath}`))

      if (output === 'json') {
        console.log(JSON.stringify({ ...snapshot, snapshot_path: snapshotPath }, null, 2))
        return
      }

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
