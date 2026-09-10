"use client"
import { useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import type { Workspace } from "@/lib/workbench/workspace"
import { completeArchive,completeProjectJson,importProjectJson,importArchive,runInputSnapshot } from "@/lib/workbench/packages"
import { provenanceGraph,provenanceCoverage,analysisReport,reportHtml } from "@/lib/workbench/provenance"
import { makeZip } from "@/lib/workbench/zip"
import { sha256 } from "@/lib/workbench/identity"
import { downloadBlob,downloadJson,downloadText,runsCsv } from "@/lib/workbench/export"
import { recordContinuation } from "@/lib/workbench/continuation"
import { toCsv } from "@/lib/workbench/csv"
import { Field,TextField,Section,ViewHeader,InlineWarning } from "./shared"
export function DataView({workspace,onReplace}:{workspace:Workspace;onReplace:(w:Workspace)=>void}){
 const [message,setMessage]=useState(""),[runId,setRunId]=useState(""),[nodeId,setNodeId]=useState(""),w=workspace
 const graph=useMemo(()=>provenanceGraph(w),[w]),coverage=useMemo(()=>provenanceCoverage(w,graph),[w,graph]),node=graph.find(n=>n.id===nodeId)
 const [completed,setCompleted]=useState(""),[checkpoint,setCheckpoint]=useState(""),[executionEvidence,setExecutionEvidence]=useState(""),[continuationReason,setContinuationReason]=useState(""),[continuationAction,setContinuationAction]=useState<"continue"|"stop">("continue")
 const [jsonReview,setJsonReview]=useState<{revision:string;text:string}|null>(null),[pastedJson,setPastedJson]=useState(""),[filePath,setFilePath]=useState(""),[showReport,setShowReport]=useState(false)
 const frozenFiles=w.runs.find(r=>r.runId===runId)?.inputSnapshots?.[0]?.files??[],selectedFile=frozenFiles.find(f=>f.path===filePath)
 const continuation=w.decisions.filter(d=>d.type==="ProductionContinuationDecision"&&d.runId===runId).at(-1)
 const act=async(fn:()=>void|Promise<void>)=>{try{await fn();setMessage("")}catch(e){setMessage(String(e))}}
 const full=()=>({...w,provenance:graph})
 const packRun=(frozen=false)=>act(async()=>{
   const run=w.runs.find(r=>r.runId===runId);if(!run)throw new Error("Choose a generated run.")
   const snapshot=frozen?run.inputSnapshots?.[0]:await runInputSnapshot(w.project,run,w.orcaGromacs);if(!snapshot)throw new Error("No frozen input snapshot.")
   for(const f of snapshot.files)if(await sha256(f.content)!==f.sha256)throw new Error("Frozen input checksum mismatch: "+f.path)
   const next={...w,runs:w.runs.map(r=>r.runId===runId?{...r,inputSnapshots:r.inputSnapshots?.length?r.inputSnapshots:[snapshot]}:r)}
   next.provenance=provenanceGraph(next);onReplace(next)
   const files=snapshot.files.map(f=>({path:f.path,content:f.content}))
   files.push({path:"run_manifest.json",content:JSON.stringify({...run,inputSnapshots:[{...snapshot,files:snapshot.files.map(({path,sha256})=>({path,sha256}))}]},null,2)})
   const checksums=await Promise.all(files.map(async f=>({path:f.path,size:new TextEncoder().encode(f.content).length,sha256:await sha256(f.content)})))
   downloadBlob(runId+"-run-inputs.zip",makeZip([...files,{path:"checksums.json",content:JSON.stringify(checksums,null,2)}]))
 })
 return <>
 <ViewHeader eyebrow="Data / provenance" title="Local ownership & reproducibility" description="Complete atomic project archives, frozen run inputs, actual provenance coverage and inspectable report ancestry."/>
 {message&&<div role="alert" className="inline-warning">{message}</div>}
 <Section title="Complete Project Archive">
 <div className="section-actions"><Button onClick={()=>void act(async()=>downloadBlob("solvforge-complete-project.zip",await completeArchive(full())))}>Export Complete Project Archive ZIP</Button><Button variant="outline" onClick={()=>void act(async()=>downloadText("solvforge-workspace.json",await completeProjectJson(full()),"application/json"))}>Export complete project JSON</Button><Button variant="outline" onClick={()=>downloadJson("project-manifest.json",w.project)}>Export design manifest only</Button><Button variant="outline" onClick={()=>void act(async()=>setJsonReview({revision:w.savedAt,text:await completeProjectJson(full())}))}>Review complete project JSON</Button></div>
 {jsonReview?.revision===w.savedAt&&<label className="field-stack mt-3">Complete project JSON — validated export snapshot<Textarea aria-label="Complete project JSON review" readOnly value={jsonReview.text} rows={12} className="font-mono text-xs"/><small>Select and copy this text to retain or transfer a complete project when downloads are unavailable. This is the same JSON serialization used by export; raw imported sources are included.</small></label>}
 <details className="my-3"><summary>Restore from pasted project JSON</summary><label className="field-stack mt-3">Project JSON<Textarea aria-label="Project JSON to restore" value={pastedJson} onChange={e=>setPastedJson(e.target.value)} rows={6}/></label><Button disabled={!pastedJson.trim()} onClick={()=>void act(async()=>{const next=await importProjectJson(pastedJson);onReplace(next);setPastedJson("");setJsonReview(null)})}>Validate and restore pasted JSON</Button></details>
 <label className="field-stack mt-3">Import project JSON or archive ZIP<input aria-label="Import complete project" type="file" accept=".json,.zip" onChange={e=>{const file=e.target.files?.[0];e.currentTarget.value="";if(file)void act(async()=>{const next=file.name.endsWith(".zip")?await importArchive(new Uint8Array(await file.arrayBuffer())):await importProjectJson(await file.text());onReplace(next)})}}/></label>
 <p>Complete bundles restore all scientific slices atomically. Design-only manifests start a clean scientific workspace. ZIP imports validate file inventory, CRC and SHA-256 before replacement.</p>
 <InlineWarning title="External artifacts">Raw imported ORCA/RDF text and original topologies are bundled. Full trajectories and installed GROMACS force-field distributions are retained externally; their references are recorded. Keep those files and checksums separately. Browser quotas can limit very large project saves; errors remain visible.</InlineWarning>
 {w.legacyEvidence!==undefined&&<Button variant="outline" onClick={()=>downloadJson("legacy-unresolved-evidence.json",w.legacyEvidence)}>Export quarantined legacy evidence</Button>}
 </Section>
 <Section title="Run Input Package">
 <label>Resolved run<select aria-label="Run input package run" value={runId} onChange={e=>setRunId(e.target.value)}><option value="">Choose run</option>{w.runs.map(r=><option key={r.runId}>{r.runId}</option>)}</select></label><Button disabled={!runId} onClick={()=>void packRun()}>Validate, freeze and export Run Input Package</Button>
 <Button variant="outline" disabled={!w.runs.find(r=>r.runId===runId)?.inputSnapshots?.length} onClick={()=>void packRun(true)}>Export existing frozen Run Input Package</Button>
 <p>Requires consistent resolved protocol, complete reviewed molecular topologies and validated packed coordinates. The exact exported files and hashes become an immutable input snapshot. Actual GROMACS execution and physical equilibration remain external checks.</p>
 {frozenFiles.length>0&&<><label className="field-stack mt-3">Inspect frozen file<select aria-label="Frozen input file" value={filePath} onChange={e=>setFilePath(e.target.value)}><option value="">Choose exact generated artifact</option>{frozenFiles.map(f=><option value={f.path} key={f.path}>{f.path}</option>)}</select></label>{selectedFile&&<><p className="text-xs break-all">SHA-256: {selectedFile.sha256}</p><pre aria-label="Frozen file contents" className="text-xs overflow-auto max-h-96">{selectedFile.content}</pre></>}</>}
 </Section>
 <Section title="Manual production continuation">
 <p>Select a frozen run above. Read the completed time and checkpoint from the external GROMACS outputs. No automatic execution or convergence acceptance is implied.</p>
 <div className="form-grid form-grid-2"><Field label="Completed production time (ns)" type="number" value={completed} onChange={setCompleted}/><Field label="Checkpoint SHA-256" value={checkpoint} onChange={setCheckpoint}/><Field label="Execution log and checkpoint reference" value={executionEvidence} onChange={setExecutionEvidence}/><label>Researcher action<select aria-label="Production continuation action" value={continuationAction} onChange={e=>setContinuationAction(e.target.value as typeof continuationAction)}><option value="continue">Continue after evidence review</option><option value="stop">Stop production by researcher decision</option></select></label></div>
 <TextField label="Continuation decision rationale" value={continuationReason} onChange={setContinuationReason}/>
 <Button disabled={!runId} onClick={()=>void act(()=>{const decision=recordContinuation(w,{runId,completedNs:Number(completed),action:continuationAction,checkpointSha256:checkpoint,executionEvidence,rationale:continuationReason});onReplace({...w,decisions:[...w.decisions,decision]})})}>Record decision and generate continuation</Button>
 {continuation&&<><p>{String(continuation.interpretation)} End time: {String(continuation.nextEndNs)} ns.</p><pre className="text-xs overflow-auto">{String(continuation.commands)}</pre><Button variant="outline" onClick={()=>downloadText("continuation.sh",String(continuation.commands))}>Download checkpoint command</Button></>}
 </Section>
 <Section title="Generate Analysis Report">
 <div className="section-actions"><Button onClick={()=>downloadJson("analysis-report.json",analysisReport(w,graph))}>Report JSON</Button><Button variant="outline" onClick={()=>downloadText("analysis-report.html",reportHtml(w),"text/html")}>Printable HTML report</Button><Button variant="outline" onClick={()=>{const win=window.open("","_blank");if(win){win.document.write(reportHtml(w));win.document.close();win.focus();win.print()}else setMessage("Popup blocked; download the HTML report and print it.")}}>Print / Save PDF</Button></div>
 <p>Reports use frozen generated protocol values. Editing the current form cannot rewrite historical simulation settings.</p>
 <Button variant="outline" onClick={()=>setShowReport(!showReport)}>{showReport?"Hide report JSON":"Inspect report JSON"}</Button>{showReport&&<pre aria-label="Analysis report JSON review" className="text-xs overflow-auto max-h-96">{JSON.stringify(analysisReport(w,graph),null,2)}</pre>}
 </Section>
 <Section title="Scientific tables and intermediates">
 <div className="section-actions"><Button variant="outline" onClick={()=>downloadText("runs.csv",runsCsv(w.runs),"text/csv")}>Runs CSV</Button><Button variant="outline" onClick={()=>downloadJson("scientific-intermediates.json",w.scientific)}>All scientific intermediates JSON</Button><Button variant="outline" onClick={()=>downloadText("kbi.csv",toCsv([["dataset","analysis","pair_A","pair_B","G_nm3","plateau_SD_not_SEM","status","source_sha256"],...w.datasets.filter(d=>d.analysis).map(d=>[d.id,d.analysis!.id,d.observable?.speciesA,d.observable?.speciesB,d.analysis!.estimateNm3,d.analysis!.plateauSdNm3,d.analysis!.plateauStatus,d.sourceHash])]),"text/csv")}>KBI CSV</Button><Button variant="outline" onClick={()=>downloadText("gamma.csv",toCsv([["result","x","Gamma","relative_gamma","absolute_gamma"],...w.scientific.activityResults.flatMap(a=>a.points.map(p=>[a.id,p.x,p.thermodynamicFactor,p.gammaRelative,p.gammaAbsolute]))]),"text/csv")}>Activity CSV</Button><Button variant="outline" onClick={()=>downloadText("provenance.csv",toCsv([["id","category","status","detail","parents"],...coverage.map(c=>[c.id,c.category,c.status,c.detail,c.parents.join(" ")])]),"text/csv")}>Validation coverage CSV</Button></div>
 </Section>
 <Section title="Project scientific validation and provenance coverage">
 <p>Numerical implementation tests are separate. PRESENT describes recorded evidence; researcher acceptance does not mean automatic verification of GROMACS execution.</p>
 <table className="w-full text-xs"><thead><tr><th>Record</th><th>Category</th><th>Coverage</th><th>Diagnostic</th></tr></thead><tbody>{coverage.map(c=><tr key={c.id}><td><button className="underline text-left break-all" onClick={()=>setNodeId(c.id)}>{c.id}</button></td><td>{c.category}</td><td>{c.status}</td><td>{c.detail}</td></tr>)}</tbody></table>
 </Section>
 <Section title="Trace a scientific result">{node?<><p>{node.type} · {node.status} · {node.actor} · software {node.softwareVersion}</p><p>Parents:</p>{node.parentIds.map(id=><button className="underline m-2 text-xs" key={id} onClick={()=>setNodeId(id)}>{id}</button>)}<pre className="text-xs overflow-auto">{JSON.stringify(node,null,2)}</pre></>:<p>Select any provenance record above to inspect its exact values and parent IDs.</p>}</Section>
 </>
}
