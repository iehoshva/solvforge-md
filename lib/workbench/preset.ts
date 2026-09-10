import { uuid } from "./crypto.ts"
import type { BoxCompositionSettings, DESSystem, Molecule, ProjectState, Protocol } from "./types"
import { SOFTWARE_VERSION, SCHEMA_VERSION } from "./version.ts"

const now = () => new Date().toISOString()
const uid = (prefix: string) => `${prefix}-${uuid()}`
export const defaultCompositionSettings = (): BoxCompositionSettings => ({ mode: "density", soluteMassMode: "include-in-target", lockAcrossSeries: false, lockReferenceSoluteCount: 1, densityResolution: "exact-only", densityInputUnit: "g/cm3", densityPoints: [], molecularWeightOverrides: {}, selectedMultipliers: {}, candidateSpan: 3, deviationWarningPct: 2 })

export const thesisMolecules: Molecule[] = [
  { id: "geranyl-acetate", fullName: "Geranyl acetate", abbreviation: "GA", role: "solute", formula: "C12H20O2", molecularWeight: 196.29, charge: 0, moleculeCount: null, topologyFile: "geranyl_acetate.itp", coordinateFile: "geranyl_acetate.gro", residueName: "GAC", notes: "Primary target" },
  { id: "geraniol", fullName: "Geraniol", abbreviation: "GER", role: "solute", formula: "C10H18O", molecularWeight: 154.25, charge: 0, moleculeCount: null, topologyFile: "geraniol.itp", coordinateFile: "geraniol.gro", residueName: "GER", notes: "Polar protic comparison" },
  { id: "limonene", fullName: "Limonene", abbreviation: "LIM", role: "solute", formula: "C10H16", molecularWeight: 136.24, charge: 0, moleculeCount: null, topologyFile: "limonene.itp", coordinateFile: "limonene.gro", residueName: "LIM", notes: "Nonpolar comparison" },
  { id: "thymol", fullName: "Thymol", abbreviation: "THY", role: "HBA", formula: "C10H14O", molecularWeight: 150.22, charge: 0, moleculeCount: null, topologyFile: "thymol.itp", coordinateFile: "thymol.gro", residueName: "THY", notes: "DES component" },
  { id: "dodecanol", fullName: "Dodecanol", abbreviation: "DOD", role: "HBD", formula: "C12H26O", molecularWeight: 186.34, charge: 0, moleculeCount: null, topologyFile: "dodecanol.itp", coordinateFile: "dodecanol.gro", residueName: "DOD", notes: "DES component" },
  { id: "butanediol-23", fullName: "2,3-Butanediol", abbreviation: "23BD", role: "HBD", formula: "C4H10O2", molecularWeight: 90.12, charge: 0, moleculeCount: null, topologyFile: "23_butanediol.itp", coordinateFile: "23_butanediol.gro", residueName: "B23", notes: "DES component" },
  { id: "lauric-acid", fullName: "Lauric acid", abbreviation: "LAU", role: "HBD", formula: "C12H24O2", molecularWeight: 200.32, charge: 0, moleculeCount: null, topologyFile: "lauric_acid.itp", coordinateFile: "lauric_acid.gro", residueName: "LAU", notes: "DES component" },
  { id: "octanoic-acid", fullName: "Octanoic acid", abbreviation: "OCT", role: "HBD", formula: "C8H16O2", molecularWeight: 144.21, charge: 0, moleculeCount: null, topologyFile: "octanoic_acid.itp", coordinateFile: "octanoic_acid.gro", residueName: "OCT", notes: "DES component" },
]

export const thesisDesSystems: DESSystem[] = [
  { id: "thy-dod", name: "Thymol:Dodecanol", abbreviation: "THY-DOD", componentIds: ["thymol", "dodecanol"], ratio: [5, 1], boxCounts: [null, null], compositionSettings: defaultCompositionSettings(), notes: "Component counts are calculated from box size, target density, molecular weights, and the selected composition method." },
  { id: "thy-23bd", name: "Thymol:2,3-butanediol", abbreviation: "THY-23BD", componentIds: ["thymol", "butanediol-23"], ratio: [5, 1], boxCounts: [null, null], compositionSettings: defaultCompositionSettings(), notes: "Component counts are calculated from box size, target density, molecular weights, and the selected composition method." },
  { id: "thy-lau", name: "Thymol:Lauric acid", abbreviation: "THY-LAU", componentIds: ["thymol", "lauric-acid"], ratio: [5, 1], boxCounts: [null, null], compositionSettings: defaultCompositionSettings(), notes: "Component counts are calculated from box size, target density, molecular weights, and the selected composition method." },
  { id: "thy-oct", name: "Thymol:Octanoic acid", abbreviation: "THY-OCT", componentIds: ["thymol", "octanoic-acid"], ratio: [5, 1], boxCounts: [null, null], compositionSettings: defaultCompositionSettings(), notes: "Component counts are calculated from box size, target density, molecular weights, and the selected composition method." },
]

