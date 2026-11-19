import assert from "node:assert/strict"
import test from "node:test"
import {
  attachGeometry,
  attachQmOutput,
  defaultQmGromacsState,
  emptyMoleculePreparation,
  generateAtomMappingCsv,
  generateChargesCsv,
  generateIndexNdx,
  generateItp,
  generatePackedGro,
  generatePackmolInput,
  generatePdb,
  generateTopolTop,
  importTopology,
  mappedFinalChargeSum,
  parsePackedPdb,
  preparationStatus,
  qmDiagnostics,
  reconcilePreparation,
  topologyDiagnostics,
  validatePackedSystem,
} from "../lib/workbench/qm-gromacs.ts"
import { createSelfContainedGaffProject, migrateProject } from "../lib/workbench/preset.ts"
import { generateMatrixRuns, parseRunMatrixDesign } from "../lib/workbench/runs.ts"
import { buildRunMetadata, completeArchive, importArchive, runInputSnapshot } from "../lib/workbench/packages.ts"
import { emptyWorkspace } from "../lib/workbench/workspace.ts"
import { sha256 } from "../lib/workbench/identity.ts"

const makeSource = async (name, text) => ({
  name,
  text,
  size: new TextEncoder().encode(text).byteLength,
  lastModified: 0,
  sha256: await sha256(text),
  importedAt: "2026-01-01T00:00:00Z",
})

const waterXyz = `3
water
O 0.000000 0.000000 0.117300
H 0.000000 0.757200 -0.469200
H 0.000000 -0.757200 -0.469200
`

const orcaR2scan = `! r2SCAN-3c CHELPG
* xyz 0 1
CARTESIAN COORDINATES (ANGSTROEM)
---------------------------------
O  0.000000  0.000000  0.117300
H  0.000000  0.757200 -0.469200
H  0.000000 -0.757200 -0.469200

CHELPG Charges
--------------------------------
 0 O : -0.800300
 1 H :  0.400000
 2 H :  0.400000
Total charge: -0.000300

ORCA TERMINATED NORMALLY
`

const gaffWaterItp = `[ defaults ]
1 2 yes 0.5 0.83333333

[ atomtypes ]
ow  8 15.999  0.000 A 3.15061e-01 6.36386e-01
hw  1  1.008  0.000 A 0.00000e+00 0.00000e+00

[ moleculetype ]
WAT 3

[ atoms ]
1 ow 1 WAT O1 1 -0.834 15.999
2 hw 1 WAT H1 1  0.417  1.008
3 hw 1 WAT H2 1  0.417  1.008

[ bonds ]
1 2 1 0.09572 502416.0
1 3 1 0.09572 502416.0

[ angles ]
2 1 3 1 104.52 628.02
`

