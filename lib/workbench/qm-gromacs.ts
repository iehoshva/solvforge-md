import type { Molecule, RunRecord } from "./types"
import { canonical, sha256 as sourceSha256 } from "./identity.ts"
import { COVALENT_RADIUS, ELEMENT_MASS, normalizeElement } from "./elements.ts"
import {
  parseGeometryFile,
  parseQmOutput,
  type CoordinateAtom,
  type ParsedQmOutput,
  type QmChargeEntry,
  type QmSoftware,
} from "./qm-parser.ts"

export type { CoordinateAtom, QmChargeEntry, QmSoftware, ParsedQmOutput }

export type PrepSeverity = "ERROR" | "WARNING" | "INFO"
export type PrepDiagnostic = { severity: PrepSeverity; code: string; message: string }
export type StepStatus =
  | "PASS"
  | "WARNING"
  | "FAIL"
  | "WAITING"
  | "NOT RUN"
  | "RESEARCHER ACCEPTED"
  | "AUTOMATICALLY VERIFIED"

export type SourceFileRecord = {
  name: string
  text: string
  size: number
  lastModified: number
  sha256: string
  importedAt: string
}

export type ChargeMode = "qm" | "topology" | "manual"
export type NeutralizationPolicy = "none" | "uniform-residual" | "heavy-atoms-residual" | "largest-abs-atom"
export type TopologyHelperTool = "acpype" | "x2top" | "antechamber" | "sobtop" | "ligpargen" | "cgenff"

export type PreparedAtom = CoordinateAtom & {
  outIndex: number
  outElement: string | null
  gromacsName: string
  residueName: string
  rawQmCharge: number | null
  existingTopologyCharge: number | null
  manualCharge: number | null
  finalCharge: number | null
  atomType: string
  mass: number | null
  ljSource: string
  mappingStatus: "AUTO-MAPPED" | "REVIEW REQUIRED" | "UNMAPPED" | "USER-OVERRIDDEN"
}

export type BondRecord = {
  id: string
  ai: number
  aj: number
  elementI: string
  elementJ: string
  distanceAngstrom: number
  definition?: string
  proposed: boolean
  accepted: boolean
  source: "covalent-radius" | "user" | "topology-import" | "geometry-import"
}

export type TopologySection = { name: string; lines: string[] }

const PARAMETER_SECTIONS = new Set([
  "atomtypes",
  "bondtypes",
  "pairtypes",
  "angletypes",
  "dihedraltypes",
  "constrainttypes",
  "nonbond_params",
  "cmaptypes",
  "implicit_genborn_params",
])

export type QmMetadata = {
  software: QmSoftware | "none"
  inputLine: string
  method: string
  basis: string
  parsedTotalCharge: number | null
  multiplicity: number | null
  terminatedNormally: boolean | null
  availableSchemes: string[]
}

export type MoleculePreparation = {
  moleculeId: string
  residueName: string
  expectedFormalCharge: number
  chargeTolerance: number
  chargeMode: ChargeMode
  selectedChargeScheme: string
  chargeScaleFactor: number
  neutralizationPolicy: NeutralizationPolicy
  chargeAcknowledged: boolean
  geometryAcknowledged: boolean
  geometryFile: SourceFileRecord | null
  qmFile: SourceFileRecord | null
  geometryComment: string
  geometryAtoms: CoordinateAtom[]
  qmCoordinates: CoordinateAtom[]
  qmChargeSets: Record<string, QmChargeEntry[]>
  atoms: PreparedAtom[]
  bonds: BondRecord[]
  connectivityApproved: boolean
  coordinateSettings: { center: boolean; translateAngstrom: { x: number; y: number; z: number } }
  qmMetadata: QmMetadata
  topologyHelperTool: TopologyHelperTool
  originalTopologyFile?: SourceFileRecord
  topologyFileName: string
  topologyText: string
  topologySections: TopologySection[]
  topologyReviewed: boolean
  gromppValidated: boolean
  notes: string
  updatedAt: string
}

export type PackedPdbAtom = {
  serial: number
  atomName: string
  residueName: string
  residueNumber: number
  xAngstrom: number
  yAngstrom: number
  zAngstrom: number
  element: string
}

export type PackedSystemRecord = {
  runId: string
  sourceFile: SourceFileRecord
  atoms: PackedPdbAtom[]
  cryst1Angstrom: { x: number; y: number; z: number } | null
  importedAt: string
}

export type ExecutionStatus = {
  history?: Array<{
    id: string
    projectId: string
    stage: string
    classification: string
    rationale: string
    timestamp: string
    softwareVersion: string
    actor: "researcher"
  }>
  em: "not-run" | "failed" | "accepted"
  nvt: "not-run" | "failed" | "accepted"
  npt: "not-run" | "failed" | "accepted"
  production: "not-run" | "failed" | "accepted"
}

export type QmGromacsState = {
  projectId?: string
  schemaVersion: "0.2"
  tutorialMode: boolean
  selectedMoleculeId: string
  selectedRunId: string
  molecules: Record<string, MoleculePreparation>
  packedSystems: Record<string, PackedSystemRecord>
  execution: Record<string, ExecutionStatus>
  commandOverrides: Record<string, string>
  packmol: { toleranceAngstrom: number; marginAngstrom: number; periodic: boolean }
  rdf: {
    mode: "center-of-mass" | "atom-based" | "custom"
    binWidthNm: number
    rmaxNm: number
    beginNs: number
    endNs: number
    customSelections: Record<string, string>
    blocks: string
  }
  updatedAt: string
}

export const defaultQmGromacsState = (): QmGromacsState => ({
  schemaVersion: "0.2",
  tutorialMode: true,
  selectedMoleculeId: "",
  selectedRunId: "",
  molecules: {},
  packedSystems: {},
  execution: {},
  commandOverrides: {},
  packmol: { toleranceAngstrom: 2, marginAngstrom: 1, periodic: true },
  rdf: {
    mode: "center-of-mass",
    binWidthNm: 0.002,
    rmaxNm: 2.4,
    beginNs: 0,
    endNs: 50,
    customSelections: {},
    blocks: "0-10, 10-20, 20-30, 30-40, 40-50",
  },
  updatedAt: new Date().toISOString(),
})

type LegacyAtomLike = Partial<PreparedAtom> & { mullikenCharge?: number | null; oplsType?: string }
type LegacyPreparationLike = Omit<Partial<MoleculePreparation>, "atoms"> & {
  xyzFile?: SourceFileRecord | null
  outFile?: SourceFileRecord | null
  xyzComment?: string
  xyzAtoms?: CoordinateAtom[]
  outCoordinates?: CoordinateAtom[]
  outCharges?: Array<{ outIndex: number; element: string; charge: number }>
  orcaMetadata?: { inputLine: string; method: string; basis: string; parsedTotalCharge: number | null; terminatedNormally: boolean }
  atoms?: LegacyAtomLike[]
}

export function migrateMoleculePreparation(raw: LegacyPreparationLike): MoleculePreparation {
  const atoms: PreparedAtom[] = (raw.atoms ?? []).map((a, idx) => ({
    index: a.index ?? idx + 1,
    element: a.element ?? "X",
    x: a.x ?? 0,
    y: a.y ?? 0,
    z: a.z ?? 0,
    outIndex: a.outIndex ?? a.index ?? idx + 1,
    outElement: a.outElement ?? null,
    gromacsName: a.gromacsName ?? `${a.element ?? "X"}${idx + 1}`,
    residueName: a.residueName ?? raw.residueName ?? "MOL",
    rawQmCharge: a.rawQmCharge !== undefined ? a.rawQmCharge : (a.mullikenCharge ?? null),
    existingTopologyCharge: a.existingTopologyCharge ?? null,
    manualCharge: a.manualCharge ?? null,
    finalCharge: a.finalCharge ?? a.rawQmCharge ?? a.mullikenCharge ?? null,
    atomType: a.atomType ?? a.oplsType ?? "",
    mass: a.mass ?? ELEMENT_MASS[a.element ?? ""] ?? null,
    ljSource: a.ljSource ?? "",
    mappingStatus: a.mappingStatus ?? "UNMAPPED",
  }))

  const legacyCharges: Record<string, QmChargeEntry[]> = raw.outCharges?.length ? { Mulliken: raw.outCharges } : {}
  const qmChargeSets: Record<string, QmChargeEntry[]> = raw.qmChargeSets ?? legacyCharges
  const availableSchemes = Object.keys(qmChargeSets)
  const qmMetadata: QmMetadata = raw.qmMetadata ?? {
    software: raw.outFile ? "orca" : "none",
    inputLine: raw.orcaMetadata?.inputLine ?? "",
    method: raw.orcaMetadata?.method ?? "not detected",
    basis: raw.orcaMetadata?.basis ?? "not detected",
    parsedTotalCharge: raw.orcaMetadata?.parsedTotalCharge ?? null,
    multiplicity: null,
    terminatedNormally: raw.orcaMetadata?.terminatedNormally ?? null,
    availableSchemes,
  }

  return {
    moleculeId: raw.moleculeId ?? "",
    residueName: raw.residueName ?? "MOL",
    expectedFormalCharge: raw.expectedFormalCharge ?? 0,
    chargeTolerance: raw.chargeTolerance ?? 1e-4,
    chargeMode: raw.chargeMode ?? (availableSchemes.length || !raw.topologyText ? "qm" : "topology"),
    selectedChargeScheme: raw.selectedChargeScheme ?? availableSchemes[0] ?? "",
    chargeScaleFactor: raw.chargeScaleFactor ?? 1.0,
    neutralizationPolicy: raw.neutralizationPolicy ?? "none",
    chargeAcknowledged: raw.chargeAcknowledged ?? false,
    geometryAcknowledged: raw.geometryAcknowledged ?? false,
    geometryFile: raw.geometryFile ?? raw.xyzFile ?? null,
    qmFile: raw.qmFile ?? raw.outFile ?? null,
    geometryComment: raw.geometryComment ?? raw.xyzComment ?? "",
    geometryAtoms: raw.geometryAtoms ?? raw.xyzAtoms ?? [],
    qmCoordinates: raw.qmCoordinates ?? raw.outCoordinates ?? [],
    qmChargeSets,
    atoms,
    bonds: raw.bonds ?? [],
    connectivityApproved: raw.connectivityApproved ?? false,
    coordinateSettings: raw.coordinateSettings ?? { center: false, translateAngstrom: { x: 0, y: 0, z: 0 } },
    qmMetadata,
    topologyHelperTool: raw.topologyHelperTool ?? "acpype",
    originalTopologyFile: raw.originalTopologyFile,
    topologyFileName: raw.topologyFileName ?? "",
    topologyText: raw.topologyText ?? "",
    topologySections: raw.topologySections ?? [],
    topologyReviewed: raw.topologyReviewed ?? false,
    gromppValidated: raw.gromppValidated ?? false,
    notes: raw.notes ?? "",
    updatedAt: raw.updatedAt ?? new Date().toISOString(),
  }
}