export const thesisProtocol: Protocol = {
  name: "Andaliman Thesis MD Protocol",
  forceField: "OPLS-AA",
  chargeScheme: "Mulliken-derived charges from ORCA BP86/def2-TZVP",
  pressureBar: 1,
  box: { x: 5, y: 5, z: 5, geometry: "cubic", unit: "nm" },
  replicas: 1,
  randomSeedBase: 42001,
  em: { method: "steep", maxSteps: 50000, fmax: 1000 },
  nvt: { durationNs: 5, thermostat: "V-rescale", tauTPs: 0.1, timestepFs: 1 },
  npt: { durationNs: 10, barostat: "Parrinello-Rahman", tauPPs: 2, timestepFs: 2, compressibilityBarInverse: null },
  production: { pureDes: { enabled: false, durationNs: 100 }, solute: { mode: "convergence-controlled", initialNs: 100, maximumNs: 200, extensionNs: 20 }, framePs: 20, timestepFs: 2 },
  nonbonded: { cutoffNm: 1.2, coulombMethod: "PME", pmeOrder: 4, fourierSpacingNm: 0.12 },
  constraints: "h-bonds",
  constraintAlgorithm: "lincs",
  equilibrationNotes: "Verify equilibration for each molecular system.",
  productionNotes: "Production duration is a plan; extend based on convergence evidence.",
  mdpOverrides: { em: "", nvt: "", npt: "", prod: "" },
}

export function createThesisProject(): ProjectState {
  return {
    schemaVersion: SCHEMA_VERSION,
    softwareVersion: SOFTWARE_VERSION,
    createdWithVersion: SOFTWARE_VERSION,
    originalSchemaVersion: SCHEMA_VERSION,
    lastOpenedWithVersion: SOFTWARE_VERSION,
    currentSchemaVersion: SCHEMA_VERSION,
    migrationHistory: [],
    projectId: uid("project"),
    projectName: "Andaliman Selective Solvation MD/KBI",
    projectAbbreviation: "AND",
    description: "Hierarchical MD validation of COSMO-RS-screened DES candidates for selective solvation of geranyl acetate.",
    presetName: "Andaliman Thesis MD/KBI",
    mode: "thesis",
    researchObjective: "Compare four DES candidates, select one champion using explicit evidence, optimize solute loading, then characterize temperature dependence.",
    notes: "Built-in preset. All values remain editable.",
    defaultUnits: { distance: "nm", temperature: "K", pressure: "bar", time: "ns" },
    createdAt: now(),
    molecules: structuredClone(thesisMolecules),
    desSystems: structuredClone(thesisDesSystems),
    soluteIds: ["geranyl-acetate", "geraniol", "limonene"],
    concentrations: [1, 2, 3, 6, 12, 18, 24].map((n) => ({ id: `n-${n}`, label: `${n} molecule${n === 1 ? "" : "s"} per box`, soluteCount: n })),
    stageASoluteCount: 1,
    stageATemperatureK: 323.15,
    stageBTemperatureK: 323.15,
    temperaturesK: [298.15, 303.15, 313.15, 323.15, 333.15],
    selectedChampion: null,
    selectedOptimum: null,
    protocol: structuredClone(thesisProtocol),
    runNaming: { includeProject: false, includeStage: false, includePressure: false, includeBox: false, includeConcentration: true, includeTemperature: true, includeReplica: true },
    analysisDefaults: { integrationMethod: "trapezoidal", smoothing: "none", smoothingWindow: 5, rebinFactor: 1, plateauMinWidthNm: 0.5, plateauMaxAbsSlope: 0.1, plateauMaxVariance: 0.05, replicaCvThreshold: 0.15, ssmMinimumPoints: 3, matrixConditionLimit: 1e8, bootstrapSamples: 1000, bootstrapSeed: 2026, gammaInterpolation: "linear" },
    overrideLog: [],
  }
}

