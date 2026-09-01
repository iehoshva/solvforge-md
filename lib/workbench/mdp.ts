import type { RunRecord } from "./types"

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

const numeric = new Set(["dt", "nsteps", "emtol", "nstxout", "nstxout_compressed", "nstenergy", "nstlog", "ref_t", "ref_p", "tau_t", "tau_p", "rcoulomb", "rvdw", "fourierspacing", "pme_order"])

export function validateMdp(text: string, kind: "em" | "nvt" | "npt" | "prod", expected?: { temperatureK?: number; pressureBar?: number; durationNs?: number }) {
  const diagnostics: MdpDiagnostic[] = []
  const directives = parseMdp(text)
  for (const [key, entries] of directives) if (entries.length > 1) diagnostics.push({ severity: "ERROR", code: "DUPLICATE_DIRECTIVE", message: `Directive '${key}' occurs ${entries.length} times.`, line: entries[1].line })
  const first = (key: string) => directives.get(key)?.[0]
  const number = (key: string) => {
    const entry = first(key)
    if (!entry) return null
    const value = Number(entry.value)
    return Number.isFinite(value) ? value : null
  }
  for (const key of numeric) {
    const entry = first(key)
    if (entry && entry.value.split(/\s+/).some((token) => !Number.isFinite(Number(token)))) diagnostics.push({ severity: "ERROR", code: "MALFORMED_NUMBER", message: `Directive '${key}' contains a malformed number: '${entry.value}'.`, line: entry.line })
  }
  const dt = number("dt"), nsteps = number("nsteps")
  if (kind !== "em" && (dt === null || dt <= 0)) diagnostics.push({ severity: "ERROR", code: "INVALID_TIMESTEP", message: "Molecular-dynamics timestep dt must be positive." })
  if (nsteps === null || nsteps < 0 || !Number.isInteger(nsteps)) diagnostics.push({ severity: "ERROR", code: "INVALID_STEPS", message: "nsteps must be a non-negative integer." })
  if (dt !== null && nsteps !== null && dt > 0 && nsteps >= 0 && expected?.durationNs !== undefined) {
    const durationNs = dt * nsteps / 1000
    const tolerance = Math.max(1e-9, expected.durationNs * 1e-6)
    if (Math.abs(durationNs - expected.durationNs) > tolerance) diagnostics.push({ severity: "WARNING", code: "DURATION_MISMATCH", message: `dt × nsteps gives ${durationNs.toPrecision(7)} ns; expected ${expected.durationNs} ns.` })
  }
  const refT = number("ref_t")
  if (expected?.temperatureK !== undefined && refT !== null && Math.abs(refT - expected.temperatureK) > 1e-6) diagnostics.push({ severity: "ERROR", code: "TEMPERATURE_MISMATCH", message: `ref_t=${refT} K does not match run temperature ${expected.temperatureK} K.` })
  const pcoupl = first("pcoupl")?.value.trim().toLowerCase()
  if (kind === "nvt" && pcoupl && !["no", "none"].includes(pcoupl)) diagnostics.push({ severity: "WARNING", code: "NVT_PRESSURE_COUPLING", message: `NVT file enables pressure coupling '${pcoupl}'. Confirm this is intentional.` })
  if ((kind === "npt" || kind === "prod") && (!pcoupl || ["no", "none"].includes(pcoupl))) diagnostics.push({ severity: "ERROR", code: "MISSING_PRESSURE_COUPLING", message: `${kind.toUpperCase()} requires requested pressure coupling but pcoupl is missing or disabled.` })
  const refP = number("ref_p")
  if ((kind === "npt" || kind === "prod") && expected?.pressureBar !== undefined && refP !== null && Math.abs(refP - expected.pressureBar) > 1e-6) diagnostics.push({ severity: "WARNING", code: "PRESSURE_MISMATCH", message: `ref_p=${refP} bar does not match run pressure ${expected.pressureBar} bar.` })
  const outputSteps = number("nstxout_compressed") ?? number("nstxout")
  if (outputSteps !== null && nsteps !== null && outputSteps > nsteps && nsteps > 0) diagnostics.push({ severity: "WARNING", code: "OUTPUT_AFTER_RUN", message: `Trajectory output interval (${outputSteps} steps) exceeds the entire run (${nsteps} steps).` })
  if (dt !== null && dt > 0.004) diagnostics.push({ severity: "WARNING", code: "UNUSUAL_TIMESTEP", message: `dt=${dt} ps is unusual; verify constraints and force-field compatibility.` })
  if (!diagnostics.length) diagnostics.push({ severity: "INFO", code: "VALIDATED", message: "No detectable structural conflicts in this MDP file. Scientific suitability still requires researcher review." })
  return diagnostics
}

export function validateRunIds(runs: RunRecord[]) {
  const counts = new Map<string, number>()
  runs.forEach((run) => counts.set(run.runId, (counts.get(run.runId) ?? 0) + 1))
  return [...counts.entries()].filter(([, count]) => count > 1).map(([runId, count]): MdpDiagnostic => ({ severity: "ERROR", code: "DUPLICATE_RUN_ID", message: `Run ID '${runId}' occurs ${count} times. Enable additional naming dimensions or change the matrix.` }))
}
