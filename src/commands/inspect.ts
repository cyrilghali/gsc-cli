import type { Command } from 'commander'
import pc from 'picocolors'
import { inspectUrl } from '../api.ts'
import { pickCanonical, resolveSite } from '../cli-util.ts'

function colorVerdict(verdict?: string): string {
  switch (verdict) {
    case 'PASS':
      return pc.green(verdict)
    case 'FAIL':
      return pc.red(verdict)
    case 'NEUTRAL':
      return pc.yellow(verdict)
    default:
      return verdict ?? 'UNKNOWN'
  }
}

export function registerInspectCommand(program: Command): void {
  program
    .command('inspect')
    .description('Inspect how Google indexes a URL (verdict, canonical, last crawl…)')
    .argument('<url>', 'the fully-qualified URL to inspect (must belong to the property)')
    .argument('[site]', 'property URL (defaults to the site set with `gsc sites use`)')
    .option('-o, --output <format>', 'text | json', 'text')
    .action(async (url: string, siteArg: string | undefined, opts: { output: string }) => {
      const site = resolveSite(siteArg)
      const output = pickCanonical(opts.output, ['text', 'json'], '--output')
      const res = await inspectUrl(site, url)
      if (output === 'json') {
        console.log(JSON.stringify(res, null, 2))
        return
      }

      const result = res.inspectionResult
      const index = result?.indexStatusResult
      if (!index) {
        console.log('No inspection result returned.')
        return
      }

      const line = (label: string, value?: string): void => {
        if (value) console.log(`${label.padEnd(17)} ${value}`)
      }
      line('Verdict', colorVerdict(index.verdict))
      line('Coverage', index.coverageState)
      line('Robots.txt', index.robotsTxtState)
      line('Indexing', index.indexingState)
      line('Fetch', index.pageFetchState)
      line('Crawled as', index.crawledAs)
      line('Last crawl', index.lastCrawlTime)
      line('Google canonical', index.googleCanonical)
      line('User canonical', index.userCanonical)
      if (index.sitemap?.length) line('Sitemaps', index.sitemap.join(', '))
      if (index.referringUrls?.length) {
        console.log('Referring URLs')
        for (const ref of index.referringUrls.slice(0, 5)) console.log(`                  ${ref}`)
        if (index.referringUrls.length > 5) console.log(`                  … and ${index.referringUrls.length - 5} more`)
      }
      const rich = result?.richResultsResult
      if (rich?.verdict) {
        const types = rich.detectedItems?.map((i) => i.richResultType).filter(Boolean).join(', ')
        line('Rich results', `${colorVerdict(rich.verdict)}${types ? ` (${types})` : ''}`)
      }
      line('Details', result?.inspectionResultLink)
    })
}
