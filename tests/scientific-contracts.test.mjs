import test from "node:test"
import assert from "node:assert/strict"
import { fixture,addRun,addEvidence } from "./scientific-fixture.mjs"
import { createRun } from "../lib/workbench/runs.ts"
import { replicaGroups,blockGroup,decidePlateau,runMatchesDataset,analysisInputSignature } from "../lib/workbench/evidence.ts"
import { designFiniteSizeRuns,pointFromDataset,fitValidatedSsm,currentSsmFit } from "../lib/workbench/finite-size.ts"
import { calculateThermodynamics,currentThermodynamic,calculateActivity,currentActivity,pairId } from "../lib/workbench/thermodynamics.ts"
import { matchCompatibility } from "../lib/workbench/cosmo.ts"
import { completeArchive,importArchive,reconcileRun } from "../lib/workbench/packages.ts"
import { provenanceGraph,analysisReport } from "../lib/workbench/provenance.ts"
import { stateId,canonical } from "../lib/workbench/identity.ts"
import { runValidationSuite,ternaryThermodynamicFactor,integrateActivity,polynomialRegression } from "../lib/workbench/scientific.ts"
import { generateItp,parseTopologySections } from "../lib/workbench/orca-gromacs.ts"
test("canonical identity is valid normalized JSON and missing physical metadata never matches",async()=>{
 const w=await fixture(),r=await addRun(w);assert.deepEqual(JSON.parse(canonical({b:1,a:2})),{a:2,b:1})
 assert.equal(stateId({...r.scientificState,temperatureK:undefined}),null)
 assert.equal(stateId(r.scientificState),stateId({...r.scientificState,desComponents:r.scientificState.desComponents.map(c=>({...c,ratio:c.ratio*2}))}))
})
test("replicas are unique trajectories of one observable; blocks/pairs/duplicate seeds cannot add replicas",async()=>{
 const w=await fixture(),r=await addRun(w),s=r.scientificState.composition.map(c=>c.moleculeId)
 const ds=await addEvidence(w,r,s[0],s[1]);await addEvidence(w,r,s[0],s[2])
 assert.deepEqual(replicaGroups(w.datasets,w.scientific).map(g=>g.n),[1,1])
 assert.ok(replicaGroups(w.datasets,w.scientific).every(g=>g.se===null))
 const r2=await addRun(w,{replica:2});await addEvidence(w,r2,s[0],s[1])
 assert.equal(replicaGroups(w.datasets,w.scientific).find(g=>g.sourceDatasetIds.includes(ds[2].id)).n,2)
 const copy={...ds[2],id:"duplicate",scientificState:{...ds[2].scientificState,replica:3}}
 // A modified state first invalidates the analysis; it cannot add a replica.
 assert.equal(replicaGroups([...w.datasets,copy]).find(g=>g.sourceDatasetIds.includes(ds[2].id)).n,2)
 // Even after explicit reanalysis, identical source and seed cannot be independent.
 copy.analysis={...copy.analysis,inputSignature:analysisInputSignature(copy)}
 assert.ok(replicaGroups([...w.datasets,copy]).some(g=>g.issues.length&&g.n===0))
})
test("block convergence cannot mix states, observables, temperatures or replica trajectories",async()=>{
 const w=await fixture(),r=await addRun(w),s=r.scientificState.composition.map(c=>c.moleculeId),ds=await addEvidence(w,r,s[0],s[1])
 const hot=await addRun(w,{T:333.15});await addEvidence(w,hot,s[0],s[1])
 assert.deepEqual(blockGroup(ds[2],w.datasets).points.map(d=>d.id),ds.map(d=>d.id))
 w.datasets=w.datasets.map(d=>d.id===ds[0].id?decidePlateau(d,"rejected","Test rejection"):d)
 assert.ok(blockGroup(ds[2],w.datasets).issues.length)
 assert.equal(replicaGroups(w.datasets,w.scientific).filter(g=>g.sourceDatasetIds.includes(ds[2].id)).length,0)
})
test("SSM accepts only independently generated distinct physical systems, current exact evidence and one pair",async()=>{
 const w=await fixture(),base=await addRun(w),s=base.scientificState.composition.map(c=>c.moleculeId)
 assert.equal(designFiniteSizeRuns(w.project,base,[1,2,3]).length,3)
 const points=[]
 for(const m of [1,2,3]){const r=m===1?base:await addRun(w,{multiplier:m});const ds=await addEvidence(w,r,s[0],s[1]);const p=pointFromDataset(ds[2],w.runs,w.datasets,w.scientific);w.scientific.ssmPoints.push(p);points.push(p)}
 assert.throws(()=>fitValidatedSsm([points[0]],"g-vs-inverse-l",3,w.runs,w.datasets,w.scientific),/Insufficient/)
 assert.throws(()=>fitValidatedSsm([points[0],{...points[0],id:"fake",effectiveLengthNm:8},points[2]],"g-vs-inverse-l",3,w.runs,w.datasets,w.scientific),/source|independently|differs/)
 const fit=fitValidatedSsm(points,"g-vs-inverse-l",3,w.runs,w.datasets,w.scientific);assert.ok(Math.abs(fit.gInfinityNm3)<1e-12)
 assert.equal(currentSsmFit(fit,w.scientific,w.runs,w.datasets),false)
})
test("complete KB → Gamma → activity chain rejects missing pairs and invalidates when any parent is rejected",async()=>{
 const w=await fixture(),allResults=[]
 for(const count of [2,4]){
  const r=await addRun(w,{count}),sp=[r.soluteId,...r.components.map(c=>c.moleculeId)],selection={}
  assert.throws(()=>calculateThermodynamics(w.project,r,{},"missing",w.scientific,w.runs,w.datasets),/Density|missing/)
  for(const [i,j]of [[0,0],[0,1],[0,2],[1,1],[1,2],[2,2]])await addEvidence(w,r,sp[i],sp[j])
  for(const g of replicaGroups(w.datasets,w.scientific).filter(g=>g.scientificState.composition.find(c=>c.moleculeId===r.soluteId).count===count))selection[pairId(g.observable.speciesA,g.observable.speciesB)]=g.id
  const density=w.datasets.find(d=>d.metadata.runId===r.runId&&d.replicaRepresentative).id
  assert.throws(()=>calculateThermodynamics(w.project,r,selection,density,w.scientific,w.runs,w.datasets),/Finite-size/)
  const result=calculateThermodynamics(w.project,r,selection,density,w.scientific,w.runs,w.datasets,"Synthetic fixture explicitly tests the finite-size override.")
  assert.ok(Math.abs(result.fixedDesRatioSoluteGamma-1)<1e-12);assert.ok(result.override);assert.equal(result.uncertainty,undefined)
  w.scientific.thermodynamicResults.push(result);allResults.push(result)
 }
 const a=calculateActivity(allResults,"linear",{type:"composition",x:allResults[0].moleFractions[0],gamma:2},"Synthetic reference gamma=2; testing only.",w.scientific,w.runs,w.datasets)
 assert.ok(a.points.every(p=>Math.abs(p.gammaAbsolute-2)<1e-10));w.scientific.activityResults.push(a)
 assert.equal(currentActivity(a,w.scientific,w.runs,w.datasets,false),true)
 const parent=w.datasets.find(d=>d.id===allResults[0].sourceDatasetIds[0]);w.datasets=w.datasets.map(d=>d.id===parent.id?decidePlateau(d,"rejected","Counterexample test"):d)
 assert.equal(currentThermodynamic(allResults[0],w.scientific,w.runs,w.datasets),false);assert.equal(currentActivity(a,w.scientific,w.runs,w.datasets,false),false)
})
test("COSMO matching rejects a ratio, unknown temperature, unknown pressure, composition or quantity mismatch",()=>{
 const components=[{moleculeId:"a",ratio:5},{moleculeId:"b",ratio:1}],a={projectId:"p",soluteId:"s",temperatureK:323.15,seriesIdentity:{desComponents:components,pressureBar:1},anchor:{type:"composition"},points:[{x:.01,gammaAbsolute:2}]},c={projectId:"p",mapping:{desComponents:components,soluteId:"s"},sourceHash:"hash",sourceText:"raw",temperatureK:323.15,pressureBar:1,composition:.01,gamma:2,gammaInfinity:null,compatibilityReview:{standardStateCompatible:true,independentAnchor:true,rationale:"Fixture"}}
 assert.equal(matchCompatibility(c,a,"same-composition").length,0)
 assert.ok(matchCompatibility({...c,mapping:{...c.mapping,desComponents:[{moleculeId:"a",ratio:1},{moleculeId:"b",ratio:1}]}},a,"same-composition").length)
 for(const patch of [{temperatureK:null},{pressureBar:null},{composition:null}])assert.ok(matchCompatibility({...c,...patch},a,"same-composition").length)
 assert.ok(matchCompatibility(c,a,"infinite-dilution").length)
})
test("archive roundtrip restores raw files, frozen inputs, decisions, scientific sources and checksums",async()=>{
 const w=await fixture(),r=await addRun(w),s=r.scientificState.composition.map(c=>c.moleculeId);await addEvidence(w,r,s[0],s[1]);w.provenance=provenanceGraph(w)
 const blob=await completeArchive(w),restored=await importArchive(new Uint8Array(await blob.arrayBuffer()))
 for(const key of ["datasets","runs","scientific","orcaGromacs","provenance","decisions"])assert.deepEqual(restored[key],JSON.parse(JSON.stringify(w[key])))
 assert.ok(runMatchesDataset(restored.datasets[0],restored.runs[0]))
 assert.deepEqual(reconcileRun(w.project,r,w.orcaGromacs),[])
 w.project.protocol.production.solute.initialNs=33
 const report=analysisReport(w),node=report.provenance.find(n=>n.id===r.resolvedProtocol.id);assert.equal(node.payload.production.initialNs,100)
 const corrupt=new Uint8Array(await blob.arrayBuffer());corrupt[200]^=1;await assert.rejects(importArchive(corrupt))
})
test("ITP preserves repeated interaction sections and charges; refuses unparsed edits and no invented nrexcl",async()=>{
 const w=await fixture(),p=Object.values(w.orcaGromacs.molecules)[0],edited={...p,topologyText:p.topologyText+"[ dihedrals ]\n; proper reviewed empty fixture\n[ dihedrals ]\n; improper reviewed empty fixture\n"}
 edited.topologySections=parseTopologySections(edited.topologyText)
 assert.equal((generateItp(edited).match(/\[ dihedrals \]/g)??[]).length,2)
 assert.match(generateItp({...edited,topologyText:edited.topologyText+"[ bonds ]\n1 9 1\n"}),/INCOMPLETE/)
})
test("ideal multicomponent projection and low-x polynomial conditioning are numerically consistent",()=>{
 assert.ok(runValidationSuite().every(r=>r.passed))
 const r=ternaryThermodynamicFactor([[0,0,0],[0,0,0],[0,0,0]],[.01,2,1]);assert.ok(Math.abs(r.fixedDesRatioSoluteGamma-1)<1e-12)
 const x=[1e-6,2e-6,3e-6,4e-6];const fit=polynomialRegression(x,x.map(v=>2+3*v+5*v*v),2);assert.ok(Math.abs(fit.coefficients[0]-2)<1e-9)
 assert.throws(()=>integrateActivity([{x:.01,thermodynamicFactor:1},{x:.02,thermodynamicFactor:1}],"linear",{type:"composition",x:NaN,gamma:1}))
})
