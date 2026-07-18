import type { Command } from 'commander'
import pc from 'picocolors'
import { parsePositiveInt, pickCanonical, sleep } from '../../cli-util.ts'
import { renderTable, truncate } from '../../format.ts'
import { containsAllRoots } from '../../pain/sources/saturation.ts'
import { autocomplete, dailyTrends, relatedQueries, validateGeo } from '../api.ts'

const OUTPUTS = ['table', 'json'] as const

/**
 * Demand-shock detection: a spike younger than the market's colonization delay
 * shows high volume with zero competitors — but only for weeks. Keyword-volume
 * averages (12-month trailing) smooth spikes into invisibility, so this command
 * reads the two fast signals instead: today's trending searches and rising
 * breakouts, then probes each candidate with Autocomplete for PURCHASE-INTENT
 * completions ("en stock", "where to buy"…). A trending news topic has none; a
 * product people are hunting for has several — that asymmetry is the filter.
 */

// Retailer names are markers too: "rowenta ventilateur darty" is someone
// hunting where to buy, and "dupe" is someone priced out or facing a stockout.
export const INTENT_MARKERS: Record<string, string[]> = {
  en: ['in stock', 'restock', 'out of stock', 'where to buy', 'buy', 'price', 'alternative', 'availability', 'preorder', 'discount', 'dupe', 'amazon', 'walmart', 'target', 'best buy', 'costco'],
  fr: ['en stock', 'stock', 'rupture', 'disponible', 'disponibilité', 'où acheter', 'acheter', 'prix', 'alternative', 'précommande', 'promo', 'dupe', 'amazon', 'darty', 'boulanger', 'leclerc', 'castorama', 'fnac', 'cdiscount', 'lidl'],
}

const STOPWORDS = new Set(['de', 'du', 'des', 'le', 'la', 'les', 'sur', 'et', 'a', 'à', 'en', 'pour', 'the', 'of', 'for', 'and', 'on', 'in', 'with'])

/**
 * Product core of a long query: the original prefix up to the 2nd significant
 * (non-stopword) token, stopwords kept in place so the phrase stays natural.
 * Breakout queries arrive fully qualified ("shark chillpill ventilateur
 * brumisateur") but the intent completions live on the shorter product name
 * ("shark chillpill dupe"). Null when the query is already that short.
 */
export function productCore(query: string): string | null {
  const tokens = query.toLowerCase().split(/\s+/).filter((t) => t.length > 0)
  let significant = 0
  for (let i = 0; i < tokens.length; i++) {
    if (!STOPWORDS.has(tokens[i])) significant++
    if (significant === 2) {
      const core = tokens.slice(0, i + 1).join(' ')
      return core === query.toLowerCase().trim() ? null : core
    }
  }
  return null
}

export interface ShockCandidate {
  query: string
  source: 'trending' | 'seed'
  traffic: number | null
  rising_value: number | null
  intent_completions: string[]
  shock_score: number
  article_title?: string
  article_url?: string
}

/** Parse Google's approximate traffic strings ("200+", "20 000+") to a number. */
export function parseTraffic(traffic: string): number | null {
  const digits = traffic.replace(/[^0-9]/g, '')
  return digits.length > 0 ? Number(digits) : null
}

/**
 * Completions that both anchor on the candidate's roots and carry an intent
 * marker. "portasplit en stock" counts for "portasplit"; "ukraine news" carries
 * no marker and never counts.
 */
export function intentCompletions(completions: string[], query: string, markers: string[]): string[] {
  return completions.filter((c) => {
    const lower = c.toLowerCase()
    return containsAllRoots(c, query) && markers.some((m) => lower.includes(m))
  })
}

/**
 * Score ∈ [0,1]: intent density dominates (a topic nobody wants to buy is not a
 * shock, whatever its traffic), magnitude breaks ties. 3 intent completions or
 * a 5000-breakout saturate their component.
 */
export function shockScore(input: { intentCount: number; traffic: number | null; risingValue: number | null }): number {
  const intent = Math.min(input.intentCount / 3, 1) * 0.6
  const magnitudeRaw = input.risingValue !== null ? Math.min(input.risingValue / 5000, 1) : Math.min((input.traffic ?? 0) / 50_000, 1)
  return Math.min(intent + magnitudeRaw * 0.4, 1)
}