export function createCustomProject(): ProjectState {
  const p = createThesisProject()
  return {
    ...p,
    projectId: uid("project"),
    projectName: "Untitled molecular simulation project",
    projectAbbreviation: "SIM",
    description: "",
    presetName: "Custom",
    mode: "custom",
    researchObjective: "",
    notes: "",
    molecules: [],
    desSystems: [],
    soluteIds: [],
    concentrations: [{ id: "n-1", label: "1 molecule per box", soluteCount: 1 }],
    temperaturesK: [298.15],
  }
}

export function migrateProject(input: ProjectState): ProjectState {
  if (!input || !input.projectId || !Array.isArray(input.molecules) || !Array.isArray(input.desSystems)) throw new Error("Invalid project manifest: projectId, molecules and DES systems are required.")
  const defaults = createThesisProject()
  const oldProduction = input.protocol?.production as Protocol["production"] & { pureDesNs?: number; soluteMinNs?: number; soluteMaxNs?: number; exactOrRange?: string }
  const migrated = input.currentSchemaVersion !== SCHEMA_VERSION
  return {
    ...defaults,
    ...input,
    schemaVersion: SCHEMA_VERSION,
    softwareVersion: input.softwareVersion ?? "unknown",
    createdWithVersion: input.createdWithVersion ?? input.softwareVersion ?? "unknown",
    originalSchemaVersion: input.originalSchemaVersion ?? input.schemaVersion ?? "unknown",
    lastOpenedWithVersion: SOFTWARE_VERSION,
    currentSchemaVersion: SCHEMA_VERSION,
    migrationHistory: [...(input.migrationHistory ?? []), ...(migrated ? [{ from: input.currentSchemaVersion ?? input.schemaVersion ?? "unknown", to: SCHEMA_VERSION, at: now(), softwareVersion: SOFTWARE_VERSION, note: "Design defaults migrated. Historical evidence requires explicit project/state resolution; no missing scientific identity inferred." }] : [])],
    defaultUnits: { ...defaults.defaultUnits },
    runNaming: { ...defaults.runNaming, ...input.runNaming },
    analysisDefaults: { ...defaults.analysisDefaults, ...input.analysisDefaults },
    desSystems: (input.desSystems ?? defaults.desSystems).map((system) => ({ ...system, compositionSettings: { ...defaultCompositionSettings(), ...system.compositionSettings, densityPoints: system.compositionSettings?.densityPoints ?? [], molecularWeightOverrides: system.compositionSettings?.molecularWeightOverrides ?? {}, selectedMultipliers: system.compositionSettings?.selectedMultipliers ?? {} } })),
    protocol: {
      ...defaults.protocol,
      ...input.protocol,
      box: { ...defaults.protocol.box, ...input.protocol?.box },
      em: { ...defaults.protocol.em, ...input.protocol?.em, method: String(input.protocol?.em?.method) === "steepest descent" ? "steep" : input.protocol?.em?.method ?? "steep" },
      nvt: { ...defaults.protocol.nvt, ...input.protocol?.nvt },
      npt: { ...defaults.protocol.npt, ...input.protocol?.npt },
      production: { framePs: oldProduction?.framePs ?? 20, timestepFs: oldProduction?.timestepFs ?? 2, pureDes: oldProduction?.pureDes ?? { enabled: false, durationNs: oldProduction?.pureDesNs ?? 100 }, solute: oldProduction?.solute ?? { mode: oldProduction?.exactOrRange === "exact" ? "fixed" : "convergence-controlled", initialNs: oldProduction?.soluteMinNs ?? 100, maximumNs: oldProduction?.soluteMaxNs ?? 200, extensionNs: 20 } },
      constraints: String(input.protocol?.constraints) === "LINCS / appropriate constraints" ? "h-bonds" : input.protocol?.constraints ?? "h-bonds",
      nonbonded: { ...defaults.protocol.nonbonded, ...input.protocol?.nonbonded },
      mdpOverrides: { ...defaults.protocol.mdpOverrides!, ...input.protocol?.mdpOverrides },
    },
  }
}

export const newId = uid
