import type { CompositionCalculationMetadata, CompositionDiagnostic, DESSystem, DensityPoint, Molecule, ProjectState } from "./types"

export const AVOGADRO = 6.02214076e23
export const NM3_TO_CM3 = 1e-21

export type DensityResolution = {
  densityGcm3: number
  referenceTemperatureK: number | null
  status: DensityPoint["status"]
  sourceNote: string
  method: "exact" | "nearest" | "linear-interpolation"
  bracket?: [number, number]
  referenceId: string | null
  label: string
  derivation: DensityPoint["derivation"] | null
  uncertaintyGcm3: number | null
  methodNote: string
  sources: Array<{ citation: string; url: string }>
}

export type CompositionCandidate = {
  multiplier: number
  componentCounts: number[]
  totalDesMolecules: number
  totalMolecules: number
  desOnlyMassG: number
  totalMassG: number
  desOnlyDensityGcm3: number
  estimatedDensityGcm3: number
  densityDeviationGcm3: number
  relativeDensityErrorPct: number
  selectionErrorPct: number
  mathematicallyClosest: boolean
}

export type CompositionResult = {
  diagnostics: CompositionDiagnostic[]
  candidates: CompositionCandidate[]
  selected: CompositionCandidate | null
  componentCounts: number[] | null
  density: DensityResolution | null
  molecularWeights: Record<string, number>
  metadata: CompositionCalculationMetadata | null
}

const diagnostic = (severity: CompositionDiagnostic["severity"], code: string, message: string): CompositionDiagnostic => ({ severity, code, message })
const positiveFinite = (value: number | null | undefined): value is number => typeof value === "number" && Number.isFinite(value) && value > 0

export function boxDimensionsNm(box: ProjectState["protocol"]["box"]) {
  const factor = box.unit === "angstrom" ? 0.1 : 1
  return { x: box.x * factor, y: box.y * factor, z: box.z * factor }
}

export function boxVolumeNm3(box: ProjectState["protocol"]["box"]) {
  const dimensions = boxDimensionsNm(box)
  return dimensions.x * dimensions.y * dimensions.z
}

export function compositionStateKey(temperatureK: number, soluteId: string, soluteCount: number) {
  return `${Number(temperatureK).toFixed(4)}|${soluteId}|${Math.trunc(soluteCount)}`
}

export function resolveDensity(system: DESSystem, temperatureK: number): DensityResolution | null {
  const settings = system.compositionSettings
  const points = settings.densityPoints.filter((point) => positiveFinite(point.densityGcm3)).sort((a, b) => (a.temperatureK ?? Number.NEGATIVE_INFINITY) - (b.temperatureK ?? Number.NEGATIVE_INFINITY))
  if (!points.length) return null
  const resolvedPoint = (point: DensityPoint, method: DensityResolution["method"]): DensityResolution => ({
    densityGcm3: point.densityGcm3!,
    referenceTemperatureK: point.temperatureK,
    status: point.status,
    sourceNote: point.sourceNote,
    method,
    referenceId: point.referenceId ?? null,
    label: point.label ?? "User density record",
    derivation: point.derivation ?? "user-supplied",
    uncertaintyGcm3: positiveFinite(point.uncertaintyGcm3) ? point.uncertaintyGcm3 : null,
    methodNote: point.methodNote ?? "",
    sources: structuredClone(point.sources ?? []),
  })
  const exact = points.find((point) => point.temperatureK !== null && Math.abs(point.temperatureK - temperatureK) < 1e-6)
  if (exact) return resolvedPoint(exact, "exact")
  const temperatureFree = points.find((point) => point.temperatureK === null)
  if (temperatureFree) return resolvedPoint(temperatureFree, "exact")
  if (settings.densityResolution === "exact-only") return null
  if (settings.densityResolution === "nearest") {
    const nearest = points.reduce((best, point) => Math.abs(point.temperatureK! - temperatureK) < Math.abs(best.temperatureK! - temperatureK) ? point : best)
    return resolvedPoint(nearest, "nearest")
  }
  const lower = [...points].reverse().find((point) => point.temperatureK! < temperatureK)
  const upper = points.find((point) => point.temperatureK! > temperatureK)
  if (!lower || !upper) return null
  const fraction = (temperatureK - lower.temperatureK!) / (upper.temperatureK! - lower.temperatureK!)
  const sourceMap = new Map<string, { citation: string; url: string }>()
  for (const source of [...(lower.sources ?? []), ...(upper.sources ?? [])]) sourceMap.set(`${source.citation}|${source.url}`, source)
  return {
    densityGcm3: lower.densityGcm3! + fraction * (upper.densityGcm3! - lower.densityGcm3!),
    referenceTemperatureK: temperatureK,
    status: "estimated",
    sourceNote: `Linear interpolation between ${lower.temperatureK} K (${lower.sourceNote || lower.status}) and ${upper.temperatureK} K (${upper.sourceNote || upper.status}).`,
    method: "linear-interpolation",
    bracket: [lower.temperatureK!, upper.temperatureK!],
    referenceId: null,
    label: `Temperature interpolation at ${temperatureK} K`,
    derivation: "temperature-interpolation",
    uncertaintyGcm3: null,
    methodNote: "Piecewise linear interpolation in temperature; no extrapolation.",
    sources: [...sourceMap.values()],
  }
}

