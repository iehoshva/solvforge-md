import type { RDFDataset, ScientificState } from "./types"
import { defaultScientificState } from "./scientific"
import { defaultOrcaGromacsState, migrateOrcaGromacsState, type OrcaGromacsState } from "./orca-gromacs"

const DB_NAME = "green-solvent-md-workbench"
const STORE = "datasets"

function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
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

export async function saveRdfDatasets(datasets: RDFDataset[]) {
  const db = await database()
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite")
    tx.objectStore(STORE).put(datasets, "active")
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
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

export async function saveScientificState(state: ScientificState) {
  const db = await database()
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite")
    tx.objectStore(STORE).put(state, "scientific")
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
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

export async function saveOrcaGromacsState(state: OrcaGromacsState) {
  const db = await database()
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite")
    tx.objectStore(STORE).put(state, "orca-gromacs")
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}
