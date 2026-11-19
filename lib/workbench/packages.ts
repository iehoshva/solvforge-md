import { uuid } from "./crypto.ts"
import type { Workspace } from "./workspace"
import type { ProjectState, RunRecord } from "./types"
import { importWorkspace, assertProjectOwnership } from "./workspace.ts"
import { canonical, sha256, stateErrors } from "./identity.ts"
import { makeZip, readZip } from "./zip.ts"
import { commands, firstContinuation } from "./runs.ts"
import { parseDirectives } from "./protocol.ts"
import {
  generateItp,
  generatePdb,
  generateGro,
  generatePackmolInput,
  generateTopolTop,
  generatePackedGro,
  generateIndexNdx,
  generateRdfCommands,
  generateBlockRdfCommands,
  topologyDiagnostics,
  systemTopologyDiagnostics,
  validatePackedSystem,
  runSpecies,
  generateAtomMappingCsv,
  generateChargesCsv,
  type QmGromacsState,
} from "./qm-gromacs.ts"
import { SOFTWARE_VERSION } from "./version.ts"
import { compositionPreparationNotes } from "./export.ts"

export type PackageFile = { path: string; content: string }
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "")

export function reconcileRun(project: ProjectState, r: RunRecord, state?: QmGromacsState) {
  const errors: string[] = []
  if (r.projectId !== project.projectId) errors.push("Run belongs to a different project.")
  if (!r.resolvedProtocol) {
    errors.push("Run has no resolved protocol; regenerate.")
  } else {
    const p = r.resolvedProtocol
    errors.push(...p.diagnostics.filter((d) => d.severity === "ERROR").map((d) => d.message))
    if (r.forceField !== p.forceField || r.chargeScheme !== p.chargeSource) {
      errors.push("Run force-field/charge metadata disagree with its resolved protocol.")
    }
    if (r.temperatureK !== p.temperatureK || r.pressureBar !== p.pressureBar || r.randomSeed !== p.randomSeed) {
      errors.push("Run metadata disagree with the resolved simulation protocol.")
    }
    for (const [stage, v] of Object.entries(p.stages)) {
      if (v.enabled && canonical(parseDirectives(v.mdp).directives) !== canonical(v.directives)) {
        errors.push(`${stage}: resolved directives disagree with stored MDP.`)
      }
    }
  }
  errors.push(...stateErrors(r.scientificState), ...r.compositionDiagnostics.filter((d) => d.severity === "ERROR").map((d) => d.message))
  if (state) {
    errors.push(...systemTopologyDiagnostics(r, state.molecules).filter((d) => d.severity === "ERROR").map((d) => d.message))
    for (const species of runSpecies(r)) {
      const prep = state.molecules[species.moleculeId]
      const m = r.molecularSnapshot?.find((item) => item.id === species.moleculeId)
      if (!prep) {
        errors.push(`${species.name}: molecular preparation missing.`)
        continue
      }
      errors.push(...topologyDiagnostics(prep).filter((d) => d.severity === "ERROR").map((d) => `${species.name}: ${d.message}`))
      if (m && (prep.expectedFormalCharge !== m.charge || prep.residueName !== m.residueName)) {
        errors.push(`${species.name}: prepared formal charge/residue differs from run snapshot; synchronize and regenerate.`)
      }
    }
    errors.push(...validatePackedSystem(r, state.packedSystems[r.runId] ?? null, state.molecules).filter((d) => d.severity === "ERROR").map((d) => d.message))
  }
  return [...new Set(errors)]
}

/** Build run metadata.json compatible with MoDy Analyse `run_metadata.schema.json`. */
export function buildRunMetadata(run: RunRecord) {
  return {
    runId: run.runId,
    projectId: run.projectId,
    systemKind: run.systemKind,
    systemId: run.systemId,
    systemName: run.systemName,
    systemAbbreviation: run.systemAbbreviation,
    soluteId: run.soluteId,
    soluteName: run.soluteName,
    soluteAbbreviation: run.soluteAbbreviation,
    soluteCount: run.soluteCount,
    replica: run.replica,
    randomSeed: run.randomSeed,
    temperatureK: run.temperatureK,
    pressureBar: run.pressureBar,
    box: run.box,
    forceField: run.forceField,
    forceFieldInclude: run.forceFieldInclude,
    chargeScheme: run.chargeScheme,
    components: run.components,
    totalMoleculeCount: run.totalMoleculeCount,
    moleFractions: run.moleFractions,
    productionNs: run.productionNs,
    generatedBy: `SolvForge MD ${SOFTWARE_VERSION}`,
  }
}

