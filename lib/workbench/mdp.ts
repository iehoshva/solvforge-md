import type { RunRecord } from "./types"
import { parseDirectives, validateStage } from "./protocol.ts"

export type MdpDiagnostic = { severity: "ERROR" | "WARNING" | "INFO"; code: string; message: string; line?: number }

export function parseMdp(text: string) {
  const directives = new Map<string, Array<{ value: string; line: number }>>()
  text.split(/\r?\n/).forEach((raw, index) => {
    const content = raw.split(";")[0].trim()
    if (!content) return
    const match = content.match(/^([^=]+?)\s*=\s*(.*?)\s*$/)
    if (!match) return
    const key = match[1].trim().toLowerCase().replaceAll("-", "_")
    directives.set(key, [...(directives.get(key) ?? []), { value: match[2], line: index + 1 }])
  })
  return directives
}

export function validateMdp(
  text: string,
  kind: "em" | "nvt" | "npt" | "prod",
  expected?: { temperatureK?: number; pressureBar?: number; durationNs?: number },
) {
  const parsed = parseDirectives(text)
  const diagnostics: MdpDiagnostic[] = [...parsed.diagnostics, ...validateStage(parsed.directives, kind, expected)]
  const directives = parseMdp(text)
  const first = (key: string) => directives.get(key)?.[0]
  const number = (key: string) => {
    const entry = first(key)
    if (!entry) return null
    const value = Number(entry.value)
    return Number.isFinite(value) ? value : null
  }
  const dt = number("dt"), nsteps = number("nsteps")
  if (dt !== null && nsteps !== null && dt > 0 && nsteps >= 0 && expected?.durationNs !== undefined) {
    const durationNs = (dt * nsteps) / 1000
    const tolerance = Math.max(1e-9, expected.durationNs * 1e-6)
    if (Math.abs(durationNs - expected.durationNs) > tolerance) {
      diagnostics.push({
        severity: "INFO",
        code: "DURATION_DIFFERENCE",
        message: `dt × nsteps gives ${durationNs.toPrecision(7)} ns; form duration is ${expected.durationNs} ns.`,
      })
    }
  }
  if (!diagnostics.length) {
    diagnostics.push({
      severity: "INFO",
      code: "VALIDATED",
      message: "No structural conflicts detected. Final parameter resolution is performed by gmx grompp.",
    })
  }
  return diagnostics
}

export function validateRunIds(runs: RunRecord[]) {
  const counts = new Map<string, number>()
  runs.forEach((run) => counts.set(run.runId, (counts.get(run.runId) ?? 0) + 1))
  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(
      ([runId, count]): MdpDiagnostic => ({
        severity: "ERROR",
        code: "DUPLICATE_RUN_ID",
        message: `Run ID '${runId}' occurs ${count} times. Enable additional naming dimensions or adjust matrix axes.`,
      }),
    )
}