export function migrateQmGromacsState(input?: Partial<QmGromacsState> | null): QmGromacsState {
  const defaults = defaultQmGromacsState()
  if (!input) return defaults
  return {
    ...defaults,
    ...input,
    schemaVersion: "0.2",
    molecules: Object.fromEntries(
      Object.entries(input.molecules ?? {}).map(([id, prep]) => [id, migrateMoleculePreparation(prep as LegacyPreparationLike)]),
    ),
    packedSystems: input.packedSystems ?? {},
    execution: input.execution ?? {},
    commandOverrides: input.commandOverrides ?? {},
    packmol: { ...defaults.packmol, ...input.packmol },
    rdf: { ...defaults.rdf, ...input.rdf, customSelections: input.rdf?.customSelections ?? {} },
  }
}

const finite = (value: number) => Number.isFinite(value)
const slug = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "molecule"
const csvCell = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`
const csv = (rows: unknown[][]) => rows.map((row) => row.map(csvCell).join(",")).join("\n")

export async function sourceFileRecord(file: File): Promise<SourceFileRecord> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes)
  const sha256 = await sourceSha256(text)
  return { name: file.name, text, size: file.size, lastModified: file.lastModified, sha256, importedAt: new Date().toISOString() }
}

export function deterministicAtomNames(atoms: CoordinateAtom[]) {
  const counts: Record<string, number> = {}
  return atoms.map((atom) => {
    counts[atom.element] = (counts[atom.element] ?? 0) + 1
    return `${atom.element}${counts[atom.element]}`.slice(0, 4)
  })
}

export const GROMACS_STAGE_COMMANDS = {
  em: "#!/usr/bin/env bash\nset -euo pipefail\ngmx grompp -f 01_em/em.mdp -c 00_input/packed.gro -p 00_input/topol.top -n 00_input/index.ndx -o 01_em/em.tpr -maxwarn 0\ngmx mdrun -deffnm 01_em/em -v",
  nvt: "#!/usr/bin/env bash\nset -euo pipefail\ngmx grompp -f 02_nvt/nvt.mdp -c 01_em/em.gro -r 01_em/em.gro -p 00_input/topol.top -n 00_input/index.ndx -o 02_nvt/nvt.tpr -maxwarn 0\ngmx mdrun -deffnm 02_nvt/nvt -v",
  npt: "#!/usr/bin/env bash\nset -euo pipefail\ngmx grompp -f 03_npt/npt.mdp -c 02_nvt/nvt.gro -t 02_nvt/nvt.cpt -p 00_input/topol.top -n 00_input/index.ndx -o 03_npt/npt.tpr -maxwarn 0\ngmx mdrun -deffnm 03_npt/npt -v\nprintf 'Density\\n0\\n' | gmx energy -f 03_npt/npt.edr -o 03_npt/density.xvg",
  production:
    "#!/usr/bin/env bash\nset -euo pipefail\ngmx grompp -f 04_prod/prod.mdp -c 03_npt/npt.gro -t 03_npt/npt.cpt -p 00_input/topol.top -n 00_input/index.ndx -o 04_prod/prod.tpr -maxwarn 0\ngmx mdrun -deffnm 04_prod/prod -v\n# Restart after interruption:\n# gmx mdrun -deffnm 04_prod/prod -cpi 04_prod/prod.cpt -append",
} as const

export function commandText(state: QmGromacsState, key: string, generated: string) {
  return Object.prototype.hasOwnProperty.call(state.commandOverrides, key) ? state.commandOverrides[key] : generated
}

export function defaultResidueName(molecule: Molecule) {
  return (molecule.residueName || molecule.abbreviation || "MOL").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4) || "MOL"
}

export function emptyMoleculePreparation(molecule: Molecule): MoleculePreparation {
  return {
    moleculeId: molecule.id,
    residueName: defaultResidueName(molecule),
    expectedFormalCharge: molecule.charge,
    chargeTolerance: 1e-4,
    chargeMode: "qm",
    selectedChargeScheme: "",
    chargeScaleFactor: 1.0,
    neutralizationPolicy: "none",
    chargeAcknowledged: false,
    geometryAcknowledged: false,
    geometryFile: null,
    qmFile: null,
    geometryComment: "",
    geometryAtoms: [],
    qmCoordinates: [],
    qmChargeSets: {},
    atoms: [],
    bonds: [],
    connectivityApproved: false,
    coordinateSettings: { center: false, translateAngstrom: { x: 0, y: 0, z: 0 } },
    qmMetadata: {
      software: "none",
      inputLine: "",
      method: "not detected",
      basis: "not detected",
      parsedTotalCharge: null,
      multiplicity: null,
      terminatedNormally: null,
      availableSchemes: [],
    },
    topologyHelperTool: "acpype",
    topologyFileName: "",
    topologyText: "",
    topologySections: [],
    topologyReviewed: false,
    gromppValidated: false,
    notes: "",
    updatedAt: new Date().toISOString(),
  }
}

export function activeQmCharges(preparation: MoleculePreparation): QmChargeEntry[] {
  const scheme = preparation.selectedChargeScheme || preparation.qmMetadata.availableSchemes[0] || ""
  return preparation.qmChargeSets[scheme] ?? []
}

function applyChargePolicy(
  atoms: PreparedAtom[],
  expectedFormalCharge: number,
  scaleFactor: number,
  policy: NeutralizationPolicy,
  chargeMode: ChargeMode,
): PreparedAtom[] {
  const safeScale = Number.isFinite(scaleFactor) && scaleFactor > 0 ? scaleFactor : 1.0
  // Step 1: base charge per atom
  const baseCharges = atoms.map((atom) => {
    if (atom.manualCharge !== null && Number.isFinite(atom.manualCharge)) return atom.manualCharge
    if (chargeMode === "manual") return atom.manualCharge
    if (chargeMode === "topology") {
      return atom.existingTopologyCharge !== null ? atom.existingTopologyCharge * safeScale : null
    }
    return atom.rawQmCharge !== null ? atom.rawQmCharge * safeScale : null
  })

  if (policy === "none" || baseCharges.some((q) => q === null) || !atoms.length) {
    return atoms.map((atom, i) => ({ ...atom, finalCharge: baseCharges[i] }))
  }

  const nums = baseCharges as number[]
  const sum = nums.reduce((acc, v) => acc + v, 0)
  const residual = expectedFormalCharge - sum

  if (Math.abs(residual) === 0) {
    return atoms.map((atom, i) => ({ ...atom, finalCharge: nums[i] }))
  }

  const adjusted = [...nums]
  if (policy === "uniform-residual") {
    const delta = residual / atoms.length
    for (let i = 0; i < adjusted.length; i++) adjusted[i] += delta
  } else if (policy === "heavy-atoms-residual") {
    const heavyIndices = atoms.map((a, i) => (a.element !== "H" ? i : -1)).filter((i) => i >= 0)
    const targets = heavyIndices.length ? heavyIndices : atoms.map((_, i) => i)
    const delta = residual / targets.length
    for (const i of targets) adjusted[i] += delta
  } else if (policy === "largest-abs-atom") {
    let bestIdx = 0
    for (let i = 1; i < adjusted.length; i++) {
      if (Math.abs(adjusted[i]) > Math.abs(adjusted[bestIdx])) bestIdx = i
    }
    adjusted[bestIdx] += residual
  }

  return atoms.map((atom, i) => ({ ...atom, finalCharge: adjusted[i] }))
}

export function reconcilePreparation(preparation: MoleculePreparation): MoleculePreparation {
  const names = deterministicAtomNames(preparation.geometryAtoms)
  const previous = new Map(preparation.atoms.map((atom) => [atom.index, atom]))
  const qmEntries = activeQmCharges(preparation)
  const chargeMap = new Map(qmEntries.map((entry) => [entry.outIndex, entry]))

  const rawAtoms: PreparedAtom[] = preparation.geometryAtoms.map((geom, index) => {
    const prior = previous.get(geom.index)
    const outIndex = prior?.outIndex ?? geom.index
    const qEntry = chargeMap.get(outIndex)
    const elementMatches = !qEntry?.element || qEntry.element === geom.element
    const rawQmCharge = qEntry && elementMatches ? qEntry.charge : null
    return {
      ...geom,
      outIndex,
      outElement: qEntry?.element ?? null,
      gromacsName: prior?.gromacsName ?? names[index],
      residueName: preparation.residueName,
      rawQmCharge,
      existingTopologyCharge: prior?.existingTopologyCharge ?? null,
      manualCharge: prior?.manualCharge ?? null,
      finalCharge: null,
      atomType: prior?.atomType ?? "",
      mass: prior?.mass ?? ELEMENT_MASS[geom.element] ?? null,
      ljSource: prior?.ljSource ?? "",
      mappingStatus: prior?.mappingStatus ?? ("UNMAPPED" as const),
    }
  })

  const atoms = applyChargePolicy(
    rawAtoms,
    preparation.expectedFormalCharge,
    preparation.chargeScaleFactor,
    preparation.neutralizationPolicy,
    preparation.chargeMode,
  )
  return { ...preparation, atoms, updatedAt: new Date().toISOString() }
}

const distance = (a: CoordinateAtom, b: CoordinateAtom) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)

export function attachGeometry(preparation: MoleculePreparation, file: SourceFileRecord): MoleculePreparation {
  const parsed = parseGeometryFile(file.text, file.name)
  const bonds: BondRecord[] = (parsed.bonds ?? []).reduce<BondRecord[]>((acc, b, idx) => {
    const atomI = parsed.atoms[b.ai - 1], atomJ = parsed.atoms[b.aj - 1]
    if (atomI && atomJ) {
      acc.push({
        id: `geom-${idx + 1}-${b.ai}-${b.aj}`,
        ai: b.ai,
        aj: b.aj,
        elementI: atomI.element,
        elementJ: atomJ.element,
        distanceAngstrom: distance(atomI, atomJ),
        definition: b.order ? `order ${b.order}` : "imported from geometry",
        proposed: false,
        accepted: true,
        source: "geometry-import",
      })
    }
    return acc
  }, [])

  // If the geometry file itself carries charges (e.g., MOL2, Multiwfn .chg, PQR) and no QM file is attached yet, expose them!
  const chargeSets = { ...preparation.qmChargeSets }
  let selectedChargeScheme = preparation.selectedChargeScheme
  let qmMetadata = preparation.qmMetadata
  if (parsed.charges?.length && !preparation.qmFile) {
    const schemeName = parsed.format.toUpperCase()
    chargeSets[schemeName] = parsed.charges
    selectedChargeScheme = schemeName
    qmMetadata = {
      ...qmMetadata,
      software: parsed.format === "mol2" ? "mol2" : "multiwfn",
      method: `${schemeName} file`,
      basis: "n/a",
      availableSchemes: Object.keys(chargeSets),
    }
  }

  return reconcilePreparation({
    ...preparation,
    geometryFile: file,
    atoms: [],
    topologyText: "",
    topologySections: [],
    topologyReviewed: false,
    gromppValidated: false,
    geometryComment: parsed.comment,
    geometryAtoms: parsed.atoms,
    qmChargeSets: chargeSets,
    selectedChargeScheme,
    qmMetadata,
    bonds,
    connectivityApproved: false,
    geometryAcknowledged: false,
  })
}

export function attachQmOutput(
  preparation: MoleculePreparation,
  file: SourceFileRecord,
  softwareHint?: QmSoftware,
): MoleculePreparation {
  const parsed = parseQmOutput(file.text, file.name, softwareHint)
  // If no separate geometry file is loaded and the QM output contains coordinates, use them directly!
  const useQmCoordsAsGeometry = !preparation.geometryFile && parsed.coordinates.length > 0
  const geometryAtoms = useQmCoordsAsGeometry ? parsed.coordinates : preparation.geometryAtoms
  const bonds =
    useQmCoordsAsGeometry && parsed.bonds?.length
      ? parsed.bonds.reduce<BondRecord[]>((acc, b, idx) => {
          const atomI = geometryAtoms[b.ai - 1], atomJ = geometryAtoms[b.aj - 1]
          if (atomI && atomJ) {
            acc.push({
              id: `qm-${idx + 1}-${b.ai}-${b.aj}`,
              ai: b.ai,
              aj: b.aj,
              elementI: atomI.element,
              elementJ: atomJ.element,
              distanceAngstrom: distance(atomI, atomJ),
              definition: b.order ? `order ${b.order}` : "imported from QM file",
              proposed: false,
              accepted: true,
              source: "geometry-import",
            })
          }
          return acc
        }, [])
      : preparation.bonds

  return reconcilePreparation({
    ...preparation,
    qmFile: file,
    chargeMode: parsed.availableSchemes.length ? "qm" : preparation.chargeMode,
    geometryAtoms,
    geometryComment: useQmCoordsAsGeometry ? `Extracted from ${file.name} (${parsed.software})` : preparation.geometryComment,
    qmCoordinates: parsed.coordinates,
    qmChargeSets: parsed.chargeSets,
    selectedChargeScheme: parsed.defaultScheme,
    qmMetadata: {
      software: parsed.software,
      inputLine: parsed.inputLine,
      method: parsed.method,
      basis: parsed.basis,
      parsedTotalCharge: parsed.parsedTotalCharge,
      multiplicity: parsed.multiplicity,
      terminatedNormally: parsed.terminatedNormally,
      availableSchemes: parsed.availableSchemes,
    },
    bonds,
    topologyReviewed: false,
    gromppValidated: false,
    chargeAcknowledged: false,
    geometryAcknowledged: false,
  })
}

export function mappedRawChargeSum(preparation: MoleculePreparation) {
  return preparation.atoms.reduce((sum, atom) => {
    const q = preparation.chargeMode === "topology" ? atom.existingTopologyCharge : preparation.chargeMode === "manual" ? atom.manualCharge : atom.rawQmCharge
    return sum + (q ?? 0)
  }, 0)
}

export function mappedFinalChargeSum(preparation: MoleculePreparation) {
  return preparation.atoms.reduce((sum, atom) => sum + (atom.finalCharge ?? 0), 0)
}

export function geometryDifference(preparation: MoleculePreparation) {
  if (!preparation.geometryAtoms.length || preparation.qmCoordinates.length !== preparation.geometryAtoms.length) return null
  let sum = 0
  let max = 0
  for (const atom of preparation.atoms) {
    const out = preparation.qmCoordinates[atom.outIndex - 1]
    if (!out || out.element !== atom.element) return null
    const d = Math.hypot(atom.x - out.x, atom.y - out.y, atom.z - out.z)
    sum += d * d
    max = Math.max(max, d)
  }
  return { rmsdAngstrom: Math.sqrt(sum / preparation.atoms.length), maxDisplacementAngstrom: max }
}

export function qmDiagnostics(preparation: MoleculePreparation): PrepDiagnostic[] {
  const diagnostics: PrepDiagnostic[] = []
  if (!preparation.geometryAtoms.length) {
    diagnostics.push({
      severity: "ERROR",
      code: "GEOMETRY_REQUIRED",
      message: "Import a molecular geometry (.xyz, .pdb, .gro, .mol2, .chg) or a QM output containing Cartesian coordinates.",
    })
  }

  if (preparation.chargeMode === "qm") {
    const entries = activeQmCharges(preparation)
    if (!preparation.qmFile && !entries.length) {
      diagnostics.push({
        severity: "ERROR",
        code: "QM_CHARGES_REQUIRED",
        message: "Import a QM output or charge table (ORCA, Gaussian .log/.fchk, xTB, Multiwfn .chg, MOL2, CSV), or switch charge mode to 'Keep topology charges'.",
      })
    } else if (!entries.length) {
      diagnostics.push({
        severity: "ERROR",
        code: "CHARGE_BLOCK_NOT_FOUND",
        message: `No atomic charge table was parsed from ${preparation.qmFile?.name ?? "the QM file"}. Upload a supported output/CSV or switch charge mode.`,
      })
    }
    if (preparation.geometryAtoms.length && entries.length && preparation.geometryAtoms.length !== entries.length) {
      diagnostics.push({
        severity: "ERROR",
        code: "ATOM_COUNT_MISMATCH",
        message: `Geometry contains ${preparation.geometryAtoms.length} atoms but the selected '${preparation.selectedChargeScheme}' charge set contains ${entries.length}.`,
      })
    }
    if (entries.length) {
      const mapped = preparation.atoms.map((atom) => atom.outIndex)
      if (mapped.some((idx) => !Number.isInteger(idx) || idx < 1 || idx > entries.length) || new Set(mapped).size !== mapped.length) {
        diagnostics.push({
          severity: "ERROR",
          code: "MAPPING_NOT_BIJECTIVE",
          message: "Every geometry atom must map to one unique QM charge index.",
        })
      }
      for (const atom of preparation.atoms) {
        if (atom.outElement && atom.element !== atom.outElement) {
          diagnostics.push({
            severity: "ERROR",
            code: "ATOM_MAPPING_MISMATCH",
            message: `Geometry atom ${atom.index} = ${atom.element}; mapped QM atom ${atom.outIndex} = ${atom.outElement}. Fix the index mapping explicitly.`,
          })
        }
      }
    }
  }

  if (preparation.atoms.length && preparation.atoms.some((atom) => atom.finalCharge === null || !Number.isFinite(atom.finalCharge))) {
    diagnostics.push({
      severity: "ERROR",
      code: "CHARGE_MAPPING_INCOMPLETE",
      message: "At least one atom has no resolved final partial charge.",
    })
  }

  if (
    preparation.chargeMode === "qm" &&
    preparation.qmMetadata.parsedTotalCharge !== null &&
    preparation.qmMetadata.parsedTotalCharge !== preparation.expectedFormalCharge
  ) {
    diagnostics.push({
      severity: "WARNING",
      code: "QM_FORMAL_CHARGE_MISMATCH",
      message: `QM file declares total charge ${preparation.qmMetadata.parsedTotalCharge}, while the Molecule Registry expects ${preparation.expectedFormalCharge}. Confirm this is intentional.`,
    })
  }

  const finalSum = mappedFinalChargeSum(preparation)
  const expectedTarget = preparation.expectedFormalCharge * (preparation.neutralizationPolicy === "none" ? preparation.chargeScaleFactor : 1)
  const diff = finalSum - expectedTarget
  if (
    preparation.atoms.length &&
    preparation.atoms.every((atom) => atom.finalCharge !== null) &&
    Math.abs(diff) > preparation.chargeTolerance
  ) {
    diagnostics.push({
      severity: preparation.chargeAcknowledged ? "WARNING" : "ERROR",
      code: "CHARGE_SUM_MISMATCH",
      message: `Final charge sum ${finalSum.toFixed(8)} differs from expected ${expectedTarget.toFixed(6)} by ${diff.toExponential(3)}. Select a neutralization policy or acknowledge explicitly.`,
    })
  }

  const geometry = geometryDifference(preparation)
  if (preparation.qmCoordinates.length && preparation.qmCoordinates.length !== preparation.geometryAtoms.length) {
    diagnostics.push({
      severity: "WARNING",
      code: "OUTPUT_GEOMETRY_COUNT_MISMATCH",
      message: "QM output coordinate count differs from the loaded geometry file.",
    })
  } else if (
    preparation.qmCoordinates.length &&
    preparation.atoms.some((atom) => preparation.qmCoordinates[atom.outIndex - 1]?.element !== atom.element)
  ) {
    diagnostics.push({
      severity: "ERROR",
      code: "OUTPUT_GEOMETRY_ELEMENT_MISMATCH",
      message: "Mapped geometry atoms do not match the element sequence in the QM output coordinates.",
    })
  } else if (geometry && geometry.maxDisplacementAngstrom > 0.05) {
    diagnostics.push({
      severity: preparation.geometryAcknowledged ? "WARNING" : "ERROR",
      code: "GEOMETRY_DIFFERENCE",
      message: `Geometry vs QM output coordinates: RMSD ${geometry.rmsdAngstrom.toFixed(5)} Å; max displacement ${geometry.maxDisplacementAngstrom.toFixed(5)} Å. Confirm this is optimization/conformer difference rather than atom reordering.`,
    })
  }

  if (preparation.qmFile && preparation.qmMetadata.terminatedNormally === false) {
    diagnostics.push({
      severity: "WARNING",
      code: "QM_NOT_TERMINATED",
      message: `Normal termination banner was not detected in ${preparation.qmFile.name}.`,
    })
  }
  return diagnostics
}

export function proposeConnectivity(preparation: MoleculePreparation): MoleculePreparation {
  const bonds: BondRecord[] = []
  for (let i = 0; i < preparation.geometryAtoms.length; i++) {
    for (let j = i + 1; j < preparation.geometryAtoms.length; j++) {
      const a = preparation.geometryAtoms[i], b = preparation.geometryAtoms[j]
      const radiusA = COVALENT_RADIUS[a.element], radiusB = COVALENT_RADIUS[b.element]
      if (!radiusA || !radiusB) continue
      const d = distance(a, b)
      const threshold = 1.25 * (radiusA + radiusB)
      if (d >= 0.4 && d <= threshold) {
        bonds.push({
          id: `${a.index}-${b.index}`,
          ai: a.index,
          aj: b.index,
          elementI: a.element,
          elementJ: b.element,
          distanceAngstrom: d,
          definition: "covalent-radius suggestion; bonded parameters supplied by topology",
          proposed: true,
          accepted: false,
          source: "covalent-radius",
        })
      }
    }
  }
  return { ...preparation, bonds, connectivityApproved: false, updatedAt: new Date().toISOString() }
}

export function parseTopologySections(text: string): TopologySection[] {
  const sections: TopologySection[] = []
  let current: TopologySection | null = null
  for (const raw of text.split(/\r?\n/)) {
    const match = raw.match(/^\s*\[\s*([^\]]+)\s*\]/)
    if (match) {
      current = { name: match[1].trim().toLowerCase(), lines: [] }
      sections.push(current)
    } else if (current) {
      current.lines.push(raw)
    }
  }
  return sections
}

function dataLines(section: TopologySection | undefined) {
  return (section?.lines ?? []).map((line) => line.split(";")[0].trim()).filter((line) => line && !line.startsWith("#"))
}

export function importTopology(preparation: MoleculePreparation, file: SourceFileRecord): MoleculePreparation {
  const sections = parseTopologySections(file.text)
  const atomLines = dataLines(sections.find((section) => section.name === "atoms"))
  const parsedAtoms = atomLines.map((line) => line.split(/\s+/)).filter((fields) => fields.length >= 7)

  const updatedAtoms = preparation.atoms.map((atom) => {
    const fields = parsedAtoms.find((item) => Number(item[0]) === atom.index)
    if (!fields) return atom
    const existingCharge = Number(fields[6])
    const mass = fields[7] === undefined ? atom.mass : Number(fields[7])
    return {
      ...atom,
      atomType: fields[1] ?? "",
      gromacsName: fields[4] ? fields[4].slice(0, 4) : atom.gromacsName,
      existingTopologyCharge: Number.isFinite(existingCharge) ? existingCharge : null,
      mass: Number.isFinite(mass) ? mass : atom.mass,
      ljSource: atom.ljSource || `Imported from ${file.name}; verify with gmx grompp`,
      mappingStatus: fields[1] ? ("REVIEW REQUIRED" as const) : ("UNMAPPED" as const),
    }
  })

  const importedBonds = dataLines(sections.find((section) => section.name === "bonds")).reduce<BondRecord[]>((bonds, line, index) => {
    const fields = line.split(/\s+/)
    const ai = Number(fields[0]), aj = Number(fields[1])
    const atomI = preparation.geometryAtoms[ai - 1], atomJ = preparation.geometryAtoms[aj - 1]
    if (atomI && atomJ) {
      bonds.push({
        id: `top-${index + 1}-${ai}-${aj}`,
        ai,
        aj,
        elementI: atomI.element,
        elementJ: atomJ.element,
        distanceAngstrom: distance(atomI, atomJ),
        definition: fields.slice(2).join(" ") || "function/parameters in topology",
        proposed: false,
        accepted: true,
        source: "topology-import",
      })
    }
    return bonds
  }, [])

  return reconcilePreparation({
    ...preparation,
    originalTopologyFile: preparation.originalTopologyFile ?? file,
    topologyFileName: file.name,
    topologyText: file.text,
    topologySections: sections,
    atoms: updatedAtoms,
    bonds: importedBonds.length ? importedBonds : preparation.bonds,
    connectivityApproved: importedBonds.length ? false : preparation.connectivityApproved,
    topologyReviewed: false,
    gromppValidated: false,
    updatedAt: new Date().toISOString(),
  })
}

export function applyEditedTopology(preparation: MoleculePreparation, text: string) {
  const file: SourceFileRecord = {
    name: preparation.topologyFileName || "edited_topology.itp",
    text,
    size: new TextEncoder().encode(text).byteLength,
    lastModified: Date.now(),
    sha256: "edited-in-workbench",
    importedAt: new Date().toISOString(),
  }
  return importTopology(preparation, file)
}

export function topologyDiagnostics(preparation: MoleculePreparation): PrepDiagnostic[] {
  const diagnostics = [...qmDiagnostics(preparation)]
  if (canonical(parseTopologySections(preparation.topologyText)) !== canonical(preparation.topologySections)) {
    diagnostics.push({ severity: "ERROR", code: "TOPOLOGY_TEXT_NOT_PARSED", message: "Re-parse the edited topology before generation." })
  }
  if (preparation.atoms.some((a) => !Number.isFinite(a.mass) || !(a.mass! > 0) || a.finalCharge === null || !Number.isFinite(a.finalCharge))) {
    diagnostics.push({ severity: "ERROR", code: "MASS_CHARGE_CONFLICT", message: "Positive masses and finite final partial charges are required for all atoms." })
  }
  if (!/^[A-Za-z][A-Za-z0-9]{0,3}$/.test(preparation.residueName)) {
    diagnostics.push({ severity: "ERROR", code: "RESIDUE_NAME_INVALID", message: "Residue name must be 1–4 alphanumeric characters starting with a letter." })
  }
  const atomIndices = preparation.atoms.map((atom) => atom.index)
  if (new Set(atomIndices).size !== atomIndices.length) {
    diagnostics.push({ severity: "ERROR", code: "DUPLICATE_ATOM_INDEX", message: "Molecular atom indices must be unique." })
  }
  const atomNames = preparation.atoms.map((atom) => atom.gromacsName.trim()).filter(Boolean)
  if (atomNames.length !== preparation.atoms.length) {
    diagnostics.push({ severity: "ERROR", code: "ATOM_NAME_MISSING", message: "Every atom requires a GROMACS atom name." })
  }
  if (new Set(atomNames).size !== atomNames.length) {
    diagnostics.push({ severity: "ERROR", code: "DUPLICATE_ATOM_NAME", message: "Atom names must be unique within this residue for unambiguous PDB/Packmol mapping." })
  }
  if (atomNames.some((name) => name.length > 4)) {
    diagnostics.push({ severity: "ERROR", code: "PDB_ATOM_NAME_TOO_LONG", message: "Atom names are limited to 4 characters for PDB column compatibility." })
  }
  if (preparation.atoms.length > 1) {
    if (!preparation.bonds.length) {
      diagnostics.push({ severity: "ERROR", code: "CONNECTIVITY_MISSING", message: "No accepted molecular bond graph is available (import topology or suggest/add bonds)." })
    }
    if (preparation.bonds.some((bond) => !bond.accepted)) {
      diagnostics.push({ severity: "ERROR", code: "CONNECTIVITY_UNAPPROVED", message: "Every retained bond must be explicitly accepted or removed." })
    }
    if (!preparation.connectivityApproved) {
      diagnostics.push({ severity: "ERROR", code: "CONNECTIVITY_NOT_APPROVED", message: "Approve the molecular connectivity graph before export." })
    }
  }
  const unmapped = preparation.atoms.filter((atom) => !atom.atomType || atom.mappingStatus === "UNMAPPED")
  if (unmapped.length) {
    diagnostics.push({
      severity: "ERROR",
      code: "ATOM_TYPES_MISSING",
      message: `Force-field atom typing incomplete: ${unmapped.map((atom) => atom.gromacsName || atom.element + atom.index).join(", ")} missing atom type.`,
    })
  }
  const review = preparation.atoms.filter((atom) => atom.mappingStatus === "REVIEW REQUIRED")
  if (review.length) {
    diagnostics.push({
      severity: "ERROR",
      code: "ATOM_TYPES_REQUIRE_REVIEW",
      message: `${review.length} imported atom type mapping(s) still require researcher review.`,
    })
  }
  if (!preparation.topologyText) {
    diagnostics.push({
      severity: "ERROR",
      code: "BONDED_TOPOLOGY_MISSING",
      message: "Import a force-field topology (.top/.itp from ACPYPE, x2top, Antechamber, Sobtop, LigParGen, CGenFF, or custom).",
    })
  }
  const sectionNames = new Set(preparation.topologySections.map((section) => section.name))
  const sectionCount = (name: string) => preparation.topologySections.filter((section) => section.name === name).length
  for (const unique of ["moleculetype", "atoms"]) {
    if (sectionCount(unique) > 1) {
      diagnostics.push({ severity: "ERROR", code: `DUPLICATE_${unique.toUpperCase()}_SECTION`, message: `Imported topology contains ${sectionCount(unique)} [ ${unique} ] sections.` })
    }
  }
  if (preparation.topologyText && !sectionNames.has("atoms")) {
    diagnostics.push({ severity: "ERROR", code: "SECTION_ATOMS_MISSING", message: "Imported topology is missing [ atoms ]." })
  }
  if (preparation.topologyText && preparation.atoms.length > 1 && !sectionNames.has("bonds") && !sectionNames.has("settles") && !sectionNames.has("constraints")) {
    diagnostics.push({ severity: "ERROR", code: "SECTION_BONDS_MISSING", message: "Multi-atom topology is missing [ bonds ] (or [ settles ] / [ constraints ])." })
  }

  const topologyAtomLines = dataLines(preparation.topologySections.find((section) => section.name === "atoms"))
  if (preparation.topologyText && topologyAtomLines.length !== preparation.atoms.length) {
    diagnostics.push({
      severity: "ERROR",
      code: "TOPOLOGY_ATOM_COUNT_MISMATCH",
      message: `Imported [ atoms ] contains ${topologyAtomLines.length} records for ${preparation.atoms.length} geometry atoms.`,
    })
  }

  const parsedTopologyAtomIndices: number[] = []
  for (const [lineIndex, line] of topologyAtomLines.entries()) {
    const fields = line.split(/\s+/)
    const index = Number(fields[0]), charge = Number(fields[6]), mass = fields[7] === undefined ? null : Number(fields[7])
    if (fields.length < 7 || !Number.isInteger(index) || !Number.isFinite(charge) || (mass !== null && !Number.isFinite(mass))) {
      diagnostics.push({ severity: "ERROR", code: "MALFORMED_ATOMS_RECORD", message: `Malformed [ atoms ] record ${lineIndex + 1}: ${line}` })
      continue
    }
    parsedTopologyAtomIndices.push(index)
    const mapped = preparation.atoms.find((atom) => atom.index === index)
    if (!mapped) {
      diagnostics.push({ severity: "ERROR", code: "TOPOLOGY_ATOM_INDEX_UNDEFINED", message: `[ atoms ] index ${index} does not exist in the geometry mapping.` })
    } else if (fields[4] && fields[4].slice(0, 4) !== mapped.gromacsName) {
      diagnostics.push({
        severity: "WARNING",
        code: "TOPOLOGY_ATOM_NAME_DIFF",
        message: `[ atoms ] index ${index} is named '${fields[4]}' in topology vs '${mapped.gromacsName}' in mapping; exported .itp uses '${mapped.gromacsName}'.`,
      })
    }
  }
  if (new Set(parsedTopologyAtomIndices).size !== parsedTopologyAtomIndices.length) {
    diagnostics.push({ severity: "ERROR", code: "DUPLICATE_TOPOLOGY_ATOM_INDEX", message: "Imported [ atoms ] contains duplicate atom indices." })
  }

  const validateInteraction = (sectionName: "bonds" | "angles" | "dihedrals", arity: number) => {
    const lines = preparation.topologySections.filter((section) => section.name === sectionName).flatMap(dataLines)
    for (const [lineIndex, line] of lines.entries()) {
      const fields = line.split(/\s+/)
      const indices = fields.slice(0, arity).map(Number)
      if (fields.length < arity + 1 || !Number.isInteger(Number(fields[arity])) || Number(fields[arity]) < 1 || indices.some((idx) => !Number.isInteger(idx))) {
        diagnostics.push({ severity: "ERROR", code: `MALFORMED_${sectionName.toUpperCase()}_RECORD`, message: `Malformed [ ${sectionName} ] record ${lineIndex + 1}: ${line}` })
      } else if (indices.some((idx) => !atomIndices.includes(idx))) {
        diagnostics.push({ severity: "ERROR", code: `UNDEFINED_${sectionName.toUpperCase()}_ATOM`, message: `[ ${sectionName} ] record ${lineIndex + 1} references undefined atom: ${line}` })
      }
    }
  }
  validateInteraction("bonds", 2)
  validateInteraction("angles", 3)
  validateInteraction("dihedrals", 4)

  const topologyBondKeys = preparation.topologySections
    .filter((section) => section.name === "bonds")
    .flatMap(dataLines)
    .map((line) => line.split(/\s+/).slice(0, 2).map(Number))
    .filter((pair) => pair.every(Number.isInteger))
    .map(([a, b]) => [Math.min(a, b), Math.max(a, b)].join("-"))
  if (new Set(topologyBondKeys).size !== topologyBondKeys.length) {
    diagnostics.push({ severity: "ERROR", code: "DUPLICATE_BOND_DEFINITION", message: "Imported [ bonds ] contains a duplicated atom pair." })
  }
  const acceptedBonds = preparation.bonds
    .filter((b) => b.accepted)
    .map((b) => [Math.min(b.ai, b.aj), Math.max(b.ai, b.aj)].join("-"))
    .sort()
  if (topologyBondKeys.length && canonical(acceptedBonds) !== canonical([...topologyBondKeys].sort())) {
    diagnostics.push({ severity: "ERROR", code: "CONNECTIVITY_TOPOLOGY_CONFLICT", message: "Accepted bond graph differs from imported [ bonds ] topology." })
  }

  if (/^\s*#\s*include/m.test(preparation.topologyText)) {
    diagnostics.push({
      severity: "ERROR",
      code: "UNRESOLVED_TOPOLOGY_INCLUDE",
      message: "Inline or strip per-molecule #include statements before merging so dependencies are explicit.",
    })
  }
  if (/^\s*#\s*(?:if|else|endif|define|undef)/m.test(preparation.topologyText)) {
    diagnostics.push({
      severity: "ERROR",
      code: "UNRESOLVED_TOPOLOGY_PREPROCESSOR",
      message: "Resolve conditional/macro preprocessor directives in the imported molecule topology before merging.",
    })
  }

  const atomTypeDefs = preparation.topologySections
    .filter((section) => section.name === "atomtypes")
    .flatMap(dataLines)
    .map((line) => line.split(/\s+/)[0])
    .filter(Boolean)
  if (new Set(atomTypeDefs).size !== atomTypeDefs.length) {
    diagnostics.push({ severity: "ERROR", code: "DUPLICATE_ATOMTYPE_DEFINITION", message: "Imported [ atomtypes ] contains duplicate type names." })
  }

  if (preparation.atoms.length >= 3 && preparation.topologyText && !sectionNames.has("angles") && !sectionNames.has("settles")) {
    diagnostics.push({ severity: "WARNING", code: "ANGLES_MISSING", message: "No [ angles ] section found; confirm whether angles are intentionally omitted." })
  }
  if (preparation.atoms.length >= 4 && preparation.topologyText && !sectionNames.has("dihedrals")) {
    diagnostics.push({ severity: "WARNING", code: "DIHEDRALS_MISSING", message: "No [ dihedrals ] section found; review proper/improper torsions." })
  }
  if (!preparation.topologyReviewed) {
    diagnostics.push({ severity: "ERROR", code: "TOPOLOGY_REVIEW_REQUIRED", message: "Confirm topology review checklist before generating final .itp." })
  }
  if (!preparation.gromppValidated) {
    diagnostics.push({ severity: "WARNING", code: "GROMPP_NOT_VALIDATED", message: "External gmx grompp check has not yet been marked as completed." })
  }
  return diagnostics
}

export function preparationStatus(preparation: MoleculePreparation) {
  const diagnostics = topologyDiagnostics(preparation)
  if (diagnostics.some((item) => item.severity === "ERROR")) return "INCOMPLETE — NOT READY FOR PRODUCTION MD"
  if (!preparation.gromppValidated) return "READY FOR GROMPP VALIDATION"
  return "RESEARCHER ACCEPTED — EXTERNAL GROMPP REPORTED"
}

function transformedCoordinates(preparation: MoleculePreparation) {
  if (!preparation.atoms.length) return []
  const center = preparation.coordinateSettings.center
    ? {
        x: preparation.atoms.reduce((sum, atom) => sum + atom.x, 0) / preparation.atoms.length,
        y: preparation.atoms.reduce((sum, atom) => sum + atom.y, 0) / preparation.atoms.length,
        z: preparation.atoms.reduce((sum, atom) => sum + atom.z, 0) / preparation.atoms.length,
      }
    : { x: 0, y: 0, z: 0 }
  const translation = preparation.coordinateSettings.translateAngstrom
  return preparation.atoms.map((atom) => ({
    ...atom,
    x: atom.x - center.x + translation.x,
    y: atom.y - center.y + translation.y,
    z: atom.z - center.z + translation.z,
  }))
}

export function generatePdb(preparation: MoleculePreparation) {
  const lines = transformedCoordinates(preparation).map((atom, index) => {
    const serial = String(index + 1).padStart(5)
    const name = atom.gromacsName.slice(0, 4).padStart(4)
    const residue = preparation.residueName.slice(0, 4).padStart(4)
    const x = atom.x.toFixed(3).padStart(8)
    const y = atom.y.toFixed(3).padStart(8)
    const z = atom.z.toFixed(3).padStart(8)
    return `HETATM${serial} ${name} ${residue}A${String(1).padStart(4)}    ${x}${y}${z}  1.00  0.00          ${atom.element.padStart(2)}`
  })
  return [`REMARK SolvForge MD — atom order preserved; coordinates in Angstrom`, ...lines, "TER", "END", ""].join("\n")
}

export function generateGro(preparation: MoleculePreparation) {
  const atoms = transformedCoordinates(preparation)
  const lines = atoms.map(
    (atom, index) =>
      `${String(1).padStart(5)}${preparation.residueName.slice(0, 5).padEnd(5)}${atom.gromacsName.slice(0, 5).padStart(5)}${String(index + 1).padStart(5)}${(atom.x / 10).toFixed(3).padStart(8)}${(atom.y / 10).toFixed(3).padStart(8)}${(atom.z / 10).toFixed(3).padStart(8)}`,
  )
  return [
    `${preparation.residueName} — Angstrom converted to nm; atom order preserved`,
    String(atoms.length),
    ...lines,
    "   0.00000   0.00000   0.00000",
    "",
  ].join("\n")
}

export function generateAtomMappingCsv(preparation: MoleculePreparation) {
  return csv([
    [
      "geom_index",
      "element",
      "x_angstrom",
      "y_angstrom",
      "z_angstrom",
      "qm_index",
      "qm_element",
      "gromacs_atom_name",
      "residue",
      "atom_type",
      "topology_charge",
      "raw_qm_charge",
      "charge_mode",
      "charge_scheme",
      "scale_factor",
      "neutralization",
      "final_charge",
      "lj_parameter_source",
      "mapping_status",
    ],
    ...preparation.atoms.map((atom) => [
      atom.index,
      atom.element,
      atom.x,
      atom.y,
      atom.z,
      atom.outIndex,
      atom.outElement,
      atom.gromacsName,
      preparation.residueName,
      atom.atomType,
      atom.existingTopologyCharge,
      atom.rawQmCharge,
      preparation.chargeMode,
      preparation.selectedChargeScheme,
      preparation.chargeScaleFactor,
      preparation.neutralizationPolicy,
      atom.finalCharge,
      atom.ljSource,
      atom.mappingStatus,
    ]),
  ])
}

export function generateChargesCsv(preparation: MoleculePreparation) {
  return csv([
    [
      "atom_index",
      "element",
      "gromacs_atom_name",
      "qm_software",
      "qm_method",
      "qm_basis",
      "charge_mode",
      "charge_scheme",
      "scale_factor",
      "neutralization_policy",
      "expected_formal_charge",
      "raw_qm_charge",
      "topology_charge",
      "manual_override",
      "final_charge",
    ],
    ...preparation.atoms.map((atom) => [
      atom.index,
      atom.element,
      atom.gromacsName,
      preparation.qmMetadata.software,
      preparation.qmMetadata.method,
      preparation.qmMetadata.basis,
      preparation.chargeMode,
      preparation.selectedChargeScheme,
      preparation.chargeScaleFactor,
      preparation.neutralizationPolicy,
      preparation.expectedFormalCharge,
      atom.rawQmCharge,
      atom.existingTopologyCharge,
      atom.manualCharge,
      atom.finalCharge,
    ]),
    [
      "SUM",
      "",
      "",
      preparation.qmMetadata.software,
      preparation.qmMetadata.method,
      preparation.qmMetadata.basis,
      preparation.chargeMode,
      preparation.selectedChargeScheme,
      preparation.chargeScaleFactor,
      preparation.neutralizationPolicy,
      preparation.expectedFormalCharge,
      mappedRawChargeSum(preparation),
      preparation.atoms.reduce((s, a) => s + (a.existingTopologyCharge ?? 0), 0),
      "",
      mappedFinalChargeSum(preparation),
    ],
  ])
}

export function generateItp(preparation: MoleculePreparation, forceFieldLabel = "User force field") {
  const errors = topologyDiagnostics(preparation).filter((d) => d.severity === "ERROR")
  if (errors.length) {
    return "; INCOMPLETE — NOT READY FOR PRODUCTION MD\n" + errors.map((e) => "; " + e.code + ": " + e.message).join("\n") + "\n"
  }
  const moleculeName = preparation.residueName
  const nrexclRaw = dataLines(preparation.topologySections.find((s) => s.name === "moleculetype"))[0]?.split(/\s+/)[1]
  const nrexcl = nrexclRaw && Number.isSafeInteger(Number(nrexclRaw)) && Number(nrexclRaw) >= 0 ? nrexclRaw : "3"

  const chargeDesc =
    preparation.chargeMode === "topology"
      ? `Topology native charges (scale ${preparation.chargeScaleFactor}, neutralization: ${preparation.neutralizationPolicy})`
      : preparation.chargeMode === "manual"
        ? `Manual charges (neutralization: ${preparation.neutralizationPolicy})`
        : `${preparation.qmMetadata.software.toUpperCase()} ${preparation.qmMetadata.method}/${preparation.qmMetadata.basis} ${preparation.selectedChargeScheme || "QM"} charges (scale ${preparation.chargeScaleFactor}, neutralization: ${preparation.neutralizationPolicy})`

  const header = [
    `; SolvForge MD — Force field: ${forceFieldLabel}`,
    `; Charge source: ${chargeDesc}`,
    `; Status: ${preparationStatus(preparation)}`,
    `; Atom order preserved; full audit in atom_mapping.csv and charges.csv.`,
    "",
  ]

  const definitions = preparation.topologySections
    .filter((s) => PARAMETER_SECTIONS.has(s.name))
    .sort((a, b) => Number(b.name === "atomtypes") - Number(a.name === "atomtypes"))

  const output = [
    ...header,
    ...(definitions.length
      ? ["#ifndef SOLVFORGE_SYSTEM_PARAMETERS", ...definitions.flatMap((s) => ["[ " + s.name + " ]", ...s.lines, ""]), "#endif", ""]
      : []),
    "[ moleculetype ]",
    `${moleculeName} ${nrexcl}`,
    "",
    "[ atoms ]",
    "; nr type resnr residue atom cgnr charge mass",
    ...preparation.atoms.map((a) =>
      [a.index, a.atomType, 1, moleculeName, a.gromacsName, a.index, a.finalCharge!.toPrecision(12), a.mass].join(" "),
    ),
    "",
  ]

  const omit = new Set(["defaults", "system", "molecules", "moleculetype", "atoms", ...PARAMETER_SECTIONS])
  for (const section of preparation.topologySections) {
    if (!omit.has(section.name)) output.push("[ " + section.name + " ]", ...section.lines, "")
  }
  return output.join("\n")
}

export function topologyToolCommand(preparation: MoleculePreparation, forceField = "oplsaa"): string {
  const base = slug(preparation.moleculeId)
  const tool = preparation.topologyHelperTool ?? "acpype"
  const ffSlug = forceField.toLowerCase().includes("opls")
    ? "oplsaa"
    : forceField.toLowerCase().includes("charmm")
      ? "charmm36"
      : forceField.toLowerCase().includes("gromos")
        ? "gromos54a7"
        : forceField.toLowerCase().includes("amber")
          ? "amber99sb-ildn"
          : "oplsaa"

  switch (tool) {
    case "x2top":
      return `gmx x2top -f molecules/${base}/coordinates/${base}.gro -o molecules/${base}/topology/${base}_raw.top -ff ${ffSlug}`
    case "acpype":
      return `acpype -i molecules/${base}/coordinates/${base}.pdb -c bcc -a gaff2 -n ${preparation.expectedFormalCharge} -o gmx`
    case "antechamber":
      return [
        `antechamber -i molecules/${base}/coordinates/${base}.pdb -fi pdb -o ${base}.mol2 -fo mol2 -c bcc -nc ${preparation.expectedFormalCharge} -at gaff2`,
        `parmchk2 -i ${base}.mol2 -f mol2 -o ${base}.frcmod -s gaff2`,
        `# Convert Amber prmtop/inpcrd to GROMACS .top/.itp via ParmEd or acpype, then import the .itp here.`,
      ].join("\n")
    case "sobtop":
      return `# Generate GROMACS .itp with Sobtop using your QM output (.fchk/.molden/.xyz) + ${base}.gro, then import the .itp below.`
    case "ligpargen":
      return `# Export GROMACS .itp from LigParGen for ${base}.pdb (verify atom ordering matches geometry), then import below.`
    case "cgenff":
      return `# Upload ${base}.mol2 to CGenFF, convert with cgenff_charmm2gmx.py, and import the resulting .itp below.`
  }
}

