/** Reuse expensive checks only inside one synchronous evaluation. Never cache across
 * researcher edits, persistence, imports or separate calls. No asynchronous work
 * belongs inside this scope; finally always discards its references. */
let active: Map<string, WeakMap<object, unknown>> | undefined
export function withEvidenceEvaluation<T>(evaluate: () => T): T {
  if (active) return evaluate()
  active = new Map()
  try { return evaluate() } finally { active = undefined }
}
export function evaluated<T>(kind: string, source: object, compute: () => T): T {
  if (!active) return compute()
  let cache = active.get(kind)
  if (!cache) { cache = new WeakMap(); active.set(kind, cache) }
  if (cache.has(source)) return cache.get(source) as T
  const value = compute(); cache.set(source, value); return value
}
