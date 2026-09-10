import type { Molecule, RDFDataset, RunRecord } from "./types"
import { canonical,sha256 as sourceSha256 } from "./identity.ts"
import { FORCE_FIELD, CHARGE_SOURCE, FORCE_FIELD_INCLUDE } from "./version.ts"

export type PrepSeverity = "ERROR" | "WARNING" | "INFO"
export type PrepDiagnostic = { severity: PrepSeverity; code: string; message: string }
export type StepStatus = "PASS" | "WARNING" | "FAIL" | "WAITING" | "NOT RUN" | "RESEARCHER ACCEPTED" | "AUTOMATICALLY VERIFIED"

export type SourceFileRecord = {
  name: string
  text: string
  size: number
  lastModified: number
  sha256: string
  importedAt: string
}

export type CoordinateAtom = { index: number; element: string; x: number; y: number; z: number }
export type OrcaCharge = { outIndex: number; element: string; charge: number }

export type PreparedAtom = CoordinateAtom & {
  outIndex: number
  outElement: string | null
  gromacsName: string
  residueName: string
  mullikenCharge: number | null
  existingTopologyCharge: number | null
  finalCharge: number | null
  oplsType: string
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
  source: "covalent-radius" | "user" | "topology-import"
}

export type TopologySection = { name: string; lines: string[] }
const PARAMETER_SECTIONS = new Set(["atomtypes", "bondtypes", "pairtypes", "angletypes", "dihedraltypes", "constrainttypes", "nonbond_params", "cmaptypes", "implicit_genborn_params"])

export type MoleculePreparation = {
  moleculeId: string
  residueName: string
  expectedFormalCharge: number
  chargeTolerance: number
  chargeAcknowledged: boolean
  geometryAcknowledged: boolean
  xyzFile: SourceFileRecord | null
  outFile: SourceFileRecord | null
  xyzComment: string
  xyzAtoms: CoordinateAtom[]
  outCoordinates: CoordinateAtom[]
  outCharges: OrcaCharge[]
  atoms: PreparedAtom[]
  bonds: BondRecord[]
  connectivityApproved: boolean
  coordinateSettings: { center: boolean; translateAngstrom: { x: number; y: number; z: number } }
  orcaMetadata: { inputLine: string; method: string; basis: string; parsedTotalCharge: number | null; terminatedNormally: boolean }
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
  history?: Array<{id:string;projectId:string;stage:string;classification:string;rationale:string;timestamp:string;softwareVersion:string;actor:"researcher"}>
  em: "not-run" | "failed" | "accepted"
  nvt: "not-run" | "failed" | "accepted"
  npt: "not-run" | "failed" | "accepted"
  production: "not-run" | "failed" | "accepted"
}

export type OrcaGromacsState = {
  projectId?: string
  schemaVersion: "0.1"
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
  ssm: { sizesNm: string; beginNs: number; endNs: number; pair: string }
  updatedAt: string
}

export const defaultOrcaGromacsState = (): OrcaGromacsState => ({
  schemaVersion: "0.1",
  tutorialMode: true,
  selectedMoleculeId: "",
  selectedRunId: "",
  molecules: {},
  packedSystems: {},
  execution: {},
  commandOverrides: {},
  packmol: { toleranceAngstrom: 2, marginAngstrom: 1, periodic: true },
  rdf: { mode: "center-of-mass", binWidthNm: 0.002, rmaxNm: 2.4, beginNs: 0, endNs: 100, customSelections: {}, blocks: "0-20, 20-40, 40-60, 60-80, 80-100" },
  ssm: { sizesNm: "1.5, 2.0, 2.5, 3.0", beginNs: 0, endNs: 100, pair: "" },
  updatedAt: new Date().toISOString(),
})

export function migrateOrcaGromacsState(input?: Partial<OrcaGromacsState> | null): OrcaGromacsState {
  const defaults = defaultOrcaGromacsState()
  if (!input) return defaults
  return {
    ...defaults,
    ...input,
    schemaVersion: "0.1",
    molecules: Object.fromEntries(Object.entries(input.molecules ?? {}).map(([id, preparation]) => [id, { ...preparation, geometryAcknowledged: preparation.geometryAcknowledged ?? false }])),
    packedSystems: input.packedSystems ?? {},
    execution: input.execution ?? {},
    commandOverrides: input.commandOverrides ?? {},
    packmol: { ...defaults.packmol, ...input.packmol },
    rdf: { ...defaults.rdf, ...input.rdf, customSelections: input.rdf?.customSelections ?? {} },
    ssm: { ...defaults.ssm, ...input.ssm },
  }
}

const ELEMENT_MASS: Record<string, number> = { H: 1.008, C: 12.011, N: 14.007, O: 15.999, F: 18.998, P: 30.974, S: 32.06, Cl: 35.45, Br: 79.904, I: 126.904 }
const COVALENT_RADIUS: Record<string, number> = { H: 0.31, C: 0.76, N: 0.71, O: 0.66, F: 0.57, P: 1.07, S: 1.05, Cl: 1.02, Br: 1.20, I: 1.39 }