export async function runInputSnapshot(project: ProjectState, run: RunRecord, state: QmGromacsState) {
  const errors = reconcileRun(project, run, state)
  if (errors.length) throw new Error("Run Input Package unavailable:\n" + errors.join("\n"))

  const files: PackageFile[] = []
  const add = (path: string, content: string) => files.push({ path, content })

  add("metadata.json", JSON.stringify(buildRunMetadata(run), null, 2))
  add("resolved_protocol.json", JSON.stringify(run.resolvedProtocol, null, 2))
  add("molecule_manifest.json", JSON.stringify(run.molecularSnapshot, null, 2))
  add("composition.json", JSON.stringify(run.compositionCalculation, null, 2))
  add("packing/system/composition-notes.txt", compositionPreparationNotes(run))

  for (const [stage, dir] of [
    ["em", "01_em"],
    ["nvt", "02_nvt"],
    ["npt", "03_npt"],
    ["prod", "04_prod"],
  ] as const) {
    if (run.resolvedProtocol!.stages[stage]?.enabled) {
      add(`${dir}/${stage}.mdp`, run.resolvedProtocol!.stages[stage].mdp)
    }
  }

  add("commands.sh", commands(run))
  if (run.resolvedProtocol!.stages.prod?.enabled) {
    add("04_prod/continuation.sh", firstContinuation(run))
  }

  add("00_input/topol.top", generateTopolTop(run, state.molecules))
  add("00_input/packed.gro", generatePackedGro(run, state.packedSystems[run.runId]))
  add("00_input/packed.pdb", state.packedSystems[run.runId].sourceFile.text)
  add("00_input/index.ndx", generateIndexNdx(state.packedSystems[run.runId], run, state.molecules))

  for (const species of runSpecies(run)) {
    const p = state.molecules[species.moleculeId]
    const base = slug(species.moleculeId)
    add(`00_input/${base}.itp`, generateItp(p, run.forceField))
    add(`molecules/${base}/coordinates/${base}.pdb`, generatePdb(p))
    add(`molecules/${base}/coordinates/${base}.gro`, generateGro(p))
    add(`molecules/${base}/mapping/atom_mapping.csv`, generateAtomMappingCsv(p))
    add(`molecules/${base}/mapping/charges.csv`, generateChargesCsv(p))
    if (p.geometryFile) add(`molecules/${base}/source/${p.geometryFile.name}`, p.geometryFile.text)
    if (p.qmFile) add(`molecules/${base}/source/${p.qmFile.name}`, p.qmFile.text)
    if (p.originalTopologyFile) add(`molecules/${base}/source/original_topology.top`, p.originalTopologyFile.text)
    add(`molecules/${base}/source/reviewed_topology.top`, p.topologyText)
  }

  add("packing/system/packmol.inp", generatePackmolInput(run, state.molecules, state.packmol))
  add("packing/system/commands.sh", "#!/usr/bin/env bash\nset -euo pipefail\npackmol < packmol.inp\n")

  // Optional post-MD RDF extraction helpers (non-blocking if production disabled)
  if (run.resolvedProtocol!.stages.prod?.enabled) {
    const rdfCmd = generateRdfCommands(run, state.molecules, state.rdf)
    const blockCmd = generateBlockRdfCommands(run, state.molecules, state.rdf)
    if (!/^# ERROR:/m.test(rdfCmd)) add("analysis/rdf/commands.sh", rdfCmd)
    if (!/^# ERROR:/m.test(blockCmd)) add("analysis/blocks/commands.sh", blockCmd)
  }

  const invalidCore = files
    .filter((f) => f.path === "packing/system/packmol.inp" || f.path === "commands.sh")
    .filter((f) => /^# ERROR:/m.test(f.content))
  if (invalidCore.length) {
    throw new Error("Invalid generated scripts: " + invalidCore.map((f) => `${f.path}\n${f.content}`).join("\n"))
  }

  add(
    "README.txt",
    [
      `SolvForge MD ${SOFTWARE_VERSION} — QM → GROMACS Run Input Package`,
      `Force field: ${run.forceField}${run.forceFieldInclude ? ` (#include "${run.forceFieldInclude}")` : " (self-contained)"}`,
      `Charge source: ${run.chargeScheme}`,
      "",
      "1. Execute `bash commands.sh` from this run directory after inspecting the MDP files and topologies.",
      "2. Original QM outputs, geometries, atom/charge audit CSVs, and topologies are preserved under molecules/.",
      "3. `metadata.json` matches the MoDy Analyse bridge schema (`run_metadata.schema.json`) for direct downstream analysis.",
      "4. External GROMACS (`gmx grompp` / `gmx mdrun`) validation remains the responsibility of the researcher.",
      "",
    ].join("\n"),
  )

  if (Object.entries(state.commandOverrides).some(([k, v]) => k.startsWith(`run:${run.runId}:`) && v.trim())) {
    throw new Error("Edited command drafts exist for this run. Reset or reconcile them before exporting a canonical Run Input Package.")
  }

  const checks = await Promise.all(files.map(async (f) => ({ ...f, sha256: await sha256(f.content) })))
  const prior = run.inputSnapshots?.[0]
  if (prior) {
    if (canonical(prior.files) !== canonical(checks)) {
      throw new Error("Inputs for this run are already frozen. Generate a new run revision (new seed or protocol) for modified inputs.")
    }
    return prior
  }
  return {
    id: uuid(),
    generatedAt: new Date().toISOString(),
    softwareVersion: SOFTWARE_VERSION,
    files: checks,
    molecularSources: structuredClone(Object.fromEntries(runSpecies(run).map((s) => [s.moleculeId, state.molecules[s.moleculeId]]))),
    researcherReviewed: true,
  }
}

export async function validateSourceIntegrity(w: Workspace) {
  for (const r of w.runs) {
    for (const snapshot of r.inputSnapshots ?? []) {
      if (new Set(snapshot.files.map((f) => f.path)).size !== snapshot.files.length) {
        throw new Error("Duplicate frozen input paths: " + r.runId)
      }
      for (const f of snapshot.files) {
        if ((await sha256(f.content)) !== f.sha256) {
          throw new Error(`Frozen input checksum mismatch: ${r.runId}/${f.path}`)
        }
      }
      for (const [stage, dir] of [
        ["em", "01_em"],
        ["nvt", "02_nvt"],
        ["npt", "03_npt"],
        ["prod", "04_prod"],
      ] as const) {
        if (r.resolvedProtocol?.stages[stage]?.enabled) {
          const f = snapshot.files.find((item) => item.path === `${dir}/${stage}.mdp`)
          if (!f || f.content !== r.resolvedProtocol.stages[stage].mdp) {
            throw new Error(`Frozen MDP disagrees with resolved protocol: ${r.runId}/${stage}`)
          }
        }
      }
    }
  }
  for (const p of Object.values(w.qmGromacs.molecules)) {
    for (const f of [p.geometryFile, p.qmFile, p.originalTopologyFile]) {
      if (f && (await sha256(f.text)) !== f.sha256) {
        throw new Error(`Molecular source checksum mismatch: ${f.name}`)
      }
    }
  }
}

export async function archiveFiles(w: Workspace): Promise<PackageFile[]> {
  assertProjectOwnership(w, w.projectId)
  await validateSourceIntegrity(w)
  const files: PackageFile[] = [
    { path: "workspace.json", content: JSON.stringify(w) },
    { path: "project_manifest.json", content: JSON.stringify(w.project, null, 2) },
  ]
  for (const r of w.runs) {
    files.push({ path: `runs/${r.runId}/metadata.json`, content: JSON.stringify(buildRunMetadata(r), null, 2) })
    if (r.resolvedProtocol) {
      files.push({ path: `runs/${r.runId}/resolved_protocol.json`, content: JSON.stringify(r.resolvedProtocol, null, 2) })
    }
    for (const snapshot of r.inputSnapshots ?? []) {
      for (const f of snapshot.files) {
        files.push({ path: `runs/${r.runId}/inputs/${snapshot.id}/${f.path}`, content: f.content })
      }
    }
  }
  for (const [id, p] of Object.entries(w.qmGromacs.molecules)) {
    if (p.geometryFile) files.push({ path: `qm/${slug(id)}/${p.geometryFile.name}`, content: p.geometryFile.text })
    if (p.qmFile) files.push({ path: `qm/${slug(id)}/${p.qmFile.name}`, content: p.qmFile.text })
    if (p.originalTopologyFile) files.push({ path: `qm/${slug(id)}/original_topology.top`, content: p.originalTopologyFile.text })
  }
  files.push({ path: "provenance.json", content: JSON.stringify(w.provenance, null, 2) })
  files.push({
    path: "README.txt",
    content: `SolvForge MD ${SOFTWARE_VERSION} Complete Project Archive\nImport workspace.json or this ZIP to restore the full QM → GROMACS project atomically.\n`,
  })
  const checksums = await Promise.all(
    files.map(async (f) => ({ path: f.path, size: new TextEncoder().encode(f.content).byteLength, sha256: await sha256(f.content) })),
  )
  files.push({ path: "checksums.json", content: JSON.stringify(checksums, null, 2) })
  return files
}

export async function completeArchive(w: Workspace) {
  return makeZip(await archiveFiles(w))
}

export async function completeProjectJson(w: Workspace) {
  assertProjectOwnership(w, w.projectId)
  await validateSourceIntegrity(w)
  return JSON.stringify(w, null, 2)
}

export async function importProjectJson(text: string) {
  const workspace = importWorkspace(JSON.parse(text))
  await validateSourceIntegrity(workspace)
  return workspace
}

export async function importArchive(bytes: Uint8Array) {
  const files = await readZip(new Blob([new Uint8Array(bytes)]))
  const decode = new TextDecoder("utf-8", { fatal: true })
  const get = (path: string) => {
    const f = files.find((item) => item.path === path)
    if (!f) throw new Error("Archive is missing " + path)
    return f.bytes
  }
  const checks: Array<{ path: string; size: number; sha256: string }> = JSON.parse(decode.decode(get("checksums.json")))
  if (checks.length !== files.length - 1 || new Set(checks.map((c) => c.path)).size !== checks.length) {
    throw new Error("Archive file inventory differs from checksums.")
  }
  for (const c of checks) {
    const entryBytes = get(c.path)
    if (entryBytes.length !== c.size || (await sha256(entryBytes)) !== c.sha256) {
      throw new Error("Archive checksum mismatch: " + c.path)
    }
  }
  const workspace = importWorkspace(JSON.parse(decode.decode(get("workspace.json"))))
  await validateSourceIntegrity(workspace)
  return workspace
}
