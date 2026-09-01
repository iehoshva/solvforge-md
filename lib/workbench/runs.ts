import type { ProjectState, RunRecord } from "./types"
import { boxDimensionsNm, boxVolumeNm3, calculateBoxComposition } from "./composition"

const clean = (value: string) => value.toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-|-$/g, "")
const pad = (n: number, width = 2) => String(n).padStart(width, "0")

export function moleFraction(project: ProjectState, desId: string, soluteCount: number, soluteId = project.soluteIds[0] ?? "", temperatureK = project.stageBTemperatureK) {
  return calculateBoxComposition(project, desId, soluteId, soluteCount, temperatureK).metadata?.moleFractions[soluteId] ?? null
}

export function makeRunId(project: ProjectState, run: Omit<RunRecord, "runId">) {
  const parts: string[] = []
  if (project.runNaming.includeProject) parts.push(clean(project.projectAbbreviation))
  if (project.runNaming.includeStage) parts.push(clean(run.stage))
  parts.push(clean(run.soluteAbbreviation), clean(run.desAbbreviation))
  const des = project.desSystems.find((d) => d.id === run.desId)
  if (des?.ratio.length) parts.push(des.ratio.join("-"))
  if (project.runNaming.includePressure) parts.push(`${run.pressureBar}BAR`)
  if (project.runNaming.includeBox) {
    const box = run.compositionCalculation?.boxDimensionsNm ?? boxDimensionsNm(run.box)
    parts.push(`${box.x}X${box.y}X${box.z}NM`)
  }
  if (project.runNaming.includeTemperature) parts.push(`${Math.round(run.temperatureK)}K`)
  if (project.runNaming.includeConcentration) parts.push(`N${pad(run.soluteCount)}`)
  if (project.runNaming.includeReplica) parts.push(`R${pad(run.replica)}`)
  return parts.filter(Boolean).join("_")
}

function record(project: ProjectState, stage: string, desId: string, soluteId: string, soluteCount: number, label: string, temperatureK: number, replica: number): RunRecord | null {
  const des = project.desSystems.find((d) => d.id === desId)
  const solute = project.molecules.find((m) => m.id === soluteId)
  if (!des || !solute) return null
  const calculation = calculateBoxComposition(project, desId, soluteId, soluteCount, temperatureK)
  const components = des.componentIds.map((id, index) => ({ moleculeId: id, name: project.molecules.find((m) => m.id === id)?.fullName ?? id, count: calculation.componentCounts?.[index] ?? null, molecularWeight: calculation.molecularWeights[id] ?? null }))
  const volumeNm3 = boxVolumeNm3(project.protocol.box)
  const compositionComplete = components.every((c) => c.count !== null && Number.isFinite(c.count) && Number(c.count) >= 0)
  const totalMoleculeCount = compositionComplete ? components.reduce((sum, c) => sum + Number(c.count), soluteCount) : null
  const counts: Record<string, number> | null = compositionComplete ? Object.fromEntries([...components.map((c) => [c.moleculeId, Number(c.count)]), [soluteId, soluteCount]]) : null
  const moleFractions = calculation.metadata?.moleFractions ?? (counts && totalMoleculeCount ? Object.fromEntries(Object.entries(counts).map(([id, count]) => [id, count / totalMoleculeCount])) : null)
  const massFractions = calculation.metadata?.massFractions ?? null
  const numberDensitiesNm3 = calculation.metadata?.numberDensitiesNm3 ?? (counts && volumeNm3 > 0 ? Object.fromEntries(Object.entries(counts).map(([id, count]) => [id, count / volumeNm3])) : null)
  const base = {
    stage,
    desId,
    desName: des.name,
    desAbbreviation: des.abbreviation,
    components,
    soluteId,
    soluteName: solute.fullName,
    soluteAbbreviation: solute.abbreviation,
    soluteCount,
    moleFraction: moleFractions?.[soluteId] ?? null,
    totalMoleculeCount,
    moleFractions,
    massFractions,
    numberDensitiesNm3,
    boxVolumeNm3: volumeNm3,
    compositionCalculation: calculation.metadata,
    compositionDiagnostics: calculation.diagnostics,
    concentrationLabel: label,
    temperatureK,
    pressureBar: project.protocol.pressureBar,
    box: structuredClone(project.protocol.box),
    replica,
    randomSeed: project.protocol.randomSeedBase + replica - 1,
    protocolName: project.protocol.name,
    forceField: project.protocol.forceField,
    chargeScheme: project.protocol.chargeScheme,
    productionNs: project.protocol.production.soluteMaxNs,
    status: "planned" as const,
  }
  return { ...base, runId: makeRunId(project, base) }
}

