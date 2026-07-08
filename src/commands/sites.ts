import type { Command } from 'commander'
import pc from 'picocolors'
import { addSite, listSites, removeSite } from '../api.ts'
import { pickCanonical } from '../cli-util.ts'
import { CliError, readConfig, writeConfig } from '../config.ts'
import { renderTable } from '../format.ts'

export function registerSitesCommand(program: Command): void {
  const sites = program.command('sites').description('Manage Search Console properties')

  sites
    .command('list', { isDefault: true })
    .description('List the properties you can access')
    .option('-o, --output <format>', 'table | json', 'table')
    .action(async (opts: { output: string }) => {
      const output = pickCanonical(opts.output, ['table', 'json'], '--output')
      const entries = await listSites()
      if (output === 'json') {
        console.log(JSON.stringify(entries, null, 2))
        return
      }
      if (entries.length === 0) {
        console.log('No properties. Add one with `gsc sites add <siteUrl>` or verify a site in Search Console.')
        return
      }
      entries.sort((a, b) => a.siteUrl.localeCompare(b.siteUrl))
      const defaultSite = readConfig().defaultSite
      console.log(
        renderTable(
          ['SITE', 'PERMISSION', ''],
          entries.map((e) => [e.siteUrl, e.permissionLevel, e.siteUrl === defaultSite ? '(default)' : '']),
        ),
      )
    })

  sites
    .command('add')
    .description('Add a property to your Search Console account')
    .argument('<siteUrl>', 'property URL, e.g. https://example.com/ or sc-domain:example.com')
    .action(async (siteUrl: string) => {
      await addSite(siteUrl)
      console.log(`${pc.green('✓')} Added ${siteUrl} (it still needs to be verified in Search Console if it is not already).`)
    })

  sites
    .command('remove')
    .description('Remove a property from your Search Console account')
    .argument('<siteUrl>', 'property URL, e.g. https://example.com/ or sc-domain:example.com')
    .action(async (siteUrl: string) => {
      await removeSite(siteUrl)
      console.log(`${pc.green('✓')} Removed ${siteUrl} from your account.`)
    })

  sites
    .command('use')
    .description('Set the default property used when [site] is omitted')
    .argument('<siteUrl>', 'property URL, e.g. https://example.com/ or sc-domain:example.com')
    .action(async (siteUrl: string) => {
      const entries = await listSites()
      const urls = entries.map((e) => e.siteUrl)
      if (!urls.includes(siteUrl)) {
        const nearMiss = urls.find(
          (u) => u.toLowerCase() === siteUrl.toLowerCase() ||
            u.replace(/\/$/, '') === siteUrl.replace(/\/$/, ''),
        )
        throw new CliError(
          'Property not found in your Search Console account.',
          `Run 'gsc sites list' to see available properties.${nearMiss ? ` Did you mean: ${nearMiss}` : ''}`,
        )
      }
      writeConfig({ ...readConfig(), defaultSite: siteUrl })
      console.log(`${pc.green('✓')} Default site set to ${siteUrl}`)
    })
}
