import type { ProjectState, RunMatrixDesign, RunRecord } from "./types"
import { boxVolumeNm3, calculateBoxComposition } from "./composition.ts"
import { fingerprint, runState } from "./identity.ts"
import { continuationPlan, resolveProtocol } from "./protocol.ts"
import { SOFTWARE_VERSION } from "./version.ts"

const clean = (v: string) => v.toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-|-$/g, "")

export function inferSystemKind(componentCount: number, hasSolute: boolean): RunRecord["systemKind"] {
  if (hasSolute) return "solute-loaded"
  if (componentCount === 2) return "binary"
  if (componentCount === 3) return "ternary"
  return "custom"
}

export function makeRunId(p: ProjectState, r: Omit<RunRecord, "runId">) {
  const n = p.runNaming
  const sys = p.systems.find((s) => s.id === r.systemId)
  const parts: string[] = []
  if (n.includeProject) parts.push(clean(p.projectAbbreviation))
  if (r.soluteAbbreviation && r.soluteCount > 0) parts.push(clean(r.soluteAbbreviation))
  else parts.push("NEAT")
  parts.push(clean(r.systemAbbreviation))
  if (sys && sys.ratio.length > 1) parts.push(sys.ratio.join("-"))
  if (n.includePressure) parts.push(r.pressureBar + "BAR")
  if (n.includeBox) parts.push([r.box.x, r.box.y, r.box.z].join("X") + (r.box.unit === "angstrom" ? "A" : "NM"))
  if (n.includeTemperature) parts.push(r.temperatureK + "K")
  if (n.includeConcentration && r.soluteId && r.soluteCount > 0) parts.push("N" + String(r.soluteCount).padStart(2, "0"))
  if (n.includeReplica) parts.push("R" + String(r.replica).padStart(2, "0"))
  parts.push(
    fingerprint(
      JSON.stringify({
        projectId: p.projectId,
        systemId: r.systemId,
        ratio: sys?.ratio,
        kind: r.systemKind,
        soluteId: r.soluteId,
        count: r.soluteCount,
        components: r.components,
        box: r.box,
        t: r.temperatureK,
        p: r.pressureBar,
        replica: r.replica,
        seed: r.randomSeed,
        protocol: r.resolvedProtocol?.id,
      }),
    ),
  )
  return parts.filter(Boolean).join("_")
}

export function createRun(
  p: ProjectState,
  systemId: string,
  soluteId: string | null,
  count: number,
  label: string,
  temperatureK: number,
  replica: number,
): RunRecord | null {
  const sys = p.systems.find((s) => s.id === systemId)
  const hasSolute = Boolean(soluteId && count > 0)
  const solute = hasSolute ? p.molecules.find((m) => m.id === soluteId) : null
  if (!sys || (hasSolute && !solute)) return null

  const systemKind = inferSystemKind(sys.componentIds.length, hasSolute)
  const c = calculateBoxComposition(p, systemId, hasSolute ? soluteId! : "", hasSolute ? count : 0, temperatureK)
  const components = sys.componentIds.map((id, i) => ({
    moleculeId: id,
    name: p.molecules.find((m) => m.id === id)?.fullName ?? id,
    count: c.componentCounts?.[i] ?? null,
    molecularWeight: c.molecularWeights[id] ?? null,
  }))
  const total = components.every((v) => v.count !== null)
    ? components.reduce((sum, v) => sum + Number(v.count), hasSolute ? count : 0)
    : null
  const randomSeed = p.protocol.randomSeedBase + replica - 1
  const rp = resolveProtocol(p, { temperatureK, pressureBar: p.protocol.pressureBar, randomSeed })

  const base: Omit<RunRecord, "runId"> = {
    projectId: p.projectId,
    systemKind,
    systemId,
    systemName: sys.name,
    systemAbbreviation: sys.abbreviation,
    components,
    soluteId: hasSolute ? soluteId : null,
    soluteName: solute?.fullName ?? null,
    soluteAbbreviation: solute?.abbreviation ?? null,
    soluteCount: hasSolute ? count : 0,
    moleFraction: hasSolute ? c.metadata?.moleFractions[soluteId!] ?? null : null,
    totalMoleculeCount: total,
    moleFractions: c.metadata?.moleFractions ?? null,
    massFractions: c.metadata?.massFractions ?? null,
    numberDensitiesNm3: c.metadata?.numberDensitiesNm3 ?? null,
    boxVolumeNm3: boxVolumeNm3(p.protocol.box),
    compositionCalculation: c.metadata,
    compositionDiagnostics: c.diagnostics,
    concentrationLabel: label,
    temperatureK,
    pressureBar: p.protocol.pressureBar,
    box: structuredClone(p.protocol.box),
    replica,
    randomSeed,
    protocolName: p.protocol.name,
    forceField: rp.forceField,
    forceFieldInclude: rp.forceFieldInclude,
    chargeScheme: rp.chargeSource,
    productionNs: rp.production.initialNs,
    status: "planned",
    resolvedProtocol: rp,
    molecularSnapshot: structuredClone(
      p.molecules.filter((m) => sys.componentIds.includes(m.id) || (hasSolute && m.id === soluteId)),
    ),
    generatedAt: new Date().toISOString(),
    createdWithVersion: SOFTWARE_VERSION,
    provenanceStatus: "resolved",
  }
  const run: RunRecord = { ...base, runId: makeRunId(p, base) }
  run.scientificState = runState(run, sys.ratio)
  return run
}