function molecularWeight(system: DESSystem, molecule: Molecule | undefined) {
  if (!molecule) return null
  const override = system.compositionSettings.molecularWeightOverrides[molecule.id]
  return positiveFinite(override) ? override : positiveFinite(molecule.molecularWeight) ? molecule.molecularWeight : null
}

function buildMetadata(input: { project: ProjectState; system: DESSystem; solute: Molecule; soluteCount: number; componentCounts: number[]; molecularWeights: Record<string, number>; density: DensityResolution | null; multiplier: number | null; diagnostics: CompositionDiagnostic[] }): CompositionCalculationMetadata | null {
  const { project, system, solute, soluteCount, componentCounts, molecularWeights, density, multiplier, diagnostics } = input
  const volume = boxVolumeNm3(project.protocol.box)
  if (!(volume > 0)) return null
  const componentMasses = system.componentIds.map((id, index) => componentCounts[index] * (molecularWeights[id] ?? 0) / AVOGADRO)
  const soluteMass = soluteCount * (molecularWeights[solute.id] ?? 0) / AVOGADRO
  const desOnlyMassG = componentMasses.reduce((sum, value) => sum + value, 0)
  const totalMassG = desOnlyMassG + soluteMass
  const counts: Record<string, number> = Object.fromEntries(system.componentIds.map((id, index) => [id, componentCounts[index]]))
  counts[solute.id] = soluteCount
  const totalCount = Object.values(counts).reduce((sum, value) => sum + value, 0)
  const desCount = componentCounts.reduce((sum, value) => sum + value, 0)
  const masses: Record<string, number> = Object.fromEntries(system.componentIds.map((id, index) => [id, componentMasses[index]]))
  masses[solute.id] = soluteMass
  const moleFractions = Object.fromEntries(Object.entries(counts).map(([id, count]) => [id, totalCount > 0 ? count / totalCount : 0]))
  const desNormalizedMoleFractions = Object.fromEntries(system.componentIds.map((id, index) => [id, desCount > 0 ? componentCounts[index] / desCount : 0]))
  const massFractions = Object.fromEntries(Object.entries(masses).map(([id, mass]) => [id, totalMassG > 0 ? mass / totalMassG : 0]))
  const numberDensitiesNm3 = Object.fromEntries(Object.entries(counts).map(([id, count]) => [id, count / volume]))
  const estimatedDensityGcm3 = totalMassG / (volume * NM3_TO_CM3)
  const dimensions = boxDimensionsNm(project.protocol.box)
  const ratioReference = componentCounts.at(-1) ?? 0
  const actualDesRatio = componentCounts.map((count) => ratioReference > 0 ? count / ratioReference : 0)
  return { mode: system.compositionSettings.mode, soluteMassMode: system.compositionSettings.mode === "manual" ? "manual" : system.compositionSettings.soluteMassMode, lockAcrossSeries: system.compositionSettings.lockAcrossSeries, lockReferenceSoluteCount: system.compositionSettings.lockAcrossSeries ? system.compositionSettings.lockReferenceSoluteCount : null, boxInput: { x: project.protocol.box.x, y: project.protocol.box.y, z: project.protocol.box.z, unit: project.protocol.box.unit ?? "nm", geometry: project.protocol.box.geometry }, boxDimensionsNm: dimensions, volumeNm3: volume, targetDensityGcm3: density?.densityGcm3 ?? null, densityReferenceTemperatureK: density?.referenceTemperatureK ?? null, densityResolution: density?.method ?? "unavailable", densityStatus: density?.status ?? null, densitySourceNote: density?.sourceNote ?? "", densityReferenceId: density?.referenceId ?? null, densityLabel: density?.label ?? "", densityDerivation: density?.derivation ?? null, densityUncertaintyGcm3: density?.uncertaintyGcm3 ?? null, densityMethodNote: density?.methodNote ?? "", densitySources: structuredClone(density?.sources ?? []), ratio: [...system.ratio], actualDesRatio, molecularWeightsUsed: molecularWeights, multiplier, totalMassG, desOnlyMassG, estimatedDensityGcm3, desOnlyDensityGcm3: desOnlyMassG / (volume * NM3_TO_CM3), densityDeviationPct: density ? 100 * (estimatedDensityGcm3 - density.densityGcm3) / density.densityGcm3 : null, moleFractions, desNormalizedMoleFractions, massFractions, numberDensitiesNm3, totalNumberDensityNm3: totalCount / volume, diagnostics }
}

