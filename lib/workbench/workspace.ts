import { uuid } from "./crypto.ts"
import type { ProjectState, RDFDataset, RunRecord, ScientificState } from "./types"
import { defaultScientificState } from "./scientific.ts"
import { defaultOrcaGromacsState, type OrcaGromacsState } from "./orca-gromacs.ts"
import { migrateProject } from "./preset.ts"
import { canonical } from "./identity.ts"
import { SCHEMA_VERSION, SOFTWARE_VERSION } from "./version.ts"

export type ProvenanceNode = { id: string; projectId: string; type: string; parentIds: string[]; softwareVersion: string; actor: "automatic" | "researcher" | "unknown"; timestamp: string; payload: unknown; status: "present" | "incomplete" | "rejected" | "overridden"; issues: string[] }
export type Workspace = {
  format: "solvforge-project-archive"; schemaVersion: string; projectId: string
  project: ProjectState; runs: RunRecord[]; datasets: RDFDataset[]; scientific: ScientificState
  orcaGromacs: OrcaGromacsState; customPresets: ProjectState[]; provenance: ProvenanceNode[]
  decisions: Array<Record<string, unknown>>; legacyEvidence?: unknown
  savedAt: string; savedWithVersion: string
}
export type ImportBundle = { project: ProjectState; runs?: RunRecord[]; datasets?: RDFDataset[]; scientific?: ScientificState; orcaGromacs?: OrcaGromacsState; customPresets?: ProjectState[]; provenance?: ProvenanceNode[]; decisions?: Array<Record<string, unknown>>; format?: string; schemaVersion?: string; legacyEvidence?: unknown }

export function emptyWorkspace(project: ProjectState): Workspace {
  const p = migrateProject(structuredClone(project))
  return { format: "solvforge-project-archive", schemaVersion: SCHEMA_VERSION, projectId: p.projectId, project: { ...p, selectedChampion: null, selectedOptimum: null }, runs: [], datasets: [], scientific: { ...defaultScientificState(), projectId: p.projectId }, orcaGromacs: { ...defaultOrcaGromacsState(), projectId: p.projectId }, customPresets: [], provenance: [], decisions: [], savedAt: new Date().toISOString(), savedWithVersion: SOFTWARE_VERSION }
}

/** Ownership is mandatory. Do not coerce foreign records into the active project. */
export function assertProjectOwnership(value: unknown, projectId: string, path = "workspace") {
  if (!value || typeof value !== "object") return
  if (Array.isArray(value)) { value.forEach((v, i) => assertProjectOwnership(v, projectId, `${path}[${i}]`)); return }
  const record = value as Record<string, unknown>
  if (typeof record.projectId === "string" && record.projectId !== projectId) throw new Error(`Cross-project record rejected at ${path}: ${record.projectId}`)
  for (const [k, v] of Object.entries(record)) {
    // Presets and original file bytes are independent source artifacts, never scientific joins.
    if (["customPresets", "legacyEvidence", "text", "sourceText", "payload"].includes(k)) continue
    assertProjectOwnership(v, projectId, `${path}.${k}`)
  }
}
export function scopeRecords<T>(value: T, projectId: string): T {
  assertProjectOwnership(value, projectId)
  // Ownership is set by record constructors, before calculating input signatures.
  // Injecting keys into nested trajectories/atoms here changes the very evidence
  // whose signature was just accepted. Saving must never mutate scientific inputs.
  return structuredClone(value)
}

export function importWorkspace(bundle: ImportBundle): Workspace {
  const w = emptyWorkspace(bundle.project ?? bundle as unknown as ProjectState)
  // A project-only import is intentionally a clean workspace even if IDs happen to match.
  if (bundle.format !== "solvforge-project-archive") {
    if (bundle.runs?.length || bundle.datasets?.length || bundle.scientific || bundle.orcaGromacs) w.legacyEvidence = { reason: "Legacy bundle without validated ownership/state provenance. Evidence is preserved but excluded from joins.", original: structuredClone(bundle) }
    return w
  }
  if (bundle.schemaVersion !== SCHEMA_VERSION) throw new Error(`Unsupported complete archive schema: ${bundle.schemaVersion}. Import a supported project manifest or migrate explicitly.`)
  if (!bundle.runs || !bundle.datasets || !bundle.scientific || !bundle.orcaGromacs || !bundle.provenance || !bundle.decisions) throw new Error("Incomplete project archive: runs, datasets, scientific, ORCA, provenance and decisions must all be present.")
  assertProjectOwnership(bundle, w.projectId)
  if (bundle.scientific.projectId !== w.projectId || bundle.orcaGromacs.projectId !== w.projectId) throw new Error("Scientific and ORCA workspace ownership is missing or inconsistent.")
  for (const record of [...bundle.runs, ...bundle.datasets]) if (record.projectId !== w.projectId) throw new Error("Complete archive contains a record without explicit project ownership.")
  if (new Set(bundle.runs.map((r) => r.runId)).size !== bundle.runs.length || new Set(bundle.datasets.map((d) => d.id)).size !== bundle.datasets.length) throw new Error("Duplicate run or dataset IDs in archive.")
  return { ...w, project: migrateProject(bundle.project), runs: structuredClone(bundle.runs), datasets: structuredClone(bundle.datasets), scientific: structuredClone(bundle.scientific), orcaGromacs: structuredClone(bundle.orcaGromacs), customPresets: structuredClone(bundle.customPresets ?? []), provenance: structuredClone(bundle.provenance), decisions: structuredClone(bundle.decisions), legacyEvidence: structuredClone(bundle.legacyEvidence) }
}

export function duplicateWorkspace(w: Workspace, includeEvidence: boolean): Workspace {
  const p = { ...structuredClone(w.project), projectId: `project-${uuid()}`, projectName: `${w.project.projectName} copy`, createdAt: new Date().toISOString() }
  const copy = emptyWorkspace(p)
  if (!includeEvidence) return copy
  // Re-home the explicit copy. IDs are project-qualified for joins; original source bytes remain unchanged.
  const rehome = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(rehome)
    if (!v || typeof v !== "object") return v
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, k === "projectId" ? p.projectId : ["text", "sourceText", "legacyEvidence"].includes(k) ? x : rehome(x)]))
  }
  const result = rehome(structuredClone(w)) as Workspace
  result.projectId = p.projectId; result.project = { ...p, selectedChampion: null, selectedOptimum: null }
  // Decision state IDs contain the old canonical project. Preserve history; new acceptance must be explicit.
  result.datasets = result.datasets.map((d) => ({ ...d, analysis: d.analysis ? { ...d.analysis, plateauStatus: "candidate", decision: undefined } : undefined }))
  result.decisions.push({ id: uuid(), projectId: p.projectId, action: "explicit-copy-with-evidence", copiedFromProjectId: w.projectId, timestamp: new Date().toISOString(), note: "Raw/calculated evidence copied deliberately; acceptance decisions require review in the new project." })
  return result
}

export function mergeRuns(current: RunRecord[], next: RunRecord[]) {
  const map = new Map(current.map((r) => [r.runId, r]))
  for (const r of next) {
    const prior = map.get(r.runId)
    // A planning refresh must retain independently frozen artifact snapshots.
    if (prior && canonical({ ...prior, generatedAt: null, inputSnapshots: null }) !== canonical({ ...r, generatedAt: null, inputSnapshots: null })) throw new Error(`Run ID collision: ${r.runId}. Existing scientific artifacts were not overwritten.`)
    if (!prior) map.set(r.runId, r)
  }
  return [...map.values()]
}
