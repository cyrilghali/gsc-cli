import type { Command } from 'commander'
import pc from 'picocolors'
import { deleteSitemap, listSitemaps, submitSitemap } from '../api.ts'
import { pickCanonical, resolveSite } from '../cli-util.ts'
import { CliError } from '../config.ts'
import { renderTable } from '../format.ts'

/** Resolve a possibly-relative sitemap path against a URL-prefix property. */
export function resolveSitemapUrl(feed: string, site: string): string {
  if (/^https?:\/\//i.test(feed)) return feed
  if (/^https?:\/\//i.test(site)) return new URL(feed, site).toString()
  throw new CliError(
    `For domain properties the sitemap URL must be absolute (got "${feed}").`,
    'Example: gsc sitemaps submit https://example.com/sitemap.xml sc-domain:example.com',
  )
}

export function registerSitemapsCommand(program: Command): void {
  const sitemaps = program.command('sitemaps').description('Manage sitemaps')

  sitemaps
    .command('list', { isDefault: true })
    .description('List submitted sitemaps')
    .argument('[site]', 'property URL (defaults to the site set with `gsc sites use`)')
    .option('-o, --output <format>', 'table | json', 'table')
    .action(async (siteArg: string | undefined, opts: { output: string }) => {
      const site = resolveSite(siteArg)
      const output = pickCanonical(opts.output, ['table', 'json'], '--output')
      const entries = await listSitemaps(site)
      if (output === 'json') {
        console.log(JSON.stringify(entries, null, 2))
        return
      }
      if (entries.length === 0) {
        console.log(`No sitemaps submitted for ${site}.`)
        return
      }
      console.log(
        renderTable(
          ['PATH', 'SUBMITTED', 'STATUS', 'URLS', 'WARNINGS', 'ERRORS'],
          entries.map((e) => [
            e.path,
            e.lastSubmitted?.slice(0, 10) ?? '',
            e.isPending ? 'pending' : 'processed',
            String(e.contents?.reduce((sum, c) => sum + Number(c.submitted ?? 0), 0) ?? 0),
            e.warnings ?? '0',
            e.errors ?? '0',
          ]),
          [false, false, false, true, true, true],
        ),
      )
    })

  sitemaps
    .command('submit')
    .description('Submit a sitemap')
    .argument('<sitemapUrl>', 'absolute sitemap URL (or a path relative to a URL-prefix property)')
    .argument('[site]', 'property URL (defaults to the site set with `gsc sites use`)')
    .action(async (sitemapUrl: string, siteArg: string | undefined) => {
      const site = resolveSite(siteArg)
      const feedUrl = resolveSitemapUrl(sitemapUrl, site)
      await submitSitemap(site, feedUrl)
      console.log(`${pc.green('✓')} Submitted ${feedUrl}`)
    })

  sitemaps
    .command('delete')
    .description('Delete a sitemap from Search Console')
    .argument('<sitemapUrl>', 'absolute sitemap URL (or a path relative to a URL-prefix property)')
    .argument('[site]', 'property URL (defaults to the site set with `gsc sites use`)')
    .action(async (sitemapUrl: string, siteArg: string | undefined) => {
      const site = resolveSite(siteArg)
      const feedUrl = resolveSitemapUrl(sitemapUrl, site)
      await deleteSitemap(site, feedUrl)
      console.log(`${pc.green('✓')} Deleted ${feedUrl}`)
    })
}
