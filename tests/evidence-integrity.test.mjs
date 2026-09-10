import test from 'node:test'
import assert from 'node:assert/strict'
import {fixture,addRun,addEvidence} from './scientific-fixture.mjs'
import {scopeRecords,emptyWorkspace,duplicateWorkspace,importWorkspace} from '../lib/workbench/workspace.ts'
import {plateauIssues,replicaGroups,acceptedConvergence} from '../lib/workbench/evidence.ts'
import {validateSourceIntegrity} from '../lib/workbench/packages.ts'
import {generateRdfCommands,generateBlockRdfCommands,runSpecies} from '../lib/workbench/orca-gromacs.ts'
import {recordContinuation} from '../lib/workbench/continuation.ts'
test('UI persistence preserves scientific inputs and current accepted decisions exactly',async()=>{
 const w=await fixture(),r=await addRun(w),s=r.scientificState.composition.map(c=>c.moleculeId);await addEvidence(w,r,s[0],s[1])
 const saved=scopeRecords(w,w.projectId);assert.deepEqual(saved,w);assert.deepEqual(plateauIssues(saved.datasets[2]),[])
 assert.equal(replicaGroups(saved.datasets,saved.scientific).length,1);assert.ok(acceptedConvergence(saved.datasets[2],saved.datasets,saved.scientific))
 const foreign=structuredClone(w);foreign.datasets[0].projectId='foreign';assert.throws(()=>scopeRecords(foreign,w.projectId),/Cross-project/)
})
test('stored numbers and time decisions must reproduce raw data; copied signatures cannot bless a modified result',async()=>{
 const w=await fixture(),r=await addRun(w),s=r.scientificState.composition.map(c=>c.moleculeId);await addEvidence(w,r,s[0],s[1])
 const bad=structuredClone(w.datasets[0]);bad.analysis.estimateNm3=123;assert.ok(plateauIssues(bad).some(e=>e.includes('recalculation')))
 w.scientific.convergenceDecisions[0].diagnostics.slopeNm3PerNs=999;assert.equal(acceptedConvergence(w.datasets[2],w.datasets,w.scientific),undefined)
 const raw=structuredClone(w);raw.datasets[0].g[3]=17;await assert.rejects(validateSourceIntegrity(raw),/numerical arrays/)
 const artifact=structuredClone(w);artifact.runs[0].inputSnapshots[0].files[0].content+='changed';await assert.rejects(validateSourceIntegrity(artifact),/checksum/)
})
test('RDF controls change actual quoted commands and invalid selections/windows block generation',async()=>{
 const w=await fixture(),r=await addRun(w),p=w.orcaGromacs.molecules,settings=w.orcaGromacs.rdf
 const initial=generateRdfCommands(r,p,settings);assert.match(initial,/gmx rdf/)
 for(const [key,value,pattern]of[['beginNs',10,/-b 10000/],['endNs',80,/-e 80000/],['binWidthNm',.03,/-bin 0.03/],['rmaxNm',1.7,/-rmax 1.7/]])assert.match(generateRdfCommands(r,p,{...settings,[key]:value}),pattern)
 assert.match(generateRdfCommands(r,p,{...settings,endNs:-1}),/ERROR/)
 assert.match(generateRdfCommands(r,p,{...settings,mode:'custom',customSelections:{}}),/ERROR/)
 const customSelections=Object.fromEntries(runSpecies(r).map(s=>[p[s.moleculeId].residueName,'res_com of resname '+p[s.moleculeId].residueName]));assert.match(generateRdfCommands(r,p,{...settings,mode:'custom',customSelections}),/res_com of resname/)
 assert.match(generateBlockRdfCommands(r,p,{...settings,blocks:'0-20, invalid'}),/ERROR/)
 assert.match(generateBlockRdfCommands(r,p,{...settings,blocks:'0-120'}),/ERROR/)
})
test('manual continuation requires an actual frozen run and explicitly reported checkpoint evidence',async()=>{
 const w=await fixture(),r=await addRun(w),input={runId:r.runId,completedNs:100,action:'continue',checkpointSha256:'a'.repeat(64),executionEvidence:'SYNTHETIC log 100 ns',rationale:'Software fixture'}
 assert.equal(recordContinuation(w,input).stop,true)
 assert.throws(()=>recordContinuation(w,{...input,checkpointSha256:''}),/SHA-256/)
 assert.throws(()=>recordContinuation(emptyWorkspace(w.project),input),/frozen/)
 const p=r.resolvedProtocol;p.production={...p.production,mode:'convergence-controlled',maximumNs:200,extensionNs:30}
 const next=recordContinuation(w,input);assert.equal(next.nextEndNs,130);assert.match(next.commands,/-until 130000/);assert.equal(next.status,'RESEARCHER_REPORTED')
 assert.equal(recordContinuation(w,{...input,action:'stop'}).stop,true)
})
test('complete ownership, project-only imports and deliberate duplication do not inherit accepted evidence',async()=>{
 const w=await fixture(),r=await addRun(w),s=r.scientificState.composition.map(c=>c.moleculeId);await addEvidence(w,r,s[0],s[1]);
 const design=importWorkspace(w.project);assert.equal(design.datasets.length,0);assert.deepEqual(design.orcaGromacs.molecules,{})
 const copy=duplicateWorkspace(w,true);assert.notEqual(copy.projectId,w.projectId);assert.equal(copy.datasets.length,3);assert.equal(replicaGroups(copy.datasets,copy.scientific).length,0)
 const malformed=structuredClone(w);delete malformed.scientific.projectId;assert.throws(()=>importWorkspace(malformed),/ownership/)
})

test('Pareto objectives are explicit, ties remain on the front and missing evidence is never imputed',async()=>{
 const {paretoFront}=await import('../lib/workbench/pareto.ts')
 const rows=[{id:'a',values:[1,3],sourceIds:['ka']},{id:'b',values:[2,2],sourceIds:['kb']},{id:'c',values:[1,3],sourceIds:['kc']},{id:'unknown',values:[null,5],sourceIds:[]}]
 const r=paretoFront(rows,['minimize','maximize']);assert.equal(r[0].status,'PARETO FRONT');assert.equal(r[2].status,'PARETO FRONT');assert.deepEqual(r[1].dominatedBy,['a','c']);assert.equal(r[3].status,'INSUFFICIENT EVIDENCE')
 assert.equal(paretoFront(rows,['maximize','minimize'])[1].status,'PARETO FRONT')
})