const cleanElement = (value: string) => value.slice(0, 1).toUpperCase() + value.slice(1).toLowerCase()
const finite = (value: number) => Number.isFinite(value)
const slug = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "molecule"
const csvCell = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`
const csv = (rows: unknown[][]) => rows.map((row) => row.map(csvCell).join(",")).join("\n")

export async function sourceFileRecord(file: File): Promise<SourceFileRecord> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes)
  if (new TextEncoder().encode(text).length !== bytes.length) throw new Error("Source encoding cannot be preserved; supply UTF-8 text without byte-order mark.")
  const sha256 = await sourceSha256(text)
  return { name: file.name, text, size: file.size, lastModified: file.lastModified, sha256, importedAt: new Date().toISOString() }
}

export function parseXyz(text: string) {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/)
  const atomCount = Number(lines[0]?.trim())
  if (!Number.isInteger(atomCount) || atomCount <= 0) throw new Error("XYZ first line must contain a positive atom count.")
  const comment = lines[1] ?? ""
  const atoms: CoordinateAtom[] = []
  for (let i = 0; i < atomCount; i++) {
    const fields = (lines[i + 2] ?? "").trim().split(/\s+/)
    if (fields.length < 4) throw new Error(`XYZ atom line ${i + 1} is missing element or coordinates.`)
    const [elementRaw, xRaw, yRaw, zRaw] = fields
    const x = Number(xRaw), y = Number(yRaw), z = Number(zRaw)
    if (![x, y, z].every(finite)) throw new Error(`XYZ atom line ${i + 1} contains malformed coordinates.`)
    atoms.push({ index: i + 1, element: cleanElement(elementRaw), x, y, z })
  }
  return { atomCount, comment, atoms }
}

function lastSectionLines(text: string, heading: RegExp) {
  const lines = text.split(/\r?\n/)
  let start = -1
  for (let i = 0; i < lines.length; i++) if (heading.test(lines[i])) start = i
  return start < 0 ? [] : lines.slice(start + 1)
}

export function parseOrcaOutput(text: string) {
  const chargeLines = lastSectionLines(text, /MULLIKEN\s+ATOMIC\s+CHARGES/i)
  const charges: OrcaCharge[] = []
  for (const line of chargeLines) {
    const match = line.match(/^\s*(\d+)\s+([A-Za-z]{1,3})\s*:\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[EeDd][+-]?\d+)?)\b/)
    if (match) charges.push({ outIndex: Number(match[1]) + 1, element: cleanElement(match[2]), charge: Number(match[3].replace(/[Dd]/, "E")) })
    else if (charges.length && /Sum\s+of\s+atomic\s+charges|MULLIKEN\s+REDUCED/i.test(line)) break
  }

  const coordinateLines = lastSectionLines(text, /CARTESIAN\s+COORDINATES\s*\(ANGSTROE?M\)/i)
  const outCoordinates: CoordinateAtom[] = []
  for (const line of coordinateLines) {
    const match = line.match(/^\s*([A-Za-z]{1,3})\s+([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[EeDd][+-]?\d+)?)\s+([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[EeDd][+-]?\d+)?)\s+([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[EeDd][+-]?\d+)?)/)
    if (match) outCoordinates.push({ index: outCoordinates.length + 1, element: cleanElement(match[1]), x: Number(match[2].replace(/[Dd]/, "E")), y: Number(match[3].replace(/[Dd]/, "E")), z: Number(match[4].replace(/[Dd]/, "E")) })
    else if (outCoordinates.length) break
  }

  const inputLines = text.split(/\r?\n/).filter((line) => /^\s*(?:\|\s*\d+>\s*)?!/.test(line)).map((line) => line.trim())
  const inputLine = inputLines.at(-1) ?? ""
  const method = /\bBP86\b/i.test(inputLine) ? "BP86" : "not detected"
  const basis = /\bdef2[-–]?TZVP\b/i.test(inputLine) ? "def2-TZVP" : "not detected"
  const xyzCharge = [...text.matchAll(/\*\s*xyz(?:file)?\s+(-?\d+)\s+\d+/gi)].at(-1)
  const totalChargeLine = [...text.matchAll(/Total\s+Charge[^\n]*?(-?\d+)\s*$/gim)].at(-1)
  const parsedTotalCharge = xyzCharge ? Number(xyzCharge[1]) : totalChargeLine ? Number(totalChargeLine[1]) : null
  return { charges, outCoordinates, metadata: { inputLine, method, basis, parsedTotalCharge, terminatedNormally: /ORCA\s+TERMINATED\s+NORMALLY/i.test(text) } }
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
  production: "#!/usr/bin/env bash\nset -euo pipefail\ngmx grompp -f 04_prod/prod.mdp -c 03_npt/npt.gro -t 03_npt/npt.cpt -p 00_input/topol.top -n 00_input/index.ndx -o 04_prod/prod.tpr -maxwarn 0\ngmx mdrun -deffnm 04_prod/prod\n# Restart after interruption only: gmx mdrun -deffnm 04_prod/prod -cpi 04_prod/prod.cpt -append",
} as const

export function commandText(state: OrcaGromacsState, key: string, generated: string) {
  return Object.prototype.hasOwnProperty.call(state.commandOverrides, key) ? state.commandOverrides[key] : generated
}

export function thesisResidueName(molecule: Molecule) {
  return (molecule.residueName || molecule.abbreviation || "MOL").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4) || "MOL"
}

export function emptyMoleculePreparation(molecule: Molecule): MoleculePreparation {
  return {
    moleculeId: molecule.id,
    residueName: thesisResidueName(molecule),
    expectedFormalCharge: molecule.charge,
    chargeTolerance: 1e-4,
    chargeAcknowledged: false,
    geometryAcknowledged: false,
    xyzFile: null,
    outFile: null,
    xyzComment: "",
    xyzAtoms: [],
    outCoordinates: [],
    outCharges: [],
    atoms: [],
    bonds: [],
    connectivityApproved: false,
    coordinateSettings: { center: false, translateAngstrom: { x: 0, y: 0, z: 0 } },
    orcaMetadata: { inputLine: "", method: "not detected", basis: "not detected", parsedTotalCharge: null, terminatedNormally: false },
    topologyFileName: "",
    topologyText: "",
    topologySections: [],
    topologyReviewed: false,
    gromppValidated: false,
    notes: "",
    updatedAt: new Date().toISOString(),
  }
}

export function reconcilePreparation(preparation: MoleculePreparation): MoleculePreparation {
  const names = deterministicAtomNames(preparation.xyzAtoms)
  const previous = new Map(preparation.atoms.map((atom) => [atom.index, atom]))
  const charges = new Map(preparation.outCharges.map((charge) => [charge.outIndex, charge]))
  const atoms = preparation.xyzAtoms.map((xyz, index) => {
    const prior = previous.get(xyz.index)
    const outIndex = prior?.outIndex ?? xyz.index
    const charge = charges.get(outIndex)
    const mullikenCharge = charge && charge.element === xyz.element ? charge.charge : null
    return {
      ...xyz,
      outIndex,
      outElement: charge?.element ?? null,
      gromacsName: prior?.gromacsName ?? names[index],
      residueName: preparation.residueName,
      mullikenCharge,
      existingTopologyCharge: prior?.existingTopologyCharge ?? null,
      finalCharge: mullikenCharge,
      oplsType: prior?.oplsType ?? "",
      mass: prior?.mass ?? ELEMENT_MASS[xyz.element] ?? null,
      ljSource: prior?.ljSource ?? "",
      mappingStatus: prior?.mappingStatus ?? "UNMAPPED" as const,
    }
  })
  return { ...preparation, atoms, updatedAt: new Date().toISOString() }
}

export function attachXyz(preparation: MoleculePreparation, file: SourceFileRecord) {
  const parsed = parseXyz(file.text)
  return reconcilePreparation({ ...preparation, xyzFile: file, atoms: [], topologyText: "", topologySections: [], topologyReviewed: false, gromppValidated: false, xyzComment: parsed.comment, xyzAtoms: parsed.atoms, bonds: [], connectivityApproved: false, geometryAcknowledged: false })
}

export function attachOrcaOutput(preparation: MoleculePreparation, file: SourceFileRecord) {
  const parsed = parseOrcaOutput(file.text)
  return reconcilePreparation({ ...preparation, outFile: file, topologyReviewed: false, gromppValidated: false, outCoordinates: parsed.outCoordinates, outCharges: parsed.charges, orcaMetadata: parsed.metadata, chargeAcknowledged: false, geometryAcknowledged: false })
}

export function mappedChargeSum(preparation: MoleculePreparation) {
  return preparation.atoms.reduce((sum, atom) => sum + (atom.mullikenCharge ?? 0), 0)
}

export function geometryDifference(preparation: MoleculePreparation) {
  if (!preparation.xyzAtoms.length || preparation.outCoordinates.length !== preparation.xyzAtoms.length) return null
  let sum = 0, max = 0
  for (const atom of preparation.atoms) {
    const out = preparation.outCoordinates[atom.outIndex - 1]
    if (!out || out.element !== atom.element) return null
    const distance = Math.hypot(atom.x - out.x, atom.y - out.y, atom.z - out.z)
    sum += distance * distance
    max = Math.max(max, distance)
  }
  return { rmsdAngstrom: Math.sqrt(sum / preparation.atoms.length), maxDisplacementAngstrom: max }
}

export function orcaDiagnostics(preparation: MoleculePreparation): PrepDiagnostic[] {
  const diagnostics: PrepDiagnostic[] = []
  if (!preparation.xyzFile) diagnostics.push({ severity: "ERROR", code: "XYZ_REQUIRED", message: "Import one ORCA XYZ geometry file." })
  if (!preparation.outFile) diagnostics.push({ severity: "ERROR", code: "ORCA_OUT_REQUIRED", message: "Import the corresponding ORCA .out file." })
  if (preparation.xyzFile && !preparation.xyzAtoms.length) diagnostics.push({ severity: "ERROR", code: "XYZ_EMPTY", message: "No atoms were parsed from the XYZ file." })
  if (preparation.outFile && !preparation.outCharges.length) diagnostics.push({ severity: "ERROR", code: "MULLIKEN_NOT_FOUND", message: "No complete MULLIKEN ATOMIC CHARGES section was found in the ORCA output." })
  if (preparation.xyzAtoms.length && preparation.outCharges.length && preparation.xyzAtoms.length !== preparation.outCharges.length) diagnostics.push({ severity: "ERROR", code: "ATOM_COUNT_MISMATCH", message: `.xyz contains ${preparation.xyzAtoms.length} atoms but the parsed Mulliken block contains ${preparation.outCharges.length}.` })
  const mapped = preparation.atoms.map((atom) => atom.outIndex)
  if (mapped.some((index) => !Number.isInteger(index) || index < 1 || index > preparation.outCharges.length) || new Set(mapped).size !== mapped.length) diagnostics.push({ severity: "ERROR", code: "MAPPING_NOT_BIJECTIVE", message: "Every XYZ atom must map to one unique ORCA output atom index." })
  for (const atom of preparation.atoms) if (atom.outElement && atom.element !== atom.outElement) diagnostics.push({ severity: "ERROR", code: "ATOM_MAPPING_MISMATCH", message: `.xyz atom ${atom.index} = ${atom.element}; mapped .out atom ${atom.outIndex} = ${atom.outElement}. Resolve the mapping explicitly.` })
  if (preparation.outCharges.length && preparation.atoms.some((atom) => atom.mullikenCharge === null)) diagnostics.push({ severity: "ERROR", code: "CHARGE_MAPPING_INCOMPLETE", message: "At least one XYZ atom has no mapped Mulliken charge." })
  const sum = mappedChargeSum(preparation)
  const difference = sum - preparation.expectedFormalCharge
  if (preparation.orcaMetadata.parsedTotalCharge !== null && preparation.orcaMetadata.parsedTotalCharge !== preparation.expectedFormalCharge) diagnostics.push({ severity: "ERROR", code: "ORCA_FORMAL_CHARGE_MISMATCH", message: `ORCA input/output metadata declares total charge ${preparation.orcaMetadata.parsedTotalCharge}, while the Molecule Library expects ${preparation.expectedFormalCharge}. Resolve the molecular charge identity before topology preparation.` })
  if (preparation.atoms.length && preparation.atoms.every((atom) => atom.mullikenCharge !== null) && Math.abs(difference) > preparation.chargeTolerance) diagnostics.push({ severity: preparation.chargeAcknowledged ? "WARNING" : "ERROR", code: "CHARGE_SUM_MISMATCH", message: `Parsed Mulliken sum ${sum.toFixed(8)} differs from expected charge ${preparation.expectedFormalCharge} by ${difference.toExponential(3)}. Charges were not normalized or redistributed.` })
  const geometry = geometryDifference(preparation)
  if (preparation.outCoordinates.length && preparation.outCoordinates.length !== preparation.xyzAtoms.length) diagnostics.push({ severity: "WARNING", code: "OUTPUT_GEOMETRY_COUNT_MISMATCH", message: "The final ORCA coordinate table could not be compared because its atom count differs from the XYZ file." })
  else if (preparation.outCoordinates.length && preparation.atoms.some((atom) => preparation.outCoordinates[atom.outIndex - 1]?.element !== atom.element)) diagnostics.push({ severity: "ERROR", code: "OUTPUT_GEOMETRY_ELEMENT_MISMATCH", message: "Mapped XYZ atoms do not match the element sequence in the final ORCA coordinate table." })
  else if (geometry && geometry.maxDisplacementAngstrom > 0.05) diagnostics.push({ severity: preparation.geometryAcknowledged ? "WARNING" : "ERROR", code: "GEOMETRY_DIFFERENCE", message: `XYZ versus mapped final ORCA coordinates: RMSD ${geometry.rmsdAngstrom.toFixed(5)} Å; maximum displacement ${geometry.maxDisplacementAngstrom.toFixed(5)} Å. Confirm that this reflects geometry optimization rather than atom reordering.` })
  if (preparation.outFile && !preparation.orcaMetadata.terminatedNormally) diagnostics.push({ severity: "WARNING", code: "ORCA_NOT_TERMINATED", message: "ORCA TERMINATED NORMALLY was not detected in the imported output." })
  if (preparation.outFile && (preparation.orcaMetadata.method !== "BP86" || preparation.orcaMetadata.basis !== "def2-TZVP")) diagnostics.push({ severity: "WARNING", code: "METHOD_METADATA_MISMATCH", message: `Detected method/basis: ${preparation.orcaMetadata.method}/${preparation.orcaMetadata.basis}. The Andaliman preset requires BP86/def2-TZVP.` })
  return diagnostics
}

const distance = (a: CoordinateAtom, b: CoordinateAtom) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)

export function proposeConnectivity(preparation: MoleculePreparation): MoleculePreparation {
  const bonds: BondRecord[] = []
  for (let i = 0; i < preparation.xyzAtoms.length; i++) for (let j = i + 1; j < preparation.xyzAtoms.length; j++) {
    const a = preparation.xyzAtoms[i], b = preparation.xyzAtoms[j]
    const radiusA = COVALENT_RADIUS[a.element], radiusB = COVALENT_RADIUS[b.element]
    if (!radiusA || !radiusB) continue
    const d = distance(a, b)
    const threshold = 1.25 * (radiusA + radiusB)
    if (d >= 0.4 && d <= threshold) bonds.push({ id: `${a.index}-${b.index}`, ai: a.index, aj: b.index, elementI: a.element, elementJ: b.element, distanceAngstrom: d, definition: "connectivity suggestion; bond function/order unassigned", proposed: true, accepted: false, source: "covalent-radius" })
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
    } else if (current) current.lines.push(raw)
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
  const atoms = preparation.atoms.map((atom) => {
    const fields = parsedAtoms.find((item) => Number(item[0]) === atom.index)
    if (!fields) return atom
    const existingCharge = Number(fields[6])
    const mass = fields[7] === undefined ? atom.mass : Number(fields[7])
    return {
      ...atom,
      oplsType: fields[1] ?? "",
      existingTopologyCharge: Number.isFinite(existingCharge) ? existingCharge : null,
      finalCharge: atom.mullikenCharge,
      mass: Number.isFinite(mass) ? mass : atom.mass,
      ljSource: "oplsaa.ff lookup from imported x2top topology; must pass grompp",
      mappingStatus: fields[1] ? "REVIEW REQUIRED" as const : "UNMAPPED" as const,
    }
  })
  const importedBonds = dataLines(sections.find((section) => section.name === "bonds")).reduce<BondRecord[]>((bonds, line, index) => {
    const fields = line.split(/\s+/)
    const ai = Number(fields[0]), aj = Number(fields[1])
    const atomI = preparation.xyzAtoms[ai - 1], atomJ = preparation.xyzAtoms[aj - 1]
    if (atomI && atomJ) bonds.push({ id: `top-${index + 1}-${ai}-${aj}`, ai, aj, elementI: atomI.element, elementJ: atomJ.element, distanceAngstrom: distance(atomI, atomJ), definition: fields.slice(2).join(" ") || "function/parameters not supplied", proposed: false, accepted: true, source: "topology-import" })
    return bonds
  }, [])
  return { ...preparation, originalTopologyFile: preparation.originalTopologyFile ?? file, topologyFileName: file.name, topologyText: file.text, topologySections: sections, atoms, bonds: importedBonds.length ? importedBonds : preparation.bonds, connectivityApproved: importedBonds.length ? false : preparation.connectivityApproved, topologyReviewed: false, gromppValidated: false, updatedAt: new Date().toISOString() }
}

export function applyEditedTopology(preparation: MoleculePreparation, text: string) {
  const file: SourceFileRecord = { name: preparation.topologyFileName || "edited_x2top.top", text, size: new TextEncoder().encode(text).byteLength, lastModified: Date.now(), sha256: "edited-in-workbench", importedAt: new Date().toISOString() }
  return importTopology(preparation, file)
}

export function topologyDiagnostics(preparation: MoleculePreparation): PrepDiagnostic[] {
  const diagnostics = [...orcaDiagnostics(preparation)]
  if(canonical(parseTopologySections(preparation.topologyText))!==canonical(preparation.topologySections))diagnostics.push({severity:"ERROR",code:"TOPOLOGY_TEXT_NOT_PARSED",message:"Re-parse the edited topology before generation."})
  if(preparation.atoms.some(a=>!Number.isFinite(a.mass)||!(a.mass!>0)||a.finalCharge!==a.mullikenCharge))diagnostics.push({severity:"ERROR",code:"MASS_CHARGE_CONFLICT",message:"Positive masses and exact mapped ORCA Mulliken final charges are required."})
  if(!/^[A-Za-z][A-Za-z0-9]{0,3}$/.test(preparation.residueName))diagnostics.push({severity:"ERROR",code:"RESIDUE_NAME_INVALID",message:"Use a unique residue name with 1–4 alphanumeric characters, beginning with a letter."})
  const atomIndices = preparation.atoms.map((atom) => atom.index)
  if (new Set(atomIndices).size !== atomIndices.length) diagnostics.push({ severity: "ERROR", code: "DUPLICATE_ATOM_INDEX", message: "Molecular atom indices must be unique." })
  const atomNames = preparation.atoms.map((atom) => atom.gromacsName.trim()).filter(Boolean)
  if (atomNames.length !== preparation.atoms.length) diagnostics.push({ severity: "ERROR", code: "ATOM_NAME_MISSING", message: "Every atom requires a stable GROMACS atom name." })
  if (new Set(atomNames).size !== atomNames.length) diagnostics.push({ severity: "ERROR", code: "DUPLICATE_ATOM_NAME", message: "Stable atom names must be unique within this molecular residue for unambiguous mapping." })
  if (atomNames.some((name) => name.length > 4)) diagnostics.push({ severity: "ERROR", code: "PDB_ATOM_NAME_TOO_LONG", message: "Atom names are limited to four characters so PDB → Packmol → GROMACS mapping remains column-compatible." })
  if (!preparation.bonds.length && preparation.atoms.length > 1) diagnostics.push({ severity: "ERROR", code: "CONNECTIVITY_MISSING", message: "No accepted molecular bond graph is available." })
  if (preparation.bonds.some((bond) => !bond.accepted)) diagnostics.push({ severity: "ERROR", code: "CONNECTIVITY_UNAPPROVED", message: "Every retained bond must be explicitly accepted or removed." })
  if (preparation.bonds.some((bond) => !bond.definition?.trim())) diagnostics.push({ severity: "WARNING", code: "BOND_DEFINITION_UNRECORDED", message: "At least one connectivity record has no bond-definition annotation; the imported OPLS-AA [ bonds ] section must still provide the authoritative function/parameters." })
  if (!preparation.connectivityApproved) diagnostics.push({ severity: "ERROR", code: "CONNECTIVITY_NOT_APPROVED", message: "Researcher approval of the complete connectivity graph is required." })
  const unmapped = preparation.atoms.filter((atom) => !atom.oplsType || atom.mappingStatus === "UNMAPPED")
  if (unmapped.length) diagnostics.push({ severity: "ERROR", code: "OPLS_TYPES_MISSING", message: `OPLS-AA parameterization incomplete: ${unmapped.map((atom) => `${atom.gromacsName || atom.element + atom.index}`).join(", ")} ${unmapped.length === 1 ? "has" : "have"} no validated atom type.` })
  const review = preparation.atoms.filter((atom) => atom.mappingStatus === "REVIEW REQUIRED")
  if (review.length) diagnostics.push({ severity: "ERROR", code: "OPLS_TYPES_REQUIRE_REVIEW", message: `${review.length} imported OPLS-AA atom type mapping(s) still require researcher review.` })
  if (preparation.atoms.some((atom) => atom.mullikenCharge === null)) diagnostics.push({ severity: "ERROR", code: "FINAL_CHARGE_MISSING", message: "Every [ atoms ] charge must come from a mapped ORCA Mulliken value." })
  if (preparation.atoms.some((atom) => atom.oplsType && !atom.ljSource.trim())) diagnostics.push({ severity: "ERROR", code: "LJ_SOURCE_MISSING", message: "Every assigned OPLS-AA type requires a recorded Lennard–Jones parameter source or mapping note." })
  if (!preparation.topologyText) diagnostics.push({ severity: "ERROR", code: "BONDED_TOPOLOGY_MISSING", message: "Import an x2top-generated or manually reviewed topology containing the OPLS-AA bonded framework." })
  const sectionNames = new Set(preparation.topologySections.map((section) => section.name))
  const sectionCount = (name: string) => preparation.topologySections.filter((section) => section.name === name).length
  for (const unique of ["moleculetype", "atoms"]) if (sectionCount(unique) > 1) diagnostics.push({ severity: "ERROR", code: `DUPLICATE_${unique.toUpperCase()}_SECTION`, message: `Imported topology contains ${sectionCount(unique)} [ ${unique} ] sections; merge or remove conflicting definitions.` })
  for (const required of ["atoms", "bonds"]) if (preparation.topologyText && !sectionNames.has(required)) diagnostics.push({ severity: "ERROR", code: `SECTION_${required.toUpperCase()}_MISSING`, message: `Imported topology is missing [ ${required} ].` })
  const topologyAtomLines = dataLines(preparation.topologySections.find((section) => section.name === "atoms"))
  if (preparation.topologyText && topologyAtomLines.length !== preparation.atoms.length) diagnostics.push({ severity: "ERROR", code: "TOPOLOGY_ATOM_COUNT_MISMATCH", message: `Imported [ atoms ] contains ${topologyAtomLines.length} records for ${preparation.atoms.length} mapped XYZ atoms.` })
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
    if (!mapped) diagnostics.push({ severity: "ERROR", code: "TOPOLOGY_ATOM_INDEX_UNDEFINED", message: `[ atoms ] index ${index} does not exist in the preserved XYZ mapping.` })
    else if (fields[4] && fields[4] !== mapped.gromacsName) diagnostics.push({ severity: "ERROR", code: "TOPOLOGY_ATOM_NAME_MISMATCH", message: `[ atoms ] index ${index} is named ${fields[4]} but the preserved mapping names that atom ${mapped.gromacsName}. Resolve without reordering charges.` })
  }
  if (new Set(parsedTopologyAtomIndices).size !== parsedTopologyAtomIndices.length) diagnostics.push({ severity: "ERROR", code: "DUPLICATE_TOPOLOGY_ATOM_INDEX", message: "Imported [ atoms ] contains duplicate atom indices." })
  const validateInteraction = (sectionName: "bonds" | "angles" | "dihedrals", arity: number) => {
    const lines = preparation.topologySections.filter((section) => section.name === sectionName).flatMap(dataLines)
    for (const [lineIndex, line] of lines.entries()) {
      const fields = line.split(/\s+/)
      const indices = fields.slice(0, arity).map(Number)
      if (fields.length < arity+1 || !Number.isInteger(Number(fields[arity])) || Number(fields[arity])<1 || indices.some((index) => !Number.isInteger(index))) diagnostics.push({ severity: "ERROR", code: `MALFORMED_${sectionName.toUpperCase()}_RECORD`, message: `Malformed [ ${sectionName} ] record ${lineIndex + 1}: ${line}` })
      else if (indices.some((index) => !atomIndices.includes(index))) diagnostics.push({ severity: "ERROR", code: `UNDEFINED_${sectionName.toUpperCase()}_ATOM`, message: `[ ${sectionName} ] record ${lineIndex + 1} references an undefined atom index: ${line}` })
    }
  }
  validateInteraction("bonds", 2)
  validateInteraction("angles", 3)
  validateInteraction("dihedrals", 4)
  const topologyBondKeys = preparation.topologySections.filter((section) => section.name === "bonds").flatMap(dataLines).map((line) => line.split(/\s+/).slice(0, 2).map(Number)).filter((pair) => pair.every(Number.isInteger)).map(([a, b]) => [Math.min(a, b), Math.max(a, b)].join("-"))
  if (new Set(topologyBondKeys).size !== topologyBondKeys.length) diagnostics.push({ severity: "ERROR", code: "DUPLICATE_BOND_DEFINITION", message: "Imported [ bonds ] contains a duplicated atom pair." })
  const acceptedBonds=preparation.bonds.filter(b=>b.accepted).map(b=>[Math.min(b.ai,b.aj),Math.max(b.ai,b.aj)].join("-")).sort()
  if(canonical(acceptedBonds)!==canonical([...topologyBondKeys].sort()))diagnostics.push({severity:"ERROR",code:"CONNECTIVITY_TOPOLOGY_CONFLICT",message:"Accepted bond graph differs from imported bonded topology."})
  if(/^\s*#\s*include/m.test(preparation.topologyText))diagnostics.push({severity:"ERROR",code:"UNRESOLVED_TOPOLOGY_INCLUDE",message:"Inline and review per-molecule include dependencies before export; external includes are not silently discarded."})
  if(/^\s*#\s*(?:if|else|endif|define|undef)/m.test(preparation.topologyText))diagnostics.push({severity:"ERROR",code:"UNRESOLVED_TOPOLOGY_PREPROCESSOR",message:"Resolve imported conditional/macro definitions into an unconditional reviewed topology before merging. The original file remains preserved; the importer does not evaluate a force-field preprocessor."})
  const atomTypeDefinitions = preparation.topologySections.filter((section) => section.name === "atomtypes").flatMap(dataLines).map((line) => line.split(/\s+/)[0]).filter(Boolean)
  if (new Set(atomTypeDefinitions).size !== atomTypeDefinitions.length) diagnostics.push({ severity: "ERROR", code: "DUPLICATE_ATOMTYPE_DEFINITION", message: "Imported [ atomtypes ] contains duplicate type names." })
  if (preparation.atoms.length >= 3 && preparation.topologyText && !sectionNames.has("angles")) diagnostics.push({ severity: "WARNING", code: "ANGLES_MISSING", message: "No [ angles ] section was found. Confirm whether angle parameters are generated through another included definition." })
  if (preparation.atoms.length >= 4 && preparation.topologyText && !sectionNames.has("dihedrals")) diagnostics.push({ severity: "WARNING", code: "DIHEDRALS_MISSING", message: "No [ dihedrals ] section was found. Proper and improper torsions require review." })
  if (preparation.atoms.length >= 4 && preparation.topologyText && !sectionNames.has("pairs")) diagnostics.push({ severity: "WARNING", code: "PAIRS_MISSING", message: "No explicit [ pairs ] section was found. Confirm whether 1–4 interactions are generated appropriately by the selected OPLS-AA topology convention." })
  if (!preparation.topologyReviewed) diagnostics.push({ severity: "ERROR", code: "TOPOLOGY_REVIEW_REQUIRED", message: "The imported bonded topology and exclusions/pairs checklist has not been accepted." })
  if (!preparation.gromppValidated) diagnostics.push({ severity: "WARNING", code: "GROMPP_NOT_VALIDATED", message: "The topology is not production-ready until gmx grompp succeeds and its diagnostics are reviewed." })
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
  const center = preparation.coordinateSettings.center ? {
    x: preparation.atoms.reduce((sum, atom) => sum + atom.x, 0) / preparation.atoms.length,
    y: preparation.atoms.reduce((sum, atom) => sum + atom.y, 0) / preparation.atoms.length,
    z: preparation.atoms.reduce((sum, atom) => sum + atom.z, 0) / preparation.atoms.length,
  } : { x: 0, y: 0, z: 0 }
  const translation = preparation.coordinateSettings.translateAngstrom
  return preparation.atoms.map((atom) => ({ ...atom, x: atom.x - center.x + translation.x, y: atom.y - center.y + translation.y, z: atom.z - center.z + translation.z }))
}

export function generatePdb(preparation: MoleculePreparation) {
  const lines = transformedCoordinates(preparation).map((atom, index) => {
    const serial = String(index + 1).padStart(5)
    const name = atom.gromacsName.slice(0, 4).padStart(4)
    const residue = preparation.residueName.slice(0, 4).padStart(4)
    const x = atom.x.toFixed(3).padStart(8), y = atom.y.toFixed(3).padStart(8), z = atom.z.toFixed(3).padStart(8)
    // Fixed PDB columns: name 13–16, four-character residue 18–21,
    // chain 22, residue number 23–26, x/y/z 31–54. Do not add a
    // separator before the chain: it shifts every coordinate column.
    return `HETATM${serial} ${name} ${residue}A${String(1).padStart(4)}    ${x}${y}${z}  1.00  0.00          ${atom.element.padStart(2)}`
  })
  return [`REMARK Generated without atom reordering from ORCA XYZ; coordinates in Angstrom`, ...lines, "TER", "END", ""].join("\n")
}

export function generateGro(preparation: MoleculePreparation) {
  const atoms = transformedCoordinates(preparation)
  const lines = atoms.map((atom, index) => `${String(1).padStart(5)}${preparation.residueName.slice(0, 5).padEnd(5)}${atom.gromacsName.slice(0, 5).padStart(5)}${String(index + 1).padStart(5)}${(atom.x / 10).toFixed(3).padStart(8)}${(atom.y / 10).toFixed(3).padStart(8)}${(atom.z / 10).toFixed(3).padStart(8)}`)
  return [`${preparation.residueName} from ORCA XYZ; Angstrom converted to nm; atom order preserved`, String(atoms.length), ...lines, "   0.00000   0.00000   0.00000", ""].join("\n")
}

export function generateAtomMappingCsv(preparation: MoleculePreparation) {
  return csv([["orca_xyz_index", "xyz_element", "x_angstrom", "y_angstrom", "z_angstrom", "orca_out_index", "orca_out_element", "gromacs_atom_name", "residue", "oplsaa_atom_type", "opls_existing_charge", "orca_mulliken_charge", "final_charge", "lj_parameter_source", "mapping_status"], ...preparation.atoms.map((atom) => [atom.index, atom.element, atom.x, atom.y, atom.z, atom.outIndex, atom.outElement, atom.gromacsName, preparation.residueName, atom.oplsType, atom.existingTopologyCharge, atom.mullikenCharge, atom.finalCharge, atom.ljSource, atom.mappingStatus])])
}

export function generateChargesCsv(preparation: MoleculePreparation) {
  return csv([["atom_index", "element", "gromacs_atom_name", "expected_total_charge", "raw_mulliken_charge", "final_charge", "normalization_applied"], ...preparation.atoms.map((atom) => [atom.index, atom.element, atom.gromacsName, preparation.expectedFormalCharge, atom.mullikenCharge, atom.finalCharge, false]), ["SUM", "", "", preparation.expectedFormalCharge, mappedChargeSum(preparation), preparation.atoms.reduce((sum, atom) => sum + (atom.finalCharge ?? 0), 0), false]])
}

export function generateItp(preparation: MoleculePreparation) {
  const errors=topologyDiagnostics(preparation).filter(d=>d.severity==="ERROR")
  if(errors.length)return "; INCOMPLETE — NOT READY FOR PRODUCTION MD\n"+errors.map(e=>"; "+e.code+": "+e.message).join("\n")+"\n"
  const moleculeName=preparation.residueName
  const nrexcl=dataLines(preparation.topologySections.find(s=>s.name==="moleculetype"))[0]?.split(/\s+/)[1]
  if(!nrexcl||!Number.isSafeInteger(Number(nrexcl))||Number(nrexcl)<0)throw new Error("Valid imported nrexcl is required; no default is invented.")
  const header=["; SolvForge MD: OPLS-AA framework; raw ORCA BP86/def2-TZVP Mulliken charges","; Status: "+preparationStatus(preparation),"; Atom order unchanged; source and final charges in atom_mapping.csv.",""]
  const parameters=PARAMETER_SECTIONS
  // GROMACS requires the parameter level before every molecule definition.
  // The system topology hoists these exact source sections once. The guard
  // also retains parameters when this molecule is exported on its own.
  // https://manual.gromacs.org/documentation/current/reference-manual/topologies/topology-file-formats.html
  const definitions=preparation.topologySections.filter(s=>parameters.has(s.name)).sort((a,b)=>Number(b.name==="atomtypes")-Number(a.name==="atomtypes"))
  const output=[...header,...(definitions.length?["#ifndef SOLVFORGE_SYSTEM_PARAMETERS",...definitions.flatMap(s=>["[ "+s.name+" ]",...s.lines,""]),"#endif",""]:[]),"[ moleculetype ]",moleculeName+" "+nrexcl,"","[ atoms ]","; nr type resnr residue atom cgnr charge mass",...preparation.atoms.map(a=>[a.index,a.oplsType,1,moleculeName,a.gromacsName,a.index,a.finalCharge!.toPrecision(15),a.mass].join(" ")),""]
  // Preserve all interaction sections in order, including repeated proper/improper dihedral sections.
  const omit=new Set(["defaults","system","molecules","moleculetype","atoms",...parameters])
  for(const section of preparation.topologySections)if(!omit.has(section.name))output.push("[ "+section.name+" ]",...section.lines,"")
  return output.join("\n")
}

export function x2topCommand(preparation: MoleculePreparation) {
  const base = slug(preparation.moleculeId)
  return `gmx x2top -f molecules/${base}/coordinates/${base}.gro -o molecules/${base}/topology/${base}_raw.top -ff oplsaa`
}

export function runSpecies(run: RunRecord) {
  return [...run.components.map((component) => ({ moleculeId: component.moleculeId, name: component.name, count: component.count })), ...(run.systemKind==="pure-des"?[]:[{ moleculeId: run.soluteId, name: run.soluteName, count: run.soluteCount }])]
}

export function runBoxAngstrom(run: RunRecord) {
  const factor = run.box.unit === "angstrom" ? 1 : 10
  return { x: run.box.x * factor, y: run.box.y * factor, z: run.box.z * factor }
}

export function generatePackmolInput(run: RunRecord, preparations: Record<string, MoleculePreparation>, settings: OrcaGromacsState["packmol"]) {
  const box = runBoxAngstrom(run)
  const margin = settings.marginAngstrom
  if(!Number.isFinite(margin)||margin<0||Object.values(box).some(v=>v<=2*margin)||!Number.isFinite(settings.toleranceAngstrom)||settings.toleranceAngstrom<=0)return "# ERROR: positive box and packing tolerance, and margins smaller than half each dimension required.\n"
  const lines = [`# Counts copied from run ${run.runId}; dimensions and all packing coordinates are in Angstrom.`, `tolerance ${settings.toleranceAngstrom.toFixed(3)}`, "filetype pdb", "output packed.pdb"]
  if (settings.periodic) lines.push(`pbc 0.000 0.000 0.000 ${box.x.toFixed(3)} ${box.y.toFixed(3)} ${box.z.toFixed(3)}`)
  for (const species of runSpecies(run)) {
    const preparation = preparations[species.moleculeId]
    const base = slug(species.moleculeId)
    if (!Number.isInteger(species.count) || Number(species.count) < 0) {
      lines.push("", `# ERROR: absolute molecule count for ${species.name} is unresolved.`, "# Supply manual counts or box + target density + molecular weights before running Packmol.")
      continue
    }
    lines.push("", `structure ../../molecules/${base}/coordinates/${base}.pdb`, `  number ${species.count}`, `  inside box ${margin.toFixed(3)} ${margin.toFixed(3)} ${margin.toFixed(3)} ${(box.x - margin).toFixed(3)} ${(box.y - margin).toFixed(3)} ${(box.z - margin).toFixed(3)}`, "end structure")
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
    const element = cleanElement(line.slice(76, 78).trim() || atomName.replace(/\d/g, "").slice(0, 2))
    if (![serial, residueNumber, xAngstrom, yAngstrom, zAngstrom].every(finite)) throw new Error(`Malformed packed PDB atom record: ${line}`)
    atoms.push({ serial, atomName, residueName, residueNumber, xAngstrom, yAngstrom, zAngstrom, element })
  }
  if (!atoms.length) throw new Error("No ATOM/HETATM records were found in packed.pdb.")
  return { atoms, cryst1Angstrom }
}

