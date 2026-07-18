import { spawn } from 'node:child_process'
import { createHash, createSign, randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { CliError, readConfig, readTokens, writeTokens, type StoredTokens } from './config.ts'

export const SCOPE_FULL = 'https://www.googleapis.com/auth/webmasters'
export const SCOPE_READONLY = 'https://www.googleapis.com/auth/webmasters.readonly'
export const SCOPE_INDEXING = 'https://www.googleapis.com/auth/indexing'

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const LOGIN_TIMEOUT_MS = 5 * 60 * 1000

interface ClientCredentials {
  client_id: string
  client_secret: string
}

interface TokenResponse {
  access_token: string
  expires_in: number
  refresh_token?: string
  scope?: string
}

export function parseClientCredentialsFile(path: string): ClientCredentials {
  let raw: string
  try {
    raw = readFileSync(path, 'utf8')
  } catch {
    throw new CliError(`Cannot read OAuth credentials file: ${path}`)
  }
  let json: Record<string, { client_id?: string; client_secret?: string }>
  try {
    json = JSON.parse(raw)
  } catch {
    throw new CliError(`${path} is not valid JSON.`)
  }
  const entry = json.installed ?? json.web
  if (!entry?.client_id || !entry?.client_secret) {
    throw new CliError(
      `${path} does not look like an OAuth client file.`,
      'In Google Cloud Console → APIs & Services → Credentials, create an OAuth client of type "Desktop app" and download its JSON.',
    )
  }
  return { client_id: entry.client_id, client_secret: entry.client_secret }
}

const b64url = (buf: Buffer): string => buf.toString('base64url')

async function tokenRequest(params: Record<string, string>): Promise<TokenResponse> {
  let res: Response
  try {
    res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params).toString(),
    })
  } catch (err) {
    throw new CliError(`Could not reach Google's token endpoint: ${err instanceof Error ? err.message : String(err)}`, 'Check your network connection.')
  }
  const body = (await res.json().catch(() => ({}))) as TokenResponse & { error?: string; error_description?: string }
  if (!res.ok) {
    const description = body.error_description ?? body.error ?? `HTTP ${res.status}`
    throw new CliError(
      `Token request failed: ${description}`,
      body.error === 'invalid_grant' ? 'The stored grant is no longer valid. Run `gsc auth login` again.' : undefined,
    )
  }
  return body
}

export async function loginWithOAuth(credentialsPath: string, scope: string): Promise<string> {
  const creds = parseClientCredentialsFile(credentialsPath)
  const verifier = b64url(randomBytes(32))
  const challenge = b64url(createHash('sha256').update(verifier).digest())
  const state = b64url(randomBytes(16))

  const { code, redirectUri } = await authorizeViaLoopback(creds, scope, challenge, state)

  const token = await tokenRequest({
    grant_type: 'authorization_code',
    code,
    client_id: creds.client_id,
    client_secret: creds.client_secret,
    redirect_uri: redirectUri,
    code_verifier: verifier,
  })
  if (!token.refresh_token) {
    throw new CliError(
      'Google did not return a refresh token.',
      'Revoke gsc-cli at https://myaccount.google.com/permissions, then run `gsc auth login` again.',
    )
  }
  const grantedScope = token.scope ?? scope
  writeTokens({
    access_token: token.access_token,
    refresh_token: token.refresh_token,
    expiry: Date.now() + token.expires_in * 1000,
    scope: grantedScope,
    client_id: creds.client_id,
    client_secret: creds.client_secret,
  })
  return grantedScope
}

function authorizeViaLoopback(
  creds: ClientCredentials,
  scope: string,
  challenge: string,
  state: string,
): Promise<{ code: string; redirectUri: string }> {
  return new Promise((resolve, reject) => {
    const server = http.createServer()
    let redirectUri = ''

    const finish = (fn: () => void) => {
      clearTimeout(timer)
      server.close()
      fn()
    }
    const timer = setTimeout(() => {
      finish(() => reject(new CliError('Timed out waiting for the browser sign-in (5 minutes).')))
    }, LOGIN_TIMEOUT_MS)

    server.on('error', (err) => {
      finish(() => reject(new CliError(`Could not start the local sign-in server: ${err.message}`)))
    })

    server.on('request', (req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      if (url.pathname !== '/callback') {
        res.writeHead(404).end()
        return
      }
      const error = url.searchParams.get('error')
      const code = url.searchParams.get('code')
      const gotState = url.searchParams.get('state')

      const page = (message: string): string =>
        `<!doctype html><meta charset="utf-8"><title>gsc-cli</title><p style="font-family:system-ui;margin:3rem">${message}</p>`
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      if (error) {
        res.end(page(`Authorization failed: ${escapeHtml(error)} — return to the terminal for details.`))
        finish(() => reject(new CliError(`Authorization failed: ${error}`)))
      } else if (!code || gotState !== state) {
        res.end(page('Authorization response was invalid — return to the terminal for details.'))
        finish(() => reject(new CliError('Authorization response was invalid (missing code or state mismatch).')))
      } else {
        res.end(page('Signed in — you can close this tab and return to the terminal.'))
        finish(() => resolve({ code, redirectUri }))
      }
    })

    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo
      redirectUri = `http://127.0.0.1:${port}/callback`
      const authUrl = new URL(AUTH_URL)
      authUrl.search = new URLSearchParams({
        client_id: creds.client_id,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope,
        access_type: 'offline',
        prompt: 'consent',
        state,
        code_challenge: challenge,
        code_challenge_method: 'S256',
      }).toString()
      console.error(`Opening your browser to sign in. If nothing opens, visit:\n\n  ${authUrl}\n`)
      openBrowser(authUrl.toString())
    })
  })
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
}

