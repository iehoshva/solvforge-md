import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import { join, dirname } from "node:path"
import { tmpdir } from "node:os"
import { execFileSync } from "node:child_process"
import {
  attachGeometry,
  attachQmOutput,
  defaultQmGromacsState,
  emptyMoleculePreparation,
  importTopology,
  reconcilePreparation,
  systemTopologyDiagnostics,
  topologyDiagnostics,
  parsePackedPdb,
  generatePdb,
} from "../lib/workbench/qm-gromacs.ts"
import { createSelfContainedGaffProject } from "../lib/workbench/preset.ts"
import { generateMatrixRuns, parseRunMatrixDesign } from "../lib/workbench/runs.ts"
import { runInputSnapshot } from "../lib/workbench/packages.ts"
import { sha256 } from "../lib/workbench/identity.ts"

const src = async (name, text) => ({
  name,
  text,
  size: new TextEncoder().encode(text).byteLength,
  lastModified: 0,
  sha256: await sha256(text),
  importedAt: "2026-01-01T00:00:00Z",
})

const makeMol = (id, res) => ({
  id,
  fullName: id,
  abbreviation: res,
  role: "solvent",
  formula: "OH",
  molecularWeight: 17.007,
  charge: 0,
  moleculeCount: null,
  topologyFile: "",
  coordinateFile: "",
  residueName: res,
  notes: "",
})

const ohXyz = `2\noh\nO 0 0 0\nH 1 0 0\n`
const ohCsv = `element,charge\nO,-0.4\nH,0.4\n`

