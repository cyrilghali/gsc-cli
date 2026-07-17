#!/usr/bin/env node
import { createRequire } from 'node:module'
import { Command } from 'commander'
import pc from 'picocolors'
import { CliError } from '../config.ts'
import { registerMineCommand } from './commands/mine.ts'

const { version } = createRequire(import.meta.url)('../../package.json') as { version: string }

const program = new Command()

program
  .name('gpain')
  .description('Pain-signal mining for micro-SaaS opportunity scanning (HN comments, dev.to — no auth required)')
  .version(version)
  .addHelpText(
    'after',
    `
Getting started:
  gpain mine "zapier alternative" -o json | gpain score /dev/stdin

Note: sources are unauthenticated public feeds (Hacker News Algolia API, dev.to).
Rate limits are generous — if you see errors, wait a moment and retry.`,
  )

registerMineCommand(program)

program.parseAsync().catch((err: unknown) => {
  if (err instanceof CliError) {
    console.error(`${pc.red('Error:')} ${err.message}`)
    if (err.hint) console.error(pc.dim(err.hint))
  } else {
    console.error(`${pc.red('Unexpected error:')} ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`)
  }
  process.exit(1)
})
