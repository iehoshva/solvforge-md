export type MoleculeRole =
  | "solute"
  | "solvent"
  | "HBA"
  | "HBD"
  | "ion"
  | "co-solvent"
  | "ligand"
  | "custom"

export type Molecule = {
  id: string
  fullName: string
  abbreviation: string
  role: MoleculeRole
  formula: string
  molecularWeight: number | null
  charge: number
  moleculeCount: number | null
  topologyFile: string
  coordinateFile: string
  residueName: string
  notes: string
}

export type DensityPoint = {
  id: string
  label?: string
  densityGcm3: number | null
  temperatureK: number | null
  status: "experimental" | "literature" | "estimated" | "MD-derived"
  sourceNote: string
  referenceId?: string
  derivation?: "direct-measurement" | "temperature-interpolation" | "composition-interpolation" | "additive-molar-volume-estimate" | "MD-derived" | "user-supplied"
  uncertaintyGcm3?: number | null
  methodNote?: string
  sources?: Array<{ citation: string; url: string }>
}

export type BoxCompositionSettings = {
  mode: "manual" | "density"
  soluteMassMode: "add-after" | "include-in-target"
  lockAcrossSeries: boolean
  lockReferenceSoluteCount: number
  densityResolution: "exact-only" | "nearest" | "linear-interpolation"
  densityInputUnit: "g/cm3" | "kg/m3"
  densityPoints: DensityPoint[]
  molecularWeightOverrides: Record<string, number>
  selectedMultipliers: Record<string, number>
  candidateSpan: number
  deviationWarningPct: number
}

export type MolecularSystem = {
  id: string
  name: string
  abbreviation: string
  componentIds: string[]
  ratio: number[]
  boxCounts: Array<number | null>
  compositionSettings: BoxCompositionSettings
  notes: string
}

export type Protocol = {
  name: string
  forceField: string
  forceFieldInclude: string
  defaultsSection: string
  chargeScheme: string
  qmSoftware: string
  qmMethodBasis: string
  pressureBar: number
  box: { x: number; y: number; z: number; geometry: string; unit?: "nm" | "angstrom" }
  replicas: number
  randomSeedBase: number
  enabledStages: { em: boolean; nvt: boolean; npt: boolean; prod: boolean }
  em: { method: string; maxSteps: number; fmax: number; emstep: number }
  nvt: { durationNs: number; thermostat: string; tcGrps: string; tauTPs: number; timestepFs: number }
  npt: {
    durationNs: number
    barostat: string
    pcoupltype: string
    tauPPs: number
    timestepFs: number
    compressibility: string
  }
  production: {
    ensemble: "NPT" | "NVT"
    mode: "fixed" | "convergence-controlled"
    initialNs: number
    maximumNs: number
    extensionNs: number
    framePs: number
    energyPs: number
    timestepFs: number
  }
  nonbonded: {
    cutoffScheme: string
    coulombMethod: string
    vdwType: string
    vdwModifier: string
    dispCorr: string
    rcoulombNm: number
    rvdwNm: number
    pmeOrder: number
    fourierSpacingNm: number
  }
  constraints: string
  constraintAlgorithm: string
  equilibrationNotes: string
  productionNotes: string
  mdpOverrides: { em: string; nvt: string; npt: string; prod: string }
}

export type RunNaming = {
  includeProject: boolean
  includePressure: boolean
  includeBox: boolean
  includeConcentration: boolean
  includeTemperature: boolean
  includeReplica: boolean
}

export type RunMatrixDesign = {
  systemIds: string[]
  includeNeatSystems: boolean
  soluteIds: string[]
  soluteCounts: string
  temperaturesK: string
  pressuresBar: string
  boxSizesNm: string
  useProtocolBox: boolean
  replicas: number
}

export type ProjectState = {
  createdWithVersion?: string
  originalSchemaVersion?: string
  lastOpenedWithVersion?: string
  currentSchemaVersion?: string
  migrationHistory?: Array<{ from: string; to: string; at: string; softwareVersion: string; note: string }>
  schemaVersion: string
  softwareVersion: string
  projectId: string
  projectName: string
  projectAbbreviation: string
  description: string
  presetName: string
  researchObjective: string
  notes: string
  defaultUnits: { distance: string; temperature: string; pressure: string; time: string }
  createdAt: string
  molecules: Molecule[]
  systems: MolecularSystem[]
  soluteIds: string[]
  runDesign: RunMatrixDesign
  protocol: Protocol
  runNaming: RunNaming
  overrideLog: Array<{ timestamp: string; action: string; note: string }>
}