export function runSpecies(run: RunRecord) {
  const base = run.components.map((component) => ({
    moleculeId: component.moleculeId,
    name: component.name,
    count: component.count,
  }))
  if (run.soluteId && run.soluteCount > 0) {
    base.push({ moleculeId: run.soluteId, name: run.soluteName ?? run.soluteId, count: run.soluteCount })
  }
  return base
}

export function runBoxAngstrom(run: RunRecord) {
  const factor = run.box.unit === "angstrom" ? 1 : 10
  return { x: run.box.x * factor, y: run.box.y * factor, z: run.box.z * factor }
}

export function generatePackmolInput(
  run: RunRecord,
  preparations: Record<string, MoleculePreparation>,
  settings: QmGromacsState["packmol"],
) {
  const box = runBoxAngstrom(run)
  const margin = settings.marginAngstrom
  if (
    !Number.isFinite(margin) ||
    margin < 0 ||
    Object.values(box).some((v) => v <= 2 * margin) ||
    !Number.isFinite(settings.toleranceAngstrom) ||
    settings.toleranceAngstrom <= 0
  ) {
    return "# ERROR: positive box and packing tolerance, and margins smaller than half each box dimension required.\n"
  }
  const lines = [
    `# SolvForge MD — Packmol input for run ${run.runId} (all coordinates in Angstrom).`,
    `tolerance ${settings.toleranceAngstrom.toFixed(3)}`,
    "filetype pdb",
    "output packed.pdb",
  ]
  if (settings.periodic) lines.push(`pbc 0.000 0.000 0.000 ${box.x.toFixed(3)} ${box.y.toFixed(3)} ${box.z.toFixed(3)}`)
  for (const species of runSpecies(run)) {
    const preparation = preparations[species.moleculeId]
    const base = slug(species.moleculeId)
    if (!Number.isInteger(species.count) || Number(species.count) < 0) {
      lines.push(
        "",
        `# ERROR: absolute molecule count for ${species.name} is unresolved.`,
        "# Supply manual counts or box + target density + molecular weights before running Packmol.",
      )
      continue
    }
    lines.push(
      "",
      `structure ../../molecules/${base}/coordinates/${base}.pdb`,
      `  number ${species.count}`,
      `  inside box ${margin.toFixed(3)} ${margin.toFixed(3)} ${margin.toFixed(3)} ${(box.x - margin).toFixed(3)} ${(box.y - margin).toFixed(3)} ${(box.z - margin).toFixed(3)}`,
      "end structure",
    )
    if (!preparation) lines.push(`# ERROR: molecular preparation ${species.moleculeId} is unavailable.`)
  }
  return `${lines.join("\n")}\n`
}

