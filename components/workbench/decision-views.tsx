"use client"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import type { ProjectState,RDFDataset,RunRecord,ScientificState } from "@/lib/workbench/types"
import { paretoFront } from "@/lib/workbench/pareto"
import { downloadJson } from "@/lib/workbench/export"
import { generateStageRuns } from "@/lib/workbench/runs"
import { stateId } from "@/lib/workbench/identity"
import { replicaGroups,plateauIssues,acceptedConvergence,resolvedRunState,runMatchesDataset } from "@/lib/workbench/evidence"
import { currentThermodynamic,currentActivity } from "@/lib/workbench/thermodynamics"
import { currentSsmFit } from "@/lib/workbench/finite-size"
import { Section,ViewHeader,TextField,InlineWarning,formatNumber,SvgPlot } from "./shared"
type Props={project:ProjectState;setProject?:(p:ProjectState)=>void;datasets:RDFDataset[];scientific:ScientificState;runs:RunRecord[]}
function Evidence({run,project,datasets,scientific,runs}:Props&{run:RunRecord}){
 const actual=runs.find(r=>r.runId===run.runId),sid=stateId(resolvedRunState(actual)),sources=datasets.filter(d=>sid&&stateId(d.scientificState)===sid&&runMatchesDataset(d,runs.find(r=>r.runId===d.metadata.runId))),groups=replicaGroups(datasets,scientific).filter(g=>sid&&stateId(g.scientificState)===sid)
 const name=(id:string)=>run.molecularSnapshot?.find(m=>m.id===id)?.abbreviation??id
 const thermo=scientific.thermodynamicResults.filter(r=>r.stateKey===sid&&currentThermodynamic(r,scientific,runs,datasets))
 const fit=scientific.ssmFits.filter(f=>f.familyId===stateId(resolvedRunState(actual),{finiteSizeFamily:true})&&currentSsmFit(f,scientific,runs,datasets))
 const obs=scientific.observables.filter(o=>stateId(o.scientificState)===stateId(run.scientificState)&&o.projectId===project.projectId)
 return <div className="text-xs"><p>N={run.soluteCount}; x={run.moleFraction??"unresolved"}; T={run.temperatureK} K; P={run.pressureBar} bar; box={run.box.x} × {run.box.y} × {run.box.z} {run.box.unit}</p>
 {!sources.length&&<p>Insufficient evidence for this exact state.</p>}
 {groups.map(g=><p key={g.id}><strong>{name(g.observable.speciesA)} ↔ {name(g.observable.speciesB)}</strong>: {g.mean===null?g.issues.join(" "):formatNumber(g.mean)+" nm³"}; n independent replicas={g.n}; SEM={g.se===null?"not estimated":formatNumber(g.se)}<br/>Sources: {g.sourceDatasetIds.join(", ")}</p>)}
 {sources.map(d=><details key={d.id}><summary>{d.sourceFilename}: {d.analysis?.plateauStatus??"raw"} · time {acceptedConvergence(d,datasets,scientific)?"RESEARCHER ACCEPTED":"not accepted"}</summary><p>{plateauIssues(d).join(" ")||"Plateau accepted"}</p><pre>{JSON.stringify({pair:d.observable,interval:d.analysis&&[d.analysis.plateauStartNm,d.analysis.plateauEndNm],source:d.sourceHash},null,2)}</pre></details>)}
 {fit.map(f=><p key={f.id}>{f.pairKey}: G∞={formatNumber(f.gInfinityNm3)} ± {formatNumber(f.gInfinitySe)} nm³ · {f.id}</p>)}
 {thermo.map(r=><p key={r.id}>Γ={formatNumber(r.fixedDesRatioSoluteGamma)} · {r.id} {r.override&&"OVERRIDDEN"}</p>)}
 {obs.map(o=><p key={o.id}>{o.type}: {o.value} {o.unit} · imported {o.sourceFilename}</p>)}
 <details><summary>Generated state manifest</summary><pre className="overflow-auto">{JSON.stringify(run,null,2)}</pre></details>
 </div>
}
export function ChampionView(props:Props){
 const {project,setProject,datasets}=props,[notes,setNotes]=useState<Record<string,string>>({})
 const planned=generateStageRuns(project,"A").filter(r=>r.systemKind==="solute"&&r.replica===1)
 return <><ViewHeader eyebrow="Stage A" title="Champion screening" description="All DES × solute systems. Pair-specific accepted evidence remains separate from candidates and rejected analyses."/>
 <InlineWarning title="Researcher decision">Selection without accepted analyses is a planning decision, not scientific validation. Changing champion clears the optimum selection; downstream runs require regeneration.</InlineWarning>
 <ParetoComparison {...props} planned={planned}/>
 {project.desSystems.map(des=><Section key={des.id} title={des.name} kicker={des.ratio.join(":")}>
 <div className="form-grid form-grid-3">{planned.filter(r=>r.desId===des.id).map(r=><div key={r.runId}><strong>{r.soluteName}</strong><Evidence {...props} run={r}/></div>)}</div>
 <TextField label={"Champion rationale "+des.name} value={notes[des.id]??""} onChange={v=>setNotes({...notes,[des.id]:v})}/>
 <Button disabled={!notes[des.id]?.trim()} onClick={()=>{const ids=new Set(planned.filter(r=>r.desId===des.id).map(r=>stateId(resolvedRunState(props.runs.find(a=>a.runId===r.runId)))).filter(Boolean));const sources=datasets.filter(d=>ids.has(stateId(d.scientificState))&&!plateauIssues(d).length&&acceptedConvergence(d,datasets,props.scientific));setProject?.({...project,selectedChampion:{valueId:des.id,selectedAt:new Date().toISOString(),rationale:notes[des.id],supportingAnalysis:sources.map(d=>d.analysis!.id!)},selectedOptimum:project.selectedChampion?.valueId===des.id?project.selectedOptimum:null,overrideLog:[...project.overrideLog,{timestamp:new Date().toISOString(),action:"Champion researcher decision",note:notes[des.id]+"; accepted sources="+sources.map(d=>d.id).join(",")}]})}}>Set as Champion</Button>
 </Section>)}</>
}
export function ConcentrationView(props:Props){
 const {project,setProject,datasets}=props,[notes,setNotes]=useState<Record<string,string>>({}),[solute,setSolute]=useState(project.soluteIds[0]??"")
 const runs=generateStageRuns(project,"B").filter(r=>r.systemKind==="solute"&&r.soluteId===solute&&r.replica===1)
 return <><ViewHeader eyebrow="Stage B" title="Concentration optimization" description="Actual component counts and molecular composition at each nominal loading; no automatic optimum."/>
 {!project.selectedChampion?<p>Select a champion DES first.</p>:<><label>Comparison solute<select aria-label="Concentration comparison solute" value={solute} onChange={e=>setSolute(e.target.value)}>{project.soluteIds.map(id=><option key={id} value={id}>{project.molecules.find(m=>m.id===id)?.fullName}</option>)}</select></label>
 {project.concentrations.map(c=>{const run=runs.find(r=>r.soluteCount===c.soluteCount);return <Section key={c.id} title={c.label+" · N="+c.soluteCount}>{run&&<Evidence {...props} run={run}/>}<TextField label={"Optimum rationale "+c.label} value={notes[c.id]??""} onChange={v=>setNotes({...notes,[c.id]:v})}/><Button disabled={!notes[c.id]?.trim()} onClick={()=>setProject?.({...project,selectedOptimum:{valueId:c.id,selectedAt:new Date().toISOString(),rationale:notes[c.id],supportingAnalysis:datasets.filter(d=>run?.scientificState&&stateId(d.scientificState)===stateId(resolvedRunState(props.runs.find(r=>r.runId===run.runId)))&&!plateauIssues(d).length&&acceptedConvergence(d,datasets,props.scientific)).map(d=>d.analysis!.id!)}})}>Set as Optimum Concentration</Button></Section>})}
 <SeriesPlots {...props} planned={runs} axis="x"/>
 </>}</>
}
function SeriesPlots(props:Props&{planned:RunRecord[];axis:"x"|"T"}){
 const {planned,datasets,scientific,runs,axis}=props,[pair,setPair]=useState("")
 const ids=new Set(planned.map(r=>stateId(resolvedRunState(runs.find(a=>a.runId===r.runId)))).filter(Boolean)),groups=replicaGroups(datasets,scientific).filter(g=>ids.has(stateId(g.scientificState))&&g.mean!==null&&!g.issues.length)
 const keys=[...new Set(groups.map(g=>[g.observable.speciesA,g.observable.speciesB].sort().join(" ↔ ")))]
 const selected=groups.filter(g=>[g.observable.speciesA,g.observable.speciesB].sort().join(" ↔ ")===pair),x=(s:NonNullable<RunRecord["scientificState"]>)=>axis==="T"?s.temperatureK:s.composition.find(c=>c.moleculeId===s.soluteId)!.moleFraction
 const thermo=scientific.thermodynamicResults.filter(r=>ids.has(stateId(r.scientificState))&&currentThermodynamic(r,scientific,runs,datasets))
 return <Section title={axis==="T"?"Temperature trends":"Composition trends"}><label>Specific KBI observable<select aria-label="Trend KBI pair" value={pair} onChange={e=>setPair(e.target.value)}><option value="">Choose pair</option>{keys.map(k=><option key={k}>{k}</option>)}</select></label>
 {selected.length>=2?<SvgPlot x={selected.map(g=>x(g.scientificState))} y={selected.map(g=>g.mean!)} xLabel={axis==="T"?"T / K":"Actual solute x"} yLabel={pair+" / nm³"}/>:<p>At least two exact comparable state points for the same pair required.</p>}
 {thermo.length>=2&&<SvgPlot x={thermo.map(r=>x(r.scientificState!))} y={thermo.map(r=>r.fixedDesRatioSoluteGamma)} xLabel={axis==="T"?"T / K":"Actual solute x"} yLabel="Γ"/>}
 {scientific.activityResults.filter(a=>currentActivity(a,scientific,runs,datasets)&&a.sourceThermodynamicIds?.some(id=>thermo.some(t=>t.id===id))).map(a=><p key={a.id}>Activity curve {a.id}: {a.anchor.type==="none"?"relative γ / γ(xmin)":"anchored absolute γ"}. Inspect the corresponding curve in KB matrix & thermodynamics.</p>)}
 <p className="table-note">Lines guide inspection only. Different pairs and solutes are never averaged. Actual x can change with temperature-dependent density even at fixed nominal solute loading.</p></Section>
}
export function TemperatureView(props:Props){
 const [solute,setSolute]=useState(props.project.soluteIds[0]??""),planned=generateStageRuns(props.project,"C").filter(r=>r.systemKind==="solute"&&r.replica===1&&r.soluteId===solute)
 return <><ViewHeader eyebrow="Stage C" title="Temperature characterization" description="Selected champion + selected nominal loading; arbitrary editable temperatures. Custom full factorial remains separate."/>
 {!props.project.selectedChampion||!props.project.selectedOptimum?<p>Champion and optimum decisions are required.</p>:<><label>Temperature comparison solute<select aria-label="Temperature comparison solute" value={solute} onChange={e=>setSolute(e.target.value)}>{props.project.soluteIds.map(id=><option key={id} value={id}>{props.project.molecules.find(m=>m.id===id)?.fullName}</option>)}</select></label>{planned.map(r=><Section key={r.runId} title={r.temperatureK+" K / "+(r.temperatureK-273.15).toFixed(2)+" °C"}><Evidence {...props} run={r}/></Section>)}<SeriesPlots {...props} planned={planned} axis="T"/></>}</>
}

