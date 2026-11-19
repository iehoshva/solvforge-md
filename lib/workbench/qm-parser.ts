import { ATOMIC_NUMBER_TO_SYMBOL, normalizeElement } from "./elements.ts"

export type CoordinateAtom = { index: number; element: string; x: number; y: number; z: number }
export type QmChargeEntry = { outIndex: number; element: string | null; charge: number }
export type ParsedBond = { ai: number; aj: number; order?: string }

export type QmSoftware =
  | "orca"
  | "gaussian"
  | "gaussian-fchk"
  | "xtb"
  | "multiwfn"
  | "mol2"
  | "csv-table"
  | "custom"

export type ParsedGeometry = {
  format: "xyz" | "pdb" | "gro" | "mol2" | "chg" | "pqr"
  comment: string
  atoms: CoordinateAtom[]
  bonds?: ParsedBond[]
  charges?: QmChargeEntry[]
  atomTypes?: string[]
}

export type ParsedQmOutput = {
  software: QmSoftware
  inputLine: string
  method: string
  basis: string
  parsedTotalCharge: number | null
  multiplicity: number | null
  terminatedNormally: boolean | null
  coordinates: CoordinateAtom[]
  chargeSets: Record<string, QmChargeEntry[]>
  availableSchemes: string[]
  defaultScheme: string
  bonds?: ParsedBond[]
}

const BOHR_TO_ANGSTROM = 0.529177210903
const NUM_RE = "[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[EeDd][+-]?\\d+)?"
const toNum = (s: string) => Number(s.replace(/[Dd]/, "E"))
const finite = (v: number) => Number.isFinite(v)

export function parseXyz(text: string): ParsedGeometry {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/)
  const atomCount = Number(lines[0]?.trim())
  if (!Number.isInteger(atomCount) || atomCount <= 0) {
    throw new Error("XYZ first line must contain a positive atom count.")
  }
  const comment = lines[1] ?? ""
  const atoms: CoordinateAtom[] = []
  for (let i = 0; i < atomCount; i++) {
    const fields = (lines[i + 2] ?? "").trim().split(/\s+/)
    if (fields.length < 4) throw new Error(`XYZ atom line ${i + 1} is missing element or coordinates.`)
    const [elementRaw, xRaw, yRaw, zRaw] = fields
    const x = toNum(xRaw), y = toNum(yRaw), z = toNum(zRaw)
    if (![x, y, z].every(finite)) throw new Error(`XYZ atom line ${i + 1} contains malformed coordinates.`)
    atoms.push({ index: i + 1, element: normalizeElement(elementRaw), x, y, z })
  }
  return { format: "xyz", comment, atoms }
}

export function parseSinglePdb(text: string): ParsedGeometry {
  const atoms: CoordinateAtom[] = []
  const charges: QmChargeEntry[] = []
  let hasPqrCharges = false
  let comment = ""
  for (const line of text.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    if (line.startsWith("REMARK") && !comment) comment = line.slice(6).trim()
    if (!/^(ATOM  |HETATM)/.test(line)) continue
    const atomName = line.slice(12, 16).trim()
    const x = Number(line.slice(30, 38)), y = Number(line.slice(38, 46)), z = Number(line.slice(46, 54))
    const elementField = line.slice(76, 78).trim()
    const element = normalizeElement(elementField || atomName.replace(/\d.*/g, "").slice(0, 2) || atomName)
    if (![x, y, z].every(finite)) {
      // Try whitespace-delimited PQR fallback: ATOM serial name res resnum x y z charge radius
      const parts = line.trim().split(/\s+/)
      if (parts.length >= 9) {
        const px = Number(parts[5]), py = Number(parts[6]), pz = Number(parts[7]), pq = Number(parts[8])
        if ([px, py, pz].every(finite)) {
          const el = normalizeElement(parts[2].replace(/\d.*/g, "").slice(0, 2) || parts[2])
          atoms.push({ index: atoms.length + 1, element: el, x: px, y: py, z: pz })
          if (finite(pq)) { hasPqrCharges = true; charges.push({ outIndex: atoms.length, element: el, charge: pq }) }
          continue
        }
      }
      throw new Error(`Malformed PDB/PQR coordinate line: ${line}`)
    }
    atoms.push({ index: atoms.length + 1, element, x, y, z })
    // Check PQR-style charge in columns 54-62 if no element column and looks like PQR
    if (!elementField && line.length >= 62) {
      const maybeQ = Number(line.slice(54, 62).trim())
      const maybeR = Number(line.slice(62, 70).trim())
      if (finite(maybeQ) && finite(maybeR) && maybeR > 0 && maybeR < 5 && Math.abs(maybeQ) <= 10) {
        charges.push({ outIndex: atoms.length, element, charge: maybeQ })
      }
    }
  }
  if (!atoms.length) throw new Error("No ATOM/HETATM records found in PDB/PQR file.")
  const isPqr = hasPqrCharges || (charges.length === atoms.length && charges.some((c) => Math.abs(c.charge) > 1e-6 && c.charge !== 1))
  return { format: isPqr ? "pqr" : "pdb", comment, atoms, ...(isPqr ? { charges } : {}) }
}