test("Charge scaling, residual neutralization, and topology-native mode work with full provenance", async () => {
  const mol = {
    id: "water",
    fullName: "Water",
    abbreviation: "WAT",
    role: "solvent",
    formula: "H2O",
    molecularWeight: 18.015,
    charge: 0,
    moleculeCount: null,
    topologyFile: "",
    coordinateFile: "",
    residueName: "WAT",
    notes: "",
  }

  let prep = emptyMoleculePreparation(mol)
  // Can import QM output directly even without separate .xyz!
  prep = attachQmOutput(prep, await makeSource("water_r2scan.out", orcaR2scan))
  assert.equal(prep.geometryAtoms.length, 3)
  assert.equal(prep.qmMetadata.method, "r2SCAN-3c")
  assert.equal(prep.selectedChargeScheme, "CHELPG")
  // Raw sum is -0.0003 -> triggers CHARGE_SUM_MISMATCH until neutralized or acknowledged
  assert.ok(qmDiagnostics(prep).some((d) => d.code === "CHARGE_SUM_MISMATCH" && d.severity === "ERROR"))

  // Apply 0.8 scaling + uniform residual neutralization -> exact 0.00000000!
  prep = reconcilePreparation({ ...prep, chargeScaleFactor: 0.8, neutralizationPolicy: "uniform-residual" })
  assert.ok(Math.abs(mappedFinalChargeSum(prep)) < 1e-12)
  assert.equal(qmDiagnostics(prep).filter((d) => d.severity === "ERROR").length, 0)

  // Import GAFF2 topology (no OPLS-AA anywhere!)
  prep = importTopology(prep, await makeSource("water_gaff.itp", gaffWaterItp))
  prep = {
    ...prep,
    connectivityApproved: true,
    topologyReviewed: true,
    gromppValidated: true,
    atoms: prep.atoms.map((a) => ({ ...a, mappingStatus: "AUTO-MAPPED" })),
  }
  assert.equal(topologyDiagnostics(prep).filter((d) => d.severity === "ERROR").length, 0)
  assert.match(preparationStatus(prep), /RESEARCHER ACCEPTED/)

  const itp = generateItp(prep, "GAFF2 (self-contained)")
  assert.match(itp, /GAFF2/)
  assert.match(itp, /r2SCAN-3c/)
  assert.match(itp, /CHELPG/)
  assert.doesNotMatch(itp, /OPLS-AA|BP86|def2-TZVP/)

  // Switch to 'topology' charge mode -> keeps -0.834 / +0.417 from GAFF2!
  const topoMode = reconcilePreparation({ ...prep, chargeMode: "topology", chargeScaleFactor: 1.0, neutralizationPolicy: "none" })
  assert.ok(Math.abs(topoMode.atoms[0].finalCharge - -0.834) < 1e-9)
  assert.match(generateChargesCsv(topoMode), /topology/)
  assert.match(generateAtomMappingCsv(topoMode), /ow/)
})