export function validatePackedSystem(run: RunRecord, packed: PackedSystemRecord | null, preparations: Record<string, MoleculePreparation>): PrepDiagnostic[] {
  if (!packed) return [{ severity: "ERROR", code: "PACKED_PDB_REQUIRED", message: "Upload the Packmol packed.pdb output for validation." }]
  const diagnostics: PrepDiagnostic[] = []
  const box = runBoxAngstrom(run)
  const preparedResidues = runSpecies(run).map((species) => preparations[species.moleculeId]?.residueName).filter(Boolean)
  if (new Set(preparedResidues).size !== preparedResidues.length) diagnostics.push({ severity: "ERROR", code: "DUPLICATE_RESIDUE_NAME", message: "Every species in a packed system needs a unique residue name for unambiguous topology and analysis mapping." })
  const serials = packed.atoms.map((atom) => atom.serial)
  if (new Set(serials).size !== serials.length) diagnostics.push({ severity: "ERROR", code: "DUPLICATE_PACKED_ATOM_SERIAL", message: "packed.pdb contains duplicate atom serial numbers." })
  let offset=0
  for(const species of runSpecies(run)){const p=preparations[species.moleculeId];if(!p||species.count===null)continue;for(let m=0;m<species.count;m++){for(const a of p.atoms){const actual=packed.atoms[offset++];if(!actual||actual.residueName!==p.residueName||actual.atomName!==a.gromacsName||actual.element!==a.element){diagnostics.push({severity:"ERROR",code:"GLOBAL_MOLECULE_ORDER_MISMATCH",message:"Packed atom/species order differs from the ordered [ molecules ] composition."});break}}}}
  let expectedTotalAtoms = 0
  for (const species of runSpecies(run)) {
    const prep = preparations[species.moleculeId]
    if (!Number.isInteger(species.count) || Number(species.count) < 0) { diagnostics.push({ severity: "ERROR", code: "MOLECULE_COUNT_UNRESOLVED", message: `${species.name} has no valid absolute molecule count. A molar ratio alone is insufficient.` }); continue }
    if (!prep?.atoms.length) { diagnostics.push({ severity: "ERROR", code: "MOLECULE_PREPARATION_MISSING", message: `Cannot validate ${species.name}: its molecular atom count is unavailable.` }); continue }
    const observedAtoms = packed.atoms.filter((atom) => atom.residueName === prep.residueName).length
    const expectedAtoms = Number(species.count) * prep.atoms.length
    expectedTotalAtoms += expectedAtoms
    if (observedAtoms !== expectedAtoms) diagnostics.push({ severity: "ERROR", code: "TOPOLOGY_COORDINATE_MISMATCH", message: `Expected ${prep.residueName}: ${species.count} molecules (${expectedAtoms} atoms), packed file contains ${observedAtoms} matching atoms.` })
    else {
      diagnostics.push({ severity: "INFO", code: "SPECIES_COUNT_MATCH", message: `${prep.residueName}: ${species.count} molecules inferred from ${observedAtoms} atoms.` })
      const packedSpeciesAtoms = packed.atoms.filter((atom) => atom.residueName === prep.residueName)
      for (let moleculeIndex = 0; moleculeIndex < Number(species.count); moleculeIndex++) {
        const packedMolecule = packedSpeciesAtoms.slice(moleculeIndex * prep.atoms.length, (moleculeIndex + 1) * prep.atoms.length)
        const mismatch = prep.atoms.findIndex((atom, atomIndex) => packedMolecule[atomIndex]?.atomName !== atom.gromacsName || packedMolecule[atomIndex]?.element !== atom.element)
        if (mismatch >= 0) {
          const expected = prep.atoms[mismatch], observed = packedMolecule[mismatch]
          diagnostics.push({ severity: "ERROR", code: "PACKED_ATOM_ORDER_MISMATCH", message: `${prep.residueName} molecule ${moleculeIndex + 1}, local atom ${mismatch + 1}: expected ${expected.gromacsName}/${expected.element}, observed ${observed ? `${observed.atomName}/${observed.element}` : "missing"}. Charge-to-atom traceability is broken.` })
          break
        }
      }
    }
  }
  if (packed.atoms.length !== expectedTotalAtoms) diagnostics.push({ severity: "ERROR", code: "TOTAL_ATOM_COUNT_MISMATCH", message: `Expected ${expectedTotalAtoms} total atoms; packed.pdb contains ${packed.atoms.length}.` })
  const outOfBounds = packed.atoms.filter((atom) => atom.xAngstrom < -1e-3 || atom.yAngstrom < -1e-3 || atom.zAngstrom < -1e-3 || atom.xAngstrom > box.x + 1e-3 || atom.yAngstrom > box.y + 1e-3 || atom.zAngstrom > box.z + 1e-3)
  if (outOfBounds.length) diagnostics.push({ severity: "WARNING", code: "PACKED_COORDINATES_OUTSIDE_BOX", message: `${outOfBounds.length} packed atom coordinate(s) fall outside the configured ${box.x} × ${box.y} × ${box.z} Å box.` })
  if (packed.cryst1Angstrom && Math.max(Math.abs(packed.cryst1Angstrom.x - box.x), Math.abs(packed.cryst1Angstrom.y - box.y), Math.abs(packed.cryst1Angstrom.z - box.z)) > 0.01) diagnostics.push({ severity: "WARNING", code: "CRYST1_BOX_MISMATCH", message: "packed.pdb CRYST1 dimensions differ from the selected run box." })
  return diagnostics
}