export function parseGroGeometry(text: string): ParsedGeometry {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/)
  const comment = lines[0]?.trim() ?? ""
  const count = Number(lines[1]?.trim())
  if (!Number.isInteger(count) || count <= 0) throw new Error("GRO second line must contain a positive atom count.")
  const atoms: CoordinateAtom[] = []
  for (let i = 0; i < count; i++) {
    const line = lines[i + 2] ?? ""
    const atomName = line.slice(10, 15).trim()
    const xNm = Number(line.slice(20, 28)), yNm = Number(line.slice(28, 36)), zNm = Number(line.slice(36, 44))
    if (![xNm, yNm, zNm].every(finite)) throw new Error(`GRO atom line ${i + 1} has malformed coordinates.`)
    const element = normalizeElement(atomName.replace(/\d.*/g, "").slice(0, 2) || atomName)
    // Convert nm -> Angstrom for unified internal representation
    atoms.push({ index: i + 1, element, x: xNm * 10, y: yNm * 10, z: zNm * 10 })
  }
  return { format: "gro", comment, atoms }
}

export function parseMol2(text: string): ParsedGeometry {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/)
  let section = ""
  let comment = ""
  const atoms: CoordinateAtom[] = []
  const charges: QmChargeEntry[] = []
  const atomTypes: string[] = []
  const bonds: ParsedBond[] = []
  for (const raw of lines) {
    const line = raw.trim()
    if (!line || line.startsWith("#")) continue
    if (line.startsWith("@<TRIPOS>")) {
      section = line.slice(9).toUpperCase()
      continue
    }
    if (section === "MOLECULE" && !comment) {
      comment = line
    } else if (section === "ATOM") {
      const f = line.split(/\s+/)
      if (f.length < 6) continue
      const x = toNum(f[2]), y = toNum(f[3]), z = toNum(f[4])
      if (![x, y, z].every(finite)) throw new Error(`Malformed MOL2 atom line: ${line}`)
      const sybylType = f[5]
      const element = normalizeElement(sybylType.split(".")[0] || f[1])
      const idx = atoms.length + 1
      atoms.push({ index: idx, element, x, y, z })
      atomTypes.push(sybylType)
      if (f.length >= 9) {
        const q = toNum(f[8])
        if (finite(q)) charges.push({ outIndex: idx, element, charge: q })
      }
    } else if (section === "BOND") {
      const f = line.split(/\s+/)
      if (f.length >= 4) {
        const ai = Number(f[1]), aj = Number(f[2])
        if (Number.isInteger(ai) && Number.isInteger(aj)) bonds.push({ ai, aj, order: f[3] })
      }
    }
  }
  if (!atoms.length) throw new Error("No @<TRIPOS>ATOM records found in MOL2 file.")
  return {
    format: "mol2",
    comment,
    atoms,
    ...(bonds.length ? { bonds } : {}),
    ...(charges.length === atoms.length ? { charges } : {}),
    ...(atomTypes.length === atoms.length ? { atomTypes } : {}),
  }
}

export function parseMultiwfnChg(text: string): ParsedGeometry {
  const atoms: CoordinateAtom[] = []
  const charges: QmChargeEntry[] = []
  for (const raw of text.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith("#") || line.startsWith(";")) continue
    const f = line.split(/\s+/)
    if (f.length < 5) throw new Error(`Multiwfn .chg line must have 5 columns (Element x y z charge): ${line}`)
    const element = normalizeElement(f[0])
    const x = toNum(f[1]), y = toNum(f[2]), z = toNum(f[3]), q = toNum(f[4])
    if (![x, y, z, q].every(finite)) throw new Error(`Malformed Multiwfn .chg line: ${line}`)
    const idx = atoms.length + 1
    atoms.push({ index: idx, element, x, y, z })
    charges.push({ outIndex: idx, element, charge: q })
  }
  if (!atoms.length) throw new Error("No atom rows found in Multiwfn .chg file.")
  return { format: "chg", comment: "Multiwfn .chg", atoms, charges }
}

