import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import test from "node:test"

test("scientific validation suite passes deterministic core algorithms", () => {
  const script = `import('./lib/workbench/scientific.ts').then(module => { const results = module.runValidationSuite(); const failed = results.filter(result => !result.passed); if (failed.length) { console.error(JSON.stringify(failed)); process.exit(1) } console.log(JSON.stringify(results)) })`
  const result = spawnSync(process.execPath, ["--experimental-strip-types", "-e", script], { cwd: process.cwd(), encoding: "utf8" })
  assert.equal(result.status, 0, result.stderr)
  const results = JSON.parse(result.stdout.trim())
  assert.equal(results.length, 5)
  assert.ok(results.every((item) => item.passed))
})

test("MDP validator rejects zero timestep and duplicate directives", () => {
  const script = `import('./lib/workbench/mdp.ts').then(module => { const result = module.validateMdp('integrator = md\\ndt = 0\\ndt = 0.002\\nnsteps = 1000\\npcoupl = no\\n', 'nvt', { temperatureK: 300, durationNs: 0.002 }); console.log(JSON.stringify(result)) })`
  const result = spawnSync(process.execPath, ["--experimental-strip-types", "-e", script], { cwd: process.cwd(), encoding: "utf8" })
  assert.equal(result.status, 0, result.stderr)
  const diagnostics = JSON.parse(result.stdout.trim())
  assert.ok(diagnostics.some((item) => item.code === "DUPLICATE_DIRECTIVE" && item.severity === "ERROR"))
  assert.ok(diagnostics.some((item) => item.code === "INVALID_TIMESTEP" && item.severity === "ERROR"))
})

test("box composition preserves integer ratio and closes mole and mass fractions", () => {
  const script = `Promise.all([import('./lib/workbench/preset.ts'), import('./lib/workbench/composition.ts')]).then(([preset, composition]) => { const project = preset.createThesisProject(); const system = project.desSystems.find(item => item.id === 'thy-oct'); system.compositionSettings.densityPoints = [{ id:'rho-323', densityGcm3:0.920, temperatureK:323.15, status:'literature', sourceNote:'test reference' }]; const result = composition.calculateBoxComposition(project, 'thy-oct', 'geranyl-acetate', 6, 323.15); console.log(JSON.stringify(result)) })`
  const child = spawnSync(process.execPath, ["--experimental-strip-types", "-e", script], { cwd: process.cwd(), encoding: "utf8" })
  assert.equal(child.status, 0, child.stderr)
  const result = JSON.parse(child.stdout.trim())
  assert.ok(result.selected)
  assert.equal(result.componentCounts[0], 5 * result.componentCounts[1])
  assert.equal(result.metadata.ratio.join(":"), "5:1")
  assert.equal(result.metadata.actualDesRatio.join(":"), "5:1")
  assert.ok(Math.abs(Object.values(result.metadata.moleFractions).reduce((a, b) => a + b, 0) - 1) < 1e-12)
  assert.ok(Math.abs(Object.values(result.metadata.massFractions).reduce((a, b) => a + b, 0) - 1) < 1e-12)
  assert.ok(result.metadata.totalNumberDensityNm3 > 0)
  assert.ok(result.candidates.length >= 3)
})

test("solute-mass policy, locked series, and temperature interpolation are explicit", () => {
  const script = `Promise.all([import('./lib/workbench/preset.ts'), import('./lib/workbench/composition.ts')]).then(([preset, composition]) => { const project = preset.createThesisProject(); const system = project.desSystems.find(item => item.id === 'thy-oct'); system.compositionSettings.densityPoints = [{ id:'rho-a', densityGcm3:0.950, temperatureK:298.15, status:'experimental', sourceNote:'A' }, { id:'rho-b', densityGcm3:0.900, temperatureK:323.15, status:'experimental', sourceNote:'B' }]; system.compositionSettings.densityResolution = 'linear-interpolation'; system.compositionSettings.soluteMassMode = 'add-after'; const addAfter = composition.calculateBoxComposition(project, 'thy-oct', 'geranyl-acetate', 24, 310.65); system.compositionSettings.soluteMassMode = 'include-in-target'; const included = composition.calculateBoxComposition(project, 'thy-oct', 'geranyl-acetate', 24, 310.65); system.compositionSettings.lockAcrossSeries = true; system.compositionSettings.lockReferenceSoluteCount = 1; const locked1 = composition.calculateBoxComposition(project, 'thy-oct', 'geranyl-acetate', 1, 310.65); const locked24 = composition.calculateBoxComposition(project, 'thy-oct', 'geranyl-acetate', 24, 310.65); console.log(JSON.stringify({addAfter,included,locked1,locked24})) })`
  const child = spawnSync(process.execPath, ["--experimental-strip-types", "-e", script], { cwd: process.cwd(), encoding: "utf8" })
  assert.equal(child.status, 0, child.stderr)
  const { addAfter, included, locked1, locked24 } = JSON.parse(child.stdout.trim())
  assert.equal(included.density.method, "linear-interpolation")
  assert.ok(Math.abs(included.density.densityGcm3 - 0.925) < 1e-12)
  assert.ok(Math.abs(included.metadata.densityDeviationPct) < Math.abs(addAfter.metadata.densityDeviationPct))
  assert.deepEqual(locked1.componentCounts, locked24.componentCounts)
  assert.notEqual(locked1.metadata.estimatedDensityGcm3, locked24.metadata.estimatedDensityGcm3)
  assert.ok(locked24.diagnostics.some((item) => item.code === "DES_COUNTS_LOCKED"))
})