export function generatePackedGro(run: RunRecord, packed: PackedSystemRecord) {
  const box = runBoxAngstrom(run)
  const lines = packed.atoms.map((atom, index) => `${String(((atom.residueNumber - 1) % 99999) + 1).padStart(5)}${atom.residueName.slice(0, 5).padEnd(5)}${atom.atomName.slice(0, 5).padStart(5)}${String((index % 99999) + 1).padStart(5)}${(atom.xAngstrom / 10).toFixed(3).padStart(8)}${(atom.yAngstrom / 10).toFixed(3).padStart(8)}${(atom.zAngstrom / 10).toFixed(3).padStart(8)}`)
  return [`${run.runId} packed by Packmol; Angstrom converted to nm`, String(lines.length), ...lines, `${(box.x / 10).toFixed(5).padStart(10)}${(box.y / 10).toFixed(5).padStart(10)}${(box.z / 10).toFixed(5).padStart(10)}`, ""].join("\n")
}

export function systemTopologyDiagnostics(run: RunRecord, preparations: Record<string, MoleculePreparation>): PrepDiagnostic[] {
  const findings: PrepDiagnostic[] = [], types = new Set<string>()
  for(const species of runSpecies(run)){
    const prep=preparations[species.moleculeId]
    if(!Number.isSafeInteger(species.count)||Number(species.count)<1)findings.push({severity:"ERROR",code:"SYSTEM_COUNT_UNRESOLVED",message:species.name+": positive integer count required."})
    if(!prep){findings.push({severity:"ERROR",code:"SYSTEM_PREPARATION_MISSING",message:species.name+": molecular preparation missing."});continue}
    findings.push(...topologyDiagnostics(prep).map(d=>({...d,message:species.name+": "+d.message})))
    for(const s of prep.topologySections.filter(s=>s.name==="atomtypes"))for(const line of dataLines(s)){
      const id=line.split(/\s+/)[0]
      if(types.has(id))findings.push({severity:"ERROR",code:"DUPLICATE_SYSTEM_ATOMTYPE",message:"Duplicate atom type definition across molecular parameter sources: "+id+". Resolve shared definitions before export."})
      types.add(id)
    }
  }
  return findings
}