/** Probe a candidate: completions of the full query plus, for long queries, of its product core. */
async function probeIntent(query: string, geo: string, lang: string, markers: string[]): Promise<string[]> {
  const intents = intentCompletions(await autocomplete(query, geo, lang), query, markers)
  const core = productCore(query)
  if (core !== null) {
    await sleep(300)
    intents.push(...intentCompletions(await autocomplete(core, geo, lang), core, markers))
  }
  return [...new Set(intents)]
}

interface Options {
  geo: string
  lang?: string
  seeds?: string
  limit: string
  output: string
}

export function registerShocksCommand(program: Command): void {
  program
    .command('shocks')
    .description('Detect demand shocks: trending searches and rising breakouts probed for purchase intent')
    .option('-g, --geo <code>', 'two-letter country code, e.g. US, FR', 'US')
    .option('--lang <code>', 'intent-marker language: en | fr (default: fr when geo is FR, else en)')
    .option('--seeds <list>', 'comma-separated category seeds to watch via rising breakouts (in addition to trending)')
    .option('-n, --limit <n>', 'max trending entries probed', '20')
    .option('-o, --output <format>', OUTPUTS.join(' | '), 'table')
    .addHelpText(
      'after',
      `
Examples:
  gtrends shocks --geo FR
  gtrends shocks --geo FR --seeds "climatiseur,ventilateur,poele a granules" -o json

A candidate with intent completions is a product people are hunting for right
now — the ClimRadar profile. Snapshot the JSON daily and diff: a shock is only
actionable while it is NEW.`,
    )
    .action(async (opts: Options) => {
      const output = pickCanonical(opts.output, OUTPUTS, '--output')
      const limit = parsePositiveInt(opts.limit, '--limit')
      const geo = (opts.geo || 'US').toUpperCase()
      validateGeo(geo)
      const lang = (opts.lang ?? (geo === 'FR' ? 'fr' : 'en')).toLowerCase()
      const markers = INTENT_MARKERS[lang]
      if (markers === undefined) {
        throw new Error(`Unknown --lang "${lang}". Use: ${Object.keys(INTENT_MARKERS).join(', ')}.`)
      }

      const candidates: ShockCandidate[] = []

      const trends = (await dailyTrends(geo)).slice(0, limit)
      for (const t of trends) {
        await sleep(300)
        const intents = await probeIntent(t.query, geo, lang, markers)
        const traffic = parseTraffic(t.traffic)
        candidates.push({
          query: t.query,
          source: 'trending',
          traffic,
          rising_value: null,
          intent_completions: intents,
          shock_score: shockScore({ intentCount: intents.length, traffic, risingValue: null }),
          ...(t.articleTitle ? { article_title: t.articleTitle } : {}),
          ...(t.articleUrl ? { article_url: t.articleUrl } : {}),
        })
      }

      const seeds = (opts.seeds ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
      const seen = new Set(candidates.map((c) => c.query.toLowerCase()))
      for (const seed of seeds) {
        await sleep(500)
        const { rising } = await relatedQueries(seed, geo, 'now 7-d', 0)
        // Breakouts only — steady growth is the equilibrium regime, not a shock
        for (const r of rising.filter((r) => r.value >= 1000).slice(0, 5)) {
          if (seen.has(r.query.toLowerCase())) continue
          seen.add(r.query.toLowerCase())
          await sleep(300)
          const intents = await probeIntent(r.query, geo, lang, markers)
          candidates.push({
            query: r.query,
            source: 'seed',
            traffic: null,
            rising_value: r.value,
            intent_completions: intents,
            shock_score: shockScore({ intentCount: intents.length, traffic: null, risingValue: r.value }),
          })
        }
      }

      candidates.sort((a, b) => b.shock_score - a.shock_score)

      console.error(pc.dim(`${candidates.length} candidates probed · geo ${geo} · intent markers ${lang}`))

      if (output === 'json') {
        console.log(JSON.stringify(candidates, null, 2))
        return
      }

      console.log(
        renderTable(
          ['QUERY', 'SCORE', 'SOURCE', 'INTENT COMPLETIONS'],
          candidates.map((c) => [
            truncate(c.query, 30),
            c.shock_score.toFixed(2),
            c.source,
            truncate(c.intent_completions.join('; ') || '—', 50),
          ]),
          [false, true, false, false],
        ),
      )
    })
}