test("automatic composition refuses missing density instead of inventing counts", () => {
  const script = `Promise.all([import('./lib/workbench/preset.ts'), import('./lib/workbench/composition.ts')]).then(([preset, composition]) => { const project = preset.createThesisProject(); const result = composition.calculateBoxComposition(project, 'thy-oct', 'geranyl-acetate', 6, 323.15); console.log(JSON.stringify(result)) })`
  const child = spawnSync(process.execPath, ["--experimental-strip-types", "-e", script], { cwd: process.cwd(), encoding: "utf8" })
  assert.equal(child.status, 0, child.stderr)
  const result = JSON.parse(child.stdout.trim())
  assert.equal(result.metadata, null)
  assert.equal(result.componentCounts, null)
  assert.ok(result.diagnostics.some((item) => item.code === "DENSITY_REQUIRED" && item.severity === "ERROR"))
})

test("323.15 K thesis density references remain opt-in and preserve provenance", () => {
  const script = `Promise.all([import('./lib/workbench/preset.ts'), import('./lib/workbench/composition.ts'), import('./lib/workbench/density-presets.ts')]).then(([preset, composition, density]) => { const project = preset.createThesisProject(); const untouched = composition.calculateBoxComposition(project, 'thy-oct', 'geranyl-acetate', 6, 323.15); const withReferences = density.applyAllCompatibleThesisDensityReferences(project); const results = Object.fromEntries(withReferences.desSystems.map(system => [system.id, composition.calculateBoxComposition(withReferences, system.id, 'geranyl-acetate', 6, 323.15)])); console.log(JSON.stringify({untouched,references:density.THESIS_DENSITY_REFERENCES_323K,results})) })`
  const child = spawnSync(process.execPath, ["--experimental-strip-types", "-e", script], { cwd: process.cwd(), encoding: "utf8" })
  assert.equal(child.status, 0, child.stderr)
  const { untouched, references, results } = JSON.parse(child.stdout.trim())
  assert.equal(untouched.metadata, null)
  assert.equal(references.length, 4)
  assert.deepEqual(references.map((item) => item.densityGcm3), [0.9194, 0.9532, 0.9326, 0.9394])
  assert.equal(references.filter((item) => item.status === "estimated").length, 3)
  assert.equal(references.find((item) => item.desId === "thy-lau").derivation, "composition-interpolation")
  for (const [desId, result] of Object.entries(results)) {
    assert.ok(result.metadata, `${desId} should resolve after explicit reference application`)
    assert.ok(result.metadata.densityReferenceId)
    assert.ok(result.metadata.densitySources.length >= 1)
    assert.equal(result.metadata.ratio.join(":"), "5:1")
  }
  assert.ok(results["thy-oct"].diagnostics.some((item) => item.code === "ESTIMATED_DENSITY_REFERENCE" && item.severity === "WARNING"))
  assert.ok(results["thy-lau"].diagnostics.some((item) => item.code === "DENSITY_COMPOSITION_INTERPOLATED" && item.severity === "INFO"))
})

test("5 nm reference compositions minimize the selected physical density objective", () => {
  const script = `Promise.all([import('./lib/workbench/preset.ts'), import('./lib/workbench/composition.ts'), import('./lib/workbench/density-presets.ts')]).then(([preset, composition, density]) => { const project = density.applyAllCompatibleThesisDensityReferences(preset.createThesisProject()); const rows = project.desSystems.map(system => composition.calculateBoxComposition(project, system.id, 'geranyl-acetate', 6, 323.15)); console.log(JSON.stringify(rows)) })`
  const child = spawnSync(process.execPath, ["--experimental-strip-types", "-e", script], { cwd: process.cwd(), encoding: "utf8" })
  assert.equal(child.status, 0, child.stderr)
  const rows = JSON.parse(child.stdout.trim())
  for (const row of rows) {
    assert.ok(row.candidates.length >= 3)
    assert.ok(row.selected.mathematicallyClosest)
    assert.deepEqual(row.selected.componentCounts, [5 * row.selected.multiplier, row.selected.multiplier])
    const best = Math.min(...row.candidates.map((candidate) => Math.abs(candidate.selectionErrorPct)))
    assert.ok(Math.abs(Math.abs(row.selected.selectionErrorPct) - best) < 1e-12)
  }
})