export function generateTopolTop(run: RunRecord, preparations: Record<string, MoleculePreparation>, includeRoot = "") {
  if(run.forceField!==FORCE_FIELD||run.chargeScheme!==CHARGE_SOURCE||run.resolvedProtocol?.topologyInclude!==FORCE_FIELD_INCLUDE)throw new Error("Force-field/charge provenance conflicts with supported generated topology.")
  const species = runSpecies(run)
  const ready = !systemTopologyDiagnostics(run,preparations).some(d=>d.severity==="ERROR")
  const externallyReviewed = ready && species.every(item=>preparations[item.moleculeId].gromppValidated)
  // Hoist all atom types first, then the remaining source parameter sections,
  // before any .itp introduces [ moleculetype ]. Do not invent parameters.
  const parameters=species.flatMap(item=>(preparations[item.moleculeId]?.topologySections??[]).filter(s=>PARAMETER_SECTIONS.has(s.name)).map(s=>({...s,source:item.moleculeId}))).sort((a,b)=>Number(b.name==="atomtypes")-Number(a.name==="atomtypes"))
  const includePath = (id: string) => includeRoot ? `${includeRoot}/${slug(id)}/topology/${slug(id)}.itp` : `${slug(id)}.itp`
  return [`; System topology for ${run.runId}`, `; STATUS: ${ready ? (externallyReviewed ? "RESEARCHER ACCEPTED — EXTERNAL GROMPP REPORTED" : "READY FOR GROMPP VALIDATION — NOT YET PRODUCTION VALIDATED") : "INCOMPLETE — DO NOT USE FOR PRODUCTION MD"}`, `; Coordinate counts must match [ molecules ]; validate packed.pdb before grompp.`, `#include "oplsaa.ff/forcefield.itp"`, "", ...parameters.flatMap(s=>["; Parameter source: "+s.source,"[ "+s.name+" ]",...s.lines,""]),"#define SOLVFORGE_SYSTEM_PARAMETERS",...species.map((item) => `#include "${includePath(item.moleculeId)}"`), "#undef SOLVFORGE_SYSTEM_PARAMETERS", "", "[ system ]", `${run.systemKind === "pure-des" ? run.desName : run.desName+" + "+run.soluteName}`, "", "[ molecules ]", "; Moleculetype  count", ...species.map((item) => `${(preparations[item.moleculeId]?.residueName ?? "UNRESOLVED").padEnd(14)} ${Number.isInteger(item.count) ? item.count : "UNRESOLVED"}`), ""].join("\n")
}