export type CompositionDiagnostic = {
  severity: "ERROR" | "WARNING" | "INFO"
  code: string
  message: string
}

export type CompositionCalculationMetadata = {
  mode: "manual" | "density"
  soluteMassMode: "add-after" | "include-in-target" | "manual"
  lockAcrossSeries: boolean
  lockReferenceSoluteCount: number | null
  boxInput: { x: number; y: number; z: number; unit: "nm" | "angstrom"; geometry: string }
  boxDimensionsNm: { x: number; y: number; z: number }
  volumeNm3: number
  targetDensityGcm3: number | null
  densityReferenceTemperatureK: number | null
  densityResolution: string
  densityStatus: DensityPoint["status"] | null
  densitySourceNote: string
  densityReferenceId: string | null
  densityLabel: string
  densityDerivation: DensityPoint["derivation"] | null
  densityUncertaintyGcm3: number | null
  densityMethodNote: string
  densitySources: Array<{ citation: string; url: string }>
  ratio: number[]
  actualSystemRatio: number[]
  molecularWeightsUsed: Record<string, number>
  multiplier: number | null
  totalMassG: number | null
  baseSystemMassG: number | null
  estimatedDensityGcm3: number | null
  baseSystemDensityGcm3: number | null
  densityDeviationPct: number | null
  moleFractions: Record<string, number>
  systemNormalizedMoleFractions: Record<string, number>
  massFractions: Record<string, number>
  numberDensitiesNm3: Record<string, number>
  totalNumberDensityNm3: number
  diagnostics: CompositionDiagnostic[]
}

export type SystemStatePoint = {
  molecularModel?: string
  projectId: string
  systemId: string
  systemComponents: Array<{ moleculeId: string; ratio: number }>
  systemKind: "pure-des" | "solute-loaded" | "binary" | "ternary" | "custom"
  soluteId: string | null
  composition: Array<{ moleculeId: string; count: number; moleFraction: number }>
  temperatureK: number
  pressureBar: number
  boxDimensionsNm: [number, number, number]
  forceField: string
  chargeSource: string
  replica: number
}

export type ResolvedSimulationProtocol = {
  id: string
  projectId: string
  softwareVersion: string
  forceField: string
  forceFieldInclude: string
  defaultsSection: string
  chargeSource: string
  qmSoftware: string
  qmMethodBasis: string
  temperatureK: number
  pressureBar: number
  randomSeed: number
  enabledStages: { em: boolean; nvt: boolean; npt: boolean; prod: boolean }
  production: {
    ensemble: "NPT" | "NVT"
    mode: "fixed" | "convergence-controlled"
    initialNs: number
    maximumNs: number
    extensionNs: number
    execution: "external-manual"
  }
  stages: Record<"em" | "nvt" | "npt" | "prod", { enabled: boolean; directives: Record<string, string>; mdp: string; durationNs: number | null }>
  diagnostics: CompositionDiagnostic[]
  inputSettings: Protocol
}

export type RunRecord = {
  inputSnapshots?: Array<{
    id: string
    generatedAt: string
    softwareVersion: string
    files: Array<{ path: string; content: string; sha256: string }>
    molecularSources: unknown
    researcherReviewed: boolean
  }>
  projectId: string
  systemKind: "pure-des" | "solute-loaded" | "binary" | "ternary" | "custom"
  scientificState?: SystemStatePoint
  resolvedProtocol?: ResolvedSimulationProtocol
  molecularSnapshot?: Molecule[]
  generatedAt?: string
  createdWithVersion?: string
  provenanceStatus?: "resolved" | "legacy-unresolved"
  runId: string
  systemId: string
  systemName: string
  systemAbbreviation: string
  components: Array<{ moleculeId: string; name: string; count: number | null; molecularWeight: number | null }>
  soluteId: string | null
  soluteName: string | null
  soluteAbbreviation: string | null
  soluteCount: number
  moleFraction: number | null
  totalMoleculeCount: number | null
  moleFractions: Record<string, number> | null
  massFractions: Record<string, number> | null
  numberDensitiesNm3: Record<string, number> | null
  boxVolumeNm3: number
  compositionCalculation: CompositionCalculationMetadata | null
  compositionDiagnostics: CompositionDiagnostic[]
  concentrationLabel: string
  temperatureK: number
  pressureBar: number
  box: Protocol["box"]
  replica: number
  randomSeed: number
  protocolName: string
  forceField: string
  forceFieldInclude: string
  chargeScheme: string
  productionNs: number
  status: "planned"
}
