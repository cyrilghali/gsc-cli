import type { Command } from 'commander'
import { resolve } from 'node:path'
import pc from 'picocolors'
import {
  SCOPE_FULL,
  SCOPE_READONLY,
  fetchServiceAccountToken,
  loginWithOAuth,
  readServiceAccountKey,
  resolveServiceAccountKeyPath,
} from '../auth.ts'
import { CliError, clearTokens, configDir, readConfig, readTokens, writeConfig } from '../config.ts'

export function registerAuthCommand(program: Command): void {
  const auth = program.command('auth').description('Manage authentication')

  auth
    .command('login')
    .description('Sign in with Google OAuth, or configure a service account')
    .option('-c, --credentials <path>', 'OAuth client JSON file ("Desktop app" type, from Google Cloud Console)')
    .option('--service-account <path>', 'service account key JSON file (alternative to OAuth)')
    .option('--readonly', 'request read-only access (no site add/remove, no sitemap submit/delete)')
    .action(async (opts: { credentials?: string; serviceAccount?: string; readonly?: boolean }) => {
      if (opts.serviceAccount) {
        const keyPath = resolve(opts.serviceAccount)
        const key = readServiceAccountKey(keyPath)
        await fetchServiceAccountToken(keyPath) // fail now rather than on the first real command
        writeConfig({ ...readConfig(), serviceAccountKey: keyPath })
        console.log(`${pc.green('✓')} Service account configured: ${key.client_email}`)
        console.log(pc.dim('If you have not already: add this email as a user of your property in Search Console (Settings → Users and permissions).'))
        return
      }
      if (!opts.credentials) {
        throw new CliError(
          'Missing --credentials <client_secret.json> (or --service-account <key.json>).',
          'In Google Cloud Console: enable the "Google Search Console API", then under APIs & Services → Credentials create an OAuth client of type "Desktop app" and download its JSON.',
        )
      }
      const scope = await loginWithOAuth(opts.credentials, opts.readonly ? SCOPE_READONLY : SCOPE_FULL)
      console.log(`${pc.green('✓')} Signed in${scope.endsWith('.readonly') ? ' (read-only)' : ''}. Tokens stored in ${configDir()}`)
    })

  auth
    .command('status')
    .description('Show the current authentication method and default site')
    .action(() => {
      const serviceAccountPath = resolveServiceAccountKeyPath()
      const config = readConfig()
      if (serviceAccountPath) {
        const key = readServiceAccountKey(serviceAccountPath)
        console.log(`Method:   service account (${serviceAccountPath})`)
        console.log(`Account:  ${key.client_email}`)
      } else {
        const tokens = readTokens()
        if (!tokens) {
          console.log('Not signed in. Run `gsc auth login`.')
          process.exitCode = 1
          return
        }
        console.log('Method:   OAuth')
        console.log(`Scope:    ${tokens.scope}`)
        console.log(
          `Token:    ${tokens.expiry > Date.now() ? `valid until ${new Date(tokens.expiry).toISOString()}` : 'expired (refreshes automatically)'}`,
        )
      }
      if (config.defaultSite) console.log(`Site:     ${config.defaultSite} (default)`)
    })

  auth
    .command('logout')
    .description('Remove stored tokens and service account configuration')
    .action(() => {
      clearTokens()
      const config = readConfig()
      if (config.serviceAccountKey) {
        delete config.serviceAccountKey
        writeConfig(config)
      }
      console.log('Signed out. Stored credentials removed.')
    })
}
