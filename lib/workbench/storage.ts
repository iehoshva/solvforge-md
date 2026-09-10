import type { RDFDataset, ScientificState } from "./types"
import { defaultScientificState } from "./scientific"
import { defaultOrcaGromacsState, migrateOrcaGromacsState, type OrcaGromacsState } from "./orca-gromacs"
import { assertProjectOwnership, type Workspace } from "./workspace.ts"

const DB_NAME = "green-solvent-md-workbench"
const STORE = "datasets"

function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 2)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE)
      if (!request.result.objectStoreNames.contains("projects")) request.result.createObjectStore("projects")
      if (!request.result.objectStoreNames.contains("workspace-meta")) request.result.createObjectStore("workspace-meta")
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

export async function saveWorkspace(workspace: Workspace) {
  assertProjectOwnership(workspace, workspace.projectId)
  const db = await database()
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(["projects", "workspace-meta"], "readwrite")
    tx.objectStore("projects").put(workspace, workspace.projectId)
    tx.objectStore("workspace-meta").put(workspace.projectId, "active-project")
    tx.oncomplete = () => { db.close(); resolve() }
    tx.onabort = tx.onerror = () => { db.close(); reject(tx.error ?? new Error("Workspace transaction aborted.")) }
  })
}
export async function loadWorkspace(projectId?: string): Promise<Workspace | null> {
  const db = await database()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(["projects", "workspace-meta"], "readonly")
    let result: Workspace | null = null
    const read = (id: string) => { const req = tx.objectStore("projects").get(id); req.onsuccess = () => { result = req.result ?? null } }
    if (projectId) read(projectId)
    else { const req = tx.objectStore("workspace-meta").get("active-project"); req.onsuccess = () => { if (req.result) read(req.result) } }
    tx.oncomplete = () => { db.close(); resolve(result) }
    tx.onabort = tx.onerror = () => { db.close(); reject(tx.error) }
  })
}
export async function listWorkspaces(): Promise<Array<{ projectId: string; projectName: string; savedAt: string }>> {
  const db = await database()
  return new Promise((resolve, reject) => {
    const tx = db.transaction("projects", "readonly"), request = tx.objectStore("projects").openCursor()
    const rows: Array<{ projectId: string; projectName: string; savedAt: string }> = []
    request.onsuccess = () => { const cursor = request.result; if (cursor) { const w = cursor.value as Workspace; rows.push({ projectId: w.projectId, projectName: w.project.projectName, savedAt: w.savedAt }); cursor.continue() } }
    tx.oncomplete = () => { db.close(); resolve(rows) }
    tx.onabort = tx.onerror = () => { db.close(); reject(tx.error) }
  })
}

export async function loadRdfDatasets(): Promise<RDFDataset[]> {
  const db = await database()
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE, "readonly").objectStore(STORE).get("active")
    request.onsuccess = () => resolve((request.result as RDFDataset[] | undefined) ?? [])
    request.onerror = () => reject(request.error)
  })
}


export async function loadScientificState(): Promise<ScientificState> {
  const db = await database()
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE, "readonly").objectStore(STORE).get("scientific")
    request.onsuccess = () => resolve({ ...defaultScientificState(), ...((request.result as ScientificState | undefined) ?? {}) })
    request.onerror = () => reject(request.error)
  })
}


export async function loadOrcaGromacsState(): Promise<OrcaGromacsState> {
  const db = await database()
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE, "readonly").objectStore(STORE).get("orca-gromacs")
    request.onsuccess = () => resolve(request.result ? migrateOrcaGromacsState(request.result as Partial<OrcaGromacsState>) : defaultOrcaGromacsState())
    request.onerror = () => reject(request.error)
  })
}
