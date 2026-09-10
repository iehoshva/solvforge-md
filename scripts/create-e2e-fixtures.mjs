// Developer-only synthetic fixture creation; never imported into the application.
import{mkdir,writeFile}from'node:fs/promises'
import{resolve}from'node:path'
import{fixture,addRun,addEvidence}from'../tests/scientific-fixture.mjs'
import{completeArchive}from'../lib/workbench/packages.ts'
import{provenanceGraph}from'../lib/workbench/provenance.ts'
import{advancedFixture}from'../tests/acceptance-fixture.mjs'
import{createThesisProject}from'../lib/workbench/preset.ts'
const out=resolve(process.argv[2]??'test-results/fixtures');await mkdir(out,{recursive:true})
const w=await fixture(),r=await addRun(w),sp=[r.soluteId,...r.components.map(c=>c.moleculeId)]
for(const[i,j]of[[0,0],[0,1],[0,2],[1,1],[1,2],[2,2]])await addEvidence(w,r,sp[i],sp[j])
w.provenance=provenanceGraph(w)
await writeFile(resolve(out,'scientific-e2e-fixture.zip'),new Uint8Array(await(await completeArchive(w)).arrayBuffer()))
await writeFile(resolve(out,'design-only-e2e.json'),JSON.stringify({...w.project,projectName:'DESIGN-ONLY IMPORT SOFTWARE TEST'}))
const advanced=await advancedFixture();await writeFile(resolve(out,'advanced-e2e.zip'),new Uint8Array(await(await completeArchive(advanced)).arrayBuffer()))
const cp=createThesisProject();cp.projectName='SYNTHETIC PROTOCOL CONTROL TEST';cp.protocol.npt.compressibilityBarInverse=.0001;cp.desSystems.forEach(d=>{d.compositionSettings.mode='manual';d.boxCounts=[10,2]});await writeFile(resolve(out,'controls-e2e.json'),JSON.stringify(cp))
await writeFile(resolve(out,'cosmo-e2e.csv'),'des,solute,ratio,temperature,pressure,composition,gamma,gamma_infinity\nSYNTHETIC,Solute,1:1,323.15,1,'+advanced.scientific.activityResults[0].points[0].x+',2,2\n')
console.log('Synthetic browser fixtures saved to '+out)