function ParetoComparison(props:Props&{planned:RunRecord[]}){
 const [solute,setSolute]=useState(props.project.soluteIds[0]??""),[a,setA]=useState("solute-self"),[b,setB]=useState("solute-component-1"),[directionA,setDirectionA]=useState<"minimize"|"maximize">("maximize"),[directionB,setDirectionB]=useState<"minimize"|"maximize">("maximize")
 const objectives=[{id:"solute-self",label:"Gsolute,solute"},{id:"solute-component-1",label:"Gsolute,DES component 1"},{id:"solute-component-2",label:"Gsolute,DES component 2"}]
 const groups=replicaGroups(props.datasets,props.scientific)
 const rows=props.project.desSystems.map(des=>{
  const planned=props.planned.find(r=>r.desId===des.id&&r.soluteId===solute),run=props.runs.find(r=>r.runId===planned?.runId),state=resolvedRunState(run)
  const terms=[a,b].map(key=>{
    if(!state)return undefined
    const target=key==="solute-self"?solute:des.componentIds[key==="solute-component-1"?0:1]
    const found=groups.filter(g=>!g.issues.length&&g.observable.observableType==="molecular-com-rdf"&&stateId(g.scientificState)===stateId(state)&&[g.observable.speciesA,g.observable.speciesB].sort().join("|")===[solute,target].sort().join("|"))
    return found.length===1?found[0]:undefined
  })
  return{id:des.id,values:terms.map(t=>t?.mean??null),sourceIds:terms.flatMap(t=>t?.sourceAnalysisIds??[])}
 })
 const result=a===b?[]:paretoFront(rows,[directionA,directionB])
 return <Section title="Explicit Pareto comparison">
 <p>Select two distinct pair observables and their optimization directions. Component positions refer to each DES definition. Accepted finite-box KBI estimates are compared directly; uncertainty overlap and finite-size sensitivity still require review. This does not select the champion.</p>
 <div className="form-grid form-grid-3"><label>Solute<select aria-label="Pareto solute" value={solute} onChange={e=>setSolute(e.target.value)}>{props.project.soluteIds.map(id=><option value={id} key={id}>{props.project.molecules.find(m=>m.id===id)?.fullName??id}</option>)}</select></label>{[[a,setA,directionA,setDirectionA],[b,setB,directionB,setDirectionB]].map((row,i)=><div key={i}><label>Objective {i+1}<select aria-label={"Pareto objective "+(i+1)} value={row[0] as string} onChange={e=>(row[1] as (v:string)=>void)(e.target.value)}>{objectives.map(o=><option key={o.id} value={o.id}>{o.label}</option>)}</select></label><select aria-label={"Pareto direction "+(i+1)} value={row[2] as string} onChange={e=>(row[3] as (v:"minimize"|"maximize")=>void)(e.target.value as "minimize"|"maximize")}><option value="minimize">Minimize</option><option value="maximize">Maximize</option></select></div>)}</div>
 {a===b?<p>Choose two different observables.</p>:<table className="w-full text-xs"><thead><tr><th>DES</th><th>Objective 1 / nm³</th><th>Objective 2 / nm³</th><th>Dominance</th><th>Dominated by</th></tr></thead><tbody>{result.map(r=><tr key={r.id}><td>{props.project.desSystems.find(d=>d.id===r.id)?.name}</td><td>{formatNumber(r.values[0])}</td><td>{formatNumber(r.values[1])}</td><td>{r.status}</td><td>{r.dominatedBy.join(", ")}</td></tr>)}</tbody></table>}
 <Button variant="outline" onClick={()=>downloadJson("pareto-comparison.json",{projectId:props.project.projectId,solute,objectives:[a,b],directions:[directionA,directionB],result,assumption:"Finite-box pair-specific accepted means. No automatic treatment of uncertainty, aggregation or champion selection."})}>Export objectives and evidence</Button>
 </Section>
}
