import test from 'node:test'
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {createThesisProject} from '../lib/workbench/preset.ts'
import {generateStageRuns,generateCustomRuns,parseNumericAxis} from '../lib/workbench/runs.ts'
import {resolveProtocol,continuationPlan} from '../lib/workbench/protocol.ts'
import {sha256Portable,uuid} from '../lib/workbench/crypto.ts'
const base=()=>{const p=createThesisProject();p.protocol.npt.compressibilityBarInverse=.0001;return p}
const resolve=p=>resolveProtocol(p,{temperatureK:p.stageATemperatureK,pressureBar:p.protocol.pressureBar,randomSeed:p.protocol.randomSeedBase,systemKind:'solute'})
// Every non-metadata protocol control has an observable artifact contract.
const cases=[
 ['em.method','cg','em','integrator','cg'],['em.maxSteps',70000,'em','nsteps','70000'],['em.fmax',500,'em','emtol','500'],
 ['nvt.durationNs',8,'nvt','nsteps','8000000'],['nvt.timestepFs',2,'nvt','dt','0.002'],['nvt.thermostat','Nose-Hoover','prod','tcoupl','Nose-Hoover'],['nvt.tauTPs',.3,'npt','tau-t','0.3'],
 ['npt.durationNs',12,'npt','nsteps','6000000'],['npt.timestepFs',1,'npt','dt','0.001'],['npt.barostat','C-rescale','prod','pcoupl','C-rescale'],['npt.tauPPs',3,'prod','tau-p','3'],['npt.compressibilityBarInverse',.0002,'npt','compressibility','0.0002'],
 ['production.solute.initialNs',120,'prod','nsteps','60000000'],['production.timestepFs',1,'prod','dt','0.001'],['production.framePs',10,'prod','nstxout-compressed','5000'],
 ['nonbonded.cutoffNm',1.4,'em','rcoulomb','1.4'],['nonbonded.coulombMethod','Cut-off','npt','coulombtype','Cut-off'],['nonbonded.pmeOrder',6,'nvt','pme-order','6'],['nonbonded.fourierSpacingNm',.15,'em','fourierspacing','0.15'],
 ['constraints','all-bonds','prod','constraints','all-bonds'],['constraintAlgorithm','shake','nvt','constraint-algorithm','shake'],['pressureBar',2,'prod','ref-p','2'],['randomSeedBase',98765,'nvt','gen-seed','98765']
]
for(const [path,value,stage,directive,expected]of cases)test('protocol control → MDP: '+path,()=>{
 const p=base(),before=resolve(p),keys=path.split('.'),last=keys.pop();let target=p.protocol;for(const key of keys)target=target[key];target[last]=value
 const after=resolve(p);assert.equal(after.stages[stage].directives[directive],expected);assert.notEqual(after.stages[stage].mdp,before.stages[stage].mdp);assert.equal(after.diagnostics.filter(d=>d.severity==='ERROR').length,0)
})
test('continuation controls change bounded artifact; pure DES uses its own duration',()=>{
 const p=base();p.protocol.production.solute.extensionNs=35;p.protocol.production.solute.maximumNs=160
 assert.match(continuationPlan(resolve(p),140,'pending').commands,/-until 160000/)
 p.protocol.production.pureDes.enabled=true;p.protocol.production.pureDes.durationNs=77
 assert.equal(generateStageRuns(p,'A').find(r=>r.systemKind==='pure-des').productionNs,77)
})
test('invalid numeric axes never silently discard values or allocate enormous matrices',()=>{
 assert.throws(()=>parseNumericAxis('1,2,typo,4'),/Malformed/)
 assert.throws(()=>generateCustomRuns(base(),{desIds:['thymol-dodecanol'],soluteIds:['geranyl-acetate'],soluteCounts:[1,2,3],temperaturesK:[300,320,340],pressuresBar:[1],boxSizesNm:[5],replicas:10000}),/limit/)
})
test('portable SHA-256 agrees with reference at padding boundaries and a realistic large source',()=>{
 for(const len of [0,1,55,56,63,64,65,1024*1024,10*1024*1024,50*1024*1024]){
  const b=new Uint8Array(len);const text=new TextEncoder().encode('ORCA ATOMIC CHARGES\n0 O : -0.400000\nÅ\n');for(let i=0;i<len;i++)b[i]=text[i%text.length]
  assert.equal(sha256Portable(b),createHash('sha256').update(b).digest('hex'))
 }
 assert.match(uuid(),/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
})