export function parseGeometryFile(text: string, filename = ""): ParsedGeometry {
  const ext = filename.toLowerCase().split(".").pop() ?? ""
  if (ext === "mol2" || text.includes("@<TRIPOS>ATOM")) return parseMol2(text)
  if (ext === "pdb" || ext === "pqr" || /^(ATOM  |HETATM)/m.test(text)) return parseSinglePdb(text)
  if (ext === "gro") return parseGroGeometry(text)
  if (ext === "chg") return parseMultiwfnChg(text)
  // Auto-detect .chg (5 columns: Element x y z q) vs .xyz (line 1 integer atom count)
  const firstNonEmpty = text.replace(/^\uFEFF/, "").split(/\r?\n/).find((l) => l.trim())?.trim() ?? ""
  if (/^\d+$/.test(firstNonEmpty)) return parseXyz(text)
  if (firstNonEmpty.split(/\s+/).length === 5 && /^[A-Za-z]{1,2}$/.test(firstNonEmpty.split(/\s+/)[0])) {
    return parseMultiwfnChg(text)
  }
  return parseXyz(text)
}

function lastSectionLines(text: string, heading: RegExp): string[] {
  const lines = text.split(/\r?\n/)
  let start = -1
  for (let i = 0; i < lines.length; i++) if (heading.test(lines[i])) start = i
  return start < 0 ? [] : lines.slice(start + 1)
}

const KNOWN_BASIS_PATTERNS = [
  /\bdef2-[A-Za-z0-9()-]+\b/i,
  /\bma-def2-[A-Za-z0-9()-]+\b/i,
  /\bcc-pV[DTQ56]Z(?:-F12)?\b/i,
  /\baug-cc-pV[DTQ56]Z\b/i,
  /\b6-31[+]*G(?:\([^)]*\)|[*]+)?\b/i,
  /\b6-311[+]*G(?:\([^)]*\)|[*]+)?\b/i,
  /\b3-21G\b/i,
  /\bSTO-3G\b/i,
  /\bpc[Ss]eg-\d\b/i,
  /\bsapporo-[A-Za-z0-9-]+\b/i,
  /\bDKH-def2-[A-Za-z0-9-]+\b/i,
  /\bZORA-def2-[A-Za-z0-9-]+\b/i,
  /\bLanL2DZ\b/i,
  /\bSDD\b/i,
]

const SKIP_METHOD_TOKENS = new Set([
  "OPT", "FREQ", "NUMFREQ", "ANFREQ", "SP", "ENGRAD", "TIGHTSCF", "VERYTIGHTSCF", "TIGHTOPT", "VERYTIGHTOPT",
  "RI", "RIJCOSX", "RIJONX", "RIJK", "NORI", "D3BJ", "D3ZERO", "D4", "GCP", "CPCM", "SMD", "CHELPG", "HIRSHFELD",
  "LOEWDIN", "MULLIKEN", "NBO", "PRINTBASIS", "LARGEPRINT", "MINIPRINT", "SMALLPRINT", "PAL2", "PAL4", "PAL8",
  "DEFGRID2", "DEFGRID3", "GRID5", "GRID6", "NOFINALGRID", "SLOWCONV", "VERYSLOWCONV", "SCF", "POP", "FORCE",
  "SCRF", "EMPIRICALDISPERSION", "INT", "INTEGRAL", "NOSYMM", "GFINPUT", "GFPRINT",
])