export function generateStageRuns(project: ProjectState, stage: "A" | "B" | "C") {
  const runs: RunRecord[] = []
  const replicas = Array.from({ length: Math.max(1, project.protocol.replicas) }, (_, i) => i + 1)
  const desIds = stage === "A" ? project.desSystems.map((d) => d.id) : project.selectedChampion ? [project.selectedChampion.valueId] : []
  const concentrations = stage === "A"
    ? [{ soluteCount: project.stageASoluteCount, label: `Stage A comparison: ${project.stageASoluteCount} molecule${project.stageASoluteCount === 1 ? "" : "s"} per box` }]
    : stage === "B"
      ? project.concentrations
      : project.selectedOptimum
        ? project.concentrations.filter((c) => c.id === project.selectedOptimum?.valueId)
        : []
  const temperatures = stage === "A" ? [project.stageATemperatureK] : stage === "B" ? [project.stageBTemperatureK] : project.temperaturesK
  for (const desId of desIds) for (const soluteId of project.soluteIds) for (const concentration of concentrations) for (const temperature of temperatures) for (const replica of replicas) {
    const r = record(project, `stage-${stage.toLowerCase()}`, desId, soluteId, concentration.soluteCount, concentration.label, temperature, replica)
    if (r) runs.push(r)
  }
  return runs
}

export type CustomAxes = { desIds: string[]; soluteIds: string[]; soluteCounts: number[]; temperaturesK: number[]; pressuresBar: number[]; boxSizesNm: number[]; replicas: number }

export function generateCustomRuns(project: ProjectState, axes: CustomAxes) {
  const runs: RunRecord[] = []
  for (const desId of axes.desIds) for (const soluteId of axes.soluteIds) for (const n of axes.soluteCounts) for (const t of axes.temperaturesK) for (const p of axes.pressuresBar) for (const box of axes.boxSizesNm) for (let replica = 1; replica <= axes.replicas; replica++) {
    const next = structuredClone(project)
    next.protocol.pressureBar = p
    next.protocol.box = { x: box, y: box, z: box, geometry: "cubic", unit: "nm" }
    const r = record(next, "custom", desId, soluteId, n, `${n} molecules per box`, t, replica)
    if (r) runs.push(r)
  }
  return runs
}

function applyMdpOverrides(base: string, overrides = "") {
  if (!overrides.trim()) return base
  const keys = new Set(overrides.split(/\r?\n/).map((line) => line.split(";")[0].match(/^\s*([^=]+?)\s*=/)?.[1]?.trim().toLowerCase().replaceAll("-", "_")).filter(Boolean))
  const retained = base.split(/\r?\n/).filter((line) => {
    const key = line.split(";")[0].match(/^\s*([^=]+?)\s*=/)?.[1]?.trim().toLowerCase().replaceAll("-", "_")
    return !key || !keys.has(key)
  })
  return `${retained.join("\n").trimEnd()}\n\n; Researcher MDP overrides / additions\n${overrides.trim()}\n`
}

export function emMdp(project: ProjectState) {
  const p = project.protocol
  return applyMdpOverrides(`; Generated by SolvForge MD v1.0\nintegrator = steep\nemtol = ${p.em.fmax}\nnsteps = ${p.em.maxSteps}\ncutoff-scheme = Verlet\ncoulombtype = ${p.nonbonded.coulombMethod}\nrcoulomb = ${p.nonbonded.cutoffNm}\nrvdw = ${p.nonbonded.cutoffNm}\nconstraints = none\n`, p.mdpOverrides?.em)
}

export function nvtMdp(project: ProjectState, run: RunRecord) {
  const p = project.protocol
  const steps = Math.round((p.nvt.durationNs * 1e6) / p.nvt.timestepFs)
  return applyMdpOverrides(`; NVT — review coupling groups before use\nintegrator = md\ndt = ${(p.nvt.timestepFs / 1000).toFixed(4)}\nnsteps = ${steps}\ntcoupl = ${p.nvt.thermostat}\ntau_t = ${p.nvt.tauTPs}\nref_t = ${run.temperatureK}\npcoupl = no\nconstraints = ${p.constraints}\ncutoff-scheme = Verlet\ncoulombtype = ${p.nonbonded.coulombMethod}\nrcoulomb = ${p.nonbonded.cutoffNm}\nrvdw = ${p.nonbonded.cutoffNm}\n`, p.mdpOverrides?.nvt)
}

