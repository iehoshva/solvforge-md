import type { ProjectState, RunRecord } from "./types"
import { boxVolumeNm3, calculateBoxComposition } from "./composition.ts"
import { fingerprint, runState } from "./identity.ts"
import { continuationPlan, resolveProtocol } from "./protocol.ts"
import { SOFTWARE_VERSION } from "./version.ts"

const clean = (v: string) => v.toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-|-$/g, "")
export function moleFraction(p: ProjectState, d: string, n: number, s = p.soluteIds[0] ?? "", t = p.stageBTemperatureK) {
  return calculateBoxComposition(p, d, s, n, t).metadata?.moleFractions[s] ?? null
}
export function makeRunId(p: ProjectState, r: Omit<RunRecord, "runId">) {
  const n = p.runNaming, des = p.desSystems.find((d) => d.id === r.desId), parts: string[] = []
  if (n.includeProject) parts.push(clean(p.projectAbbreviation))
  if (n.includeStage) parts.push(clean(r.stage))
  parts.push(r.systemKind === "pure-des" ? "PURE" : clean(r.soluteAbbreviation), clean(r.desAbbreviation), des?.ratio.join("-") ?? "")
  if (n.includePressure) parts.push(r.pressureBar + "BAR")
  if (n.includeBox) parts.push([r.box.x,r.box.y,r.box.z].join("X") + (r.box.unit === "angstrom" ? "A" : "NM"))
  if (n.includeTemperature) parts.push(r.temperatureK + "K")
  if (n.includeConcentration && r.systemKind !== "pure-des") parts.push("N" + String(r.soluteCount).padStart(2, "0"))
  if (n.includeReplica) parts.push("R" + String(r.replica).padStart(2, "0"))
  // Labels may omit dimensions. Full configuration remains in the manifest and suffix.
  parts.push(fingerprint(JSON.stringify({ projectId: p.projectId, stage: r.stage, desId: r.desId, ratio: des?.ratio, kind: r.systemKind, soluteId: r.soluteId, count: r.soluteCount, components: r.components, box: r.box, t: r.temperatureK, p: r.pressureBar, replica: r.replica, seed: r.randomSeed, protocol: r.resolvedProtocol?.id })))
  return parts.filter(Boolean).join("_")
}
export function createRun(p: ProjectState, stage: string, desId: string, soluteId: string | null, count: number, label: string, temperatureK: number, replica: number): RunRecord | null {
  const des = p.desSystems.find((d) => d.id === desId), solute = soluteId === null ? null : p.molecules.find((m) => m.id === soluteId)
  if (!des || (soluteId !== null && !solute)) return null
  const kind = soluteId === null ? "pure-des" : "solute"
  if (kind === "pure-des" && count !== 0) throw new Error("Pure DES cannot contain solute loading.")
  const c = calculateBoxComposition(p, desId, soluteId ?? "", count, temperatureK)
  const components = des.componentIds.map((id, i) => ({ moleculeId: id, name: p.molecules.find((m) => m.id === id)?.fullName ?? id, count: c.componentCounts?.[i] ?? null, molecularWeight: c.molecularWeights[id] ?? null }))
  const total = components.every((v) => v.count !== null) ? components.reduce((sum, v) => sum + Number(v.count), count) : null
  const randomSeed = p.protocol.randomSeedBase + replica - 1
  const rp = resolveProtocol(p, { temperatureK, pressureBar: p.protocol.pressureBar, randomSeed, systemKind: kind })
  const base: Omit<RunRecord, "runId"> = {
    projectId: p.projectId, systemKind: kind, stage, desId, desName: des.name, desAbbreviation: des.abbreviation, components,
    soluteId: soluteId ?? "", soluteName: solute?.fullName ?? "", soluteAbbreviation: solute?.abbreviation ?? "", soluteCount: count,
    moleFraction: soluteId ? c.metadata?.moleFractions[soluteId] ?? null : null, totalMoleculeCount: total,
    moleFractions: c.metadata?.moleFractions ?? null, massFractions: c.metadata?.massFractions ?? null, numberDensitiesNm3: c.metadata?.numberDensitiesNm3 ?? null,
    boxVolumeNm3: boxVolumeNm3(p.protocol.box), compositionCalculation: c.metadata, compositionDiagnostics: c.diagnostics,
    concentrationLabel: label, temperatureK, pressureBar: p.protocol.pressureBar, box: structuredClone(p.protocol.box), replica, randomSeed,
    protocolName: p.protocol.name, forceField: rp.forceField, chargeScheme: rp.chargeSource, productionNs: rp.production.initialNs, status: "planned",
    resolvedProtocol: rp, molecularSnapshot: structuredClone(p.molecules.filter((m) => des.componentIds.includes(m.id) || m.id === soluteId)), generatedAt: new Date().toISOString(), createdWithVersion: SOFTWARE_VERSION, provenanceStatus: "resolved",
  }
  const run: RunRecord = { ...base, runId: makeRunId(p, base) }
  run.scientificState = runState(run, des.ratio)
  return run
}
export function stageRunCount(p: ProjectState, stage: "A" | "B" | "C") {
 const des=stage==="A"?p.desSystems.length:p.selectedChampion?1:0
 const counts=stage==="A"?1:stage==="B"?p.concentrations.length:p.concentrations.filter(c=>c.id===p.selectedOptimum?.valueId).length
 return des*(stage==="C"?p.temperaturesK.length:1)*p.protocol.replicas*(p.soluteIds.length*counts+(counts&&p.protocol.production.pureDes.enabled?1:0))
}
export function generateStageRuns(p: ProjectState, stage: "A" | "B" | "C") {
  const runs: RunRecord[] = [], nr = p.protocol.replicas
  if (!Number.isSafeInteger(nr) || nr < 1 || nr > 10000 || stageRunCount(p,stage)>20000) return runs
  const desIds = stage === "A" ? p.desSystems.map((d) => d.id) : p.selectedChampion ? [p.selectedChampion.valueId] : []
  const cs = stage === "A" ? [{ soluteCount: p.stageASoluteCount, label: "Stage A comparison" }] : stage === "B" ? p.concentrations : p.concentrations.filter((c) => c.id === p.selectedOptimum?.valueId)
  const ts = stage === "A" ? [p.stageATemperatureK] : stage === "B" ? [p.stageBTemperatureK] : p.temperaturesK
  for (const d of desIds) for (const s of p.soluteIds) for (const c of cs) for (const t of ts) for (let r = 1; r <= nr; r++) {
    const run = createRun(p, "stage-" + stage.toLowerCase(), d, s, c.soluteCount, c.label, t, r)
    if (run) runs.push(run)
  }
  if (p.protocol.production.pureDes.enabled && cs.length) for (const d of desIds) for (const t of ts) for (let r = 1; r <= nr; r++) {
    const run = createRun(p, "stage-" + stage.toLowerCase(), d, null, 0, "Solvent only", t, r)
    if (run) runs.push(run)
  }
  return runs
}
export type CustomAxes = { desIds: string[]; soluteIds: string[]; soluteCounts: number[]; temperaturesK: number[]; pressuresBar: number[]; boxSizesNm: number[]; replicas: number }
export function parseNumericAxis(text: string) {
 const values=text.trim()?text.trim().split(/[,;\s]+/).map(Number):[]
 if(values.some(v=>!Number.isFinite(v)))throw new Error("Malformed numeric axis. Every entered value must be finite; no entries are discarded.")
 return values
}
export function customRunCount(a:CustomAxes){return a.desIds.length*a.soluteIds.length*a.soluteCounts.length*a.temperaturesK.length*a.pressuresBar.length*a.boxSizesNm.length*a.replicas}
export function generateCustomRuns(p: ProjectState, a: CustomAxes) {
  const runs: RunRecord[] = []
  if (!Number.isSafeInteger(a.replicas) || a.replicas < 1 || a.replicas > 10000) throw new Error("Replicas must be a positive integer, at most 10000 per matrix.")
  if (customRunCount(a)>20000) throw new Error("Browser run-design limit: 20000 records per batch. Split this matrix into explicit batches.")
  if(a.desIds.some(id=>!p.desSystems.some(d=>d.id===id))||a.soluteIds.some(id=>!p.molecules.some(m=>m.id===id)))throw new Error("Custom axis contains an unresolved molecular or DES identity.")
  if(a.soluteCounts.some(v=>!Number.isSafeInteger(v)||v<1)||a.temperaturesK.some(v=>!Number.isFinite(v)||v<=0)||a.pressuresBar.some(v=>!Number.isFinite(v))||a.boxSizesNm.some(v=>!Number.isFinite(v)||v<=0))throw new Error("Custom axes require positive integral solute counts, positive Kelvin/box dimensions and finite pressure.")
  for (const d of a.desIds) for (const s of a.soluteIds) for (const n of a.soluteCounts) for (const t of a.temperaturesK) for (const pressure of a.pressuresBar) for (const b of a.boxSizesNm) for (let r = 1; r <= a.replicas; r++) {
    const pp = { ...p, protocol: { ...p.protocol, pressureBar: pressure, box: { x: b, y: b, z: b, geometry: "cubic", unit: "nm" as const } } }
    const run = createRun(pp, "custom", d, s, n, n + " molecules per box", t, r)
    if (run) runs.push(run)
  }
  return runs
}
function resolved(p: ProjectState, r: RunRecord) {
  if (r.projectId && r.projectId !== p.projectId) throw new Error("Run belongs to another project.")
  if (!r.resolvedProtocol) throw new Error("Legacy run has no resolved protocol. Explicit regeneration required; historical files cannot be reconstructed from the current form.")
  return r.resolvedProtocol
}
export function emMdp(p: ProjectState, r?: RunRecord) { return r ? resolved(p, r).stages.em.mdp : resolveProtocol(p, { temperatureK: p.stageATemperatureK, pressureBar: p.protocol.pressureBar, randomSeed: p.protocol.randomSeedBase, systemKind: "solute" }).stages.em.mdp }
export function nvtMdp(p: ProjectState, r: RunRecord) { return resolved(p, r).stages.nvt.mdp }
export function nptMdp(p: ProjectState, r: RunRecord) { return resolved(p, r).stages.npt.mdp }
export function prodMdp(p: ProjectState, r: RunRecord) { return resolved(p, r).stages.prod.mdp }
export function commands(r: RunRecord) {
  if (!r.resolvedProtocol) return "# Unresolved legacy run: explicit regeneration required.\n"
  const lines = ["#!/usr/bin/env bash", "set -euo pipefail", "# Execute from this run directory. Inspect each stage before continuing.", "# Protocol " + r.resolvedProtocol.id + "; seed " + r.randomSeed]
  const paths = ["01_em/em", "02_nvt/nvt", "03_npt/npt", "04_prod/prod"]
  paths.forEach((path, i) => {
    const prior = paths[i - 1]
    lines.push("gmx grompp -f " + path + ".mdp -c " + (i ? prior + ".gro" : "00_input/packed.gro") + (i > 1 ? " -t " + prior + ".cpt" : "") + " -p 00_input/topol.top -o " + path + ".tpr", "gmx mdrun -deffnm " + path, "")
  })
  return lines.join("\n") + "\n# Restart interrupted production with the same TPR:\n# gmx mdrun -deffnm 04_prod/prod -cpi 04_prod/prod.cpt -append\n"
}
export function firstContinuation(r: RunRecord) {
  if (!r.resolvedProtocol || r.resolvedProtocol.diagnostics.some((d) => d.severity === "ERROR")) return "# Resolve protocol errors before continuation.\n"
  return continuationPlan(r.resolvedProtocol, r.productionNs, "pending").commands
}