export function generateIndexNdx(packed: PackedSystemRecord, run: RunRecord, preparations: Record<string, MoleculePreparation>) {
  const groups: string[] = []
  for (const species of runSpecies(run)) {
    const residue = preparations[species.moleculeId]?.residueName
    if (!residue) continue
    const indices = packed.atoms.map((atom, index) => atom.residueName === residue ? index + 1 : 0).filter(Boolean)
    groups.push(`[ ${residue} ]`)
    for (let i = 0; i < indices.length; i += 15) groups.push(indices.slice(i, i + 15).join(" "))
    groups.push("")
  }
  return `${groups.join("\n")}\n`
}

export function pairwiseSpecies(run: RunRecord, preparations: Record<string, MoleculePreparation>) {
  const residues = runSpecies(run).map((species) => ({ moleculeId: species.moleculeId, label: preparations[species.moleculeId]?.residueName ?? species.name.toUpperCase().replace(/\W+/g, "_") }))
  const pairs: Array<{ a: string; b: string }> = []
  for (let i = 0; i < residues.length; i++) for (let j = i; j < residues.length; j++) pairs.push({ a: residues[i].label, b: residues[j].label })
  return pairs
}

function rdfSelection(label: string, mode: OrcaGromacsState["rdf"]["mode"], custom: Record<string, string>) {
  if (mode === "custom") return custom[label] || `<CUSTOM_SELECTION_${label}>`
  if (mode === "center-of-mass") return `res_com of resname ${label}`
  return `resname ${label}`
}
const shellQuote=(text:string)=>"'"+text.replaceAll("'", "'\"'\"'")+"'"
export function rdfCommandDiagnostics(run:RunRecord,preparations:Record<string,MoleculePreparation>,settings:OrcaGromacsState["rdf"]){
 const errors:string[]=[]
 if(!["center-of-mass","atom-based","custom"].includes(settings.mode))errors.push("Unknown RDF definition.")
 if(!Number.isFinite(settings.binWidthNm)||settings.binWidthNm<=0||!Number.isFinite(settings.rmaxNm)||settings.rmaxNm<=settings.binWidthNm)errors.push("RDF requires 0 < bin width < maximum radius in nm.")
 const maximum=run.resolvedProtocol?.production?.maximumNs??run.productionNs
 if(!Number.isFinite(settings.beginNs)||!Number.isFinite(settings.endNs)||settings.beginNs<0||settings.endNs<=settings.beginNs||settings.endNs>maximum)errors.push("RDF window must be finite, nonnegative, increasing and within the resolved production maximum.")
 for(const species of runSpecies(run)){const residue=preparations[species.moleculeId]?.residueName;if(!residue||!/^\w{1,4}$/.test(residue))errors.push(species.name+": a mapped residue name is required.");else if(settings.mode==="custom"&&(!settings.customSelections[residue]?.trim()||/[\r\n]/.test(settings.customSelections[residue])))errors.push(residue+": supply an explicit single-line custom GROMACS selection.")}
 return errors
}