export type MatrixAxes = {
  systemIds: string[]
  includeNeatSystems: boolean
  soluteIds: string[]
  soluteCounts: number[]
  temperaturesK: number[]
  pressuresBar: number[]
  boxSizesNm: number[]
  useProtocolBox: boolean
  replicas: number
}

export function parseNumericAxis(text: string): number[] {
  const values = text.trim() ? text.trim().split(/[,;\s]+/).map(Number) : []
  if (values.some((v) => !Number.isFinite(v))) {
    throw new Error("Malformed numeric axis. Every entered value must be finite; no entries are silently discarded.")
  }
  return values
}

export function parseRunMatrixDesign(design: RunMatrixDesign): MatrixAxes {
  return {
    systemIds: design.systemIds,
    includeNeatSystems: design.includeNeatSystems,
    soluteIds: design.soluteIds,
    soluteCounts: design.soluteIds.length ? parseNumericAxis(design.soluteCounts) : [],
    temperaturesK: parseNumericAxis(design.temperaturesK),
    pressuresBar: parseNumericAxis(design.pressuresBar),
    boxSizesNm: design.useProtocolBox ? [] : parseNumericAxis(design.boxSizesNm),
    useProtocolBox: design.useProtocolBox,
    replicas: design.replicas,
  }
}

export function matrixRunCount(a: MatrixAxes) {
  const boxCount = a.useProtocolBox ? 1 : a.boxSizesNm.length
  const soluteCombinations = a.soluteIds.length * a.soluteCounts.filter((c) => c > 0).length
  const neatCombinations = a.includeNeatSystems || a.soluteCounts.includes(0) ? 1 : 0
  return a.systemIds.length * (soluteCombinations + neatCombinations) * a.temperaturesK.length * a.pressuresBar.length * boxCount * a.replicas
}

export function generateMatrixRuns(p: ProjectState, a: MatrixAxes): RunRecord[] {
  const runs: RunRecord[] = []
  if (!Number.isSafeInteger(a.replicas) || a.replicas < 1 || a.replicas > 10000) {
    throw new Error("Replicas must be a positive integer (at most 10,000 per matrix).")
  }
  if (matrixRunCount(a) > 20000) {
    throw new Error("Browser run-design limit: 20,000 records per batch. Split into smaller batches.")
  }
  if (a.systemIds.some((id) => !p.systems.some((s) => s.id === id))) {
    throw new Error("Run matrix references an unknown molecular system.")
  }
  if (a.soluteIds.some((id) => !p.molecules.some((m) => m.id === id))) {
    throw new Error("Run matrix references an unknown solute molecule.")
  }
  if (a.soluteCounts.some((v) => !Number.isSafeInteger(v) || v < 0)) {
    throw new Error("Solute counts must be non-negative integers.")
  }
  if (a.temperaturesK.some((v) => !Number.isFinite(v) || v <= 0)) {
    throw new Error("Temperatures must be positive Kelvin values.")
  }
  if (a.pressuresBar.some((v) => !Number.isFinite(v))) {
    throw new Error("Pressures must be finite bar values.")
  }
  if (!a.useProtocolBox && (!a.boxSizesNm.length || a.boxSizesNm.some((v) => !Number.isFinite(v) || v <= 0))) {
    throw new Error("Box sizes must be positive nm values (or toggle 'Use protocol box dimensions').")
  }

  const boxes = a.useProtocolBox
    ? [p.protocol.box]
    : a.boxSizesNm.map((b) => ({ x: b, y: b, z: b, geometry: "cubic", unit: "nm" as const }))

  const includeNeat = a.includeNeatSystems || a.soluteCounts.includes(0)
  const positiveCounts = a.soluteCounts.filter((c) => c > 0)

  for (const sysId of a.systemIds) {
    for (const t of a.temperaturesK) {
      for (const pressure of a.pressuresBar) {
        for (const box of boxes) {
          const pp: ProjectState = { ...p, protocol: { ...p.protocol, pressureBar: pressure, box } }
          if (includeNeat) {
            for (let r = 1; r <= a.replicas; r++) {
              const run = createRun(pp, sysId, null, 0, "Neat system", t, r)
              if (run) runs.push(run)
            }
          }
          for (const soluteId of a.soluteIds) {
            for (const n of positiveCounts) {
              for (let r = 1; r <= a.replicas; r++) {
                const run = createRun(pp, sysId, soluteId, n, `${n} molecule${n === 1 ? "" : "s"}`, t, r)
                if (run) runs.push(run)
              }
            }
          }
        }
      }
    }
  }
  return runs
}

