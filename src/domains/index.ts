#!/usr/bin/env node
import { createRequire } from 'node:module'
import { Command } from 'commander'
import { handleCliError } from '../cli-util.ts'

import { registerCheckCommand } from './commands/check.ts'

const { version } = createRequire(import.meta.url)('../../package.json') as { version: string }

const program = new Command()

program
  .name('gdom')
  .description('Domain availability checking from the command line (RDAP, no auth required)')
  .version(version)
  .addHelpText(
    'after',
    `
Getting started:
  gdom check vetoline                    check vetoline.com and vetoline.fr
  gdom check vetoline --tlds com         .com only
  gdom check vetoline.fr other.com       check specific domains
  gdom check vetoline -o json            JSON output

Note: hits RDAP registries directly (Verisign for .com, AFNIC for .fr).
Unauthenticated and rate-limited — if you see a 429, wait a moment and retry.`,
  )

registerCheckCommand(program)

program.parseAsync().catch(handleCliError)