function openBrowser(url: string): void {
  const [cmd, args]: [string, string[]] =
    process.platform === 'darwin' ? ['open', [url]]
    : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]]
    : ['xdg-open', [url]]
  try {
    const child = spawn(cmd, args, { stdio: 'ignore', detached: true })
    child.on('error', () => {}) // the URL is already printed as a fallback
    child.unref()
  } catch {
    // the URL is already printed as a fallback
  }
}

interface ServiceAccountKey {
  type?: string
  client_email: string
  private_key: string
  token_uri?: string
}

export function resolveServiceAccountKeyPath(): string | undefined {
  return readConfig().serviceAccountKey ?? process.env.GOOGLE_APPLICATION_CREDENTIALS ?? undefined
}

export function readServiceAccountKey(path: string): ServiceAccountKey {
  let json: ServiceAccountKey
  try {
    json = JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    throw new CliError(`Cannot read service account key file: ${path}`)
  }
  if (!json.client_email || !json.private_key) {
    throw new CliError(
      `${path} does not look like a service account key (missing client_email or private_key).`,
      'In Google Cloud Console → IAM & Admin → Service Accounts, create a key of type JSON.',
    )
  }
  return json
}

export async function fetchServiceAccountToken(path: string, scope: string = SCOPE_FULL): Promise<string> {
  const key = readServiceAccountKey(path)
  const now = Math.floor(Date.now() / 1000)
  const audience = key.token_uri ?? TOKEN_URL
  const header = b64url(Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })))
  const claims = b64url(Buffer.from(JSON.stringify({ iss: key.client_email, scope, aud: audience, iat: now, exp: now + 3600 })))
  const signingInput = `${header}.${claims}`
  let signature: string
  try {
    signature = createSign('RSA-SHA256').update(signingInput).sign(key.private_key, 'base64url')
  } catch {
    throw new CliError(`The private key in ${path} could not be used to sign.`, 'Re-download the service account key from Google Cloud Console.')
  }
  const token = await tokenRequest({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion: `${signingInput}.${signature}`,
  })
  return token.access_token
}

let cachedServiceAccountToken: string | undefined

export async function getAccessToken(): Promise<string> {
  const serviceAccountPath = resolveServiceAccountKeyPath()
  if (serviceAccountPath) {
    cachedServiceAccountToken ??= await fetchServiceAccountToken(serviceAccountPath)
    return cachedServiceAccountToken
  }

  const tokens = readTokens()
  if (!tokens) {
    throw new CliError(
      'Not signed in.',
      'Run `gsc auth login --credentials <client_secret.json>` or `gsc auth login --service-account <key.json>`.',
    )
  }
  if (tokens.expiry - Date.now() > 60_000) return tokens.access_token

  if (!tokens.refresh_token) {
    throw new CliError('The access token expired and no refresh token is stored.', 'Run `gsc auth login` again.')
  }
  if (!tokens.client_id || !tokens.client_secret) {
    throw new CliError('Stored tokens are missing OAuth client credentials.', 'Run `gsc auth login` again.')
  }
  const refreshed = await tokenRequest({
    grant_type: 'refresh_token',
    refresh_token: tokens.refresh_token,
    client_id: tokens.client_id,
    client_secret: tokens.client_secret,
  })
  const updated: StoredTokens = {
    ...tokens,
    access_token: refreshed.access_token,
    expiry: Date.now() + refreshed.expires_in * 1000,
    refresh_token: refreshed.refresh_token ?? tokens.refresh_token,
    scope: refreshed.scope ?? tokens.scope,
  }
  writeTokens(updated)
  return updated.access_token
}
