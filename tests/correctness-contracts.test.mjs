import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { writeFileSync, readFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { createThesisProject, migrateProject } from '../lib/workbench/preset.ts'
import { generateStageRuns, prodMdp, nvtMdp } from '../lib/workbench/runs.ts'
import { resolveProtocol, continuationPlan } from '../lib/workbench/protocol.ts'
import { emptyWorkspace, importWorkspace, mergeRuns, duplicateWorkspace } from '../lib/workbench/workspace.ts'
import { makeZip, readZip } from '../lib/workbench/zip.ts'
import { stateId } from '../lib/workbench/identity.ts'

function design() {
  const p = createThesisProject()
  p.desSystems.forEach(d => { d.compositionSettings.mode = 'manual'; d.boxCounts = [50, 10] })
  // Synthetic test setting, explicitly provided. Never a product density/compressibility preset.
  p.protocol.npt.compressibilityBarInverse = 0.0001
  return p
}
test('hierarchy generates 12, 21, 15; pure DES is an explicit separate system', () => {
  const p = design()
  assert.equal(generateStageRuns(p, 'A').length, 12)
  assert.equal(generateStageRuns(p, 'B').length, 0)
  p.selectedChampion = { valueId: p.desSystems[0].id, selectedAt: 'test', rationale: 'fixture', supportingAnalysis: [] }
  assert.equal(generateStageRuns(p, 'B').length, 21)
  assert.equal(generateStageRuns(p, 'C').length, 0)
  p.selectedOptimum = { valueId: 'n-6', selectedAt: 'test', rationale: 'fixture', supportingAnalysis: [] }
  assert.equal(generateStageRuns(p, 'C').length, 15)
  p.protocol.production.pureDes.enabled = true
  const pure = generateStageRuns(p, 'A').filter(r => r.systemKind === 'pure-des')
  assert.equal(pure.length, 4)
  assert.equal(pure[0].scientificState.soluteId, null)
  assert.equal(pure[0].soluteId, '')
  assert.equal(pure[0].soluteCount, 0)
  assert.equal(pure[0].totalMoleculeCount, 60)
})
test('replicas initialize independent seeds; snapshots do not follow subsequent form edits', () => {
  const p = design(); p.protocol.replicas = 2
  const [a, b] = generateStageRuns(p, 'A')
  assert.notEqual(a.randomSeed, b.randomSeed)
  assert.match(nvtMdp(p, a), new RegExp('gen-seed = ' + a.randomSeed))
  assert.match(nvtMdp(p, b), new RegExp('gen-seed = ' + b.randomSeed))
  assert.equal(stateId(a.scientificState), stateId(b.scientificState))
  const original = prodMdp(p, a)
  p.protocol.production.solute.initialNs = 42
  assert.equal(prodMdp(p, a), original)
  assert.notEqual(prodMdp(p, generateStageRuns(p, 'A')[0]), original)
})
test('every production setting has operational semantics', () => {
  const p = design(), run = generateStageRuns(p, 'A')[0]
  assert.equal(run.productionNs, 100)
  assert.equal(run.resolvedProtocol.production.maximumNs, 200)
  assert.equal(continuationPlan(run.resolvedProtocol, 190, 'pending').nextEndNs, 200)
  assert.equal(continuationPlan(run.resolvedProtocol, 100, 'accepted').stop, true)
  assert.equal(continuationPlan(run.resolvedProtocol, 200, 'pending').stop, true)
  assert.throws(() => continuationPlan(run.resolvedProtocol, 201, 'pending'))
  p.protocol.production.solute.mode = 'fixed'
  const fixed = generateStageRuns(p, 'A')[0]
  assert.equal(fixed.productionNs, 100)
  assert.equal(fixed.resolvedProtocol.production.maximumNs, 100)
})
test('resolved directives validate mismatches and apply every PME stage', () => {
  const p = design(), r = generateStageRuns(p, 'A')[0]
  assert.deepEqual(r.resolvedProtocol.diagnostics.filter(d=>d.severity==='ERROR'), [])
  for (const s of Object.values(r.resolvedProtocol.stages)) assert.equal(s.directives['pme-order'], '4')
  p.protocol.mdpOverrides.prod = 'nsteps = 20000000\n'
  const changed = generateStageRuns(p, 'A')[0]
  assert.equal(changed.productionNs, 40)
  p.protocol.mdpOverrides.nvt = 'gen-seed = 1\nref-t = 10\npcoupl = Berendsen'
  const bad = resolveProtocol(p, r)
  for (const code of ['REPLICA_SEED','TEMPERATURE_MISMATCH','NVT_PRESSURE']) assert.ok(bad.diagnostics.some(d=>d.code===code))
  p.protocol.forceField = 'CHARMM'
  assert.ok(resolveProtocol(p,r).diagnostics.some(d=>d.code==='METHOD_ARTIFACT_MISMATCH'))
})
test('workspace imports replace scientific slices atomically and cannot inherit evidence', () => {
  const w = emptyWorkspace(design()); w.runs = generateStageRuns(w.project,'A')
  w.project.selectedChampion = { valueId: 'thy-dod', selectedAt:'test', rationale:'test', supportingAnalysis:[] }
  assert.equal(importWorkspace({project:w.project}).runs.length,0)
  const restored = importWorkspace(w)
  assert.deepEqual(restored.runs,w.runs)
  assert.deepEqual(restored.scientific,w.scientific)
  assert.equal(duplicateWorkspace(w,false).runs.length,0)
  assert.equal(duplicateWorkspace(w,true).runs.length,12)
  const foreign = structuredClone(w); foreign.runs[0].projectId = 'foreign'
  assert.throws(()=>importWorkspace(foreign), /Cross-project/)
  assert.equal(mergeRuns(w.runs,generateStageRuns(w.project,'A')).length,12)
})
test('migration preserves creation software and quarantines legacy evidence', () => {
  const p = design(); p.createdWithVersion=undefined; p.softwareVersion='0.1.0'; p.currentSchemaVersion=undefined; p.schemaVersion='0.1'
  const migrated=migrateProject(p)
  assert.equal(migrated.createdWithVersion,'0.1.0')
  assert.equal(migrated.originalSchemaVersion,'2.0') // explicit original provenance is preserved
  const w=importWorkspace({project:p, datasets:[{id:'old'}]})
  assert.equal(w.datasets.length,0)
  assert.ok(w.legacyEvidence)
})
for (const mb of [1,10,50]) test('ZIP independently extracts '+mb+' MB ORCA-like source with exact SHA-256', async () => {
  const line='  12 C : -0.023123  1.234567890  -2.345678901  0.000000123\n# ORCA SCF ITERATION ENERGY -1234.123456789\n'
  const text=line.repeat(Math.ceil(mb*1024*1024/line.length)).slice(0,mb*1024*1024)
  const files=[{path:'project/molecules/source/calculation.out',content:text},{path:'project/manifests/project.json',content:'{"fixture":true}'}]
  const zip=makeZip(files), dir=mkdtempSync(join(tmpdir(),'solvforge-zip-'))
  try {
    const path=join(dir,'archive.zip'); writeFileSync(path,Buffer.from(await zip.arrayBuffer()))
    const result=JSON.parse(execFileSync('python3',['-c','import zipfile,json,hashlib,sys; z=zipfile.ZipFile(sys.argv[1]); print(json.dumps([{ "path":i.filename,"size":i.file_size,"sha256":hashlib.sha256(z.read(i)).hexdigest()} for i in z.infolist()]))',path],{encoding:'utf8'}))
    assert.equal(result.length,2)
    for(let i=0;i<2;i++){assert.equal(result[i].path,files[i].path);assert.equal(result[i].size,Buffer.byteLength(files[i].content));assert.equal(result[i].sha256,createHash('sha256').update(files[i].content).digest('hex'))}
    const parsed=await readZip(zip); assert.equal(parsed.length,2); assert.equal(new TextDecoder().decode(parsed[0].bytes),text)
  } finally { rmSync(dir,{recursive:true,force:true}) }
})
