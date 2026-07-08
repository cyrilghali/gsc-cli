// Shared test utilities. No `.test.ts` suffix — the `npm test` glob
// (test/*.test.ts) must not pick this file up as a suite.

/** Set (or, for undefined values, unset) env vars; returns a restore function. */
export function patchEnv(overrides: Record<string, string | undefined>): () => void {
  const saved = new Map<string, string | undefined>()
  for (const [name, value] of Object.entries(overrides)) {
    saved.set(name, process.env[name])
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
  return () => {
    for (const [name, value] of saved) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
  }
}
