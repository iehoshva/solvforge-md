import { withEvidenceEvaluation } from "./evaluation-scope.ts"
import type { Workspace,ProvenanceNode } from "./workspace"
import { canonical,fingerprint,stateId } from "./identity.ts"
import { plateauIssues,replicaGroups,acceptedConvergence } from "./evidence.ts"
import { currentSsmFit } from "./finite-size.ts"
import { currentThermodynamic,currentActivity,currentInfiniteDilution } from "./thermodynamics.ts"
import { currentComparison } from "./cosmo.ts"
import { reconcileRun } from "./packages.ts"
import { SOFTWARE_VERSION,SCHEMA_VERSION } from "./version.ts"

/** Reconcile explicit parent IDs. Missing ancestors remain missing; neither current forms
 * nor filenames are used to retroactively manufacture historical simulation provenance. */
export function provenanceGraph(w:Workspace): ProvenanceNode[]{
  return withEvidenceEvaluation(()=>computeProvenanceGraph(w))
}
function computeProvenanceGraph(w:Workspace){
  const nodes=new Map<string,ProvenanceNode>()
  const add=(id:string,type:string,parentIds:string[],payload:unknown,issues:string[]=[],actor:ProvenanceNode["actor"]="automatic",version=SOFTWARE_VERSION,timestamp=w.savedAt,status:ProvenanceNode["status"]="present")=>{
    nodes.set(id,{id,projectId:w.projectId,type,parentIds:[...new Set(parentIds.filter(Boolean))],payload,issues:[...issues],actor,softwareVersion:version,timestamp,status:issues.length?"incomplete":status})
  }
  add(w.projectId,"Project",[],w.project,[],"researcher",w.project.createdWithVersion??"UNKNOWN",w.project.createdAt)
  for(const run of w.runs){
    const p=run.resolvedProtocol
    if(p)add(p.id,"ResolvedProtocol",[w.projectId],p,[],"automatic",p.softwareVersion,run.generatedAt)
    const def="definition-"+run.runId;add(def,"MolecularSystem",[w.projectId],{molecules:run.molecularSnapshot,composition:run.compositionCalculation,state:run.scientificState},run.scientificState?[]:["Molecular state unresolved."])
    add(run.runId,"Run",[p?.id??"UNKNOWN-PROTOCOL-"+run.runId,def],{...run,inputSnapshots:undefined},reconcileRun(w.project,run), "automatic",run.createdWithVersion??"UNKNOWN",run.generatedAt)
    for(const snapshot of run.inputSnapshots??[]){
      const sourceIds:string[]=[]
      for(const [mol,raw]of Object.entries(snapshot.molecularSources as Record<string,Record<string,unknown>>)){
        const source=(label:string,file:unknown)=>{const f=file as {sha256?:string;text?:string;importedAt?:string};if(!f?.sha256)return "UNKNOWN-"+snapshot.id+"-"+mol+"-"+label;const id="source-"+f.sha256;add(id,label,[],f,[],"unknown","reported-source",f.importedAt);return id}
        const parents=[source("ORCA XYZ",raw.xyzFile),source("ORCA output",raw.outFile),source("OPLS topology source",raw.originalTopologyFile)]
        const id="mapping-"+snapshot.id+"-"+mol;add(id,"AtomChargeTopologyMapping",parents,raw,[],"researcher",snapshot.softwareVersion,snapshot.generatedAt);sourceIds.push(id)
      }
      add(snapshot.id,"GeneratedInput",[run.runId,...sourceIds],snapshot,[], "automatic",snapshot.softwareVersion,snapshot.generatedAt)
    }
  }
  for(const d of w.datasets){
    const source="rdf-source-"+(d.sourceHash??d.id);add(source,"RawRDF",[],{filename:d.sourceFilename,sha256:d.sourceHash,text:d.sourceText},d.sourceText!==undefined&&d.sourceHash?[]:["Original RDF source/hash missing."],"unknown","source-file",d.importedAt)
    let trajectory="UNKNOWN-TRAJECTORY-"+d.id
    if(d.trajectory){
      trajectory="trajectory-"+fingerprint({run:d.trajectory.runId,hash:d.trajectory.sha256})
      const r=w.runs.find(r=>r.runId===d.trajectory!.runId),snap=r?.inputSnapshots?.find(s=>s.id===d.inputSnapshotId)
      add(trajectory,"Trajectory",[snap?.id??"UNKNOWN-GENERATED-INPUT-"+d.trajectory.runId],{...d.trajectory,verification:"RESEARCHER REPORTED; external execution is not automatically verified"},/^[0-9a-f]{64}$/i.test(d.trajectory.sha256)&&d.trajectory.actualVolumeNm3>0&&d.trajectory.volumeSource?[]:["Trajectory hash or measured volume provenance missing."],"researcher","external GROMACS",d.importedAt)
    }
    add(d.id,"ObservableRDF",[source,trajectory],{...d,sourceText:undefined,analysis:undefined,analysisHistory:undefined},stateId(d.scientificState)?[]:["Unknown state mapping."],"researcher",d.createdWithVersion??"UNKNOWN",d.importedAt)
    const analyses=[...(d.analysisHistory??[]),...(d.analysis?[d.analysis]:[])]
    for(const a of analyses){
      if(!a.id)continue
      add(a.id,"KBI",[d.id],a,a===d.analysis?plateauIssues(d):["Historical superseded analysis."],"automatic",a.createdWithVersion??"UNKNOWN",a.analyzedAt)
      if(a.decision)add(a.decision.id,"PlateauDecision",[a.id],a.decision,[],"researcher",a.decision.softwareVersion,a.decision.timestamp,a.decision.classification==="rejected"?"rejected":"present")
    }
  }
  for(const c of w.scientific.convergenceDecisions)if(c.id)add(c.id,"ConvergenceDecision",[...(c.sourceDatasetIds??[]),...(c.sourceAnalysisIds??[])],c,c.sourceAnalysisIds?.length?[]:["Legacy convergence ancestry unknown."],"researcher",c.softwareVersion??"UNKNOWN",c.timestamp)
  for(const g of replicaGroups(w.datasets,w.scientific))add(g.id,"ReplicaStatistics",[...g.sourceDatasetIds,...g.sourceAnalysisIds,...g.sourceDatasetIds.flatMap(id=>{const d=w.datasets.find(d=>d.id===id)!;return [d.analysis!.decision!.id,acceptedConvergence(d,w.datasets,w.scientific)!.id!]})],g,g.issues)
  for(const p of w.scientific.ssmPoints)add(p.id,"FiniteSizePoint",[p.datasetId??"UNKNOWN-RDF",p.analysisId??"UNKNOWN-KBI",p.runId??"UNKNOWN-RUN"],p)
  for(const f of w.scientific.ssmFits){
    const calc=f.id+"-calculation";add(calc,"SSMRegression",f.pointIds,{...f,decision:undefined},[],"automatic",f.softwareVersion??"UNKNOWN",f.createdAt)
    if(f.decision)add(f.decision.id,"SSMDecision",[calc],f.decision,[],"researcher",f.decision.softwareVersion,f.decision.timestamp)
    add(f.id,"SSMFit",[calc,...(f.decision?[f.decision.id]:[])],f,currentSsmFit(f,w.scientific,w.runs,w.datasets)?[]:["SSM fit not currently accepted or sources incomplete."],"automatic",f.softwareVersion??"UNKNOWN",f.createdAt)
  }
  for(const r of w.scientific.thermodynamicResults){if(r.override)add(r.override.id,"Override",r.override.sourceIds,r.override,[],"researcher",r.override.softwareVersion,r.override.timestamp,"overridden");add(r.id,"ThermodynamicResult",[...r.sourceTermIds,...(r.sourceAnalysisIds??[]),...(r.sourceDecisionIds??[]),...(r.override?[r.override.id]:[]),...(r.densitySourceId?[r.densitySourceId]:[])],r,currentThermodynamic(r,w.scientific,w.runs,w.datasets)?[]:["Thermodynamic result ancestry is missing, rejected or stale."],"automatic",r.softwareVersion??"UNKNOWN",r.createdAt,r.override?"overridden":"present")}
  for(const a of w.scientific.activityResults){
    const calc=a.id+"-calculation";add(calc,"ActivityIntegration",a.sourceThermodynamicIds??[],{...a,decision:undefined,infiniteDilution:undefined},[],"automatic",a.softwareVersion??"UNKNOWN",a.createdAt)
    if(a.decision)add(a.decision.id,"ActivityDecision",[calc],a.decision,[],"researcher",a.decision.softwareVersion,a.decision.timestamp)
    add(a.id,"ActivityResult",[calc,...(a.decision?[a.decision.id]:[])],a,currentActivity(a,w.scientific,w.runs,w.datasets)?[]:["Activity curve is not accepted with current parent evidence."],"automatic",a.softwareVersion??"UNKNOWN",a.createdAt)
    if(a.infiniteDilution){
      const id=a.id+"-infinite-fit";add(id,"InfiniteDilutionFit",[a.id],a.infiniteDilution,currentInfiniteDilution(a)?[]:["Infinite-dilution extrapolation is unaccepted or not reproducible."],"automatic",a.softwareVersion??"UNKNOWN",a.createdAt)
      if(a.infiniteDilution.decision)add(a.infiniteDilution.decision.id,"InfiniteDilutionDecision",[id],a.infiniteDilution.decision,[],"researcher",a.infiniteDilution.decision.softwareVersion,a.infiniteDilution.decision.timestamp)
    }
  }
  for(const c of w.scientific.cosmoRecords)add(c.id,"COSMORecord",[],c,c.mapping&&c.sourceHash?[]:["Source metadata unresolved."],"researcher","source-file")
  for(const o of w.scientific.observables)add(o.id,"ImportedObservable",[o.runId],o,o.sourceHash&&o.scientificState?[]:["Observable provenance unresolved."],"researcher","source-file")
  for(const c of w.scientific.comparisons??[])add(c.id,"COSMOComparison",c.sourceIds,c,currentComparison(c,w.scientific,w.runs,w.datasets)?[]:["Comparison sources or accepted matching state have changed; recompute before interpretation."],"automatic",c.softwareVersion,c.timestamp)
  for(const [runId,execution]of Object.entries(w.orcaGromacs.execution))for(const d of execution.history??[])add(d.id,"ExecutionReview",[runId],d,[],"researcher",d.softwareVersion,d.timestamp)
  for(const d of w.decisions)if(typeof d.id==="string")add(d.id,String(d.type??"ResearchDecision"),Array.isArray(d.sourceIds)?d.sourceIds as string[]:[],d,[],"researcher",String(d.softwareVersion??"UNKNOWN"),String(d.timestamp??w.savedAt))
  for(const [kind,d]of [["Champion",w.project.selectedChampion],["Optimum",w.project.selectedOptimum]] as const)if(d)add(kind+"-"+fingerprint(d),"ResearchDecision",d.supportingAnalysis,d,d.rationale?[]:["Decision rationale missing."],"researcher",SOFTWARE_VERSION,d.selectedAt)
  for(const n of nodes.values()){const missing=n.parentIds.filter(id=>!nodes.has(id));if(missing.length){n.status="incomplete";n.issues.push("Missing ancestors: "+missing.join(", "))}}
  // Propagate unresolved/rejected ancestors without inventing links or claiming validation.
  for(let pass=0;pass<nodes.size;pass++){
    let changed=false
    for(const n of nodes.values())if(n.status!=="incomplete"&&n.parentIds.some(id=>{const p=nodes.get(id);return !p||p.status==="incomplete"||p.status==="rejected"})){n.status="incomplete";n.issues.push("One or more scientific ancestors are unresolved, stale or rejected.");changed=true}
    if(!changed)break
  }
  return [...nodes.values()]
}
export function provenanceCoverage(w:Workspace,graph=provenanceGraph(w)){
  const rows=graph.map(n=>({id:n.id,category:n.type,status:n.issues.length?(n.issues.some(s=>/disagree|conflict|inconsistent/.test(s))?"INCONSISTENT":"MISSING"):"PRESENT",detail:n.issues.join(" ")||n.status,parents:n.parentIds}))
  for(const type of ["Run","RawRDF","KBI","SSMFit","ThermodynamicResult","ActivityResult","COSMOComparison"])if(!graph.some(n=>n.type===type))rows.push({id:"none-"+type,category:type,status:"NOT_APPLICABLE",detail:"No records of this type in the project.",parents:[]})
  return rows
}
export function analysisReport(w:Workspace,graph=provenanceGraph(w)){
  return {title:"SolvForge MD Analysis Report",generatedAt:new Date().toISOString(),generatedWithVersion:SOFTWARE_VERSION,currentSchemaVersion:SCHEMA_VERSION,projectHistory:{createdWithVersion:w.project.createdWithVersion,originalSchemaVersion:w.project.originalSchemaVersion,lastOpenedWithVersion:w.project.lastOpenedWithVersion,migrationHistory:w.project.migrationHistory},projectId:w.projectId,projectName:w.project.projectName,provenance:graph,coverage:provenanceCoverage(w,graph),numericalImplementationTests:w.scientific.validationResults,scientificValidation:"Numerical implementation tests do not validate current MD equilibration, convergence, finite-size methodology or researcher interpretation."}
}
const escape=(v:unknown)=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]!))
export function reportHtml(w:Workspace){
  const report=analysisReport(w)
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>SolvForge MD Analysis Report</title><style>body{font:14px/1.5 system-ui;margin:30px;max-width:1200px}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:11px}section{border-top:1px solid #aaa;margin:18px 0}a{color:#245440}@media print{details{display:block}details>*{display:block}}</style></head><body><h1>'+escape(report.title)+'</h1><p>'+escape(report.projectName)+' · '+escape(report.generatedAt)+' · report software '+escape(report.generatedWithVersion)+'</p><p>'+escape(report.scientificValidation)+'</p><pre>'+escape(JSON.stringify(report.projectHistory,null,2))+'</pre>'+report.provenance.map(n=>'<section id="'+escape(n.id)+'"><h2>'+escape(n.type)+' · '+escape(n.id)+'</h2><p>'+escape(n.status)+'; actor='+escape(n.actor)+'; software='+escape(n.softwareVersion)+'; '+escape(n.timestamp)+'</p><p>'+escape(n.issues.join(" "))+'</p><p>Parents: '+n.parentIds.map(id=>'<a href="#'+escape(id)+'">'+escape(id)+'</a>').join(", ")+'</p><details open><summary>Exact values / transformation / sources</summary><pre>'+escape(JSON.stringify(n.payload,null,2))+'</pre></details></section>').join("")+'</body></html>'
}