export function parsePackedPdb(text: string) {
  const atoms: PackedPdbAtom[] = []
  let cryst1Angstrom: PackedSystemRecord["cryst1Angstrom"] = null
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith("CRYST1")) {
      const x = Number(line.slice(6, 15)), y = Number(line.slice(15, 24)), z = Number(line.slice(24, 33))
      if ([x, y, z].every(finite)) cryst1Angstrom = { x, y, z }
    }
    if (!/^(ATOM  |HETATM)/.test(line)) continue
    const serial = Number(line.slice(6, 11))
    const atomName = line.slice(12, 16).trim()
    const residueName = line.slice(17, 21).trim()
    const residueNumber = Number(line.slice(22, 26))
    const xAngstrom = Number(line.slice(30, 38)), yAngstrom = Number(line.slice(38, 46)), zAngstrom = Number(line.slice(46, 54))
    const element = normalizeElement(line.slice(76, 78).trim() || atomName.replace(/\d.*/g, "").slice(0, 2) || atomName)
    if (![serial, residueNumber, xAngstrom, yAngstrom, zAngstrom].every(finite)) {
      throw new Error(`Malformed packed PDB atom record: ${line}`)
    }
    atoms.push({ serial, atomName, residueName, residueNumber, xAngstrom, yAngstrom, zAngstrom, element })
  }
  if (!atoms.length) throw new Error("No ATOM/HETATM records were found in packed.pdb.")
  return { atoms, cryst1Angstrom }
}

