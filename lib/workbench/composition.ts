import { canonical } from "./identity.ts"
import type { CompositionCalculationMetadata, CompositionDiagnostic, DensityPoint, MolecularSystem, Molecule, ProjectState } from "./types"

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
  totalBaseMolecules: number
  totalMolecules: number
  baseSystemMassG: number
  totalMassG: number
  baseSystemDensityGcm3: number
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

export function compositionStateKey(temperatureK: number, soluteId: string, soluteCount: number, project?: ProjectState, system?: MolecularSystem) {
  return canonical({
    temperatureK,
    soluteId,
    soluteCount,
    box: project?.protocol.box,
    components: system?.componentIds,
    ratio: system?.ratio,
    molecularWeights: project?.molecules.map((m) => ({ id: m.id, mw: m.molecularWeight })),
    settings: system ? { ...system.compositionSettings, selectedMultipliers: undefined } : undefined,
  })
}

export function resolveDensity(system: MolecularSystem, temperatureK: number): DensityResolution | null {
  const settings = system.compositionSettings
  const points = settings.densityPoints
    .filter((point) => positiveFinite(point.densityGcm3))
    .sort((a, b) => (a.temperatureK ?? Number.NEGATIVE_INFINITY) - (b.temperatureK ?? Number.NEGATIVE_INFINITY))
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
    const nearest = points.reduce((best, point) =>
      Math.abs(point.temperatureK! - temperatureK) < Math.abs(best.temperatureK! - temperatureK) ? point : best,
    )
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

function molecularWeight(system: MolecularSystem, molecule: Molecule | undefined) {
  if (!molecule) return null
  const override = system.compositionSettings.molecularWeightOverrides[molecule.id]
  return override !== undefined
    ? positiveFinite(override)
      ? override
      : null
    : positiveFinite(molecule.molecularWeight)
      ? molecule.molecularWeight
      : null
}

function buildMetadata(input: {
  project: ProjectState
  system: MolecularSystem
  solute: Molecule | undefined
  soluteCount: number
  componentCounts: number[]
  molecularWeights: Record<string, number>
  density: DensityResolution | null
  multiplier: number | null
  diagnostics: CompositionDiagnostic[]
}): CompositionCalculationMetadata | null {
  const { project, system, solute, soluteCount, componentCounts, molecularWeights, density, multiplier, diagnostics } = input
  const volume = boxVolumeNm3(project.protocol.box)
  if (!(volume > 0)) return null
  const hasAllMws = system.componentIds.every((id) => positiveFinite(molecularWeights[id])) && (!solute || soluteCount === 0 || positiveFinite(molecularWeights[solute.id]))
  const componentMasses = system.componentIds.map((id, index) => (componentCounts[index] * (molecularWeights[id] ?? 0)) / AVOGADRO)
  const soluteMass = solute && soluteCount > 0 ? (soluteCount * (molecularWeights[solute.id] ?? 0)) / AVOGADRO : 0
  const baseSystemMassG = componentMasses.reduce((sum, value) => sum + value, 0)
  const totalMassG = baseSystemMassG + soluteMass
  const counts: Record<string, number> = Object.fromEntries(system.componentIds.map((id, index) => [id, componentCounts[index]]))
  if (solute && soluteCount > 0) counts[solute.id] = soluteCount
  const totalCount = Object.values(counts).reduce((sum, value) => sum + value, 0)
  const baseCount = componentCounts.reduce((sum, value) => sum + value, 0)
  const masses: Record<string, number> = Object.fromEntries(system.componentIds.map((id, index) => [id, componentMasses[index]]))
  if (solute && soluteCount > 0) masses[solute.id] = soluteMass
  const moleFractions = Object.fromEntries(Object.entries(counts).map(([id, count]) => [id, totalCount > 0 ? count / totalCount : 0]))
  const systemNormalizedMoleFractions = Object.fromEntries(
    system.componentIds.map((id, index) => [id, baseCount > 0 ? componentCounts[index] / baseCount : 0]),
  )
  const massFractions = Object.fromEntries(Object.entries(masses).map(([id, mass]) => [id, totalMassG > 0 ? mass / totalMassG : 0]))
  const numberDensitiesNm3 = Object.fromEntries(Object.entries(counts).map(([id, count]) => [id, count / volume]))
  const estimatedDensityGcm3 = hasAllMws ? totalMassG / (volume * NM3_TO_CM3) : null
  const baseSystemDensityGcm3 = hasAllMws ? baseSystemMassG / (volume * NM3_TO_CM3) : null
  const dimensions = boxDimensionsNm(project.protocol.box)
  const ratioReference = componentCounts.at(-1) ?? 0
  const actualSystemRatio = componentCounts.map((count) => (ratioReference > 0 ? count / ratioReference : 0))
  return {
    mode: system.compositionSettings.mode,
    soluteMassMode: system.compositionSettings.mode === "manual" ? "manual" : system.compositionSettings.soluteMassMode,
    lockAcrossSeries: system.compositionSettings.lockAcrossSeries,
    lockReferenceSoluteCount: system.compositionSettings.lockAcrossSeries ? system.compositionSettings.lockReferenceSoluteCount : null,
    boxInput: {
      x: project.protocol.box.x,
      y: project.protocol.box.y,
      z: project.protocol.box.z,
      unit: project.protocol.box.unit ?? "nm",
      geometry: project.protocol.box.geometry,
    },
    boxDimensionsNm: dimensions,
    volumeNm3: volume,
    targetDensityGcm3: density?.densityGcm3 ?? null,
    densityReferenceTemperatureK: density?.referenceTemperatureK ?? null,
    densityResolution: density?.method ?? "unavailable",
    densityStatus: density?.status ?? null,
    densitySourceNote: density?.sourceNote ?? "",
    densityReferenceId: density?.referenceId ?? null,
    densityLabel: density?.label ?? "",
    densityDerivation: density?.derivation ?? null,
    densityUncertaintyGcm3: density?.uncertaintyGcm3 ?? null,
    densityMethodNote: density?.methodNote ?? "",
    densitySources: structuredClone(density?.sources ?? []),
    ratio: [...system.ratio],
    actualSystemRatio,
    molecularWeightsUsed: molecularWeights,
    multiplier,
    totalMassG: hasAllMws ? totalMassG : null,
    baseSystemMassG: hasAllMws ? baseSystemMassG : null,
    estimatedDensityGcm3,
    baseSystemDensityGcm3,
    densityDeviationPct:
      density && estimatedDensityGcm3 !== null ? (100 * (estimatedDensityGcm3 - density.densityGcm3)) / density.densityGcm3 : null,
    moleFractions,
    systemNormalizedMoleFractions,
    massFractions,
    numberDensitiesNm3,
    totalNumberDensityNm3: totalCount / volume,
    diagnostics,
  }
}

export function calculateBoxComposition(
  project: ProjectState,
  systemId: string,
  soluteId: string,
  soluteCount: number,
  temperatureK: number,
): CompositionResult {
  const diagnostics: CompositionDiagnostic[] = []
  const system = project.systems.find((item) => item.id === systemId)
  const solute = soluteId ? project.molecules.find((item) => item.id === soluteId) : undefined
  if (!system) {
    return {
      diagnostics: [diagnostic("ERROR", "SYSTEM_MISSING", "Selected molecular system is unavailable.")],
      candidates: [],
      selected: null,
      componentCounts: null,
      density: null,
      molecularWeights: {},
      metadata: null,
    }
  }
  if (!solute && (soluteId || soluteCount !== 0)) {
    return {
      diagnostics: [diagnostic("ERROR", "SOLUTE_MISSING", "Selected additional/solute species is unavailable.")],
      candidates: [],
      selected: null,
      componentCounts: null,
      density: null,
      molecularWeights: {},
      metadata: null,
    }
  }

  const geometry = project.protocol.box.geometry.trim().toLowerCase()
  const dimensions = boxDimensionsNm(project.protocol.box)
  if (![dimensions.x, dimensions.y, dimensions.z].every(positiveFinite)) {
    diagnostics.push(diagnostic("ERROR", "INVALID_BOX", "Every box dimension must be greater than zero."))
  }
  if (geometry.includes("cubic") && Math.max(dimensions.x, dimensions.y, dimensions.z) - Math.min(dimensions.x, dimensions.y, dimensions.z) > 1e-9) {
    diagnostics.push(diagnostic("WARNING", "CUBIC_DIMENSION_MISMATCH", "Box geometry is labeled cubic but X, Y, and Z differ; volume uses X × Y × Z."))
  }
  if (!Number.isInteger(soluteCount) || soluteCount < 0) {
    diagnostics.push(diagnostic("ERROR", "INVALID_SOLUTE_COUNT", "Additional/solute molecule count must be a non-negative integer."))
  }
  if (!system.componentIds.length) {
    diagnostics.push(diagnostic("ERROR", "NO_COMPONENTS", "Add at least one molecular species to this system."))
  }
  if (new Set(system.componentIds).size !== system.componentIds.length) {
    diagnostics.push(diagnostic("ERROR", "DUPLICATE_COMPONENT", "Each molecular species may appear only once in a system."))
  }
  if (soluteId && soluteCount > 0 && system.componentIds.includes(soluteId)) {
    diagnostics.push(diagnostic("ERROR", "SOLUTE_IS_SYSTEM_COMPONENT", "The selected solute is already a base component of this system."))
  }

  const molecules = system.componentIds.map((id) => project.molecules.find((item) => item.id === id))
  const molecularWeights: Record<string, number> = {}
  molecules.forEach((molecule, index) => {
    const value = molecularWeight(system, molecule)
    if (value) molecularWeights[system.componentIds[index]] = value
    else if (system.compositionSettings.mode === "density") {
      diagnostics.push(diagnostic("ERROR", "MISSING_MW", `Molecular weight is required in density mode for ${molecule?.fullName ?? system.componentIds[index]}.`))
    }
  })
  const soluteMw = molecularWeight(system, solute)
  if (solute && soluteCount > 0) {
    if (soluteMw) molecularWeights[solute.id] = soluteMw
    else if (system.compositionSettings.mode === "density") {
      diagnostics.push(diagnostic("ERROR", "MISSING_SOLUTE_MW", `Molecular weight is required in density mode for ${solute.fullName}.`))
    }
  }

  const density = resolveDensity(system, temperatureK)
  if (system.compositionSettings.densityPoints.some((point) => point.densityGcm3 !== null && !positiveFinite(point.densityGcm3))) {
    diagnostics.push(diagnostic("ERROR", "INVALID_DENSITY", "Density values must be greater than zero."))
  }

  // Manual count mode: does NOT force molecular weights or density!
  if (system.compositionSettings.mode === "manual") {
    if (
      system.boxCounts.length !== system.componentIds.length ||
      system.boxCounts.some((value) => value === null || !Number.isInteger(value) || Number(value) <= 0)
    ) {
      diagnostics.push(diagnostic("ERROR", "MANUAL_COUNTS_REQUIRED", "Manual mode requires a positive integer count for every component."))
    }
    if (diagnostics.some((item) => item.severity === "ERROR")) {
      return { diagnostics, candidates: [], selected: null, componentCounts: null, density, molecularWeights, metadata: null }
    }
    const componentCounts = system.boxCounts.map(Number)
    const metadata = buildMetadata({ project, system, solute, soluteCount, componentCounts, molecularWeights, density, multiplier: null, diagnostics })
    if (metadata && density && metadata.densityDeviationPct !== null && Math.abs(metadata.densityDeviationPct) > system.compositionSettings.deviationWarningPct) {
      diagnostics.push(diagnostic("WARNING", "DENSITY_DEVIATION", `Manual composition differs from target density by ${Math.abs(metadata.densityDeviationPct).toFixed(2)}%.`))
    }
    diagnostics.push(diagnostic("INFO", "MANUAL_COMPOSITION", "Absolute molecule counts supplied directly."))
    if (metadata) metadata.diagnostics = diagnostics
    return { diagnostics, candidates: [], selected: null, componentCounts, density, molecularWeights, metadata }
  }

  // Density calculation mode
  if (system.ratio.length !== system.componentIds.length || system.ratio.some((value) => !Number.isInteger(value) || value <= 0)) {
    diagnostics.push(diagnostic("ERROR", "INVALID_RATIO", "Density mode requires a positive integer ratio coefficient for every component."))
  }
  if (!Number.isInteger(system.compositionSettings.candidateSpan) || system.compositionSettings.candidateSpan < 1 || system.compositionSettings.candidateSpan > 200) {
    diagnostics.push(diagnostic("ERROR", "INVALID_CANDIDATE_SPAN", "Candidate span must be an integer from 1 to 200."))
  }
  if (!positiveFinite(system.compositionSettings.deviationWarningPct)) {
    diagnostics.push(diagnostic("ERROR", "INVALID_DEVIATION_THRESHOLD", "Density-deviation warning threshold must be greater than zero."))
  }
  if (!density) {
    diagnostics.push(diagnostic("ERROR", "DENSITY_REQUIRED", "Target density required before box composition can be calculated in density mode."))
  }
  if (diagnostics.some((item) => item.severity === "ERROR")) {
    return { diagnostics, candidates: [], selected: null, componentCounts: null, density, molecularWeights, metadata: null }
  }

  const volume = boxVolumeNm3(project.protocol.box)
  const targetMassG = density!.densityGcm3 * volume * NM3_TO_CM3
  const actualSoluteMassG = solute && soluteCount > 0 ? (soluteCount * molecularWeights[solute.id]) / AVOGADRO : 0
  const referenceSoluteCount = solute && soluteCount > 0 && system.compositionSettings.lockAcrossSeries ? system.compositionSettings.lockReferenceSoluteCount : soluteCount
  const selectionSoluteMassG = solute && referenceSoluteCount > 0 ? (referenceSoluteCount * molecularWeights[solute.id]) / AVOGADRO : 0
  const desiredBaseMassG = system.compositionSettings.soluteMassMode === "include-in-target" ? targetMassG - selectionSoluteMassG : targetMassG
  if (!(desiredBaseMassG > 0)) {
    diagnostics.push(diagnostic("ERROR", "IMPOSSIBLE_TARGET_MASS", "Solute mass equals or exceeds the target mass for this box."))
    return { diagnostics, candidates: [], selected: null, componentCounts: null, density, molecularWeights, metadata: null }
  }
  const ratioUnitMassG = system.componentIds.reduce((sum, id, index) => sum + (system.ratio[index] * molecularWeights[id]) / AVOGADRO, 0)
  const idealMultiplier = desiredBaseMassG / ratioUnitMassG
  const center = Math.max(1, Math.round(idealMultiplier))
  const span = system.compositionSettings.candidateSpan
  const stateCount = system.compositionSettings.lockAcrossSeries ? referenceSoluteCount : soluteCount
  const key = compositionStateKey(temperatureK, soluteId, stateCount, project, system)
  const preferred = system.compositionSettings.selectedMultipliers[key]
  const multipliers = new Set<number>()
  for (let n = Math.max(1, center - span); n <= center + span; n++) multipliers.add(n)
  if (Number.isInteger(preferred) && preferred > 0) multipliers.add(preferred)

  let candidates: CompositionCandidate[] = [...multipliers]
    .sort((a, b) => a - b)
    .map((multiplier) => {
      const componentCounts = system.ratio.map((ratio) => ratio * multiplier)
      const baseSystemMassG = multiplier * ratioUnitMassG
      const totalMassG = baseSystemMassG + actualSoluteMassG
      const baseSystemDensityGcm3 = baseSystemMassG / (volume * NM3_TO_CM3)
      const estimatedDensityGcm3 = totalMassG / (volume * NM3_TO_CM3)
      const densityDeviationGcm3 = estimatedDensityGcm3 - density!.densityGcm3
      const relativeDensityErrorPct = (100 * densityDeviationGcm3) / density!.densityGcm3
      const selectionDensity =
        system.compositionSettings.soluteMassMode === "add-after"
          ? baseSystemDensityGcm3
          : (baseSystemMassG + selectionSoluteMassG) / (volume * NM3_TO_CM3)
      return {
        multiplier,
        componentCounts,
        totalBaseMolecules: componentCounts.reduce((sum, value) => sum + value, 0),
        totalMolecules: componentCounts.reduce((sum, value) => sum + value, soluteCount),
        baseSystemMassG,
        totalMassG,
        baseSystemDensityGcm3,
        estimatedDensityGcm3,
        densityDeviationGcm3,
        relativeDensityErrorPct,
        selectionErrorPct: (100 * (selectionDensity - density!.densityGcm3)) / density!.densityGcm3,
        mathematicallyClosest: false,
      }
    })

  const closest = candidates.reduce((best, candidate) =>
    Math.abs(candidate.selectionErrorPct) < Math.abs(best.selectionErrorPct) ? candidate : best,
  )
  candidates = candidates.map((candidate) => ({ ...candidate, mathematicallyClosest: candidate.multiplier === closest.multiplier }))
  const selected =
    Number.isInteger(preferred) && preferred > 0
      ? candidates.find((candidate) => candidate.multiplier === preferred)!
      : candidates.find((candidate) => candidate.mathematicallyClosest)!

  if (Math.abs(selected.relativeDensityErrorPct) > system.compositionSettings.deviationWarningPct) {
    diagnostics.push(
      diagnostic(
        "WARNING",
        "DENSITY_DEVIATION",
        `Selected integer ${system.ratio.join(":")} composition differs from target density by ${Math.abs(selected.relativeDensityErrorPct).toFixed(2)}%.`,
      ),
    )
  }
  diagnostics.push(diagnostic("INFO", "INTEGER_RATIO_PRESERVED", `Counts are integer multiple n=${selected.multiplier} of ratio ${system.ratio.join(":")}.`))
  const metadata = buildMetadata({
    project,
    system,
    solute,
    soluteCount,
    componentCounts: selected.componentCounts,
    molecularWeights,
    density,
    multiplier: selected.multiplier,
    diagnostics,
  })
  return { diagnostics, candidates, selected, componentCounts: selected.componentCounts, density, molecularWeights, metadata }
}
