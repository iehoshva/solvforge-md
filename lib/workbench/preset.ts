import { uuid } from "./crypto.ts"
import type { BoxCompositionSettings, MolecularSystem, Molecule, ProjectState, Protocol } from "./types"
import { SOFTWARE_VERSION, SCHEMA_VERSION } from "./version.ts"

const now = () => new Date().toISOString()
const uid = (prefix: string) => `${prefix}-${uuid()}`

export const defaultCompositionSettings = (): BoxCompositionSettings => ({
  mode: "manual",
  soluteMassMode: "include-in-target",
  lockAcrossSeries: false,
  lockReferenceSoluteCount: 1,
  densityResolution: "exact-only",
  densityInputUnit: "g/cm3",
  densityPoints: [],
  molecularWeightOverrides: {},
  selectedMultipliers: {},
  candidateSpan: 3,
  deviationWarningPct: 2,
})

export const defaultProtocol = (): Protocol => ({
  name: "General GROMACS MD Protocol",
  forceField: "OPLS-AA",
  forceFieldInclude: "oplsaa.ff/forcefield.itp",
  defaultsSection: "",
  chargeScheme: "QM-derived partial charges (user-selected)",
  qmSoftware: "Auto-detect (ORCA / Gaussian / xTB / Multiwfn / CSV)",
  qmMethodBasis: "",
  pressureBar: 1,
  box: { x: 5, y: 5, z: 5, geometry: "cubic", unit: "nm" },
  replicas: 1,
  randomSeedBase: 42001,
  enabledStages: { em: true, nvt: true, npt: true, prod: true },
  em: { method: "steep", maxSteps: 50000, fmax: 1000, emstep: 0.01 },
  nvt: { durationNs: 1, thermostat: "V-rescale", tcGrps: "System", tauTPs: 0.1, timestepFs: 1 },
  npt: {
    durationNs: 5,
    barostat: "C-rescale",
    pcoupltype: "isotropic",
    tauPPs: 2,
    timestepFs: 2,
    compressibility: "4.5e-5",
  },
  production: {
    ensemble: "NPT",
    mode: "fixed",
    initialNs: 50,
    maximumNs: 100,
    extensionNs: 20,
    framePs: 10,
    energyPs: 10,
    timestepFs: 2,
  },
  nonbonded: {
    cutoffScheme: "Verlet",
    coulombMethod: "PME",
    vdwType: "Cut-off",
    vdwModifier: "Potential-shift-Verlet",
    dispCorr: "EnerPres",
    rcoulombNm: 1.2,
    rvdwNm: 1.2,
    pmeOrder: 4,
    fourierSpacingNm: 0.12,
  },
  constraints: "h-bonds",
  constraintAlgorithm: "lincs",
  equilibrationNotes: "Inspect potential energy, temperature, and density convergence before production.",
  productionNotes: "Export Run Input Package for external GROMACS execution and downstream analysis (e.g. MoDy Analyse).",
  mdpOverrides: { em: "", nvt: "", npt: "", prod: "" },
})

export function createBlankProject(): ProjectState {
  return {
    schemaVersion: SCHEMA_VERSION,
    softwareVersion: SOFTWARE_VERSION,
    createdWithVersion: SOFTWARE_VERSION,
    originalSchemaVersion: SCHEMA_VERSION,
    lastOpenedWithVersion: SOFTWARE_VERSION,
    currentSchemaVersion: SCHEMA_VERSION,
    migrationHistory: [],
    projectId: uid("project"),
    projectName: "Untitled QM → GROMACS Project",
    projectAbbreviation: "SIM",
    description: "General-purpose QM-to-GROMACS topology, packing, and run-input preparation workspace.",
    presetName: "Blank Project",
    researchObjective: "",
    notes: "All force fields, QM methods/basis sets, charge schemes, and GROMACS MDP parameters are fully editable.",
    defaultUnits: { distance: "nm", temperature: "K", pressure: "bar", time: "ns" },
    createdAt: now(),
    molecules: [],
    systems: [],
    soluteIds: [],
    runDesign: {
      systemIds: [],
      includeNeatSystems: true,
      soluteIds: [],
      soluteCounts: "1",
      temperaturesK: "298.15",
      pressuresBar: "1",
      boxSizesNm: "5",
      useProtocolBox: true,
      replicas: 1,
    },
    protocol: defaultProtocol(),
    runNaming: {
      includeProject: false,
      includePressure: false,
      includeBox: false,
      includeConcentration: true,
      includeTemperature: true,
      includeReplica: true,
    },
    overrideLog: [],
  }
}