export function validatePackedSystem(
  run: RunRecord,
  packed: PackedSystemRecord | null,
  preparations: Record<string, MoleculePreparation>,
): PrepDiagnostic[] {
  if (!packed) return [{ severity: "ERROR", code: "PACKED_PDB_REQUIRED", message: "Import Packmol packed.pdb output for validation." }]
  const diagnostics: PrepDiagnostic[] = []
  const box = runBoxAngstrom(run)
  const preparedResidues = runSpecies(run)
    .map((species) => preparations[species.moleculeId]?.residueName)
    .filter(Boolean)
  if (new Set(preparedResidues).size !== preparedResidues.length) {
    diagnostics.push({
      severity: "ERROR",
      code: "DUPLICATE_RESIDUE_NAME",
      message: "Every species in a packed system needs a unique residue name for unambiguous topology/index mapping.",
    })
  }
  let offset = 0
  let globalOrderMismatch = false
  for (const species of runSpecies(run)) {
    const p = preparations[species.moleculeId]
    if (!p || species.count === null) continue
    for (let m = 0; m < species.count && !globalOrderMismatch; m++) {
      for (const a of p.atoms) {
        const actual = packed.atoms[offset++]
        if (!actual || actual.residueName !== p.residueName || actual.atomName !== a.gromacsName || actual.element !== a.element) {
          diagnostics.push({
            severity: "ERROR",
            code: "GLOBAL_MOLECULE_ORDER_MISMATCH",
            message: "Packed atom/species order differs from the ordered [ molecules ] composition.",
          })
          globalOrderMismatch = true
          break
        }
      }
    }
  }

  let expectedTotalAtoms = 0
  for (const species of runSpecies(run)) {
    const prep = preparations[species.moleculeId]
    if (!Number.isInteger(species.count) || Number(species.count) < 0) {
      diagnostics.push({ severity: "ERROR", code: "MOLECULE_COUNT_UNRESOLVED", message: `${species.name} has no valid absolute molecule count.` })
      continue
    }
    if (!prep?.atoms.length) {
      diagnostics.push({ severity: "ERROR", code: "MOLECULE_PREPARATION_MISSING", message: `Cannot validate ${species.name}: molecular preparation is missing.` })
      continue
    }
    const observedAtoms = packed.atoms.filter((atom) => atom.residueName === prep.residueName).length
    const expectedAtoms = Number(species.count) * prep.atoms.length
    expectedTotalAtoms += expectedAtoms
    if (observedAtoms !== expectedAtoms) {
      diagnostics.push({
        severity: "ERROR",
        code: "TOPOLOGY_COORDINATE_MISMATCH",
        message: `Expected ${prep.residueName}: ${species.count} molecules (${expectedAtoms} atoms), packed.pdb has ${observedAtoms}.`,
      })
    } else {
      diagnostics.push({ severity: "INFO", code: "SPECIES_COUNT_MATCH", message: `${prep.residueName}: ${species.count} molecules (${observedAtoms} atoms) verified.` })
    }
  }
  if (packed.atoms.length !== expectedTotalAtoms) {
    diagnostics.push({
      severity: "ERROR",
      code: "TOTAL_ATOM_COUNT_MISMATCH",
      message: `Expected ${expectedTotalAtoms} total atoms; packed.pdb contains ${packed.atoms.length}.`,
    })
  }
  const outOfBounds = packed.atoms.filter(
    (atom) =>
      atom.xAngstrom < -1e-3 ||
      atom.yAngstrom < -1e-3 ||
      atom.zAngstrom < -1e-3 ||
      atom.xAngstrom > box.x + 1e-3 ||
      atom.yAngstrom > box.y + 1e-3 ||
      atom.zAngstrom > box.z + 1e-3,
  )
  if (outOfBounds.length) {
    diagnostics.push({
      severity: "WARNING",
      code: "PACKED_COORDINATES_OUTSIDE_BOX",
      message: `${outOfBounds.length} packed atom(s) fall outside the ${box.x} × ${box.y} × ${box.z} Å box.`,
    })
  }
  if (
    packed.cryst1Angstrom &&
    Math.max(
      Math.abs(packed.cryst1Angstrom.x - box.x),
      Math.abs(packed.cryst1Angstrom.y - box.y),
      Math.abs(packed.cryst1Angstrom.z - box.z),
    ) > 0.01
  ) {
    diagnostics.push({ severity: "WARNING", code: "CRYST1_BOX_MISMATCH", message: "packed.pdb CRYST1 dimensions differ from the configured run box." })
  }
  return diagnostics
}

