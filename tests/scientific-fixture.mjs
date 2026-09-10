// Synthetic fixtures for software verification ONLY. Never imported by application modules.
import { createThesisProject } from "../lib/workbench/preset.ts"
import { createRun } from "../lib/workbench/runs.ts"
import { emptyWorkspace } from "../lib/workbench/workspace.ts"
import { emptyMoleculePreparation,attachXyz,attachOrcaOutput,importTopology,generatePdb,parsePackedPdb,runSpecies } from "../lib/workbench/orca-gromacs.ts"
import { sha256 } from "../lib/workbench/identity.ts"
import { runInputSnapshot } from "../lib/workbench/packages.ts"
import { parseXvg,analyzeDataset } from "../lib/workbench/kbi.ts"
import { emptyRdfMetadata,mapDatasetToRun,decidePlateau,convergenceDecision } from "../lib/workbench/evidence.ts"
export async function source(name,text){return {name,text,size:new TextEncoder().encode(text).length,lastModified:0,sha256:await sha256(text),importedAt:"2026-09-08T00:00:00Z"}}
export async function fixture(){
 const p=createThesisProject();p.projectName="SYNTHETIC SOFTWARE TEST — NOT RESEARCH DATA";p.protocol.npt.compressibilityBarInverse=.0001;p.protocol.production.solute={mode:"fixed",initialNs:100,maximumNs:100,extensionNs:20};p.analysisDefaults.bootstrapSamples=100
 p.desSystems=p.desSystems.slice(0,1);p.soluteIds=p.soluteIds.slice(0,1);p.desSystems[0].boxCounts=[10,2];p.desSystems[0].compositionSettings.mode="manual";p.stageASoluteCount=2
 const ids=[...p.desSystems[0].componentIds,...p.soluteIds]
 p.molecules=p.molecules.filter(m=>ids.includes(m.id)).map((m,i)=>({...m,residueName:["AAA","BBB","SOL"][i],formula:"OH",molecularWeight:17.007,charge:0,fullName:"Synthetic "+m.id}))
 const w=emptyWorkspace(p)
 for(const m of p.molecules){
  const xyz="2\nSYNTHETIC OH fixture\nO 0 0 0\nH 1 0 0\n"
  const out="! BP86 def2-TZVP\n* xyz 0 1\nCARTESIAN COORDINATES (ANGSTROEM)\n---\nO 0 0 0\nH 1 0 0\n\nMULLIKEN ATOMIC CHARGES\n---\n0 O : -0.4\n1 H : 0.4\nSum of atomic charges : 0\nORCA TERMINATED NORMALLY\n"
  let prep=attachOrcaOutput(attachXyz(emptyMoleculePreparation(m),await source(m.id+".xyz",xyz)),await source(m.id+".out",out))
  prep=importTopology(prep,await source(m.id+".top","[ moleculetype ]\n"+m.residueName+" 3\n[ atoms ]\n1 opls_154 1 "+m.residueName+" O1 1 -0.6 15.999\n2 opls_155 1 "+m.residueName+" H1 1 0.6 1.008\n[ bonds ]\n1 2 1\n"))
  prep={...prep,connectivityApproved:true,topologyReviewed:true,gromppValidated:false,atoms:prep.atoms.map(a=>({...a,mappingStatus:"USER-OVERRIDDEN",ljSource:"Synthetic test OPLS fixture; not a physical molecule"}))}
  w.orcaGromacs.molecules[m.id]=prep
 }
 return w
}
export async function addRun(w,{count=2,replica=1,multiplier=1,T=323.15}={}){
 const p=structuredClone(w.project);p.desSystems[0].boxCounts=[10*multiplier,2*multiplier];const l=5*Math.cbrt(multiplier);p.protocol.box={x:l,y:l,z:l,unit:"nm",geometry:"cubic"}
 const r=createRun(p,"A",p.desSystems[0].id,p.soluteIds[0],count*multiplier,"synthetic",T,replica)
 let text="",serial=1,resno=1
 for(const species of runSpecies(r)){const prep=w.orcaGromacs.molecules[species.moleculeId];const lines=generatePdb(prep).split("\n").filter(l=>l.startsWith("HETATM"));for(let n=0;n<species.count;n++){for(const line of lines)text+=line.slice(0,6)+String(serial++).padStart(5)+line.slice(11,22)+String(resno).padStart(4)+line.slice(26)+"\n";resno++}}
 text+="END\n"
 w.orcaGromacs.packedSystems[r.runId]={runId:r.runId,sourceFile:await source("packed.pdb",text),...parsePackedPdb(text),importedAt:new Date().toISOString()}
 const snapshot=await runInputSnapshot(w.project,r,w.orcaGromacs);r.inputSnapshots=[snapshot];w.runs.push(r);return r
}
export async function addEvidence(w,run,a,b){
 const data=[]
 for(let i=0;i<3;i++){
  const raw="# SYNTHETIC algorithm test "+run.runId+" pair="+a+"|"+b+" block="+i+"\n@ xaxis label \"r (nm)\"\n"+Array.from({length:251},(_,k)=>(k*.01).toFixed(2)+" 1").join("\n")+"\n"
  let d={...parseXvg(raw,"synthetic-"+i+".xvg")[0],id:crypto.randomUUID(),projectId:w.projectId,sourceText:raw,sourceHash:await sha256(raw),metadata:{...emptyRdfMetadata,distanceUnit:"nm",trajectoryStartNs:i*20,trajectoryEndNs:(i+1)*20,simulationDurationNs:100},windowKind:"block",replicaRepresentative:i===2}
  d=mapDatasetToRun(d,run,a,b,"molecular-com-rdf")
  d.trajectory={id:run.runId,runId:run.runId,filename:"SYNTHETIC.xtc",sha256:await sha256("SYNTHETIC TRAJECTORY "+run.runId),actualVolumeNm3:run.boxVolumeNm3,volumeSource:"Synthetic fixed-volume fixture",evidenceSource:"researcher-reported"}
  d.analysis=analyzeDataset(d,{manual:true,startNm:1.5,endNm:2,rebinFactor:1,smoothing:"none",smoothingWindow:1,minWidthNm:.3,maxAbsSlope:.1,maxVariance:.1,integrationMethod:"trapezoidal"})
  d=decidePlateau(d,"accepted","Synthetic software test, not physical validation.")
  w.datasets.push(d);data.push(d)
 }
 w.scientific.convergenceDecisions.push(convergenceDecision(data[2],w.datasets,"converged-accepted","Synthetic time-stability test.",.01,.1))
 return data
}