function resolved(p: ProjectState, r: RunRecord) {
  if (r.projectId && r.projectId !== p.projectId) throw new Error("Run belongs to another project.")
  if (!r.resolvedProtocol) throw new Error("Run has no resolved protocol. Regenerate to produce MDP files.")
  return r.resolvedProtocol
}

export function emMdp(p: ProjectState, r?: RunRecord) {
  return r
    ? resolved(p, r).stages.em.mdp
    : resolveProtocol(p, { temperatureK: 298.15, pressureBar: p.protocol.pressureBar, randomSeed: p.protocol.randomSeedBase }).stages.em.mdp
}
export function nvtMdp(p: ProjectState, r: RunRecord) {
  return resolved(p, r).stages.nvt.mdp
}
export function nptMdp(p: ProjectState, r: RunRecord) {
  return resolved(p, r).stages.npt.mdp
}
export function prodMdp(p: ProjectState, r: RunRecord) {
  return resolved(p, r).stages.prod.mdp
}

export function commands(r: RunRecord) {
  if (!r.resolvedProtocol) return "# Unresolved run: regenerate first.\n"
  const rp = r.resolvedProtocol
  const lines = [
    "#!/usr/bin/env bash",
    "set -euo pipefail",
    `# SolvForge MD ${SOFTWARE_VERSION} — ${rp.forceField} (${rp.chargeSource || "custom charges"})`,
    `# Protocol ${rp.id}; seed ${r.randomSeed}`,
  ]
  const stageMeta: Array<{ key: "em" | "nvt" | "npt" | "prod"; path: string }> = [
    { key: "em", path: "01_em/em" },
    { key: "nvt", path: "02_nvt/nvt" },
    { key: "npt", path: "03_npt/npt" },
    { key: "prod", path: "04_prod/prod" },
  ]
  let prevPath: string | null = null
  let prevHadCpt = false
  for (const s of stageMeta) {
    if (!rp.stages[s.key]?.enabled) continue
    const cInput = prevPath ? `${prevPath}.gro` : "00_input/packed.gro"
    const cptFlag = prevPath && prevHadCpt && s.key !== "em" ? ` -t ${prevPath}.cpt` : ""
    lines.push(
      `gmx grompp -f ${s.path}.mdp -c ${cInput}${cptFlag} -p 00_input/topol.top -n 00_input/index.ndx -o ${s.path}.tpr`,
      `gmx mdrun -deffnm ${s.path} -v`,
      "",
    )
    prevPath = s.path
    prevHadCpt = s.key !== "em"
  }
  if (rp.stages.prod?.enabled) {
    lines.push("# Restart interrupted production:", "# gmx mdrun -deffnm 04_prod/prod -cpi 04_prod/prod.cpt -append")
  }
  return lines.join("\n") + "\n"
}

export function firstContinuation(r: RunRecord) {
  if (!r.resolvedProtocol || r.resolvedProtocol.diagnostics.some((d) => d.severity === "ERROR")) {
    return "# Resolve protocol errors before continuation.\n"
  }
  return continuationPlan(r.resolvedProtocol, r.productionNs, "pending").commands
}