export function generatePackedGro(run: RunRecord, packed: PackedSystemRecord) {
  const box = runBoxAngstrom(run)
  const lines = packed.atoms.map(
    (atom, index) =>
      `${String(((atom.residueNumber - 1) % 99999) + 1).padStart(5)}${atom.residueName.slice(0, 5).padEnd(5)}${atom.atomName.slice(0, 5).padStart(5)}${String((index % 99999) + 1).padStart(5)}${(atom.xAngstrom / 10).toFixed(3).padStart(8)}${(atom.yAngstrom / 10).toFixed(3).padStart(8)}${(atom.zAngstrom / 10).toFixed(3).padStart(8)}`,
  )
  return [
    `${run.runId} packed by Packmol; Angstrom converted to nm`,
    String(lines.length),
    ...lines,
    `${(box.x / 10).toFixed(5).padStart(10)}${(box.y / 10).toFixed(5).padStart(10)}${(box.z / 10).toFixed(5).padStart(10)}`,
    "",
  ].join("\n")
}

export function systemTopologyDiagnostics(run: RunRecord, preparations: Record<string, MoleculePreparation>): PrepDiagnostic[] {
  const findings: PrepDiagnostic[] = []
  const types = new Map<string, string>()
  for (const species of runSpecies(run)) {
    const prep = preparations[species.moleculeId]
    if (!Number.isSafeInteger(species.count) || Number(species.count) < 1) {
      findings.push({ severity: "ERROR", code: "SYSTEM_COUNT_UNRESOLVED", message: `${species.name}: positive integer count required.` })
    }
    if (!prep) {
      findings.push({ severity: "ERROR", code: "SYSTEM_PREPARATION_MISSING", message: `${species.name}: molecular preparation missing.` })
      continue
    }
    findings.push(...topologyDiagnostics(prep).map((d) => ({ ...d, message: `${species.name}: ${d.message}` })))
    for (const s of prep.topologySections.filter((sec) => sec.name === "atomtypes")) {
      for (const line of dataLines(s)) {
        const id = line.split(/\s+/)[0]
        const normalizedLine = line.replace(/\s+/g, " ")
        if (types.has(id) && types.get(id) !== normalizedLine) {
          findings.push({
            severity: "ERROR",
            code: "DUPLICATE_SYSTEM_ATOMTYPE",
            message: `Conflicting [ atomtypes ] definition for '${id}' across molecules. Resolve or namespace before export.`,
          })
        }
        types.set(id, normalizedLine)
      }
    }
  }
  return findings
}

