import test from "node:test"
import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { createExampleSolutionProject } from "../lib/workbench/preset.ts"
import { commands, generateMatrixRuns, parseNumericAxis, parseRunMatrixDesign } from "../lib/workbench/runs.ts"
import { resolveProtocol, continuationPlan } from "../lib/workbench/protocol.ts"
import { sha256Portable, uuid } from "../lib/workbench/crypto.ts"

const resolve = (p) =>
  resolveProtocol(p, {
    temperatureK: 310,
    pressureBar: p.protocol.pressureBar,
    randomSeed: p.protocol.randomSeedBase,
  })

test("arbitrary force fields, charge schemes, ensembles, tc-grps, and semiisotropic barostats resolve without hardcoding", () => {
  const p = createExampleSolutionProject()
  p.protocol.forceField = "CHARMM36"
  p.protocol.forceFieldInclude = "charmm36.ff/forcefield.itp"
  p.protocol.chargeScheme = "Gaussian wB97XD/def2-TZVP RESP (0.8x)"
  p.protocol.nvt.tcGrps = "Solute Solvent"
  p.protocol.npt.pcoupltype = "semiisotropic"
  p.protocol.npt.compressibility = "4.5e-5 4.5e-5"
  p.protocol.nonbonded.vdwModifier = "Force-switch"
  p.protocol.mdpOverrides.prod = "rvdw-switch = 1.0"

  const rp = resolve(p)
  assert.equal(rp.diagnostics.filter((d) => d.severity === "ERROR").length, 0)
  assert.equal(rp.forceField, "CHARMM36")
  assert.equal(rp.stages.nvt.directives["tc-grps"], "Solute Solvent")
  assert.equal(rp.stages.nvt.directives["ref-t"], "310 310")
  assert.equal(rp.stages.npt.directives["ref-p"], "1 1")
  assert.equal(rp.stages.npt.directives.compressibility, "4.5e-5 4.5e-5")
  assert.equal(rp.stages.prod.directives["vdw-modifier"], "Force-switch")
  assert.equal(rp.stages.prod.directives["rvdw-switch"], "1.0")
})

test("NVT-only production and disabled NPT stage generate valid checkpoint-chained commands", () => {
  const p = createExampleSolutionProject()
  p.protocol.enabledStages = { em: true, nvt: true, npt: false, prod: true }
  p.protocol.production.ensemble = "NVT"
  p.protocol.npt.compressibility = "" // not required when NPT disabled and prod is NVT

  const runs = generateMatrixRuns(p, parseRunMatrixDesign(p.runDesign))
  assert.ok(runs.length > 0)
  const r = runs[0]
  assert.equal(r.resolvedProtocol.diagnostics.filter((d) => d.severity === "ERROR").length, 0)
  assert.equal(r.resolvedProtocol.stages.prod.directives.pcoupl, "no")
  const script = commands(r)
  assert.match(script, /01_em\/em/)
  assert.match(script, /02_nvt\/nvt/)
  assert.doesNotMatch(script, /03_npt\/npt/)
  assert.match(script, /-c 02_nvt\/nvt\.gro -t 02_nvt\/nvt\.cpt/)
})

test("continuation controls produce bounded convert-tpr commands", () => {
  const p = createExampleSolutionProject()
  p.protocol.production.mode = "convergence-controlled"
  p.protocol.production.initialNs = 50
  p.protocol.production.extensionNs = 25
  p.protocol.production.maximumNs = 100
  const plan = continuationPlan(resolve(p), 50, "pending")
  assert.equal(plan.stop, false)
  assert.equal(plan.nextEndNs, 75)
  assert.match(plan.commands, /-until 75000/)
})

test("invalid numeric axes reject malformed entries and huge batches", () => {
  assert.throws(() => parseNumericAxis("1,2,typo,4"), /Malformed/)
  const p = createExampleSolutionProject()
  assert.throws(
    () =>
      generateMatrixRuns(p, {
        systemIds: ["eth-wat"],
        includeNeatSystems: false,
        soluteIds: ["caffeine"],
        soluteCounts: [1, 2, 3],
        temperaturesK: [300, 320, 340],
        pressuresBar: [1],
        boxSizesNm: [5],
        useProtocolBox: true,
        replicas: 10000,
      }),
    /limit/,
  )
})

test("portable SHA-256 matches Node crypto and uuid emits v4", () => {
  for (const len of [0, 1, 55, 56, 63, 64, 65, 1024 * 1024]) {
    const b = new Uint8Array(len)
    const text = new TextEncoder().encode("QM CHARGES\n1 O -0.74\n")
    for (let i = 0; i < len; i++) b[i] = text[i % text.length]
    assert.equal(sha256Portable(b), createHash("sha256").update(b).digest("hex"))
  }
  assert.match(uuid(), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
})
