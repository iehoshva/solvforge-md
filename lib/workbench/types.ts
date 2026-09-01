export type MoleculeRole =
  | "solute"
  | "HBA"
  | "HBD"
  | "solvent component"
  | "ion"
  | "co-solvent"
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

export type DESSystem = {
  id: string
  name: string
  abbreviation: string
  componentIds: string[]
  ratio: number[]
  boxCounts: Array<number | null>
  compositionSettings: BoxCompositionSettings
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

export type ConcentrationPoint = {
  id: string
  label: string
  soluteCount: number
}

export type Protocol = {
  name: string
  forceField: string
  chargeScheme: string
  pressureBar: number
  box: { x: number; y: number; z: number; geometry: string; unit?: "nm" | "angstrom" }
  replicas: number
  randomSeedBase: number
  em: { method: string; maxSteps: number; fmax: number }
  nvt: { durationNs: number; thermostat: string; tauTPs: number; timestepFs: number }
  npt: { durationNs: number; barostat: string; tauPPs: number; timestepFs: number }
  production: {
    pureDesNs: number
    soluteMinNs: number
    soluteMaxNs: number
    exactOrRange: "exact" | "range"
    framePs: number
    timestepFs: number
  }
  nonbonded: {
    cutoffNm: number
    coulombMethod: string
    pmeOrder: number
    fourierSpacingNm: number
  }
  constraints: string
  equilibrationNotes: string
  productionNotes: string
  mdpOverrides?: { em: string; nvt: string; npt: string; prod: string }
}

export type Decision = {
  valueId: string
  selectedAt: string
  rationale: string
  supportingAnalysis: string[]
}

export type RunNaming = {
  includeProject: boolean
  includeStage: boolean
  includePressure: boolean
  includeBox: boolean
  includeConcentration: boolean
  includeTemperature: boolean
  includeReplica: boolean
}

export type ProjectState = {
  schemaVersion: string
  softwareVersion: string
  projectId: string
  projectName: string
  projectAbbreviation: string
  description: string
  presetName: string
  mode: "thesis" | "custom"
  researchObjective: string
  notes: string
  defaultUnits: { distance: string; temperature: string; pressure: string; time: string }
  createdAt: string
  molecules: Molecule[]
  desSystems: DESSystem[]
  soluteIds: string[]
  concentrations: ConcentrationPoint[]
  stageASoluteCount: number
  stageATemperatureK: number
  stageBTemperatureK: number
  temperaturesK: number[]
  selectedChampion: Decision | null
  selectedOptimum: Decision | null
  protocol: Protocol
  runNaming: RunNaming
  analysisDefaults: {
    integrationMethod: "trapezoidal" | "simpson"
    smoothing: "none" | "moving-average"
    smoothingWindow: number
    rebinFactor: number
    plateauMinWidthNm: number
    plateauMaxAbsSlope: number
    plateauMaxVariance: number
    replicaCvThreshold: number
    ssmMinimumPoints: number
    matrixConditionLimit: number
    bootstrapSamples: number
    bootstrapSeed: number
    gammaInterpolation: "linear" | "monotone-cubic"
  }
  overrideLog: Array<{ timestamp: string; action: string; note: string }>
}

export type RunRecord = {
  runId: string
  stage: string
  desId: string
  desName: string
  desAbbreviation: string
  components: Array<{ moleculeId: string; name: string; count: number | null; molecularWeight: number | null }>
  soluteId: string
  soluteName: string
  soluteAbbreviation: string
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
  chargeScheme: string
  productionNs: number
  status: "planned"
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
  actualDesRatio: number[]
  molecularWeightsUsed: Record<string, number>
  multiplier: number | null
  totalMassG: number | null
  desOnlyMassG: number | null
  estimatedDensityGcm3: number | null
  desOnlyDensityGcm3: number | null
  densityDeviationPct: number | null
  moleFractions: Record<string, number>
  desNormalizedMoleFractions: Record<string, number>
  massFractions: Record<string, number>
  numberDensitiesNm3: Record<string, number>
  totalNumberDensityNm3: number
  diagnostics: CompositionDiagnostic[]
}

export type RDFDataset = {
  id: string
  sourceFilename: string
  sourceFormat: "xvg" | "csv"
  radiusRaw: number[]
  radiusNm: number[]
  g: number[]
  comments: string[]
  legend: string
  xLabel: string
  yLabel: string
  metadata: {
    runId: string
    desId: string
    concentrationId: string
    speciesA: string
    speciesB: string
    temperatureK: number | null
    pressureBar: number | null
    soluteCount: number | null
    composition: string
    boxDimensionsNm: string
    replica: number | null
    trajectoryStartNs: number | null
    trajectoryEndNs: number | null
    simulationDurationNs: number | null
    distanceUnit: "nm" | "angstrom" | ""
    forceField: string
    chargeModel: string
    rdfSettings: string
    softwareVersion: string
    notes: string
  }
  analysis?: KBIAnalysis
}

export type KBIAnalysis = {
  rawRunningKbiNm3: number[]
  radiusNm: number[]
  runningKbiNm3: number[]
  processedG: number[]
  plateauStartNm: number
  plateauEndNm: number
  estimateNm3: number
  plateauMedianNm3: number
  plateauSdNm3: number
  plateauSampleCount: number
  plateauWidthNm: number
  plateauLocalVariation: number
  plateauSlope: number
  plateauVariance: number
  plateauStatus: "candidate" | "accepted" | "rejected" | "manual" | "unstable"
  integrationMethod: "trapezoidal" | "simpson"
  smoothing: string
  smoothingWindow: number
  rebinFactor: number
  analyzedAt: string
}

export type SSMPoint = {
  id: string
  stateKey: string
  desId: string
  soluteId: string
  speciesA: string
  speciesB: string
  temperatureK: number
  soluteCount: number
  effectiveLengthNm: number
  finiteKbiNm3: number
  uncertaintyNm3: number | null
  replica: number | null
  source: string
  accepted: boolean
}

export type SSMFit = {
  id: string
  stateKey: string
  pairKey: string
  representation: "g-vs-inverse-l" | "lg-vs-l"
  pointIds: string[]
  gInfinityNm3: number
  fInfinityNm4: number
  gInfinitySe: number
  fInfinitySe: number
  gInfinityCi95: [number, number]
  fInfinityCi95: [number, number]
  r2: number
  residuals: number[]
  leverage: number[]
  accepted: boolean
  createdAt: string
}

export type ThermodynamicResult = {
  id: string
  stateKey: string
  desId: string
  soluteId: string
  concentrationId: string
  species: string[]
  moleculeCounts: number[]
  moleFractions: number[]
  numberDensitiesNm3: number[]
  kbiMatrixNm3: number[][]
  kbiUncertaintyNm3: number[][]
  transformedB: number[][]
  inverseB: number[][]
  determinantB: number
  conditionNumber: number
  gammaMatrix: number[][]
  fixedDesRatioSoluteGamma: number
  uncertainty?: { sd: number; ci95: [number, number]; validSamples: number; requestedSamples: number }
  sourceTermIds: string[]
  createdAt: string
}

export type ActivityResult = {
  id: string
  desId: string
  soluteId: string
  temperatureK: number
  interpolation: "linear" | "monotone-cubic"
  points: Array<{ x: number; thermodynamicFactor: number; lnGammaRelative: number; gammaRelative: number; gammaAbsolute: number | null }>
  anchor: { type: "none" | "composition" | "infinite-dilution"; x: number | null; gamma: number | null }
  infiniteDilution?: { model: "linear" | "quadratic"; gammaInfinity: number; lnGammaInfinity: number; r2: number; ci95: [number, number]; maxX: number; sensitivity: number | null }
  createdAt: string
}

export type CosmoRecord = {
  id: string
  des: string
  hba: string
  hbd: string
  ratio: string
  solute: string
  temperatureK: number | null
  composition: number | null
  gamma: number | null
  gammaInfinity: number | null
  metrics: Record<string, string | number | null>
  sourceFilename: string
}

export type ObservableRecord = {
  id: string
  runId: string
  desId: string
  soluteId: string
  temperatureK: number | null
  soluteCount: number | null
  type: "coordination" | "hbond_count" | "hbond_lifetime" | "diffusion" | "density" | "viscosity" | "aggregation" | "custom"
  value: number
  uncertainty: number | null
  unit: string
  sourceFilename: string
  notes: string
}

export type ValidationResult = {
  id: string
  name: string
  passed: boolean
  tolerance: number
  expected: number | string
  calculated: number | string
  absoluteError: number | null
  relativeError: number | null
  detail: string
  runAt: string
}

export type ScientificState = {
  schemaVersion: "0.2"
  ssmPoints: SSMPoint[]
  ssmFits: SSMFit[]
  thermodynamicResults: ThermodynamicResult[]
  activityResults: ActivityResult[]
  cosmoRecords: CosmoRecord[]
  observables: ObservableRecord[]
  validationResults: ValidationResult[]
  matrixOverrides: Array<{ stateKey: string; reason: string; timestamp: string }>
  convergenceDecisions: Array<{ stateKey: string; classification: "not-converged" | "possibly-converged" | "converged-accepted"; rationale: string; timestamp: string }>
  commandProvenance: Array<{ type: "ssm" | "gromacs"; settings: Record<string, unknown>; timestamp: string }>
}