export function generateTopolTop(
  run: RunRecord,
  preparations: Record<string, MoleculePreparation>,
  includeRoot = "",
) {
  const species = runSpecies(run)
  const ready = !systemTopologyDiagnostics(run, preparations).some((d) => d.severity === "ERROR")
  const externallyReviewed = ready && species.every((item) => preparations[item.moleculeId]?.gromppValidated)

  const ffInclude = (run.resolvedProtocol?.forceFieldInclude ?? run.forceFieldInclude ?? "").trim()
  const protocolDefaults = (run.resolvedProtocol?.defaultsSection ?? "").trim()

  // Collect [ defaults ] from molecules if no external forcefield.itp include is used
  const moleculeDefaults = species
    .flatMap((item) => preparations[item.moleculeId]?.topologySections.filter((s) => s.name === "defaults") ?? [])
    .flatMap((s) => dataLines(s))

  // Hoist parameter-level sections ([ atomtypes ] first), deduplicating identical lines across molecules!
  const hoistedMap = new Map<string, { name: string; lines: string[] }>()
  for (const item of species) {
    const sections = (preparations[item.moleculeId]?.topologySections ?? []).filter((s) => PARAMETER_SECTIONS.has(s.name))
    for (const s of sections) {
      if (!hoistedMap.has(s.name)) hoistedMap.set(s.name, { name: s.name, lines: [] })
      const bucket = hoistedMap.get(s.name)!
      for (const line of s.lines) {
        const trimmed = line.split(";")[0].trim()
        if (!trimmed) continue
        const norm = trimmed.replace(/\s+/g, " ")
        if (!bucket.lines.some((existing) => existing.split(";")[0].trim().replace(/\s+/g, " ") === norm)) {
          bucket.lines.push(line)
        }
      }
    }
  }
  const hoistedSections = [...hoistedMap.values()].sort((a, b) => Number(b.name === "atomtypes") - Number(a.name === "atomtypes"))

  const includePath = (id: string) => (includeRoot ? `${includeRoot}/${slug(id)}/topology/${slug(id)}.itp` : `${slug(id)}.itp`)
  const headerLines = [
    `; System topology for ${run.runId}`,
    `; Force field: ${run.forceField} | Charges: ${run.chargeScheme}`,
    `; STATUS: ${ready ? (externallyReviewed ? "RESEARCHER ACCEPTED — EXTERNAL GROMPP REPORTED" : "READY FOR GROMPP VALIDATION — NOT YET PRODUCTION VALIDATED") : "INCOMPLETE — DO NOT USE FOR PRODUCTION MD"}`,
    `; Coordinate counts must match [ molecules ]; validate packed.pdb before grompp.`,
  ]

  if (ffInclude) {
    headerLines.push(`#include "${ffInclude}"`, "")
  } else {
    const defLine = protocolDefaults || moleculeDefaults[0] || ""
    if (defLine) {
      headerLines.push("[ defaults ]", "; nbfunc comb-rule gen-pairs fudgeLJ fudgeQQ", defLine, "")
    } else {
      headerLines.push("; Self-contained topology (no external forcefield.itp include configured)", "")
    }
  }

  return [
    ...headerLines,
    ...hoistedSections.flatMap((s) => ["[ " + s.name + " ]", ...s.lines, ""]),
    "#define SOLVFORGE_SYSTEM_PARAMETERS",
    ...species.map((item) => `#include "${includePath(item.moleculeId)}"`),
    "#undef SOLVFORGE_SYSTEM_PARAMETERS",
    "",
    "[ system ]",
    run.soluteName && run.soluteCount > 0 ? `${run.systemName} + ${run.soluteName}` : run.systemName,
    "",
    "[ molecules ]",
    "; Moleculetype  count",
    ...species.map(
      (item) =>
        `${(preparations[item.moleculeId]?.residueName ?? "UNRESOLVED").padEnd(14)} ${Number.isInteger(item.count) ? item.count : "UNRESOLVED"}`,
    ),
    "",
  ].join("\n")
}

export function generateIndexNdx(
  packed: PackedSystemRecord,
  run: RunRecord,
  preparations: Record<string, MoleculePreparation>,
) {
  const groups: string[] = []
  // Include full System group first
  const allIndices = packed.atoms.map((_, idx) => idx + 1)
  groups.push("[ System ]")
  for (let i = 0; i < allIndices.length; i += 15) groups.push(allIndices.slice(i, i + 15).join(" "))
  groups.push("")

  for (const species of runSpecies(run)) {
    const residue = preparations[species.moleculeId]?.residueName
    if (!residue) continue
    const indices = packed.atoms.map((atom, index) => (atom.residueName === residue ? index + 1 : 0)).filter(Boolean)
    groups.push(`[ ${residue} ]`)
    for (let i = 0; i < indices.length; i += 15) groups.push(indices.slice(i, i + 15).join(" "))
    groups.push("")
  }
  return `${groups.join("\n")}\n`
}