export function createExampleSolutionProject(): ProjectState {
  const base = createBlankProject()
  const molecules: Molecule[] = [
    {
      id: "water",
      fullName: "Water",
      abbreviation: "WAT",
      role: "solvent",
      formula: "H2O",
      molecularWeight: 18.015,
      charge: 0,
      moleculeCount: null,
      topologyFile: "water.itp",
      coordinateFile: "water.gro",
      residueName: "SOL",
      notes: "Solvent component",
    },
    {
      id: "ethanol",
      fullName: "Ethanol",
      abbreviation: "ETH",
      role: "co-solvent",
      formula: "C2H6O",
      molecularWeight: 46.069,
      charge: 0,
      moleculeCount: null,
      topologyFile: "ethanol.itp",
      coordinateFile: "ethanol.gro",
      residueName: "ETH",
      notes: "Organic solvent / co-solvent",
    },
    {
      id: "caffeine",
      fullName: "Caffeine",
      abbreviation: "CAF",
      role: "solute",
      formula: "C8H10N4O2",
      molecularWeight: 194.19,
      charge: 0,
      moleculeCount: null,
      topologyFile: "caffeine.itp",
      coordinateFile: "caffeine.gro",
      residueName: "CAF",
      notes: "Example solute",
    },
  ]
  const systems: MolecularSystem[] = [
    {
      id: "eth-wat",
      name: "Ethanol:Water (1:4)",
      abbreviation: "ETH-WAT",
      componentIds: ["ethanol", "water"],
      ratio: [1, 4],
      boxCounts: [100, 400],
      compositionSettings: { ...defaultCompositionSettings(), mode: "manual" },
      notes: "Editable example binary solvent system; switch to density mode or edit counts freely.",
    },
  ]
  return {
    ...base,
    projectName: "Example Binary Solution (QM → GROMACS)",
    projectAbbreviation: "EX",
    presetName: "Example Solution",
    description: "Starter template demonstrating multi-component packing and QM-to-GROMACS topology preparation.",
    molecules,
    systems,
    soluteIds: ["caffeine"],
    runDesign: {
      ...base.runDesign,
      systemIds: ["eth-wat"],
      includeNeatSystems: true,
      soluteIds: ["caffeine"],
      soluteCounts: "1, 5",
      temperaturesK: "298.15",
      pressuresBar: "1",
      boxSizesNm: "4.5",
      useProtocolBox: true,
      replicas: 1,
    },
  }
}

export function createSelfContainedGaffProject(): ProjectState {
  const base = createBlankProject()
  const protocol = defaultProtocol()
  protocol.name = "GAFF2 / Self-Contained Topology Protocol"
  protocol.forceField = "GAFF2 (self-contained)"
  protocol.forceFieldInclude = ""
  protocol.defaultsSection = "1 2 yes 0.5 0.83333333"
  protocol.chargeScheme = "RESP / CHELPG (self-contained)"
  protocol.nonbonded.rcoulombNm = 1.0
  protocol.nonbonded.rvdwNm = 1.0
  return {
    ...base,
    projectName: "Self-Contained GAFF2 / ACPYPE Project",
    projectAbbreviation: "GAFF",
    presetName: "Self-Contained GAFF2",
    description: "No external forcefield.itp include required — hoists [ defaults ] and [ atomtypes ] from imported molecule topologies.",
    protocol,
  }
}

// Legacy input shape from SolvForge 1.0.x (schema 2.0)
type LegacyProjectLike = Partial<ProjectState> & {
  desSystems?: MolecularSystem[]
  protocol?: Partial<Protocol> & {
    npt?: Partial<Protocol["npt"]> & { compressibilityBarInverse?: number | null }
    nonbonded?: Partial<Protocol["nonbonded"]> & { cutoffNm?: number }
    production?: Partial<Protocol["production"]> & {
      solute?: { mode?: "fixed" | "convergence-controlled"; initialNs?: number; maximumNs?: number; extensionNs?: number }
      pureDes?: { enabled?: boolean; durationNs?: number }
    }
  }
}

