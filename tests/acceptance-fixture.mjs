// Explicit synthetic inputs for UI acceptance testing. Never application data.
import {fixture,addRun,addEvidence} from './scientific-fixture.mjs'
import {replicaGroups} from '../lib/workbench/evidence.ts'
import {stateId} from '../lib/workbench/identity.ts'
import {calculateThermodynamics,calculateActivity,fitInfiniteDilution,pairId} from '../lib/workbench/thermodynamics.ts'
import {pointFromDataset} from '../lib/workbench/finite-size.ts'
import {provenanceGraph} from '../lib/workbench/provenance.ts'
import {SOFTWARE_VERSION} from '../lib/workbench/version.ts'
export const acceptance=(w,state,sources)=>({id:crypto.randomUUID(),projectId:w.projectId,stateId:state,sourceIds:sources,classification:'accepted',rationale:'SYNTHETIC SOFTWARE TEST ONLY',actor:'researcher',timestamp:new Date().toISOString(),softwareVersion:SOFTWARE_VERSION})
export async function thermodynamicFixture(){
 const w=await fixture();w.project.projectName='SYNTHETIC ADVANCED ACCEPTANCE — NOT RESEARCH DATA'
 for(const count of [2,4,6]){
  const r=await addRun(w,{count}),sp=[r.soluteId,...r.components.map(c=>c.moleculeId)]
  for(const[i,j]of[[0,0],[0,1],[0,2],[1,1],[1,2],[2,2]])await addEvidence(w,r,sp[i],sp[j])
  const groups=replicaGroups(w.datasets,w.scientific).filter(g=>stateId(g.scientificState)===stateId(w.datasets.find(d=>d.metadata.runId===r.runId).scientificState))
  const selection=Object.fromEntries(groups.map(g=>[pairId(g.observable.speciesA,g.observable.speciesB),g.id]))
  const density=w.datasets.find(d=>d.metadata.runId===r.runId&&d.replicaRepresentative).id
  w.scientific.thermodynamicResults.push(calculateThermodynamics(w.project,r,selection,density,w.scientific,w.runs,w.datasets,'SYNTHETIC finite-size override to test software only.'))
 }
 return w
}
export async function advancedFixture(){
 const w=await thermodynamicFixture(),rs=w.scientific.thermodynamicResults
 const a=calculateActivity(rs,'linear',{type:'composition',x:rs[0].moleFractions[0],gamma:2},'SYNTHETIC independent anchor; mathematical fixture, not research evidence.',w.scientific,w.runs,w.datasets)
 a.accepted=true;a.decision=acceptance(w,a.stateId,a.sourceThermodynamicIds);w.scientific.activityResults.push(a)
 a.infiniteDilution=fitInfiniteDilution(a,'linear',a.points.at(-1).x,w.scientific,w.runs,w.datasets);a.infiniteDilution.decision=acceptance(w,a.stateId,[a.id])
 const base=w.runs[0],pair=[base.soluteId,base.components[0].moleculeId]
 const source=w.datasets.find(d=>d.metadata.runId===base.runId&&d.replicaRepresentative&&d.observable.speciesA===pair[0]&&d.observable.speciesB===pair[1]);w.scientific.ssmPoints.push(pointFromDataset(source,w.runs,w.datasets,w.scientific))
 for(const m of[2,3]){const r=await addRun(w,{multiplier:m});const ds=await addEvidence(w,r,...pair);w.scientific.ssmPoints.push(pointFromDataset(ds[2],w.runs,w.datasets,w.scientific))}
 const different=await addRun(w,{T:333.15});await addEvidence(w,different,...pair)
 w.provenance=provenanceGraph(w);return w
}