export function pairwiseSpecies(run: RunRecord, preparations: Record<string, MoleculePreparation>) {
  const residues = runSpecies(run).map((species) => ({
    moleculeId: species.moleculeId,
    label: preparations[species.moleculeId]?.residueName ?? species.name.toUpperCase().replace(/\W+/g, "_"),
  }))
  const pairs: Array<{ a: string; b: string }> = []
  for (let i = 0; i < residues.length; i++) {
    for (let j = i; j < residues.length; j++) pairs.push({ a: residues[i].label, b: residues[j].label })
  }
  return pairs
}

function rdfSelection(label: string, mode: QmGromacsState["rdf"]["mode"], custom: Record<string, string>) {
  if (mode === "custom") return custom[label] || `<CUSTOM_SELECTION_${label}>`
  if (mode === "center-of-mass") return `res_com of resname ${label}`
  return `resname ${label}`
}
const shellQuote = (text: string) => "'" + text.replaceAll("'", "'\"'\"'") + "'"

export function rdfCommandDiagnostics(
  run: RunRecord,
  preparations: Record<string, MoleculePreparation>,
  settings: QmGromacsState["rdf"],
) {
  const errors: string[] = []
  if (!["center-of-mass", "atom-based", "custom"].includes(settings.mode)) errors.push("Unknown RDF definition.")
  if (!Number.isFinite(settings.binWidthNm) || settings.binWidthNm <= 0 || !Number.isFinite(settings.rmaxNm) || settings.rmaxNm <= settings.binWidthNm) {
    errors.push("RDF requires 0 < bin width < maximum radius in nm.")
  }
  const maximum = run.resolvedProtocol?.production?.maximumNs ?? run.productionNs
  if (maximum > 0 && (!Number.isFinite(settings.beginNs) || !Number.isFinite(settings.endNs) || settings.beginNs < 0 || settings.endNs <= settings.beginNs || settings.endNs > maximum)) {
    errors.push("RDF window must be finite, non-negative, increasing, and within the production duration.")
  }
  for (const species of runSpecies(run)) {
    const residue = preparations[species.moleculeId]?.residueName
    if (!residue || !/^\w{1,4}$/.test(residue)) errors.push(`${species.name}: mapped residue name is required.`)
    else if (settings.mode === "custom" && (!settings.customSelections[residue]?.trim() || /[\r\n]/.test(settings.customSelections[residue]))) {
      errors.push(`${residue}: supply a single-line custom GROMACS selection.`)
    }
  }
  return errors
}

export function generateRdfCommands(
  run: RunRecord,
  preparations: Record<string, MoleculePreparation>,
  settings: QmGromacsState["rdf"],
) {
  const errors = rdfCommandDiagnostics(run, preparations, settings)
  if (errors.length) return errors.map((e) => "# ERROR: " + e).join("\n") + "\n"
  const pairCommands = pairwiseSpecies(run, preparations).map(
    ({ a, b }) =>
      `gmx rdf -f 04_prod/prod.xtc -s 04_prod/prod.tpr -n 00_input/index.ndx -ref ${shellQuote(rdfSelection(a, settings.mode, settings.customSelections))} -sel ${shellQuote(rdfSelection(b, settings.mode, settings.customSelections))} -bin ${settings.binWidthNm} -rmax ${settings.rmaxNm} -b ${settings.beginNs * 1000} -e ${settings.endNs * 1000} -o analysis/rdf/rdf_${a}_${b}.xvg`,
  )
  return `#!/usr/bin/env bash\nset -euo pipefail\nmkdir -p analysis/rdf\n# Optional post-MD RDF extraction (ready for MoDy Analyse)\n${pairCommands.join("\n")}\n`
}

export function parseBlocks(value: string) {
  if (!value.trim()) throw new Error("Supply at least one explicit time block.")
  return value
    .split(/[,;\n]+/)
    .filter((p) => p.trim())
    .map((part) => {
      const m = part.trim().match(/^(\d+(?:\.\d*)?|\.\d+)\s*[-–:]\s*(\d+(?:\.\d*)?|\.\d+)$/)
      if (!m || !Number.isFinite(Number(m[1])) || !Number.isFinite(Number(m[2])) || Number(m[2]) <= Number(m[1])) {
        throw new Error(`Invalid block: ${part}.`)
      }
      return { startNs: Number(m[1]), endNs: Number(m[2]) }
    })
}

export function generateBlockRdfCommands(
  run: RunRecord,
  preparations: Record<string, MoleculePreparation>,
  settings: QmGromacsState["rdf"],
) {
  const errors = rdfCommandDiagnostics(run, preparations, settings)
  if (errors.length) return errors.map((e) => "# ERROR: " + e).join("\n") + "\n"
  let blocks: ReturnType<typeof parseBlocks>
  try {
    blocks = parseBlocks(settings.blocks)
  } catch (e) {
    return "# ERROR: " + String(e) + "\n"
  }
  const maxNs = run.resolvedProtocol?.production?.maximumNs ?? run.productionNs
  if (maxNs > 0 && blocks.some((b) => b.endNs > maxNs)) {
    return "# ERROR: Block exceeds the resolved production maximum.\n"
  }
  const lines = [
    "#!/usr/bin/env bash",
    "set -euo pipefail",
    "mkdir -p analysis/blocks",
    "# Optional block RDF extraction (for downstream convergence checks in MoDy Analyse)",
  ]
  for (const block of blocks) {
    for (const { a, b } of pairwiseSpecies(run, preparations)) {
      lines.push(
        `gmx rdf -f 04_prod/prod.xtc -s 04_prod/prod.tpr -n 00_input/index.ndx -ref ${shellQuote(rdfSelection(a, settings.mode, settings.customSelections))} -sel ${shellQuote(rdfSelection(b, settings.mode, settings.customSelections))} -bin ${settings.binWidthNm} -rmax ${settings.rmaxNm} -b ${block.startNs * 1000} -e ${block.endNs * 1000} -o analysis/blocks/rdf_${a}_${b}_${block.startNs}-${block.endNs}ns.xvg`,
      )
    }
  }
  return `${lines.join("\n")}\n`
}

export function executionFor(state: QmGromacsState, runId: string): ExecutionStatus {
  return state.execution[runId] ?? { em: "not-run", nvt: "not-run", npt: "not-run", production: "not-run" }
}

export function projectChecklist(run: RunRecord | undefined, state: QmGromacsState) {
  if (!run) {
    return [{ label: "Generated run selected", status: "WAITING" as StepStatus, detail: "Generate and select a run in Run Matrix & MDP first." }]
  }
  const species = runSpecies(run)
  const preps = species.map((item) => state.molecules[item.moleculeId]).filter(Boolean)
  const all = (predicate: (prep: MoleculePreparation) => boolean) => preps.length === species.length && preps.every(predicate)
  const packed = state.packedSystems[run.runId] ?? null
  const packedDiagnostics = validatePackedSystem(run, packed, state.molecules)
  const execution = executionFor(state, run.runId)

  return [
    {
      label: "Molecular geometry loaded",
      status: all((prep) => prep.geometryAtoms.length > 0) ? ("AUTOMATICALLY VERIFIED" as StepStatus) : ("WAITING" as StepStatus),
      detail: `${preps.filter((prep) => prep.geometryAtoms.length > 0).length}/${species.length} species`,
    },
    {
      label: "Partial charges resolved",
      status: all((prep) => prep.atoms.length > 0 && prep.atoms.every((atom) => atom.finalCharge !== null))
        ? ("AUTOMATICALLY VERIFIED" as StepStatus)
        : ("WAITING" as StepStatus),
      detail: "QM / topology / manual charges mapped without silent reordering",
    },
    {
      label: "QM & atom-order check",
      status: all((prep) => !qmDiagnostics(prep).some((item) => item.severity === "ERROR"))
        ? ("AUTOMATICALLY VERIFIED" as StepStatus)
        : ("WAITING" as StepStatus),
      detail: "Geometry ↔ charge mapping & formal charge sum",
    },
    {
      label: "Connectivity approved",
      status: all((prep) => prep.atoms.length <= 1 || prep.connectivityApproved) ? ("RESEARCHER ACCEPTED" as StepStatus) : ("WAITING" as StepStatus),
      detail: "Bond graph verified against topology",
    },
    {
      label: "Force-field atom typing",
      status: all((prep) => prep.atoms.every((atom) => atom.atomType && !["UNMAPPED", "REVIEW REQUIRED"].includes(atom.mappingStatus)))
        ? ("RESEARCHER ACCEPTED" as StepStatus)
        : ("WAITING" as StepStatus),
      detail: `${run.forceField} atom types assigned & reviewed`,
    },
    {
      label: "Molecular topology (.itp)",
      status: all((prep) => !topologyDiagnostics(prep).some((item) => item.severity === "ERROR"))
        ? ("RESEARCHER ACCEPTED" as StepStatus)
        : ("WAITING" as StepStatus),
      detail: "Bonded framework + partial-charge merge",
    },
    {
      label: "External grompp check",
      status: all((prep) => prep.gromppValidated) ? ("RESEARCHER ACCEPTED" as StepStatus) : ("WAITING" as StepStatus),
      detail: "Researcher-reported external gmx grompp check",
    },
    {
      label: "Box composition",
      status: run.compositionCalculation ? ("AUTOMATICALLY VERIFIED" as StepStatus) : ("WAITING" as StepStatus),
      detail: run.compositionCalculation ? `${run.totalMoleculeCount} molecules` : "Manual or density counts required",
    },
    {
      label: "Packed system validated",
      status: packed && !packedDiagnostics.some((item) => item.severity === "ERROR") ? ("AUTOMATICALLY VERIFIED" as StepStatus) : ("WAITING" as StepStatus),
      detail: packed ? `${packed.atoms.length} atoms` : "Import Packmol packed.pdb",
    },
    { label: "EM", status: execution.em === "accepted" ? "RESEARCHER ACCEPTED" : execution.em === "failed" ? "FAIL" : "NOT RUN", detail: "Energy minimization" },
    { label: "NVT", status: execution.nvt === "accepted" ? "RESEARCHER ACCEPTED" : execution.nvt === "failed" ? "FAIL" : "NOT RUN", detail: "NVT equilibration" },
    { label: "NPT", status: execution.npt === "accepted" ? "RESEARCHER ACCEPTED" : execution.npt === "failed" ? "FAIL" : "NOT RUN", detail: "NPT equilibration" },
    { label: "Production", status: execution.production === "accepted" ? "RESEARCHER ACCEPTED" : execution.production === "failed" ? "FAIL" : "NOT RUN", detail: "Production trajectory → MoDy Analyse" },
  ]
}