function extractMethodAndBasis(inputLine: string): { method: string; basis: string } {
  const cleaned = inputLine.replace(/^\s*(?:\|\s*\d+>\s*)?[!#]+[pPtTnN]?\s*/, "").trim()
  if (!cleaned) return { method: "not detected", basis: "not detected" }
  // Handle Gaussian-style method/basis token e.g. B3LYP/6-311++G(d,p) or wB97XD/def2-TZVP
  const slashMatch = cleaned.match(/\b([A-Za-z0-9_-]+)\/([A-Za-z0-9+*(),-]+)(?:\s|$)/)
  if (slashMatch) return { method: slashMatch[1], basis: slashMatch[2] }

  const tokens = cleaned.split(/\s+/).filter(Boolean)
  let basis = "not detected"
  for (const pattern of KNOWN_BASIS_PATTERNS) {
    const m = cleaned.match(pattern)
    if (m) { basis = m[0]; break }
  }
  // Composite methods like r2SCAN-3c, B97-3c, PBEh-3c, HF-3c, wB97X-3c include built-in basis
  const composite = tokens.find((t) => /-3c$/i.test(t))
  if (composite) {
    return { method: composite, basis: basis === "not detected" ? "built-in (3c)" : basis }
  }
  const methodToken = tokens.find((t) => {
    const upper = t.toUpperCase()
    if (SKIP_METHOD_TOKENS.has(upper)) return false
    if (basis !== "not detected" && t.toLowerCase() === basis.toLowerCase()) return false
    if (/^def2|^aux|^cpcm\(|^smd\(|^pal\d+|^grid|^defgrid/i.test(t)) return false
    return /^[A-Za-z0-9_-]+$/.test(t)
  })
  return { method: methodToken ?? tokens[0] ?? "not detected", basis }
}

function parseOrcaChargeBlock(text: string, heading: RegExp): QmChargeEntry[] {
  const lines = lastSectionLines(text, heading)
  const charges: QmChargeEntry[] = []
  const rowRe = new RegExp(`^\\s*(\\d+)\\s+([A-Za-z]{1,3})\\s*:\\s*(${NUM_RE})\\b`)
  for (const line of lines) {
    const match = line.match(rowRe)
    if (match) {
      charges.push({ outIndex: Number(match[1]) + 1, element: normalizeElement(match[2]), charge: toNum(match[3]) })
    } else if (charges.length && /Sum\s+of|Total\s+charge|REDUCED|SPIN|^\s*[-=]{4,}\s*$/i.test(line)) {
      if (/Sum\s+of|Total\s+charge|REDUCED/i.test(line)) break
    } else if (charges.length && !line.trim()) {
      break
    }
  }
  return charges
}

function parseOrcaHirshfeldBlock(text: string): QmChargeEntry[] {
  const lines = lastSectionLines(text, /HIRSHFELD\s+ANALYSIS/i)
  const charges: QmChargeEntry[] = []
  const rowRe = new RegExp(`^\\s*(\\d+)\\s+([A-Za-z]{1,3})\\s+(${NUM_RE})\\s+(${NUM_RE})`)
  for (const line of lines) {
    const match = line.match(rowRe)
    if (match) {
      charges.push({ outIndex: Number(match[1]) + 1, element: normalizeElement(match[2]), charge: toNum(match[3]) })
    } else if (charges.length && /TOTAL|^\s*$/i.test(line)) {
      break
    }
  }
  return charges
}

function parseOrcaMbisBlock(text: string): QmChargeEntry[] {
  const lines = lastSectionLines(text, /MBIS\s+ANALYSIS/i)
  const charges: QmChargeEntry[] = []
  const rowRe = new RegExp(`^\\s*(\\d+)\\s+([A-Za-z]{1,3})\\s+(${NUM_RE})`)
  for (const line of lines) {
    const match = line.match(rowRe)
    if (match) {
      charges.push({ outIndex: Number(match[1]) + 1, element: normalizeElement(match[2]), charge: toNum(match[3]) })
    } else if (charges.length && /TOTAL|^\s*$/i.test(line)) {
      break
    }
  }
  return charges
}

export function parseOrcaOutput(text: string): ParsedQmOutput {
  const chargeSets: Record<string, QmChargeEntry[]> = {}
  const addScheme = (name: string, entries: QmChargeEntry[]) => {
    if (entries.length) chargeSets[name] = entries
  }
  addScheme("Mulliken", parseOrcaChargeBlock(text, /MULLIKEN\s+ATOMIC\s+CHARGES/i))
  addScheme("Loewdin", parseOrcaChargeBlock(text, /LOEWDIN\s+ATOMIC\s+CHARGES/i))
  addScheme("CHELPG", parseOrcaChargeBlock(text, /CHELPG\s+Charges/i))
  addScheme("RESP", parseOrcaChargeBlock(text, /RESP\s+CHARGES/i))
  addScheme("ESP", parseOrcaChargeBlock(text, /ESP\s+CHARGES/i))
  addScheme("Hirshfeld", parseOrcaHirshfeldBlock(text))
  addScheme("MBIS", parseOrcaMbisBlock(text))

  const coordLines = lastSectionLines(text, /CARTESIAN\s+COORDINATES\s*\(ANGSTROE?M\)/i)
  const coordinates: CoordinateAtom[] = []
  const coordRe = new RegExp(`^\\s*([A-Za-z]{1,3})\\s+(${NUM_RE})\\s+(${NUM_RE})\\s+(${NUM_RE})`)
  for (const line of coordLines) {
    const match = line.match(coordRe)
    if (match) {
      coordinates.push({
        index: coordinates.length + 1,
        element: normalizeElement(match[1]),
        x: toNum(match[2]),
        y: toNum(match[3]),
        z: toNum(match[4]),
      })
    } else if (coordinates.length) {
      break
    }
  }

  const inputLines = text.split(/\r?\n/).filter((line) => /^\s*(?:\|\s*\d+>\s*)?!/.test(line)).map((line) => line.trim())
  const inputLine = inputLines.at(-1) ?? ""
  const { method, basis } = extractMethodAndBasis(inputLine)
  const xyzHeader = [...text.matchAll(/\*\s*xyz(?:file)?\s+(-?\d+)\s+(\d+)/gi)].at(-1)
  const totalChargeLine = [...text.matchAll(/Total\s+Charge[^\n]*?(-?\d+)\s*$/gim)].at(-1)
  const multLine = [...text.matchAll(/Multiplicity[^\n]*?(\d+)\s*$/gim)].at(-1)
  const parsedTotalCharge = xyzHeader ? Number(xyzHeader[1]) : totalChargeLine ? Number(totalChargeLine[1]) : null
  const multiplicity = xyzHeader ? Number(xyzHeader[2]) : multLine ? Number(multLine[1]) : null

  const availableSchemes = Object.keys(chargeSets)
  const preferredOrder = ["RESP", "CHELPG", "ESP", "Hirshfeld", "MBIS", "Loewdin", "Mulliken"]
  const defaultScheme = preferredOrder.find((s) => s in chargeSets) ?? availableSchemes[0] ?? ""

  return {
    software: "orca",
    inputLine,
    method,
    basis,
    parsedTotalCharge,
    multiplicity,
    terminatedNormally: /ORCA\s+TERMINATED\s+NORMALLY/i.test(text),
    coordinates,
    chargeSets,
    availableSchemes,
    defaultScheme,
  }
}

function parseGaussianChargeBlock(text: string, heading: RegExp): QmChargeEntry[] {
  const lines = lastSectionLines(text, heading)
  const charges: QmChargeEntry[] = []
  const rowRe = new RegExp(`^\\s*(\\d+)\\s+([A-Za-z]{1,3})\\s+(${NUM_RE})\\b`)
  for (const line of lines) {
    const match = line.match(rowRe)
    if (match) {
      charges.push({ outIndex: Number(match[1]), element: normalizeElement(match[2]), charge: toNum(match[3]) })
    } else if (charges.length && /Sum\s+of|^\s*$/i.test(line)) {
      break
    }
  }
  return charges
}

function parseGaussianNpaBlock(text: string): QmChargeEntry[] {
  const lines = lastSectionLines(text, /Summary\s+of\s+Natural\s+Population\s+Analysis:/i)
  const charges: QmChargeEntry[] = []
  const rowRe = new RegExp(`^\\s*([A-Za-z]{1,3})\\s+(\\d+)\\s+(${NUM_RE})\\s+(${NUM_RE})`)
  for (const line of lines) {
    const match = line.match(rowRe)
    if (match) {
      charges.push({ outIndex: Number(match[2]), element: normalizeElement(match[1]), charge: toNum(match[3]) })
    } else if (charges.length && /^=+\s*$|Total/i.test(line)) {
      break
    }
  }
  return charges
}

function parseGaussianHirshfeldAndCm5(text: string): { hirshfeld: QmChargeEntry[]; cm5: QmChargeEntry[] } {
  const lines = lastSectionLines(text, /Hirshfeld\s+charges,\s+spin\s+densities/i)
  const hirshfeld: QmChargeEntry[] = []
  const cm5: QmChargeEntry[] = []
  const rowRe = new RegExp(`^\\s*(\\d+)\\s+([A-Za-z]{1,3})\\s+(${NUM_RE})\\s+(${NUM_RE})\\s+(${NUM_RE})\\s+(${NUM_RE})\\s+(${NUM_RE})\\s+(${NUM_RE})`)
  const shortRe = new RegExp(`^\\s*(\\d+)\\s+([A-Za-z]{1,3})\\s+(${NUM_RE})`)
  for (const line of lines) {
    const full = line.match(rowRe)
    if (full) {
      const idx = Number(full[1]), el = normalizeElement(full[2])
      hirshfeld.push({ outIndex: idx, element: el, charge: toNum(full[3]) })
      cm5.push({ outIndex: idx, element: el, charge: toNum(full[8]) })
      continue
    }
    const short = line.match(shortRe)
    if (short) {
      hirshfeld.push({ outIndex: Number(short[1]), element: normalizeElement(short[2]), charge: toNum(short[3]) })
    } else if (hirshfeld.length && /Tot|^\s*$/i.test(line)) {
      break
    }
  }
  return { hirshfeld, cm5 }
}

export function parseGaussianLog(text: string): ParsedQmOutput {
  const chargeSets: Record<string, QmChargeEntry[]> = {}
  const addScheme = (name: string, entries: QmChargeEntry[]) => {
    if (entries.length) chargeSets[name] = entries
  }
  addScheme("Mulliken", parseGaussianChargeBlock(text, /Mulliken\s+(?:atomic\s+)?charges(?:\s+and\s+spin\s+densities)?:/i))
  addScheme("APT", parseGaussianChargeBlock(text, /APT\s+(?:atomic\s+)?charges:/i))
  addScheme("ESP", parseGaussianChargeBlock(text, /ESP\s+charges:/i))
  addScheme("NPA", parseGaussianNpaBlock(text))
  const { hirshfeld, cm5 } = parseGaussianHirshfeldAndCm5(text)
  addScheme("Hirshfeld", hirshfeld)
  addScheme("CM5", cm5)

  // Coordinates: prefer Standard orientation, fallback to Input orientation
  const coordSection = lastSectionLines(text, /Standard\s+orientation:/i)
  const fallbackSection = coordSection.length ? coordSection : lastSectionLines(text, /Input\s+orientation:/i)
  const coordinates: CoordinateAtom[] = []
  const orientRe = new RegExp(`^\\s*(\\d+)\\s+(\\d+)\\s+\\d+\\s+(${NUM_RE})\\s+(${NUM_RE})\\s+(${NUM_RE})`)
  for (const line of fallbackSection) {
    const m = line.match(orientRe)
    if (m) {
      const zNum = Number(m[2])
      coordinates.push({
        index: Number(m[1]),
        element: ATOMIC_NUMBER_TO_SYMBOL[zNum] ?? String(zNum),
        x: toNum(m[3]),
        y: toNum(m[4]),
        z: toNum(m[5]),
      })
    } else if (coordinates.length && /^-{5,}/.test(line.trim())) {
      break
    }
  }

  const routeLine = text.split(/\r?\n/).find((l) => /^\s*#[pPtTnN]?\s+\S/.test(l))?.trim() ?? ""
  const { method, basis } = extractMethodAndBasis(routeLine)
  const cm = [...text.matchAll(/Charge\s*=\s*(-?\d+)\s+Multiplicity\s*=\s*(\d+)/gi)].at(-1)
  const parsedTotalCharge = cm ? Number(cm[1]) : null
  const multiplicity = cm ? Number(cm[2]) : null

  const availableSchemes = Object.keys(chargeSets)
  const preferredOrder = ["ESP", "CM5", "Hirshfeld", "NPA", "APT", "Mulliken"]
  const defaultScheme = preferredOrder.find((s) => s in chargeSets) ?? availableSchemes[0] ?? ""

  return {
    software: "gaussian",
    inputLine: routeLine,
    method,
    basis,
    parsedTotalCharge,
    multiplicity,
    terminatedNormally: /Normal\s+termination\s+of\s+Gaussian/i.test(text),
    coordinates,
    chargeSets,
    availableSchemes,
    defaultScheme,
  }
}

function readFchkArray(lines: string[], headerPrefix: string): number[] {
  const idx = lines.findIndex((l) => l.startsWith(headerPrefix))
  if (idx < 0) return []
  const countMatch = lines[idx].match(/N=\s*(\d+)/)
  if (!countMatch) return []
  const count = Number(countMatch[1])
  const values: number[] = []
  for (let i = idx + 1; i < lines.length && values.length < count; i++) {
    const tokens = lines[i].trim().split(/\s+/).filter(Boolean)
    for (const t of tokens) {
      const n = toNum(t)
      if (!finite(n)) return values
      values.push(n)
    }
  }
  return values.slice(0, count)
}

function readFchkScalar(lines: string[], headerPrefix: string): number | null {
  const line = lines.find((l) => l.startsWith(headerPrefix))
  if (!line) return null
  const m = line.match(new RegExp(`(${NUM_RE})\\s*$`))
  return m ? toNum(m[1]) : null
}

export function parseGaussianFchk(text: string): ParsedQmOutput {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/)
  const secondLine = lines[1]?.trim() ?? ""
  const parts = secondLine.split(/\s+/)
  const method = parts[1] ?? "not detected"
  const basis = parts[2] ?? "not detected"
  const parsedTotalCharge = readFchkScalar(lines, "Charge")
  const multiplicity = readFchkScalar(lines, "Multiplicity")

  const atomicNumbers = readFchkArray(lines, "Atomic numbers")
  const rawCoords = readFchkArray(lines, "Current cartesian coordinates")
  const coordinates: CoordinateAtom[] = []
  for (let i = 0; i < atomicNumbers.length; i++) {
    const el = ATOMIC_NUMBER_TO_SYMBOL[atomicNumbers[i]] ?? String(atomicNumbers[i])
    if (rawCoords.length >= (i + 1) * 3) {
      coordinates.push({
        index: i + 1,
        element: el,
        x: rawCoords[3 * i] * BOHR_TO_ANGSTROM,
        y: rawCoords[3 * i + 1] * BOHR_TO_ANGSTROM,
        z: rawCoords[3 * i + 2] * BOHR_TO_ANGSTROM,
      })
    }
  }

  const chargeSets: Record<string, QmChargeEntry[]> = {}
  const addFchk = (label: string, key: string) => {
    const arr = readFchkArray(lines, key)
    if (arr.length && arr.length === atomicNumbers.length) {
      chargeSets[label] = arr.map((q, i) => ({
        outIndex: i + 1,
        element: ATOMIC_NUMBER_TO_SYMBOL[atomicNumbers[i]] ?? null,
        charge: q,
      }))
    }
  }
  addFchk("ESP", "ESP Charges")
  addFchk("NPA", "NPA Charges")
  addFchk("Mulliken", "Mulliken Charges")

  const availableSchemes = Object.keys(chargeSets)
  return {
    software: "gaussian-fchk",
    inputLine: secondLine,
    method,
    basis,
    parsedTotalCharge,
    multiplicity,
    terminatedNormally: null,
    coordinates,
    chargeSets,
    availableSchemes,
    defaultScheme: availableSchemes[0] ?? "",
  }
}

export function parseXtbOutput(text: string): ParsedQmOutput {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/)
  const methodMatch = text.match(/\b(GFN[012]-xTB|GFN-FF|IPEA-xTB)\b/i)
  const method = methodMatch ? methodMatch[1] : "GFN2-xTB"
  const chargeLines = lastSectionLines(text, /#\s+Z\s+covCN\s+q/i)
  const charges: QmChargeEntry[] = []
  const rowRe = new RegExp(`^\\s*(\\d+)\\s+(\\d+)\\s+([A-Za-z]{1,3})\\s+(${NUM_RE})\\s+(${NUM_RE})`)
  for (const line of chargeLines) {
    const m = line.match(rowRe)
    if (m) {
      charges.push({ outIndex: Number(m[1]), element: normalizeElement(m[3]), charge: toNum(m[5]) })
    } else if (charges.length && (!line.trim() || /Mol\.|dipole|---/i.test(line))) {
      break
    }
  }
  const chargeSets: Record<string, QmChargeEntry[]> = {}
  if (charges.length) chargeSets["xTB"] = charges

  const totalChargeMatch = text.match(/total\s+charge\s*[:=]\s*([+-]?\d+)/i)
  const parsedTotalCharge = totalChargeMatch ? Number(totalChargeMatch[1]) : null
  const terminatedNormally = /normal\s+termination\s+of\s+xtb/i.test(text)

  return {
    software: "xtb",
    inputLine: lines.find((l) => /program\s+call|xtb\s+/i.test(l))?.trim() ?? method,
    method,
    basis: "minimal-STO (xTB)",
    parsedTotalCharge,
    multiplicity: null,
    terminatedNormally,
    coordinates: [],
    chargeSets,
    availableSchemes: Object.keys(chargeSets),
    defaultScheme: charges.length ? "xTB" : "",
  }
}

export function parseGenericChargeTable(text: string, filename = ""): ParsedQmOutput {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith("#") && !l.startsWith(";"))
  const entries: QmChargeEntry[] = []
  const isCsv = lines.some((l) => l.includes(",")) || filename.toLowerCase().endsWith(".csv")
  let startIdx = 0
  let colIndex = -1, colElement = -1, colCharge = -1

  if (lines.length) {
    const firstCells = (isCsv ? lines[0].split(",") : lines[0].split(/\s+/)).map((c) => c.trim().replace(/^"|"$/g, "").toLowerCase())
    const looksLikeHeader = firstCells.some((c) => /^(charge|q|partial_charge|resp|chelpg|mulliken|element|atom|index|idx|nr)$/.test(c))
    if (looksLikeHeader) {
      startIdx = 1
      colIndex = firstCells.findIndex((c) => /^(index|idx|nr|atom_index|id)$/.test(c))
      colElement = firstCells.findIndex((c) => /^(element|el|symbol|atom)$/.test(c))
      colCharge = firstCells.findIndex((c) => /^(final_charge|charge|q|partial_charge|resp|chelpg|mulliken|cm5|hirshfeld)$/.test(c))
      if (colCharge < 0) colCharge = firstCells.length - 1
    }
  }

  for (let i = startIdx; i < lines.length; i++) {
    const cells = (isCsv ? lines[i].split(",") : lines[i].split(/\s+/)).map((c) => c.trim().replace(/^"|"$/g, ""))
    if (!cells.length) continue
    if (cells[0].toUpperCase() === "SUM" || cells[0].toUpperCase() === "TOTAL") continue
    if (colCharge >= 0) {
      const q = toNum(cells[colCharge] ?? "")
      if (!finite(q)) continue
      const outIndex = colIndex >= 0 && Number.isInteger(Number(cells[colIndex])) ? Number(cells[colIndex]) : entries.length + 1
      const element = colElement >= 0 && cells[colElement] ? normalizeElement(cells[colElement]) : null
      entries.push({ outIndex, element, charge: q })
    } else if (cells.length === 1) {
      const q = toNum(cells[0])
      if (finite(q)) entries.push({ outIndex: entries.length + 1, element: null, charge: q })
    } else if (cells.length === 2) {
      const q = toNum(cells[1])
      if (!finite(q)) continue
      if (/^\d+$/.test(cells[0])) entries.push({ outIndex: Number(cells[0]), element: null, charge: q })
      else entries.push({ outIndex: entries.length + 1, element: normalizeElement(cells[0]), charge: q })
    } else {
      // 3+ columns without header: assume [index, element, charge] or [element, ..., charge]
      const q = toNum(cells[cells.length - 1])
      if (!finite(q)) continue
      if (/^\d+$/.test(cells[0]) && /^[A-Za-z]{1,2}$/.test(cells[1])) {
        entries.push({ outIndex: Number(cells[0]), element: normalizeElement(cells[1]), charge: q })
      } else if (/^[A-Za-z]{1,2}$/.test(cells[0])) {
        entries.push({ outIndex: entries.length + 1, element: normalizeElement(cells[0]), charge: q })
      } else {
        entries.push({ outIndex: entries.length + 1, element: null, charge: q })
      }
    }
  }

  const label = filename.toLowerCase().endsWith("charges") ? "xTB charges" : "Custom table"
  const chargeSets: Record<string, QmChargeEntry[]> = entries.length ? { [label]: entries } : {}
  return {
    software: filename.toLowerCase().endsWith("charges") ? "xtb" : "csv-table",
    inputLine: filename || "Imported charge table",
    method: "user-supplied",
    basis: "user-supplied",
    parsedTotalCharge: null,
    multiplicity: null,
    terminatedNormally: null,
    coordinates: [],
    chargeSets,
    availableSchemes: Object.keys(chargeSets),
    defaultScheme: entries.length ? label : "",
  }
}

export function detectQmSoftware(text: string, filename = ""): QmSoftware {
  const lowerName = filename.toLowerCase()
  if (lowerName.endsWith(".fchk") || (/Atomic numbers\s+I\s+N=/.test(text) && /Current cartesian coordinates/.test(text))) return "gaussian-fchk"
  if (lowerName.endsWith(".mol2") || text.includes("@<TRIPOS>ATOM")) return "mol2"
  if (lowerName.endsWith(".chg") || lowerName.endsWith(".pqr")) return "multiwfn"
  if (/O\s+R\s+C\s+A|ORCA\s+TERMINATED|MULLIKEN\s+ATOMIC\s+CHARGES|LOEWDIN\s+ATOMIC\s+CHARGES|CHELPG\s+Charges/i.test(text)) return "orca"
  if (/Entering\s+Gaussian\s+System|Gaussian,\s+Inc\.|Normal\s+termination\s+of\s+Gaussian|Standard\s+orientation:/i.test(text)) return "gaussian"
  if (/x\s+T\s+B|normal\s+termination\s+of\s+xtb|#\s+Z\s+covCN\s+q/i.test(text)) return "xtb"
  if (lowerName.endsWith(".csv") || lowerName.endsWith(".tsv") || lowerName === "charges") return "csv-table"
  // Check if it looks like Multiwfn .chg (5 columns: El x y z q)
  const firstLine = text.replace(/^\uFEFF/, "").split(/\r?\n/).find((l) => l.trim() && !l.trim().startsWith("#"))?.trim() ?? ""
  const f = firstLine.split(/\s+/)
  if (f.length === 5 && /^[A-Za-z]{1,2}$/.test(f[0]) && f.slice(1).every((v) => finite(toNum(v)))) return "multiwfn"
  return "csv-table"
}

export function parseQmOutput(text: string, filename = "", softwareHint?: QmSoftware): ParsedQmOutput {
  const software = softwareHint && softwareHint !== "custom" ? softwareHint : detectQmSoftware(text, filename)
  if (software === "orca") return parseOrcaOutput(text)
  if (software === "gaussian") return parseGaussianLog(text)
  if (software === "gaussian-fchk") return parseGaussianFchk(text)
  if (software === "xtb") {
    const parsed = parseXtbOutput(text)
    if (parsed.availableSchemes.length) return parsed
    return parseGenericChargeTable(text, filename || "charges")
  }
  if (software === "mol2") {
    const geom = parseMol2(text)
    const chargeSets: Record<string, QmChargeEntry[]> = geom.charges?.length ? { "MOL2": geom.charges } : {}
    return {
      software: "mol2",
      inputLine: geom.comment || filename || "MOL2",
      method: "MOL2 partial charges",
      basis: "n/a",
      parsedTotalCharge: null,
      multiplicity: null,
      terminatedNormally: null,
      coordinates: geom.atoms,
      chargeSets,
      availableSchemes: Object.keys(chargeSets),
      defaultScheme: geom.charges?.length ? "MOL2" : "",
      bonds: geom.bonds,
    }
  }
  if (software === "multiwfn") {
    const geom = filename.toLowerCase().endsWith(".pqr") ? parseSinglePdb(text) : parseMultiwfnChg(text)
    const label = geom.format === "pqr" ? "PQR" : "Multiwfn (.chg)"
    const chargeSets: Record<string, QmChargeEntry[]> = geom.charges?.length ? { [label]: geom.charges } : {}
    return {
      software: "multiwfn",
      inputLine: filename || label,
      method: label,
      basis: "external",
      parsedTotalCharge: null,
      multiplicity: null,
      terminatedNormally: null,
      coordinates: geom.atoms,
      chargeSets,
      availableSchemes: Object.keys(chargeSets),
      defaultScheme: geom.charges?.length ? label : "",
    }
  }
  return parseGenericChargeTable(text, filename)
}
