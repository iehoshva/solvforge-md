import { uuid } from "./crypto.ts"
import type { ProjectState, RunRecord } from "./types"
import { defaultQmGromacsState, migrateQmGromacsState, type QmGromacsState } from "./qm-gromacs.ts"
import { migrateProject } from "./preset.ts"
import { canonical } from "./identity.ts"
import { SCHEMA_VERSION, SOFTWARE_VERSION } from "./version.ts"

export type ProvenanceNode = {
  id: string
  projectId: string
  type: string
  parentIds: string[]
  softwareVersion: string
  actor: "automatic" | "researcher" | "unknown"
  timestamp: string
  payload: unknown
  status: "present" | "incomplete" | "rejected" | "overridden"
  issues: string[]
}

export type Workspace = {
  format: "solvforge-project-archive"
  schemaVersion: string
  projectId: string
  project: ProjectState
  runs: RunRecord[]
  qmGromacs: QmGromacsState
  customPresets: ProjectState[]
  provenance: ProvenanceNode[]
  decisions: Array<Record<string, unknown>>
  legacyEvidence?: unknown
  savedAt: string
  savedWithVersion: string
}

export type ImportBundle = {
  project: ProjectState
  runs?: RunRecord[]
  qmGromacs?: QmGromacsState
  orcaGromacs?: Partial<QmGromacsState>
  customPresets?: ProjectState[]
  provenance?: ProvenanceNode[]
  decisions?: Array<Record<string, unknown>>
  format?: string
  schemaVersion?: string
  legacyEvidence?: unknown
}

export function emptyWorkspace(project: ProjectState): Workspace {
  const p = migrateProject(structuredClone(project))
  return {
    format: "solvforge-project-archive",
    schemaVersion: SCHEMA_VERSION,
    projectId: p.projectId,
    project: p,
    runs: [],
    qmGromacs: { ...defaultQmGromacsState(), projectId: p.projectId },
    customPresets: [],
    provenance: [],
    decisions: [],
    savedAt: new Date().toISOString(),
    savedWithVersion: SOFTWARE_VERSION,
  }
}

export function assertProjectOwnership(value: unknown, projectId: string, path = "workspace") {
  if (!value || typeof value !== "object") return
  if (Array.isArray(value)) {
    value.forEach((v, i) => assertProjectOwnership(v, projectId, `${path}[${i}]`))
    return
  }
  const record = value as Record<string, unknown>
  if (typeof record.projectId === "string" && record.projectId !== projectId) {
    throw new Error(`Cross-project record rejected at ${path}: ${record.projectId}`)
  }
  for (const [k, v] of Object.entries(record)) {
    if (["customPresets", "legacyEvidence", "text", "sourceText", "payload"].includes(k)) continue
    assertProjectOwnership(v, projectId, `${path}.${k}`)
  }
}

export function scopeRecords<T>(value: T, projectId: string): T {
  assertProjectOwnership(value, projectId)
  return structuredClone(value)
}

export function importWorkspace(bundle: ImportBundle): Workspace {
  const w = emptyWorkspace(bundle.project ?? (bundle as unknown as ProjectState))
  if (bundle.format !== "solvforge-project-archive") {
    if (bundle.runs?.length || bundle.qmGromacs || bundle.orcaGromacs) {
      w.legacyEvidence = {
        reason: "Unversioned bundle preserved separately from the active workspace.",
        original: structuredClone(bundle),
      }
    }
    return w
  }

  // Accept schema 3.0 directly, and seamlessly migrate schema 2.0 (legacy SolvForge 1.0.x archives)
  const rawQm = bundle.qmGromacs ?? bundle.orcaGromacs
  if (bundle.schemaVersion !== SCHEMA_VERSION && bundle.schemaVersion !== "2.0") {
    throw new Error(`Unsupported project archive schema: ${bundle.schemaVersion}.`)
  }
  if (!bundle.runs || !rawQm || !bundle.provenance || !bundle.decisions) {
    throw new Error("Incomplete project archive: runs, qmGromacs, provenance, and decisions are required.")
  }

  assertProjectOwnership(bundle, w.projectId)
  const qmState = migrateQmGromacsState(rawQm)
  qmState.projectId = w.projectId

  const migratedRuns: RunRecord[] = structuredClone(bundle.runs).map((rawRun) => {
    const r = rawRun as RunRecord & { desId?: string; desName?: string; desAbbreviation?: string }
    return {
      ...r,
      projectId: r.projectId ?? w.projectId,
      systemId: r.systemId ?? r.desId ?? "",
      systemName: r.systemName ?? r.desName ?? "",
      systemAbbreviation: r.systemAbbreviation ?? r.desAbbreviation ?? "",
      forceFieldInclude: r.forceFieldInclude ?? r.resolvedProtocol?.forceFieldInclude ?? "",
    }
  })

  if (new Set(migratedRuns.map((r) => r.runId)).size !== migratedRuns.length) {
    throw new Error("Duplicate run IDs in archive.")
  }

  return {
    ...w,
    project: migrateProject(bundle.project),
    runs: migratedRuns,
    qmGromacs: qmState,
    customPresets: structuredClone(bundle.customPresets ?? []).map((p) => migrateProject(p)),
    provenance: structuredClone(bundle.provenance),
    decisions: structuredClone(bundle.decisions),
    legacyEvidence: structuredClone(bundle.legacyEvidence),
  }
}

export function duplicateWorkspace(w: Workspace, includePreparations: boolean): Workspace {
  const p = {
    ...structuredClone(w.project),
    projectId: `project-${uuid()}`,
    projectName: `${w.project.projectName} copy`,
    createdAt: new Date().toISOString(),
  }
  const copy = emptyWorkspace(p)
  if (!includePreparations) return copy
  const rehome = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(rehome)
    if (!v || typeof v !== "object") return v
    return Object.fromEntries(
      Object.entries(v).map(([k, x]) => [
        k,
        k === "projectId" ? p.projectId : ["text", "sourceText", "legacyEvidence"].includes(k) ? x : rehome(x),
      ]),
    )
  }
  const result = rehome(structuredClone(w)) as Workspace
  result.projectId = p.projectId
  result.project = p
  result.decisions.push({
    id: uuid(),
    projectId: p.projectId,
    action: "explicit-copy-with-preparations",
    copiedFromProjectId: w.projectId,
    timestamp: new Date().toISOString(),
    note: "Preparations and run plans duplicated into a new project ID.",
  })
  return result
}

export function mergeRuns(current: RunRecord[], next: RunRecord[]) {
  const map = new Map(current.map((r) => [r.runId, r]))
  for (const r of next) {
    const prior = map.get(r.runId)
    if (
      prior &&
      canonical({ ...prior, generatedAt: null, inputSnapshots: null }) !==
        canonical({ ...r, generatedAt: null, inputSnapshots: null })
    ) {
      throw new Error(`Run ID collision: ${r.runId}. Existing frozen artifacts were not overwritten.`)
    }
    if (!prior) map.set(r.runId, r)
  }
  return [...map.values()]
}