export function migrateProject(input: LegacyProjectLike): ProjectState {
  if (!input || !input.projectId || !Array.isArray(input.molecules)) {
    throw new Error("Invalid project manifest: projectId and molecules are required.")
  }
  const defaults = createBlankProject()
  const rawSystems = Array.isArray(input.systems)
    ? input.systems
    : Array.isArray(input.desSystems)
      ? input.desSystems
      : []
  const legacyProto = input.protocol
  const legacyComp = legacyProto?.npt?.compressibilityBarInverse
  const migratedCompressibility =
    legacyProto?.npt?.compressibility ??
    (legacyComp !== undefined && legacyComp !== null && Number.isFinite(legacyComp) ? String(legacyComp) : defaults.protocol.npt.compressibility)
  const legacyCutoff = legacyProto?.nonbonded?.cutoffNm
  const migratedProd = {
    ...defaults.protocol.production,
    ...legacyProto?.production,
    mode: legacyProto?.production?.mode ?? legacyProto?.production?.solute?.mode ?? defaults.protocol.production.mode,
    initialNs: legacyProto?.production?.initialNs ?? legacyProto?.production?.solute?.initialNs ?? defaults.protocol.production.initialNs,
    maximumNs: legacyProto?.production?.maximumNs ?? legacyProto?.production?.solute?.maximumNs ?? defaults.protocol.production.maximumNs,
    extensionNs: legacyProto?.production?.extensionNs ?? legacyProto?.production?.solute?.extensionNs ?? defaults.protocol.production.extensionNs,
  }

  const migrated = input.currentSchemaVersion !== SCHEMA_VERSION
  const systems: MolecularSystem[] = rawSystems.map((system) => ({
    ...system,
    compositionSettings: {
      ...defaultCompositionSettings(),
      ...system.compositionSettings,
      densityPoints: system.compositionSettings?.densityPoints ?? [],
      molecularWeightOverrides: system.compositionSettings?.molecularWeightOverrides ?? {},
      selectedMultipliers: system.compositionSettings?.selectedMultipliers ?? {},
    },
  }))

  const forceField = legacyProto?.forceField ?? defaults.protocol.forceField
  const forceFieldInclude =
    legacyProto?.forceFieldInclude !== undefined
      ? legacyProto.forceFieldInclude
      : forceField.toLowerCase().includes("opls")
        ? "oplsaa.ff/forcefield.itp"
        : ""

  const rawRunDesign = input.runDesign as Partial<ProjectState["runDesign"]> & { custom?: Record<string, unknown> } | undefined
  const runDesign: ProjectState["runDesign"] = {
    ...defaults.runDesign,
    ...(rawRunDesign && "systemIds" in rawRunDesign ? rawRunDesign : {}),
    systemIds:
      rawRunDesign?.systemIds ??
      (Array.isArray(rawRunDesign?.custom?.desIds) ? (rawRunDesign.custom.desIds as string[]) : systems.slice(0, 1).map((s) => s.id)),
    soluteIds:
      rawRunDesign?.soluteIds ??
      (Array.isArray(rawRunDesign?.custom?.soluteIds) ? (rawRunDesign.custom.soluteIds as string[]) : (input.soluteIds ?? []).slice(0, 1)),
  }

  return {
    ...defaults,
    projectId: input.projectId,
    projectName: input.projectName ?? defaults.projectName,
    projectAbbreviation: input.projectAbbreviation ?? defaults.projectAbbreviation,
    description: input.description ?? "",
    presetName: input.presetName ?? "Custom",
    researchObjective: input.researchObjective ?? "",
    notes: input.notes ?? "",
    createdAt: input.createdAt ?? now(),
    schemaVersion: SCHEMA_VERSION,
    softwareVersion: input.softwareVersion ?? SOFTWARE_VERSION,
    createdWithVersion: input.createdWithVersion ?? input.softwareVersion ?? "unknown",
    originalSchemaVersion: input.originalSchemaVersion ?? input.schemaVersion ?? "unknown",
    lastOpenedWithVersion: SOFTWARE_VERSION,
    currentSchemaVersion: SCHEMA_VERSION,
    migrationHistory: [
      ...(input.migrationHistory ?? []),
      ...(migrated
        ? [
            {
              from: input.currentSchemaVersion ?? input.schemaVersion ?? "unknown",
              to: SCHEMA_VERSION,
              at: now(),
              softwareVersion: SOFTWARE_VERSION,
              note: "Migrated to SolvForge MD 2.0 (general QM-to-GROMACS bridge schema 3.0).",
            },
          ]
        : []),
    ],
    defaultUnits: { ...defaults.defaultUnits, ...input.defaultUnits },
    molecules: input.molecules.map((m) => ({
      ...m,
      role: (m.role as string) === "solvent component" ? "solvent" : (m.role ?? "custom"),
    })),
    systems,
    soluteIds: input.soluteIds ?? [],
    runDesign,
    runNaming: { ...defaults.runNaming, ...input.runNaming },
    overrideLog: input.overrideLog ?? [],
    protocol: {
      ...defaults.protocol,
      ...legacyProto,
      forceField,
      forceFieldInclude,
      defaultsSection: legacyProto?.defaultsSection ?? defaults.protocol.defaultsSection,
      box: { ...defaults.protocol.box, ...legacyProto?.box },
      enabledStages: { ...defaults.protocol.enabledStages, ...legacyProto?.enabledStages },
      em: {
        ...defaults.protocol.em,
        ...legacyProto?.em,
        method: String(legacyProto?.em?.method) === "steepest descent" ? "steep" : legacyProto?.em?.method ?? "steep",
      },
      nvt: { ...defaults.protocol.nvt, ...legacyProto?.nvt },
      npt: { ...defaults.protocol.npt, ...legacyProto?.npt, compressibility: migratedCompressibility },
      production: migratedProd,
      nonbonded: {
        ...defaults.protocol.nonbonded,
        ...legacyProto?.nonbonded,
        rcoulombNm: legacyProto?.nonbonded?.rcoulombNm ?? legacyCutoff ?? defaults.protocol.nonbonded.rcoulombNm,
        rvdwNm: legacyProto?.nonbonded?.rvdwNm ?? legacyCutoff ?? defaults.protocol.nonbonded.rvdwNm,
      },
      constraints:
        String(legacyProto?.constraints) === "LINCS / appropriate constraints"
          ? "h-bonds"
          : legacyProto?.constraints ?? "h-bonds",
      constraintAlgorithm: legacyProto?.constraintAlgorithm ?? "lincs",
      mdpOverrides: { ...defaults.protocol.mdpOverrides, ...legacyProto?.mdpOverrides },
    },
  }
}

export const newId = uid
