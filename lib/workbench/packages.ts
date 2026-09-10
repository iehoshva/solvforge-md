import { uuid } from "./crypto.ts"
import type { Workspace } from "./workspace"
import type { ProjectState,RunRecord } from "./types"
import { importWorkspace, assertProjectOwnership } from "./workspace.ts"
import { canonical,sha256,stateErrors } from "./identity.ts"
import { makeZip,readZip } from "./zip.ts"
import { commands,firstContinuation } from "./runs.ts"
import { parseDirectives } from "./protocol.ts"
import { generateItp,generatePdb,generateGro,generatePackmolInput,generateTopolTop,generatePackedGro,generateIndexNdx,generateRdfCommands,generateBlockRdfCommands,topologyDiagnostics,systemTopologyDiagnostics,validatePackedSystem,runSpecies,generateAtomMappingCsv,generateChargesCsv,type OrcaGromacsState } from "./orca-gromacs.ts"
import { FORCE_FIELD,CHARGE_SOURCE,FORCE_FIELD_INCLUDE,SOFTWARE_VERSION } from "./version.ts"
import { parseXvg,parseCsv } from "./kbi.ts"
import { compositionPreparationNotes } from "./export.ts"
export type PackageFile={path:string;content:string}
const slug=(s:string)=>s.toLowerCase().replace(/[^a-z0-9]+/g,"_").replace(/^_+|_+$/g,"")
export function reconcileRun(project:ProjectState,r:RunRecord,state?:OrcaGromacsState){
  const errors:string[]=[]
  if(r.projectId!==project.projectId)errors.push("Run belongs to a different project.")
  if(!r.resolvedProtocol)errors.push("Historical run has no resolved protocol; regenerate.")
  else {
    const p=r.resolvedProtocol
    errors.push(...p.diagnostics.filter(d=>d.severity==="ERROR").map(d=>d.message))
    if(project.protocol.forceField!==p.forceField||project.protocol.chargeScheme!==p.chargeSource||p.forceField!==FORCE_FIELD||p.chargeSource!==CHARGE_SOURCE||p.topologyInclude!==FORCE_FIELD_INCLUDE||r.forceField!==p.forceField||r.chargeScheme!==p.chargeSource)errors.push("Force-field / charge metadata and generated artifact pipeline are inconsistent.")
    if(r.temperatureK!==p.temperatureK||r.pressureBar!==p.pressureBar||r.randomSeed!==p.randomSeed||r.productionNs!==p.production.initialNs)errors.push("Run metadata disagree with the resolved simulation protocol.")
    for(const [stage,v] of Object.entries(p.stages))if(canonical(parseDirectives(v.mdp).directives)!==canonical(v.directives))errors.push(stage+": resolved directives disagree with stored MDP.")
  }
  errors.push(...stateErrors(r.scientificState),...r.compositionDiagnostics.filter(d=>d.severity==="ERROR").map(d=>d.message))
  if(state){
    errors.push(...systemTopologyDiagnostics(r,state.molecules).filter(d=>d.severity==="ERROR").map(d=>d.message))
    for(const species of runSpecies(r)){
      const prep=state.molecules[species.moleculeId],m=r.molecularSnapshot?.find(m=>m.id===species.moleculeId)
      if(!prep){errors.push(species.name+": molecular preparation missing.");continue}
      errors.push(...topologyDiagnostics(prep).filter(d=>d.severity==="ERROR").map(d=>species.name+": "+d.message))
      if(prep.expectedFormalCharge!==m?.charge||prep.residueName!==m?.residueName)errors.push(species.name+": prepared formal charge/residue differs from run molecular snapshot; synchronize design and regenerate.")
    }
    errors.push(...validatePackedSystem(r,state.packedSystems[r.runId]??null,state.molecules).filter(d=>d.severity==="ERROR").map(d=>d.message))
  }
  return [...new Set(errors)]
}
export async function runInputSnapshot(project:ProjectState,run:RunRecord,state:OrcaGromacsState){
  const errors=reconcileRun(project,run,state)
  if(errors.length)throw new Error("Run Input Package unavailable:\n"+errors.join("\n"))
  const files:PackageFile[]=[],add=(path:string,content:string)=>files.push({path,content})
  add("resolved_protocol.json",JSON.stringify(run.resolvedProtocol,null,2))
  add("molecule_manifest.json",JSON.stringify(run.molecularSnapshot,null,2))
  add("composition.json",JSON.stringify(run.compositionCalculation,null,2))
  add("packing/system/composition-notes.txt",compositionPreparationNotes(run))
  add("analysis/rdf/settings.json",JSON.stringify(state.rdf,null,2))
  for(const [stage,dir] of [["em","01_em"],["nvt","02_nvt"],["npt","03_npt"],["prod","04_prod"]] as const)add(dir+"/"+stage+".mdp",run.resolvedProtocol!.stages[stage].mdp)
  add("commands.sh",commands(run));add("04_prod/continuation.sh",firstContinuation(run))
  add("00_input/topol.top",generateTopolTop(run,state.molecules))
  add("00_input/packed.gro",generatePackedGro(run,state.packedSystems[run.runId]))
  add("00_input/packed.pdb",state.packedSystems[run.runId].sourceFile.text)
  add("00_input/index.ndx",generateIndexNdx(state.packedSystems[run.runId],run,state.molecules))
  for(const species of runSpecies(run)){
    const p=state.molecules[species.moleculeId],base=slug(species.moleculeId)
    add("00_input/"+base+".itp",generateItp(p));add("molecules/"+base+"/coordinates/"+base+".pdb",generatePdb(p));add("molecules/"+base+"/coordinates/"+base+".gro",generateGro(p))
    add("molecules/"+base+"/mapping/atom_mapping.csv",generateAtomMappingCsv(p));add("molecules/"+base+"/mapping/charges.csv",generateChargesCsv(p))
    if(p.xyzFile)add("molecules/"+base+"/source/original.xyz",p.xyzFile.text)
    if(p.outFile)add("molecules/"+base+"/source/original.out",p.outFile.text)
    if(p.originalTopologyFile)add("molecules/"+base+"/source/original.top",p.originalTopologyFile.text)
    add("molecules/"+base+"/source/reviewed.top",p.topologyText)
  }
  add("packing/system/packmol.inp",generatePackmolInput(run,state.molecules,state.packmol))
  add("packing/system/commands.sh","#!/usr/bin/env bash\nset -euo pipefail\npackmol < packmol.inp\n")
  add("analysis/rdf/commands.sh",generateRdfCommands(run,state.molecules,state.rdf))
  add("analysis/blocks/commands.sh",generateBlockRdfCommands(run,state.molecules,state.rdf))
  const invalidScripts=files.filter(f=>f.path.endsWith(".sh")||f.path.endsWith(".inp")).filter(f=>/^# ERROR:/m.test(f.content))
  if(invalidScripts.length)throw new Error("Invalid generated preparation/analysis controls: "+invalidScripts.map(f=>f.path+"\n"+f.content).join("\n"))
  for(const dir of ["rdf","blocks","kbi","ssm","kb_matrix","thermo","cosmo_validation"])add("analysis/"+dir+"/.keep","")
  add("README.txt","SolvForge MD "+SOFTWARE_VERSION+" — Run Input Package\nRun all GROMACS commands from this run directory. Install the matching GROMACS OPLS-AA force field (oplsaa.ff). This external force-field distribution is not bundled.\nOriginal geometry, charges, mapping and imported topology are under molecules/. Packing can be reproduced from packing/system/. packed.gro and topol.top are under 00_input/.\nRun bash commands.sh only after inspecting the MDPs and all external GROMACS diagnostics. Do not suppress grompp errors. Inspect EM, NVT, density/pressure NPT and production separately. Continuation is manual from the current checkpoint, bounded by resolved_protocol.json.\nExecute analysis scripts from this run directory. Record trajectory SHA-256 and equilibrated mean volume. Raw RDF files must be explicitly mapped in KBI Analyzer.\nResearcher review is not automatic GROMACS validation.\n")
  if(Object.entries(state.commandOverrides).some(([k,v])=>k.startsWith("run:"+run.runId+":")&&v.trim()))throw new Error("Edited command drafts exist. Reconcile or reset them before canonical Run Input Package export; unverified drafts are retained in the Complete Project Archive.")
  const checks=await Promise.all(files.map(async f=>({...f,sha256:await sha256(f.content)})))
  const prior=run.inputSnapshots?.[0]
  if(prior){if(canonical(prior.files)!==canonical(checks))throw new Error("Inputs for this run are already frozen. Keep the historical package and generate a new run revision (new seed or protocol settings) for changed inputs.");return prior}
  return {id:uuid(),generatedAt:new Date().toISOString(),softwareVersion:SOFTWARE_VERSION,files:checks,molecularSources:structuredClone(Object.fromEntries(runSpecies(run).map(s=>[s.moleculeId,state.molecules[s.moleculeId]]))),researcherReviewed:true}
}
/** Verify frozen input and raw numerical bytes at the import/export boundary. */
export async function validateSourceIntegrity(w:Workspace) {
  for(const r of w.runs)for(const snapshot of r.inputSnapshots??[]){
    if(new Set(snapshot.files.map(f=>f.path)).size!==snapshot.files.length)throw new Error("Duplicate frozen input paths: "+r.runId)
    for(const f of snapshot.files)if(await sha256(f.content)!==f.sha256)throw new Error("Frozen input checksum mismatch: "+r.runId+"/"+f.path)
    for(const [stage,dir]of [["em","01_em"],["nvt","02_nvt"],["npt","03_npt"],["prod","04_prod"]] as const){const f=snapshot.files.find(f=>f.path===dir+"/"+stage+".mdp");if(!f||f.content!==r.resolvedProtocol?.stages[stage].mdp)throw new Error("Frozen MDP disagrees with resolved protocol: "+r.runId+"/"+stage)}
  }
  for(const d of w.datasets)if(d.sourceText!==undefined&&d.sourceHash){
    if(await sha256(d.sourceText)!==d.sourceHash)throw new Error("RDF source checksum mismatch: "+d.sourceFilename)
    const parsed=(d.sourceFormat==="xvg"?parseXvg:parseCsv)(d.sourceText,d.sourceFilename)[d.seriesIndex??0]
    if(!parsed||canonical(parsed.radiusRaw)!==canonical(d.radiusRaw)||canonical(parsed.g)!==canonical(d.g))throw new Error("Raw RDF numerical arrays differ from the original file: "+d.sourceFilename)
  }
  for(const r of [...w.scientific.cosmoRecords,...w.scientific.observables])if(r.sourceText!==undefined&&r.sourceHash&&await sha256(r.sourceText)!==r.sourceHash)throw new Error("Imported observable/COSMO source checksum mismatch: "+r.sourceFilename)
  for(const p of Object.values(w.orcaGromacs.molecules))for(const f of [p.xyzFile,p.outFile,p.originalTopologyFile])if(f&&await sha256(f.text)!==f.sha256)throw new Error("Molecular source checksum mismatch: "+f.name)
}
export async function archiveFiles(w:Workspace):Promise<PackageFile[]>{
  assertProjectOwnership(w,w.projectId)
  await validateSourceIntegrity(w)
  const files:PackageFile[]=[{path:"workspace.json",content:JSON.stringify(w)},{path:"project_manifest.json",content:JSON.stringify(w.project,null,2)}]
  for(const r of w.runs){
    files.push({path:"runs/"+r.runId+"/metadata.json",content:JSON.stringify(r,null,2)})
    if(r.resolvedProtocol)files.push({path:"runs/"+r.runId+"/resolved_protocol.json",content:JSON.stringify(r.resolvedProtocol,null,2)})
    for(const snapshot of r.inputSnapshots??[])for(const f of snapshot.files)files.push({path:"runs/"+r.runId+"/inputs/"+snapshot.id+"/"+f.path,content:f.content})
  }
  for(const [id,p]of Object.entries(w.orcaGromacs.molecules)){
    if(p.xyzFile)files.push({path:"orca/"+slug(id)+"/original.xyz",content:p.xyzFile.text})
    if(p.outFile)files.push({path:"orca/"+slug(id)+"/original.out",content:p.outFile.text})
    if(p.originalTopologyFile)files.push({path:"orca/"+slug(id)+"/original.top",content:p.originalTopologyFile.text})
  }
  for(const d of w.datasets){
    if(d.sourceText!==undefined)files.push({path:"analysis/rdf/"+d.id+"/original.txt",content:d.sourceText})
    files.push({path:"analysis/rdf/"+d.id+"/dataset.json",content:JSON.stringify(d)})
  }
  for(const [key,value]of Object.entries(w.scientific))files.push({path:"analysis/"+key+".json",content:JSON.stringify(value)})
  files.push({path:"provenance.json",content:JSON.stringify(w.provenance,null,2)})
  files.push({path:"README.txt",content:"SolvForge MD Complete Project Archive\nImport workspace.json or this ZIP to restore the full project atomically. Original source text, unresolved legacy records, historical analyses/decisions and frozen generated input packages are retained. Archived presence is not scientific acceptance.\nFull trajectories and external GROMACS force-field installations are references only: they must be retained separately with their recorded SHA-256 checksums. Browser storage is not an archival guarantee.\n"})
  const checksums=await Promise.all(files.map(async f=>({path:f.path,size:new TextEncoder().encode(f.content).byteLength,sha256:await sha256(f.content)})))
  files.push({path:"checksums.json",content:JSON.stringify(checksums,null,2)})
  return files
}
export async function completeArchive(w:Workspace){return makeZip(await archiveFiles(w))}
/** The JSON and ZIP paths apply the same source-integrity gate. */
export async function completeProjectJson(w:Workspace){
  assertProjectOwnership(w,w.projectId)
  await validateSourceIntegrity(w)
  return JSON.stringify(w,null,2)
}
export async function importProjectJson(text:string){
  const workspace=importWorkspace(JSON.parse(text))
  await validateSourceIntegrity(workspace)
  return workspace
}
export async function importArchive(bytes:Uint8Array){
  const files=await readZip(new Blob([new Uint8Array(bytes)])),decode=new TextDecoder("utf-8",{fatal:true})
  const get=(path:string)=>{const f=files.find(f=>f.path===path);if(!f)throw new Error("Archive is missing "+path);return f.bytes}
  const checks: Array<{path:string;size:number;sha256:string}>=JSON.parse(decode.decode(get("checksums.json")))
  if(checks.length!==files.length-1||new Set(checks.map(c=>c.path)).size!==checks.length)throw new Error("Archive file inventory differs from checksums.")
  for(const c of checks){const bytes=get(c.path);if(bytes.length!==c.size||await sha256(bytes)!==c.sha256)throw new Error("Archive checksum mismatch: "+c.path)}
  const workspace=importWorkspace(JSON.parse(decode.decode(get("workspace.json"))))
  await validateSourceIntegrity(workspace)
  return workspace
}