test("End-to-end self-contained GAFF2 run package emits MoDy Analyse metadata.json and round-trips ZIP archive", async () => {
  const project = createSelfContainedGaffProject()
  const water = {
    id: "water",
    fullName: "Water",
    abbreviation: "WAT",
    role: "solvent",
    formula: "H2O",
    molecularWeight: 18.015,
    charge: 0,
    moleculeCount: null,
    topologyFile: "",
    coordinateFile: "",
    residueName: "WAT",
    notes: "",
  }
  project.molecules = [water]
  project.systems = [
    {
      id: "neat-water",
      name: "Neat Water",
      abbreviation: "WAT",
      componentIds: ["water"],
      ratio: [1],
      boxCounts: [2],
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
    systemIds: ["neat-water"],
    includeNeatSystems: true,
    soluteIds: [],
    soluteCounts: "",
    temperaturesK: "300",
    pressuresBar: "1",
    boxSizesNm: "3",
    useProtocolBox: true,
    replicas: 1,
  }

  const runs = generateMatrixRuns(project, parseRunMatrixDesign(project.runDesign))
  assert.equal(runs.length, 1)
  const run = runs[0]
  const meta = buildRunMetadata(run)
  assert.equal(meta.replica, 1)
  assert.equal(meta.temperatureK, 300)
  assert.equal(meta.soluteAbbreviation, null)
  assert.ok(["pure-des", "solute-loaded", "binary", "ternary", "custom"].includes(meta.systemKind))

  let prep = emptyMoleculePreparation(water)
  prep = attachGeometry(prep, await makeSource("water.xyz", waterXyz))
  prep = attachQmOutput(prep, await makeSource("water.out", orcaR2scan))
  prep = reconcilePreparation({ ...prep, neutralizationPolicy: "uniform-residual" })
  prep = importTopology(prep, await makeSource("water.itp", gaffWaterItp))
  prep = {
    ...prep,
    connectivityApproved: true,
    topologyReviewed: true,
    atoms: prep.atoms.map((a) => ({ ...a, mappingStatus: "AUTO-MAPPED" })),
  }

  const state = { ...defaultQmGromacsState(), projectId: project.projectId, molecules: { water: prep } }
  const packmol = generatePackmolInput(run, state.molecules, state.packmol)
  assert.match(packmol, /number 2/)

  // Construct valid packed.pdb for 2 water molecules
  const singlePdbLines = generatePdb(prep)
    .split("\n")
    .filter((l) => l.startsWith("HETATM"))
  let serial = 1
  const packedLines = []
  for (let m = 1; m <= 2; m++) {
    for (const line of singlePdbLines) {
      packedLines.push(`HETATM${String(serial++).padStart(5)}${line.slice(11, 22)}${String(m).padStart(4)}${line.slice(26)}`)
    }
  }
  const packedText = packedLines.join("\n") + "\nEND\n"
  const packedSource = await makeSource("packed.pdb", packedText)
  const parsedPacked = parsePackedPdb(packedText)
  state.packedSystems[run.runId] = {
    runId: run.runId,
    sourceFile: packedSource,
    atoms: parsedPacked.atoms,
    cryst1Angstrom: parsedPacked.cryst1Angstrom,
    importedAt: "2026-01-01T00:00:00Z",
  }

  assert.equal(validatePackedSystem(run, state.packedSystems[run.runId], state.molecules).filter((d) => d.severity === "ERROR").length, 0)
  const topol = generateTopolTop(run, state.molecules)
  assert.match(topol, /\[ defaults \]/)
  assert.match(topol, /\[ atomtypes \]/)
  assert.doesNotMatch(topol, /oplsaa\.ff/)

  const gro = generatePackedGro(run, state.packedSystems[run.runId])
  assert.match(gro, /5\.00000\s+5\.00000\s+5\.00000/)
  const ndx = generateIndexNdx(state.packedSystems[run.runId], run, state.molecules)
  assert.match(ndx, /\[ System \]/)
  assert.match(ndx, /\[ WAT \]/)

  const snapshot = await runInputSnapshot(project, run, state)
  assert.ok(snapshot.files.some((f) => f.path === "metadata.json"))
  assert.ok(snapshot.files.some((f) => f.path === "00_input/topol.top"))
  assert.ok(snapshot.files.some((f) => f.path === "00_input/water.itp"))

  const w = { ...emptyWorkspace(project), runs: [{ ...run, inputSnapshots: [snapshot] }], qmGromacs: state }
  const zipBlob = await completeArchive(w)
  const restored = await importArchive(new Uint8Array(await zipBlob.arrayBuffer()))
  assert.equal(restored.projectId, w.projectId)
  assert.equal(restored.runs.length, 1)
})

test("Legacy schema 2.0 project manifests migrate cleanly without errors", () => {
  const legacy = {
    schemaVersion: "2.0",
    projectId: "legacy-1",
    projectName: "Old Thesis Project",
    molecules: [
      { id: "m1", fullName: "Ethanol", abbreviation: "ETH", role: "solvent component", formula: "C2H6O", molecularWeight: 46.07, charge: 0, moleculeCount: null, topologyFile: "", coordinateFile: "", residueName: "ETH", notes: "" },
    ],
    desSystems: [
      { id: "s1", name: "Ethanol", abbreviation: "ETH", componentIds: ["m1"], ratio: [1], boxCounts: [100], compositionSettings: { mode: "manual" }, notes: "" },
    ],
    protocol: {
      forceField: "OPLS-AA",
      npt: { compressibilityBarInverse: 0.000045 },
      nonbonded: { cutoffNm: 1.1 },
    },
  }
  const migrated = migrateProject(legacy)
  assert.equal(migrated.schemaVersion, "3.0")
  assert.equal(migrated.systems.length, 1)
  assert.equal(migrated.molecules[0].role, "solvent")
  assert.equal(migrated.protocol.forceFieldInclude, "oplsaa.ff/forcefield.itp")
  assert.equal(migrated.protocol.npt.compressibility, "0.000045")
  assert.equal(migrated.protocol.nonbonded.rcoulombNm, 1.1)
})