export function calculateBoxComposition(project: ProjectState, desId: string, soluteId: string, soluteCount: number, temperatureK: number): CompositionResult {
  const diagnostics: CompositionDiagnostic[] = []
  const system = project.desSystems.find((item) => item.id === desId)
  const solute = project.molecules.find((item) => item.id === soluteId)
  if (!system) return { diagnostics: [diagnostic("ERROR", "SYSTEM_MISSING", "Selected solvent system is unavailable.")], candidates: [], selected: null, componentCounts: null, density: null, molecularWeights: {}, metadata: null }
  if (!solute) return { diagnostics: [diagnostic("ERROR", "SOLUTE_MISSING", "Selected solute is unavailable.")], candidates: [], selected: null, componentCounts: null, density: null, molecularWeights: {}, metadata: null }
  const geometry = project.protocol.box.geometry.trim().toLowerCase()
  if (!geometry.includes("cubic") && !geometry.includes("orthorhombic") && !geometry.includes("rectangular")) diagnostics.push(diagnostic("ERROR", "UNSUPPORTED_GEOMETRY", `Volume calculation is not defined for box geometry '${project.protocol.box.geometry}'. Use cubic or orthorhombic dimensions.`))
  const dimensions = boxDimensionsNm(project.protocol.box)
  if (![dimensions.x, dimensions.y, dimensions.z].every(positiveFinite)) diagnostics.push(diagnostic("ERROR", "INVALID_BOX", "Every box dimension must be greater than zero."))
  if (geometry.includes("cubic") && Math.max(dimensions.x, dimensions.y, dimensions.z) - Math.min(dimensions.x, dimensions.y, dimensions.z) > 1e-9) diagnostics.push(diagnostic("WARNING", "CUBIC_DIMENSION_MISMATCH", "Box geometry is labeled cubic but X, Y, and Z differ; volume is calculated from the entered dimensions."))
  if (!Number.isInteger(soluteCount) || soluteCount < 0) diagnostics.push(diagnostic("ERROR", "INVALID_SOLUTE_COUNT", "Solute molecule count must be a non-negative integer."))
  if (!system.componentIds.length || system.ratio.length !== system.componentIds.length || system.ratio.some((value) => !Number.isInteger(value) || value <= 0)) diagnostics.push(diagnostic("ERROR", "INVALID_RATIO", "Every solvent component requires a positive integer ratio coefficient."))
  if (new Set(system.componentIds).size !== system.componentIds.length) diagnostics.push(diagnostic("ERROR", "DUPLICATE_COMPONENT", "Each molecular species may appear only once in a solvent-system composition."))
  if (system.componentIds.includes(soluteId)) diagnostics.push(diagnostic("ERROR", "SOLUTE_IS_SOLVENT_COMPONENT", "The selected solute is also listed as a solvent component; choose distinct molecular species."))
  if (!Number.isInteger(system.compositionSettings.candidateSpan) || system.compositionSettings.candidateSpan < 1) diagnostics.push(diagnostic("ERROR", "INVALID_CANDIDATE_SPAN", "Nearby-candidate span must be a positive integer."))
  if (!positiveFinite(system.compositionSettings.deviationWarningPct)) diagnostics.push(diagnostic("ERROR", "INVALID_DEVIATION_THRESHOLD", "Density-deviation warning threshold must be greater than zero."))
  const molecules = system.componentIds.map((id) => project.molecules.find((item) => item.id === id))
  const molecularWeights: Record<string, number> = {}
  molecules.forEach((molecule, index) => {
    const value = molecularWeight(system, molecule)
    if (!value) diagnostics.push(diagnostic("ERROR", "MISSING_MW", `Molecular weight is required for ${molecule?.fullName ?? system.componentIds[index]}.`))
    else molecularWeights[system.componentIds[index]] = value
  })
  const soluteMw = molecularWeight(system, solute)
  if (!soluteMw) diagnostics.push(diagnostic("ERROR", "MISSING_SOLUTE_MW", `Molecular weight is required for solute ${solute.fullName}.`))
  else molecularWeights[solute.id] = soluteMw
  const density = resolveDensity(system, temperatureK)
  if (system.compositionSettings.densityPoints.some((point) => point.densityGcm3 !== null && !positiveFinite(point.densityGcm3))) diagnostics.push(diagnostic("ERROR", "INVALID_DENSITY", "Density values must be greater than zero."))
  if (density?.method === "nearest" && density.referenceTemperatureK !== null && Math.abs(density.referenceTemperatureK - temperatureK) > 1e-6) diagnostics.push(diagnostic("WARNING", "DENSITY_TEMPERATURE_MISMATCH", `Density reference is reported at ${density.referenceTemperatureK} K while this simulation is configured for ${temperatureK} K.`))
  if (density?.method === "linear-interpolation") diagnostics.push(diagnostic("INFO", "DENSITY_INTERPOLATED", `Density was linearly interpolated within ${density.bracket?.[0]}–${density.bracket?.[1]} K; no extrapolation was performed.`))
  if (density?.status === "estimated" && density.method !== "linear-interpolation") diagnostics.push(diagnostic("WARNING", "ESTIMATED_DENSITY_REFERENCE", "The selected target density is an estimate rather than a direct mixture measurement. Review its derivation and suitability before generating production inputs."))
  if (density?.derivation === "composition-interpolation") diagnostics.push(diagnostic("INFO", "DENSITY_COMPOSITION_INTERPOLATED", "The target density was interpolated between measured mixture compositions; the interpolation is recorded in provenance."))
  if (!density && system.compositionSettings.mode === "density") {
    const validTemperatures = system.compositionSettings.densityPoints.filter((point) => positiveFinite(point.densityGcm3) && point.temperatureK !== null).map((point) => point.temperatureK!)
    if (validTemperatures.length) diagnostics.push(diagnostic("WARNING", "DENSITY_TEMPERATURE_MISMATCH", `Available density reference temperature(s) ${validTemperatures.join(", ")} K do not resolve the simulation temperature ${temperatureK} K under the selected policy.`))
    diagnostics.push(diagnostic("ERROR", "DENSITY_REQUIRED", system.compositionSettings.densityResolution === "linear-interpolation" ? "No exact or bracketed density is available at this temperature; extrapolation is not performed automatically." : "Target density required before automatic box composition can be calculated."))
  }
  if (diagnostics.some((item) => item.severity === "ERROR" && !["DENSITY_REQUIRED"].includes(item.code))) return { diagnostics, candidates: [], selected: null, componentCounts: null, density, molecularWeights, metadata: null }

  if (system.compositionSettings.mode === "manual") {
    if (system.boxCounts.length !== system.componentIds.length || system.boxCounts.some((value) => value === null || !Number.isInteger(value) || Number(value) <= 0)) diagnostics.push(diagnostic("ERROR", "MANUAL_COUNTS_REQUIRED", "Manual mode requires a positive integer count for every solvent component."))
    if (diagnostics.some((item) => item.severity === "ERROR")) return { diagnostics, candidates: [], selected: null, componentCounts: null, density, molecularWeights, metadata: null }
    const componentCounts = system.boxCounts.map(Number)
    const countReference = componentCounts.at(-1)!
    const ratioReference = system.ratio.at(-1)!
    if (componentCounts.some((count, index) => Math.abs(count / countReference - system.ratio[index] / ratioReference) > 1e-9)) diagnostics.push(diagnostic("WARNING", "MANUAL_RATIO_MISMATCH", `Manual counts give ${componentCounts.map((count) => count / countReference).map((value) => value.toFixed(6)).join(":")}, not the requested ${system.ratio.map((ratio) => ratio / ratioReference).map((value) => value.toFixed(6)).join(":")} normalized ratio.`))
    const metadata = buildMetadata({ project, system, solute, soluteCount, componentCounts, molecularWeights, density, multiplier: null, diagnostics })
    if (metadata && density && Math.abs(metadata.densityDeviationPct ?? 0) > system.compositionSettings.deviationWarningPct) diagnostics.push(diagnostic("WARNING", "DENSITY_DEVIATION", `Manual composition differs from the target density by ${Math.abs(metadata.densityDeviationPct!).toFixed(2)}%.`))
    diagnostics.push(diagnostic("INFO", "MANUAL_COMPOSITION", "Absolute counts were supplied manually; the molar ratio was not used to invent a box population."))
    if (metadata) metadata.diagnostics = diagnostics
    return { diagnostics, candidates: [], selected: null, componentCounts, density, molecularWeights, metadata }
  }

  if (!density) return { diagnostics, candidates: [], selected: null, componentCounts: null, density, molecularWeights, metadata: null }
  const volume = boxVolumeNm3(project.protocol.box)
  const targetMassG = density.densityGcm3 * volume * NM3_TO_CM3
  const actualSoluteMassG = soluteCount * molecularWeights[solute.id] / AVOGADRO
  const referenceSoluteCount = system.compositionSettings.lockAcrossSeries ? system.compositionSettings.lockReferenceSoluteCount : soluteCount
  if (!Number.isInteger(referenceSoluteCount) || referenceSoluteCount < 0) diagnostics.push(diagnostic("ERROR", "INVALID_LOCK_REFERENCE", "Locked-series reference loading must be a non-negative integer."))
  const selectionSoluteMassG = referenceSoluteCount * molecularWeights[solute.id] / AVOGADRO
  const desiredDesMassG = system.compositionSettings.soluteMassMode === "include-in-target" ? targetMassG - selectionSoluteMassG : targetMassG
  if (!(desiredDesMassG > 0)) diagnostics.push(diagnostic("ERROR", "IMPOSSIBLE_TARGET_MASS", "Solute mass equals or exceeds the target mass for this box; no positive DES composition is possible."))
  const ratioUnitMassG = system.componentIds.reduce((sum, id, index) => sum + system.ratio[index] * molecularWeights[id] / AVOGADRO, 0)
  if (!(ratioUnitMassG > 0)) diagnostics.push(diagnostic("ERROR", "IMPOSSIBLE_RATIO_MASS", "The ratio-unit molecular mass must be positive."))
  if (diagnostics.some((item) => item.severity === "ERROR")) return { diagnostics, candidates: [], selected: null, componentCounts: null, density, molecularWeights, metadata: null }
  const idealMultiplier = desiredDesMassG / ratioUnitMassG
  const center = Math.max(1, Math.round(idealMultiplier))
  const span = Math.max(1, Math.min(20, Math.trunc(system.compositionSettings.candidateSpan)))
  const stateCount = system.compositionSettings.lockAcrossSeries ? referenceSoluteCount : soluteCount
  const key = compositionStateKey(temperatureK, soluteId, stateCount)
  const preferred = system.compositionSettings.selectedMultipliers[key]
  const multipliers = new Set<number>()
  for (let n = Math.max(1, center - span); n <= center + span; n++) multipliers.add(n)
  if (Number.isInteger(preferred) && preferred > 0) multipliers.add(preferred)
  let candidates: CompositionCandidate[] = [...multipliers].sort((a, b) => a - b).map((multiplier) => {
    const componentCounts = system.ratio.map((ratio) => ratio * multiplier)
    const desOnlyMassG = multiplier * ratioUnitMassG
    const totalMassG = desOnlyMassG + actualSoluteMassG
    const desOnlyDensityGcm3 = desOnlyMassG / (volume * NM3_TO_CM3)
    const estimatedDensityGcm3 = totalMassG / (volume * NM3_TO_CM3)
    const densityDeviationGcm3 = estimatedDensityGcm3 - density.densityGcm3
    const relativeDensityErrorPct = 100 * densityDeviationGcm3 / density.densityGcm3
    const selectionDensity = system.compositionSettings.soluteMassMode === "add-after" ? desOnlyDensityGcm3 : (desOnlyMassG + selectionSoluteMassG) / (volume * NM3_TO_CM3)
    return { multiplier, componentCounts, totalDesMolecules: componentCounts.reduce((sum, value) => sum + value, 0), totalMolecules: componentCounts.reduce((sum, value) => sum + value, soluteCount), desOnlyMassG, totalMassG, desOnlyDensityGcm3, estimatedDensityGcm3, densityDeviationGcm3, relativeDensityErrorPct, selectionErrorPct: 100 * (selectionDensity - density.densityGcm3) / density.densityGcm3, mathematicallyClosest: false }
  })
  const closest = candidates.reduce((best, candidate) => Math.abs(candidate.selectionErrorPct) < Math.abs(best.selectionErrorPct) ? candidate : best)
  candidates = candidates.map((candidate) => ({ ...candidate, mathematicallyClosest: candidate.multiplier === closest.multiplier }))
  const selected = Number.isInteger(preferred) && preferred > 0 ? candidates.find((candidate) => candidate.multiplier === preferred)! : candidates.find((candidate) => candidate.mathematicallyClosest)!
  if (system.compositionSettings.lockAcrossSeries) diagnostics.push(diagnostic("INFO", "DES_COUNTS_LOCKED", `DES counts use the N=${referenceSoluteCount} reference loading and remain fixed while solute loading changes.`))
  if (Math.abs(selected.relativeDensityErrorPct) > system.compositionSettings.deviationWarningPct) diagnostics.push(diagnostic("WARNING", "DENSITY_DEVIATION", `Selected integer ${system.ratio.join(":")} composition differs from the requested total density by ${Math.abs(selected.relativeDensityErrorPct).toFixed(2)}%.`))
  diagnostics.push(diagnostic("INFO", "INTEGER_RATIO_PRESERVED", `Counts are an integer multiple n=${selected.multiplier} of the requested ${system.ratio.join(":")} molar ratio.`))
  const metadata = buildMetadata({ project, system, solute, soluteCount, componentCounts: selected.componentCounts, molecularWeights, density, multiplier: selected.multiplier, diagnostics })
  return { diagnostics, candidates, selected, componentCounts: selected.componentCounts, density, molecularWeights, metadata }
}
