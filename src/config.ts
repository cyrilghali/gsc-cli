import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export class CliError extends Error {
  hint?: string

  constructor(message: string, hint?: string) {
    super(message)
    this.name = 'CliError'
    this.hint = hint
  }
}

export function configDir(): string {
  const base = process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config')
  return join(base, 'gsc-cli')
}

const tokensPath = () => join(configDir(), 'tokens.json')
const configPath = () => join(configDir(), 'config.json')

export interface StoredTokens {
  access_token: string
  refresh_token?: string
  /** Epoch milliseconds. */
  expiry: number
  scope: string
  client_id: string
  client_secret: string
}

export interface CliConfig {
  defaultSite?: string
  serviceAccountKey?: string
}

function readJsonFile<T>(path: string): T | undefined {
  if (!existsSync(path)) return undefined
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T
  } catch {
    throw new CliError(`Could not parse ${path}.`, 'The file is corrupted; delete it and try again.')
  }
}

function writeJsonFile(path: string, value: unknown): void {
  mkdirSync(configDir(), { recursive: true, mode: 0o700 })
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 })
  // mode in writeFileSync only applies when the file is created
  chmodSync(path, 0o600)
}

export const readTokens = (): StoredTokens | undefined => readJsonFile<StoredTokens>(tokensPath())

export const writeTokens = (tokens: StoredTokens): void => writeJsonFile(tokensPath(), tokens)

export function clearTokens(): void {
  rmSync(tokensPath(), { force: true })
}

export const readConfig = (): CliConfig => readJsonFile<CliConfig>(configPath()) ?? {}

export const writeConfig = (config: CliConfig): void => writeJsonFile(configPath(), config)