test("hoisted [ atomtypes ] precede all [ moleculetype ] in self-contained GAFF2 topol.top (verified by cpp)", async () => {
  const project = createSelfContainedGaffProject()
  const molA = makeMol("mol_a", "MOLA")
  const molB = makeMol("mol_b", "MOLB")
  project.molecules = [molA, molB]
  project.systems = [
    {
      id: "ab",
      name: "A:B",
      abbreviation: "AB",
      componentIds: ["mol_a", "mol_b"],
      ratio: [1, 1],
      boxCounts: [1, 1],
      compositionSettings: {
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
      },
      notes: "",
    },
  ]
  project.runDesign = {
    systemIds: ["ab"],
    includeNeatSystems: true,
    soluteIds: [],
    soluteCounts: "",
    temperaturesK: "300",
    pressuresBar: "1",
    boxSizesNm: "4",
    useProtocolBox: true,
    replicas: 1,
  }

  const [run] = generateMatrixRuns(project, parseRunMatrixDesign(project.runDesign))
  const state = { ...defaultQmGromacsState(), projectId: project.projectId }

  for (const [idx, mol] of [molA, molB].entries()) {
    const typeO = `oh_o_${idx}`
    const typeH = `oh_h_${idx}`
    const itp = `[ atomtypes ]
${typeO} 8 15.999 0.000 A 0.30 0.50
${typeH} 1  1.008 0.000 A 0.00 0.00

[ moleculetype ]
${mol.residueName} 3

[ atoms ]
1 ${typeO} 1 ${mol.residueName} O1 1 -0.5 15.999
2 ${typeH} 1 ${mol.residueName} H1 1  0.5  1.008

[ bonds ]
1 2 1 0.10 400000
`
    let prep = emptyMoleculePreparation(mol)
    prep = attachGeometry(prep, await src(`${mol.id}.xyz`, ohXyz))
    prep = attachQmOutput(prep, await src(`${mol.id}.csv`, ohCsv))
    prep = importTopology(prep, await src(`${mol.id}.itp`, itp))
    prep = reconcilePreparation({
      ...prep,
      connectivityApproved: true,
      topologyReviewed: true,
      atoms: prep.atoms.map((a) => ({ ...a, mappingStatus: "AUTO-MAPPED" })),
    })
    state.molecules[mol.id] = prep
  }

  let serial = 1
  const packedLines = []
  let resNr = 1
  for (const mol of [molA, molB]) {
    for (const line of generatePdb(state.molecules[mol.id]).split("\n").filter((l) => l.startsWith("HETATM"))) {
      packedLines.push(`HETATM${String(serial++).padStart(5)}${line.slice(11, 22)}${String(resNr).padStart(4)}${line.slice(26)}`)
    }
    resNr++
  }
  const packedText = packedLines.join("\n") + "\nEND\n"
  const parsed = parsePackedPdb(packedText)
  state.packedSystems[run.runId] = {
    runId: run.runId,
    sourceFile: await src("packed.pdb", packedText),
    atoms: parsed.atoms,
    cryst1Angstrom: parsed.cryst1Angstrom,
    importedAt: "2026-01-01T00:00:00Z",
  }

  const snapshot = await runInputSnapshot(project, run, state)
  const root = mkdtempSync(join(tmpdir(), "solvforge-topology-"))
  try {
    for (const f of snapshot.files.filter((f) => f.path.startsWith("00_input/") && /\.(top|itp)$/.test(f.path))) {
      const p = join(root, f.path)
      mkdirSync(dirname(p), { recursive: true })
      writeFileSync(p, f.content)
    }
    const expanded = execFileSync("cpp", ["-P", "-traditional-cpp", join(root, "00_input/topol.top")], { encoding: "utf8" })
    const headers = [...expanded.matchAll(/^\s*\[\s*(\w+)\s*\]/gm)].map((m) => m[1])
    assert.ok(headers.includes("defaults"))
    assert.equal(headers.filter((h) => h === "moleculetype").length, 2)
    // No [ atomtypes ] may appear after the first [ moleculetype ]!
    assert.ok(!headers.slice(headers.indexOf("moleculetype")).includes("atomtypes"))
    assert.match(expanded, /oh_o_0 8 15\.999/)
    assert.match(expanded, /oh_o_1 8 15\.999/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("unresolved preprocessor directives and conflicting cross-molecule atomtypes fail validation", async () => {
  const molA = makeMol("mol_a", "MOLA")
  let prep = emptyMoleculePreparation(molA)
  prep = attachGeometry(prep, await src("a.xyz", ohXyz))
  prep = attachQmOutput(prep, await src("a.csv", ohCsv))
  const cond = importTopology(prep, await src("cond.itp", "#ifdef FOO\n[ atoms ]\n1 c 1 MOLA O1 1 0 16\n#endif\n"))
  assert.ok(topologyDiagnostics(cond).some((d) => d.code === "UNRESOLVED_TOPOLOGY_PREPROCESSOR" && d.severity === "ERROR"))

  // Conflicting atomtype definitions across molecules
  const molB = makeMol("mol_b", "MOLB")
  const pA = importTopology(prep, await src("a.itp", "[ atomtypes ]\nshared 8 15.999 0 A 0.30 0.50\n[ moleculetype ]\nMOLA 3\n[ atoms ]\n1 shared 1 MOLA O1 1 -0.4 15.999\n2 shared 1 MOLA H1 1 0.4 1.008\n[ bonds ]\n1 2 1 0.1 400000\n"))
  let prepB = emptyMoleculePreparation(molB)
  prepB = attachGeometry(prepB, await src("b.xyz", ohXyz))
  prepB = attachQmOutput(prepB, await src("b.csv", ohCsv))
  const pB = importTopology(prepB, await src("b.itp", "[ atomtypes ]\nshared 8 15.999 0 A 0.99 0.99\n[ moleculetype ]\nMOLB 3\n[ atoms ]\n1 shared 1 MOLB O1 1 -0.4 15.999\n2 shared 1 MOLB H1 1 0.4 1.008\n[ bonds ]\n1 2 1 0.1 400000\n"))

  const dummyRun = {
    runId: "R1",
    components: [
      { moleculeId: "mol_a", name: "A", count: 1, molecularWeight: 17 },
      { moleculeId: "mol_b", name: "B", count: 1, molecularWeight: 17 },
    ],
    soluteId: null,
    soluteCount: 0,
  }
  const sysDiag = systemTopologyDiagnostics(dummyRun, { mol_a: pA, mol_b: pB })
  assert.ok(sysDiag.some((d) => d.code === "DUPLICATE_SYSTEM_ATOMTYPE" && d.severity === "ERROR"))
})