export function nptMdp(project: ProjectState, run: RunRecord) {
  const p = project.protocol
  const steps = Math.round((p.npt.durationNs * 1e6) / p.npt.timestepFs)
  return applyMdpOverrides(`; NPT — review compressibility and coupling groups before use\nintegrator = md\ndt = ${(p.npt.timestepFs / 1000).toFixed(4)}\nnsteps = ${steps}\ntcoupl = ${p.nvt.thermostat}\ntau_t = ${p.nvt.tauTPs}\nref_t = ${run.temperatureK}\npcoupl = ${p.npt.barostat}\ntau_p = ${p.npt.tauPPs}\nref_p = ${run.pressureBar}\nconstraints = ${p.constraints}\ncutoff-scheme = Verlet\ncoulombtype = ${p.nonbonded.coulombMethod}\nrcoulomb = ${p.nonbonded.cutoffNm}\nrvdw = ${p.nonbonded.cutoffNm}\n`, p.mdpOverrides?.npt)
}

export function prodMdp(project: ProjectState, run: RunRecord) {
  const p = project.protocol
  const steps = Math.round((run.productionNs * 1e6) / p.production.timestepFs)
  const nst = Math.max(1, Math.round((p.production.framePs * 1000) / p.production.timestepFs))
  return applyMdpOverrides(`; Production — user-defined research settings\nintegrator = md\ndt = ${(p.production.timestepFs / 1000).toFixed(4)}\nnsteps = ${steps}\nnstxout-compressed = ${nst}\ntcoupl = ${p.nvt.thermostat}\ntau_t = ${p.nvt.tauTPs}\nref_t = ${run.temperatureK}\npcoupl = ${p.npt.barostat}\ntau_p = ${p.npt.tauPPs}\nref_p = ${run.pressureBar}\nconstraints = ${p.constraints}\ncutoff-scheme = Verlet\ncoulombtype = ${p.nonbonded.coulombMethod}\nrcoulomb = ${p.nonbonded.cutoffNm}\nrvdw = ${p.nonbonded.cutoffNm}\npme_order = ${p.nonbonded.pmeOrder}\nfourierspacing = ${p.nonbonded.fourierSpacingNm}\n`, p.mdpOverrides?.prod)
}

export function commands(run: RunRecord) {
  const composition = run.compositionCalculation
  const compositionNote = composition ? `# Composition method: ${composition.mode}; solute assumption: ${composition.soluteMassMode}\n# Counts: ${run.components.map((component) => `${component.name}=${component.count}`).join(", ")}; ${run.soluteName}=${run.soluteCount}\n# Target density: ${composition.targetDensityGcm3 ?? "not supplied"} g cm^-3; estimated density: ${composition.estimatedDensityGcm3 ?? "unavailable"} g cm^-3\n# Density provenance: ${composition.densityStatus ?? "not supplied"}; derivation=${composition.densityDerivation ?? "not supplied"}; reference=${composition.densityReferenceId ?? "custom"}\n# Density source: ${composition.densitySourceNote || "not supplied"}; resolution: ${composition.densityResolution}\n` : "# Composition unavailable: provide manual counts or a target density and molecular weights.\n"
  return `#!/usr/bin/env bash\nset -euo pipefail\n# Replace placeholders and verify named index groups before execution.\n${compositionNote}\ngmx grompp -f 01_em/em.mdp -c 00_input/system.gro -p 00_input/topol.top -o 01_em/em.tpr\ngmx mdrun -deffnm 01_em/em\ngmx grompp -f 02_nvt/nvt.mdp -c 01_em/em.gro -r 01_em/em.gro -p 00_input/topol.top -o 02_nvt/nvt.tpr\ngmx mdrun -deffnm 02_nvt/nvt\ngmx grompp -f 03_npt/npt.mdp -c 02_nvt/nvt.gro -r 02_nvt/nvt.gro -t 02_nvt/nvt.cpt -p 00_input/topol.top -o 03_npt/npt.tpr\ngmx mdrun -deffnm 03_npt/npt\ngmx grompp -f 04_prod/prod.mdp -c 03_npt/npt.gro -t 03_npt/npt.cpt -p 00_input/topol.top -o 04_prod/prod.tpr\ngmx mdrun -deffnm 04_prod/prod\n\n# Analysis templates — replace group names with validated selections.\ngmx rdf -f 04_prod/prod.xtc -s 04_prod/prod.tpr -ref '<REFERENCE_GROUP>' -sel '<TARGET_GROUP>' -o analysis/rdf/${run.runId}_rdf.xvg\ngmx msd -f 04_prod/prod.xtc -s 04_prod/prod.tpr -o analysis/thermo/${run.runId}_msd.xvg\ngmx hbond -f 04_prod/prod.xtc -s 04_prod/prod.tpr -num analysis/thermo/${run.runId}_hbond.xvg\ngmx energy -f 04_prod/prod.edr -o analysis/thermo/${run.runId}_energy.xvg\n`
}