export function generateRdfCommands(run: RunRecord, preparations: Record<string, MoleculePreparation>, settings: OrcaGromacsState["rdf"]) {
  const errors=rdfCommandDiagnostics(run,preparations,settings);if(errors.length)return errors.map(e=>"# ERROR: "+e).join("\n")+"\n"
  const pairCommands = pairwiseSpecies(run, preparations).map(({ a, b }) => `gmx rdf -f 04_prod/prod.xtc -s 04_prod/prod.tpr -n 00_input/index.ndx -ref ${shellQuote(rdfSelection(a, settings.mode, settings.customSelections))} -sel ${shellQuote(rdfSelection(b, settings.mode, settings.customSelections))} -bin ${settings.binWidthNm} -rmax ${settings.rmaxNm} -b ${settings.beginNs * 1000} -e ${settings.endNs * 1000} -o analysis/rdf/rdf_${a}_${b}.xvg`)
  return `#!/usr/bin/env bash\nset -euo pipefail\n# ${settings.mode}; times converted from ns in the Workbench to ps for GROMACS.\n${pairCommands.join("\n")}\n`
}

export function parseBlocks(value: string) {
  if(!value.trim())throw new Error("Supply at least one explicit time block.")
  return value.split(/[,;\n]+/).filter(p=>p.trim()).map(part=>{const m=part.trim().match(/^(\d+(?:\.\d*)?|\.\d+)\s*[-–:]\s*(\d+(?:\.\d*)?|\.\d+)$/);if(!m||!Number.isFinite(Number(m[1]))||!Number.isFinite(Number(m[2]))||Number(m[2])<=Number(m[1]))throw new Error("Invalid block: "+part+". No windows are silently discarded.");return{startNs:Number(m[1]),endNs:Number(m[2])}})
}

