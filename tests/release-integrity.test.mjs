import test from 'node:test'
import assert from 'node:assert/strict'
import {thermodynamicFixture,acceptance} from './acceptance-fixture.mjs'
import {calculateActivity,currentActivity,currentThermodynamic,fitInfiniteDilution,currentInfiniteDilution} from '../lib/workbench/thermodynamics.ts'
import {completeProjectJson,importProjectJson} from '../lib/workbench/packages.ts'
import {fixture,addRun,addEvidence} from './scientific-fixture.mjs'
import {pointFromDataset,validateSsmPoints,fitValidatedSsm,currentSsmFit} from '../lib/workbench/finite-size.ts'

test('result identity, uncertainty semantics and acceptance cannot be relabelled without invalidating descendants',async()=>{
 const w=await thermodynamicFixture(),rs=w.scientific.thermodynamicResults,r=rs[0]
 const a=calculateActivity(rs,'linear',{type:'composition',x:rs[0].moleFractions[0],gamma:2},'SYNTHETIC reference',w.scientific,w.runs,w.datasets)
 a.accepted=true;a.decision=acceptance(w,a.stateId,a.sourceThermodynamicIds);w.scientific.activityResults.push(a)
 assert.equal(currentActivity(a,w.scientific,w.runs,w.datasets),true)
 for(const patch of [{temperatureK:999},{projectId:'foreign'},{stateId:'another-state'},{seriesIdentity:{...a.seriesIdentity,pressureBar:99}},{decision:{...a.decision,sourceIds:[]}},{uncertainty:{sd:123}}])assert.equal(currentActivity({...a,...patch},w.scientific,w.runs,w.datasets),false)
 for(const patch of [{moleFractions:[.1,.7,.2]},{soluteId:'other'},{uncertainty:{samples:[123]}},{override:{...r.override,sourceIds:[]}},{uncertaintyProvenance:[]}])assert.equal(currentThermodynamic({...r,...patch},w.scientific,w.runs,w.datasets),false)
 a.infiniteDilution=fitInfiniteDilution(a,'linear',1/3,w.scientific,w.runs,w.datasets);a.infiniteDilution.decision=acceptance(w,a.stateId,[a.id]);assert.equal(currentInfiniteDilution(a),true)
 assert.equal(currentInfiniteDilution({...a,infiniteDilution:{...a.infiniteDilution,decision:{...a.infiniteDilution.decision,stateId:'wrong'}}}),false)
 const restored=await importProjectJson(await completeProjectJson(w));assert.deepEqual(restored.scientific,JSON.parse(JSON.stringify(w.scientific)))
 const damaged=structuredClone(w);damaged.datasets[0].g[1]=5;await assert.rejects(completeProjectJson(damaged),/numerical arrays/);await assert.rejects(importProjectJson(JSON.stringify(damaged)),/numerical arrays/)
})

test('SSM cannot change composition, pair or decision ancestry while retaining fitted values',async()=>{
 const w=await fixture(),points=[]
 for(const multiplier of[1,2,3]){const r=await addRun(w,{multiplier}),d=(await addEvidence(w,r,r.soluteId,r.components[0].moleculeId))[2];const p=pointFromDataset(d,w.runs,w.datasets,w.scientific);w.scientific.ssmPoints.push(p);points.push(p)}
 assert.deepEqual(validateSsmPoints([{...points[0],effectiveLengthNm:points[0].effectiveLengthNm+Number.EPSILON*8},...points.slice(1)],w.runs,w.datasets,w.scientific),[])
 assert.ok(validateSsmPoints([{...points[0],effectiveLengthNm:points[0].effectiveLengthNm+.001},...points.slice(1)],w.runs,w.datasets,w.scientific).length)
 for(const patch of [{speciesA:'other'},{replica:99},{temperatureK:999},{accepted:false},{scientificState:{...points[0].scientificState,pressureBar:4}}])assert.ok(validateSsmPoints([{...points[0],...patch},...points.slice(1)],w.runs,w.datasets,w.scientific).length)
 const f=fitValidatedSsm(points,'g-vs-inverse-l',3,w.runs,w.datasets,w.scientific);f.accepted=true;f.decision=acceptance(w,f.familyId,f.pointIds);w.scientific.ssmFits.push(f)
 assert.equal(currentSsmFit(f,w.scientific,w.runs,w.datasets),true)
 assert.equal(currentSsmFit({...f,decision:{...f.decision,sourceIds:[]}},w.scientific,w.runs,w.datasets),false)
})
