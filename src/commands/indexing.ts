import type { Command } from 'commander'
import pc from 'picocolors'
import { ApiError, getUrlNotificationMetadata, publishUrlNotification, type UrlNotificationMetadata } from '../api.ts'
import { pickCanonical } from '../cli-util.ts'
import { CliError } from '../config.ts'

const INDEX_DESCRIPTION =
  'Request indexing of URLs via the Google Indexing API. ' +
  'Officially limited by Google to JobPosting/BroadcastEvent pages; in practice it triggers a crawl ' +
  'for most URLs, without guarantee. Default quota: 200 URLs/day.'

/** Exported for tests. */
export function validateAbsoluteHttpUrl(url: string): void {
  if (!/^https?:\/\//i.test(url)) {
    throw new CliError(
      `"${url}" is not a valid absolute URL.`,
      'The Indexing API requires absolute http(s) URLs. Example: https://example.com/page',
    )
  }
}

/** Exported for tests. */
export function mapNotificationType(deleted: boolean): 'URL_UPDATED' | 'URL_DELETED' {
  return deleted ? 'URL_DELETED' : 'URL_UPDATED'
}

/** Exported for tests. Format a metadata object as labelled lines (text mode). */
export function formatNotificationStatus(meta: UrlNotificationMetadata): string {
  const lines: string[] = []
  const line = (label: string, value?: string): void => {
    if (value) lines.push(`${label.padEnd(17)} ${value}`)
  }
  line('URL', meta.url)
  if (meta.latestUpdate) {
    line('Last notify', meta.latestUpdate.notifyTime)
    line('Type', meta.latestUpdate.type)
  }
  if (meta.latestRemove) {
    line('Last removed', meta.latestRemove.notifyTime)
  }
  return lines.join('\n')
}

export function registerIndexCommand(program: Command): void {
  const index = program.command('index').description(INDEX_DESCRIPTION)

  index
    .command('request')
    .description('Ask Google to crawl (or remove) one or more URLs')
    .argument('<url...>', 'one or more absolute http(s) URLs to submit')
    .option('--deleted', 'signal URL_DELETED instead of URL_UPDATED (use for removed pages)')
    .option('-o, --output <format>', 'text | json', 'text')
    .action(async (urls: string[], opts: { deleted?: boolean; output: string }) => {
      const output = pickCanonical(opts.output, ['text', 'json'], '--output')
      const type = mapNotificationType(opts.deleted ?? false)

      for (const url of urls) validateAbsoluteHttpUrl(url)

      let succeeded = 0
      let failed = 0
      const results: { url: string; ok: boolean; notifyTime?: string; recorded?: boolean; error?: string }[] = []

      for (const url of urls) {
        try {
          const res = await publishUrlNotification(url, type)
          const recorded = type === 'URL_DELETED'
            ? res.urlNotificationMetadata?.latestRemove?.notifyTime
            : res.urlNotificationMetadata?.latestUpdate?.notifyTime
          // HTTP 200 sans notifyTime = Google a accepté l'appel mais n'a PAS
          // enregistré la notification (restriction JobPosting appliquée en
          // silence depuis 2024). Un ✓ serait un mensonge.
          results.push({ url, ok: true, notifyTime: recorded, recorded: Boolean(recorded) })
          succeeded++
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          results.push({ url, ok: false, error: msg })
          failed++
        }
      }

      if (output === 'json') {
        console.log(JSON.stringify(results, null, 2))
      } else {
        for (const r of results) {
          if (r.ok && r.recorded) {
            console.log(`${pc.green('✓')} ${r.url}${r.notifyTime ? pc.dim(` — ${r.notifyTime}`) : ''}`)
          } else if (r.ok) {
            console.log(`${pc.yellow('~')} ${r.url}  ${pc.dim('accepted but NOT recorded (Google JobPosting-only enforcement)')}`)
          } else {
            console.log(`${pc.red('✗')} ${r.url}  ${pc.dim(r.error ?? 'error')}`)
          }
        }
        const recorded = results.filter((r) => r.ok && r.recorded).length
        const ignored = succeeded - recorded
        console.log(`\n${recorded} recorded, ${ignored} accepted-but-ignored, ${failed} failed`)
        if (ignored > 0) {
          console.log(pc.dim('Google silently drops non-JobPosting URLs. Real channels: GSC sitemap + manual "Request indexing" (UI), and IndexNow for Bing.'))
        }
      }

      if (failed > 0) process.exitCode = 1
    })

  index
    .command('status')
    .description('Show the last indexing notification metadata for a URL')
    .argument('<url>', 'absolute http(s) URL')
    .option('-o, --output <format>', 'text | json', 'text')
    .action(async (url: string, opts: { output: string }) => {
      validateAbsoluteHttpUrl(url)
      const output = pickCanonical(opts.output, ['text', 'json'], '--output')

      let meta: UrlNotificationMetadata
      try {
        meta = await getUrlNotificationMetadata(url)
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) {
          console.log('URL never submitted via the Indexing API.')
          return
        }
        throw err
      }

      if (output === 'json') {
        console.log(JSON.stringify(meta, null, 2))
        return
      }

      console.log(formatNotificationStatus(meta))
    })
}