export function generateBlockRdfCommands(run: RunRecord, preparations: Record<string, MoleculePreparation>, settings: OrcaGromacsState["rdf"]) {
  const errors=rdfCommandDiagnostics(run,preparations,settings);if(errors.length)return errors.map(e=>"# ERROR: "+e).join("\n")+"\n"
  let blocks:ReturnType<typeof parseBlocks>
  try{blocks=parseBlocks(settings.blocks)}catch(e){return "# ERROR: "+String(e)+"\n"}
  if(blocks.some(b=>b.endNs>(run.resolvedProtocol?.production?.maximumNs??run.productionNs)))return "# ERROR: Block exceeds the resolved production maximum.\n"
  const lines = ["#!/usr/bin/env bash", "set -euo pipefail", "# Block RDFs for time-convergence analysis; Workbench ns inputs are converted to GROMACS ps."]
  for (const block of blocks) for (const { a, b } of pairwiseSpecies(run, preparations)) lines.push(`gmx rdf -f 04_prod/prod.xtc -s 04_prod/prod.tpr -n 00_input/index.ndx -ref ${shellQuote(rdfSelection(a, settings.mode, settings.customSelections))} -sel ${shellQuote(rdfSelection(b, settings.mode, settings.customSelections))} -bin ${settings.binWidthNm} -rmax ${settings.rmaxNm} -b ${block.startNs * 1000} -e ${block.endNs * 1000} -o analysis/blocks/rdf_${a}_${b}_${block.startNs}-${block.endNs}ns.xvg`)
  return `${lines.join("\n")}\n`
}

export function executionFor(state: OrcaGromacsState, runId: string): ExecutionStatus {
  return state.execution[runId] ?? { em: "not-run", nvt: "not-run", npt: "not-run", production: "not-run" }
}

export function projectChecklist(run: RunRecord | undefined, state: OrcaGromacsState, datasets: RDFDataset[]) {
  if (!run) return [{ label: "Generated run selected", status: "WAITING" as StepStatus, detail: "Generate and select a Stage A/B/C run first." }]
  const species = runSpecies(run)
  const preps = species.map((item) => state.molecules[item.moleculeId]).filter(Boolean)
  const all = (predicate: (prep: MoleculePreparation) => boolean) => preps.length === species.length && preps.every(predicate)
  const packed = state.packedSystems[run.runId] ?? null
  const packedDiagnostics = validatePackedSystem(run, packed, state.molecules)
  const execution = executionFor(state, run.runId)
  const rdf = datasets.filter((dataset) => dataset.metadata.runId === run.runId)
  const analyzed = rdf.filter((dataset) => dataset.analysis)
  return [
    { label: "ORCA geometry imported", status: all((prep) => Boolean(prep.xyzFile && prep.xyzAtoms.length)) ? "AUTOMATICALLY VERIFIED" : "WAITING", detail: `${preps.filter((prep) => prep.xyzFile).length}/${species.length} species` },
    { label: "Mulliken charges parsed", status: all((prep) => prep.atoms.length > 0 && prep.atoms.every((atom) => atom.mullikenCharge !== null)) ? "AUTOMATICALLY VERIFIED" : "WAITING", detail: "Raw charges are never normalized." },
    { label: "Atom mapping", status: all((prep) => !orcaDiagnostics(prep).some((item) => item.severity === "ERROR")) ? "AUTOMATICALLY VERIFIED" : "WAITING", detail: "XYZ ↔ ORCA output mapping" },
    { label: "Connectivity approved", status: all((prep) => prep.connectivityApproved) ? "RESEARCHER ACCEPTED" : "WAITING", detail: "Researcher-authoritative bond graph" },
    { label: "OPLS-AA atom typing", status: all((prep) => prep.atoms.every((atom) => atom.oplsType && !["UNMAPPED", "REVIEW REQUIRED"].includes(atom.mappingStatus))) ? "RESEARCHER ACCEPTED" : "WAITING", detail: "No fictional type assignment" },
    { label: "Molecular topology", status: all((prep) => !topologyDiagnostics(prep).some((item) => item.severity === "ERROR")) ? "RESEARCHER ACCEPTED" : "WAITING", detail: "Bonded framework + Mulliken merge" },
    { label: "Molecular grompp validation", status: all((prep) => prep.gromppValidated) ? "RESEARCHER ACCEPTED" : "WAITING", detail: "External GROMACS validation required" },
    { label: "Box composition", status: run.compositionCalculation ? "AUTOMATICALLY VERIFIED" : "WAITING", detail: run.compositionCalculation ? `${run.totalMoleculeCount} molecules` : "Density/manual counts required" },
    { label: "Packed system validated", status: packed && !packedDiagnostics.some((item) => item.severity === "ERROR") ? "AUTOMATICALLY VERIFIED" : "WAITING", detail: packed ? `${packed.atoms.length} atoms` : "Upload packed.pdb" },
    { label: "EM", status: execution.em === "accepted" ? "RESEARCHER ACCEPTED" : execution.em === "failed" ? "FAIL" : "NOT RUN", detail: "Maximum force and potential energy" },
    { label: "NVT", status: execution.nvt === "accepted" ? "RESEARCHER ACCEPTED" : execution.nvt === "failed" ? "FAIL" : "NOT RUN", detail: "Temperature stability" },
    { label: "NPT", status: execution.npt === "accepted" ? "RESEARCHER ACCEPTED" : execution.npt === "failed" ? "FAIL" : "NOT RUN", detail: "Density, pressure, and volume" },
    { label: "Production", status: execution.production === "accepted" ? "RESEARCHER ACCEPTED" : execution.production === "failed" ? "FAIL" : "NOT RUN", detail: "Equilibrium trajectory" },
    { label: "RDF", status: rdf.length ? "AUTOMATICALLY VERIFIED" : "NOT RUN", detail: `${rdf.length}/${pairwiseSpecies(run, state.molecules).length} pair dataset(s)` },
    { label: "KBI calculations available", status: analyzed.length ? "AUTOMATICALLY VERIFIED" : "NOT RUN", detail: `${analyzed.length} calculations available; acceptance/convergence is checked in KBI Analyzer, not inferred from this count.` },
  ]
}

export function preparationPackageFiles(state: OrcaGromacsState) {
  const files: Array<{ path: string; content: string }> = []
  for (const preparation of Object.values(state.molecules)) {
    const base = `molecules/${slug(preparation.moleculeId)}`
    if (preparation.xyzFile) files.push({ path: `${base}/source/${preparation.xyzFile.name}`, content: preparation.xyzFile.text })
    if (preparation.outFile) files.push({ path: `${base}/source/${preparation.outFile.name}`, content: preparation.outFile.text })
    if (preparation.atoms.length) files.push(
      { path: `${base}/coordinates/${slug(preparation.moleculeId)}.pdb`, content: generatePdb(preparation) },
      { path: `${base}/coordinates/${slug(preparation.moleculeId)}.gro`, content: generateGro(preparation) },
      { path: `${base}/mapping/atom_mapping.csv`, content: generateAtomMappingCsv(preparation) },
      { path: `${base}/mapping/charges.csv`, content: generateChargesCsv(preparation) },
      { path: `${base}/topology/${slug(preparation.moleculeId)}.itp`, content: generateItp(preparation) },
      { path: `${base}/topology/x2top_command.sh`, content: `#!/usr/bin/env bash\nset -euo pipefail\n${commandText(state, `molecule:${preparation.moleculeId}:${slug(preparation.moleculeId)}_x2top.sh`, x2topCommand(preparation))}\n` },
      { path: `${base}/metadata.json`, content: JSON.stringify({ ...preparation, xyzFile: preparation.xyzFile ? { ...preparation.xyzFile, text: "preserved in source/" } : null, outFile: preparation.outFile ? { ...preparation.outFile, text: "preserved in source/" } : null, status: preparationStatus(preparation), diagnostics: topologyDiagnostics(preparation) }, null, 2) },
    )
    if (preparation.topologyText) files.push({ path: `${base}/source/edited_topology.top`, content: preparation.topologyText })
    if(preparation.originalTopologyFile)files.push({path:`${base}/source/original_topology.top`,content:preparation.originalTopologyFile.text})
  }
  return files
}
