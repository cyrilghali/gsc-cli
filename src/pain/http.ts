import { sleep } from '../cli-util.ts'
import { CliError } from '../config.ts'

/** Shared fetch for pain sources: 30 s abort, single retry on 429. */
export async function fetchSource(url: string, source: string): Promise<Response> {
  for (let attempt = 0; attempt <= 1; attempt++) {
    const ac = new AbortController()
    const timer = setTimeout(() => ac.abort(), 30_000)
    try {
      const res = await fetch(url, { signal: ac.signal })
      if (res.status === 429) {
        if (attempt === 0) {
          await sleep(1000)
          continue
        }
        throw new CliError(`${source}: HTTP 429`)
      }
      if (!res.ok) throw new CliError(`${source}: HTTP ${res.status}`)
      return res
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw new CliError(`${source}: request timed out (30 s).`, 'Check your connection.')
      }
      throw err
    } finally {
      clearTimeout(timer)
    }
  }
  throw new CliError(`${source}: unexpected state after retry`)
}
