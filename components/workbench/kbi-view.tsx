"use client"
import { uuid } from "@/lib/workbench/crypto"

import { useMemo, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import type { ProjectState, RDFDataset, RunRecord, ScientificState } from "@/lib/workbench/types"
import { analyzeDataset, parseCsv, parseXvg, runningKbi } from "@/lib/workbench/kbi"
import { acceptedConvergence, analysisInputSignature, blockGroup, convergenceDecision, decidePlateau, emptyRdfMetadata, identifyImportedSource, invalidateAnalysis, mapDatasetToRun, plateauIssues, replicaGroups } from "@/lib/workbench/evidence"
import { SOFTWARE_VERSION } from "@/lib/workbench/version"
import { downloadJson, downloadText } from "@/lib/workbench/export"
import { toCsv } from "@/lib/workbench/csv"
import { Field, formatNumber, InlineWarning, Metric, Section, StatusBadge, SvgPlot, TextField, ViewHeader } from "./shared"

export function KbiView({project,setProject,datasets,setDatasets,scientific,setScientific,runs}: {project:ProjectState;setProject:(p:ProjectState)=>void;datasets:RDFDataset[];setDatasets:(d:RDFDataset[])=>void;scientific:ScientificState;setScientific:(s:ScientificState)=>void;runs:RunRecord[]}) {
  const fileRef=useRef<HTMLInputElement>(null)
  const [selectedId,setSelectedId]=useState(datasets[0]?.id??""),[runId,setRunId]=useState(""),[speciesA,setSpeciesA]=useState(""),[speciesB,setSpeciesB]=useState("")
  const [observableType,setObservableType]=useState<"molecular-com-rdf"|"atom-rdf"|"custom-rdf">("molecular-com-rdf")
  const [start,setStart]=useState(""),[end,setEnd]=useState(""),[origin,setOrigin]=useState(""),[rationale,setRationale]=useState(""),[message,setMessage]=useState("")
  const [maxSlope,setMaxSlope]=useState(0.01),[maxSd,setMaxSd]=useState(0.1)
  const d=datasets.find(d=>d.id===selectedId)??datasets[0],a=d?.analysis,p=project.analysisDefaults
  const run=runs.find(r=>r.runId===runId)
  const groups=useMemo(()=>replicaGroups(datasets),[datasets])
  const blocks=useMemo(()=>blockGroup(d,datasets,maxSlope,maxSd),[d,datasets,maxSlope,maxSd])
  const patch=(change:Partial<RDFDataset>)=>d&&setDatasets(datasets.map(x=>x.id===d.id?invalidateAnalysis(x,change):x))
  const meta=(k:keyof RDFDataset["metadata"],v:string|number|null)=>d&&patch({metadata:{...d.metadata,[k]:v}})
  const act=(fn:()=>void)=>{try{fn();setMessage("")}catch(e){setMessage(String(e))}}
  const ingest=async(files:FileList)=>{
    const all=[...datasets],added:RDFDataset[]=[]
    for(const file of Array.from(files)){
      const text=await file.text(),hash=await identifyImportedSource(text,[...all,...added])
      const parsed=file.name.toLowerCase().endsWith(".xvg")?parseXvg(text,file.name):parseCsv(text,file.name)
      for(const s of parsed)added.push({...s,id:"rdf-"+uuid(),projectId:project.projectId,sourceHash:hash,sourceText:text,importedAt:new Date().toISOString(),createdWithVersion:SOFTWARE_VERSION,metadata:{...emptyRdfMetadata},provenanceStatus:"unknown",windowKind:"full",replicaRepresentative:false})
    }
    setDatasets([...all,...added]);if(added[0])setSelectedId(added[0].id)
  }
  const analyze=(manual:boolean)=>act(()=>{
    if(!d)return
    const result=analyzeDataset(d,{startNm:manual?Number(start):undefined,endNm:manual?Number(end):undefined,manual,smoothing:p.smoothing,smoothingWindow:p.smoothingWindow,rebinFactor:p.rebinFactor,minWidthNm:p.plateauMinWidthNm,maxAbsSlope:p.plateauMaxAbsSlope,maxVariance:p.plateauMaxVariance,integrationMethod:p.integrationMethod,originG:origin===""?undefined:Number(origin)})
    setDatasets(datasets.map(x=>x.id===d.id?{...d,analysis:result,analysisHistory:[...(d.analysisHistory??[]),...(d.analysis?[d.analysis]:[])]}:x))
    setStart(String(result.plateauStartNm));setEnd(String(result.plateauEndNm))
  })
  const trajectory=(k:string,v:unknown)=>d&&patch({trajectory:{id:d.trajectory?.id??uuid(),runId:d.metadata.runId,filename:"",sha256:"",actualVolumeNm3:0,volumeSource:"",evidenceSource:"researcher-reported",...d.trajectory,[k]:v}})
  const accept=(classification:"accepted"|"rejected")=>act(()=>{if(d)setDatasets(datasets.map(x=>x.id===d.id?decidePlateau(x,classification,rationale):x))})
  const rawR=d?.radiusRaw.map(r=>r*(d.metadata.distanceUnit==="angstrom"?0.1:1))??[]
  const rawRunning=useMemo(()=>{try{return d?.metadata.distanceUnit?runningKbi(rawR,d.g,p.integrationMethod):[]}catch{return[]}},[d,p.integrationMethod,rawR])
  const options=(label:string,value:string,items:Array<{id:string;name:string}>,change:(v:string)=>void)=><label className="field-stack">{label}<select aria-label={label} className="h-9 border px-2 text-sm" value={value} onChange={e=>change(e.target.value)}><option value="">Select explicitly</option>{items.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
  const choose=(x:RDFDataset)=>{setSelectedId(x.id);setStart(String(x.analysis?.plateauStartNm??""));setEnd(String(x.analysis?.plateauEndNm??""));setOrigin(x.analysis?.originG===undefined?"":String(x.analysis.originG));setRunId(x.metadata.runId);setSpeciesA(x.observable?.speciesA??"");setSpeciesB(x.observable?.speciesB??"");setRationale("");setMessage("")}
  const exportPlot=()=>{const svg=document.querySelector("#kbi-running svg");if(svg)downloadText("running-kbi.svg",new XMLSerializer().serializeToString(svg),"image/svg+xml")}
  return <>
    <ViewHeader eyebrow="Analysis / Kirkwood–Buff" title="RDF → running KBI" description="Keep molecular pairs, physical states, trajectories and researcher decisions traceable." actions={<><Button onClick={()=>fileRef.current?.click()}>Import RDF</Button><input aria-label="RDF files" ref={fileRef} type="file" accept=".xvg,.csv" multiple hidden onChange={e=>e.target.files&&void ingest(e.target.files).catch(e=>setMessage(String(e)))}/></>}/>
    {message&&<div role="alert" className="inline-warning">{message}</div>}
    {!d?<Section title="Import processed RDF"><p>No imported evidence. Choose XVG or CSV; units and physical provenance remain unknown until explicitly mapped.</p></Section>:<>
      <div className="analysis-layout"><aside className="dataset-list">{datasets.map(x=><button key={x.id} className={x.id===d.id?"active":""} onClick={()=>choose(x)}><strong>{x.sourceFilename}</strong><span>{x.legend}</span><small>{x.analysis?.plateauStatus??"raw / unassigned"}</small></button>)}</aside><div className="analysis-main">
        <Section title="Source and state mapping" kicker={d.provenanceStatus??"UNKNOWN"}>
          <div className="raw-meta"><span>File / series</span><code>{d.sourceFilename} / {(d.seriesIndex??0)+1}</code><span>Points</span><code>{d.g.length}</code><span>Original radius domain</span><code>{d.radiusRaw[0]}–{d.radiusRaw.at(-1)}</code><span>Detected axis</span><code>{d.xLabel}</code><span>SHA-256</span><code className="break-all">{d.sourceHash??"unavailable"}</code></div>
          <div className="form-grid form-grid-3">
            {options("Distance unit",d.metadata.distanceUnit,[{id:"nm",name:"nm"},{id:"angstrom",name:"Å"}],v=>meta("distanceUnit",v))}
            {options("Generated run",runId,runs.filter(r=>r.scientificState).map(r=>({id:r.runId,name:r.runId})),setRunId)}
            {options("RDF representation",observableType,[{id:"molecular-com-rdf",name:"Molecular center of mass"},{id:"atom-rdf",name:"Atom based"},{id:"custom-rdf",name:"Custom selections"}],v=>setObservableType(v as typeof observableType))}
            {options("Species A",speciesA,(run?.molecularSnapshot??[]).map(m=>({id:m.id,name:m.fullName})),setSpeciesA)}
            {options("Species B",speciesB,(run?.molecularSnapshot??[]).map(m=>({id:m.id,name:m.fullName})),setSpeciesB)}
          </div>
          <Button className="mt-3" disabled={!run||!speciesA||!speciesB} onClick={()=>act(()=>{if(run)patch(mapDatasetToRun(d,run,speciesA,speciesB,observableType))})}>Apply explicit run and pair mapping</Button>
          <p className="table-note">Force field and charges: {d.metadata.forceField}; {d.metadata.chargeModel}. A run mapping declares their source as the generated manifest; it does not prove which settings were executed externally. Unmapped RDFs are still viewable and integrable.</p>
          {d.observable&&<div className="form-grid form-grid-2"><Field label="Reference selection actually used" value={d.observable.selectionA} onChange={v=>patch({observable:{...d.observable!,selectionA:v}})}/><Field label="Target selection actually used" value={d.observable.selectionB} onChange={v=>patch({observable:{...d.observable!,selectionB:v}})}/></div>}
          {d.scientificState&&<details><summary>Resolved molecular state from run</summary><pre className="overflow-auto text-xs">{JSON.stringify(d.scientificState,null,2)}</pre></details>}
        </Section>
        <Section title="Trajectory provenance and time window">
          <div className="form-grid form-grid-3">
            <Field label="Source trajectory filename" value={d.trajectory?.filename??""} onChange={v=>trajectory("filename",v)}/>
            <Field label="Trajectory SHA-256 (external sha256sum)" value={d.trajectory?.sha256??""} onChange={v=>trajectory("sha256",v.toLowerCase())}/>
            <Field label="Trajectory identity" value={d.trajectory?.id??""} onChange={v=>trajectory("id",v)} note="Use the same identity and hash for all windows of one trajectory."/>
            <Field label="Measured mean volume (nm³)" type="number" step="any" value={d.trajectory?.actualVolumeNm3||""} onChange={v=>trajectory("actualVolumeNm3",Number(v))}/>
            <Field label="Volume source / analysis interval" value={d.trajectory?.volumeSource??""} onChange={v=>trajectory("volumeSource",v)} note="Use equilibrated volume evidence, not the initial packing volume."/>
            {options("Window type",d.windowKind??"",[{id:"full",name:"Full analyzed trajectory"},{id:"block",name:"Disjoint block"},{id:"cumulative",name:"Cumulative window"}],v=>patch({windowKind:v as RDFDataset["windowKind"]}))}
            <Field label="Window start (ns)" type="number" value={d.metadata.trajectoryStartNs??""} onChange={v=>meta("trajectoryStartNs",v===""?null:Number(v))}/>
            <Field label="Window end (ns)" type="number" value={d.metadata.trajectoryEndNs??""} onChange={v=>meta("trajectoryEndNs",v===""?null:Number(v))}/>
            <Field label="Executed simulation duration (ns)" type="number" value={d.metadata.simulationDurationNs??""} onChange={v=>meta("simulationDurationNs",v===""?null:Number(v))}/>
          </div>
          <Field label="RDF settings / normalization notes" value={d.metadata.rdfSettings} onChange={v=>meta("rdfSettings",v)}/>
          <label className="flex gap-2 my-3"><input type="checkbox" checked={d.replicaRepresentative??false} onChange={e=>patch({replicaRepresentative:e.target.checked})}/>Use this dataset as the single representative for this replica and pair</label>
          <TextField label="Source notes (metadata)" value={d.metadata.notes} onChange={v=>meta("notes",v)}/>
        </Section>
      </div></div>
      <Section title="Numerical processing and plateau">
        <div className="form-grid form-grid-4">
          {options("Integration method",p.integrationMethod,[{id:"trapezoidal",name:"Trapezoidal"},{id:"simpson",name:"Simpson with trapezoid fallback"}],v=>setProject({...project,analysisDefaults:{...p,integrationMethod:v as typeof p.integrationMethod}}))}
          {options("Smoothing",p.smoothing,[{id:"none",name:"None"},{id:"moving-average",name:"Moving average"}],v=>setProject({...project,analysisDefaults:{...p,smoothing:v as typeof p.smoothing}}))}
          <Field label="Smoothing window" type="number" value={p.smoothingWindow} onChange={v=>setProject({...project,analysisDefaults:{...p,smoothingWindow:Number(v)}})} disabled={p.smoothing==="none"}/>
          <Field label="Rebin factor" type="number" value={p.rebinFactor} onChange={v=>setProject({...project,analysisDefaults:{...p,rebinFactor:Number(v)}})}/>
          <Field label="Minimum plateau width (nm)" type="number" step="any" value={p.plateauMinWidthNm} onChange={v=>setProject({...project,analysisDefaults:{...p,plateauMinWidthNm:Number(v)}})}/>
          <Field label="Maximum absolute radial slope (nm²)" type="number" step="any" value={p.plateauMaxAbsSlope} onChange={v=>setProject({...project,analysisDefaults:{...p,plateauMaxAbsSlope:Number(v)}})}/>
          <Field label="Maximum radial variance (nm⁶)" type="number" step="any" value={p.plateauMaxVariance} onChange={v=>setProject({...project,analysisDefaults:{...p,plateauMaxVariance:Number(v)}})}/>
          <Field label="Explicit g(0), if origin is unmeasured" type="number" step="any" value={origin} onChange={setOrigin} note="Blank means integrate from the first supplied radius; do not treat that truncated integral as complete KBI." disabled={rawR[0]===0}/>
          <Field label="Plateau start (nm)" type="number" step="any" value={start} onChange={setStart}/>
          <Field label="Plateau end (nm)" type="number" step="any" value={end} onChange={setEnd}/>
        </div>
        <div className="section-actions"><Button onClick={()=>analyze(false)}>Suggest Plateau</Button><Button variant="outline" disabled={start===""||end===""} onClick={()=>analyze(true)}>Calculate manual interval</Button></div>
        <p className="table-note">Click the running-KBI plot twice to set the interval, then calculate it. Any suggested plateau remains a candidate until explicitly accepted. Plateau SD measures radial variation, not replica uncertainty.</p>
      </Section>
      <Tabs defaultValue="plots"><TabsList><TabsTrigger value="plots">Plots</TabsTrigger><TabsTrigger value="plateau">Plateau</TabsTrigger><TabsTrigger value="replicas">Replicas</TabsTrigger><TabsTrigger value="blocks">Block convergence</TabsTrigger><TabsTrigger value="raw">Raw / Export</TabsTrigger></TabsList>
        <TabsContent value="plots"><div className="plot-grid">
          <Section title="Raw RDF"><SvgPlot x={d.metadata.distanceUnit?rawR:d.radiusRaw} y={d.g} xLabel={d.metadata.distanceUnit?"r / nm":"r / UNKNOWN unit"} yLabel="g(r)"/></Section>
          {a&&<Section title="Processed RDF"><SvgPlot x={a.radiusNm} y={a.processedG} xLabel="r / nm" yLabel="processed g(r)"/></Section>}
          <Section title={a?"Running KBI with selected interval":"Running integral from first measured radius"}><div id="kbi-running"><SvgPlot x={a?.radiusNm??rawR} y={a?.runningKbiNm3??rawRunning} xLabel="R / nm" yLabel="G / nm³" plateau={a?[a.plateauStartNm,a.plateauEndNm]:undefined} onSelectX={v=>{if(start===""||end!==""){setStart(String(v));setEnd("")}else{setEnd(String(Math.max(Number(start),v)));setStart(String(Math.min(Number(start),v)))}}}/></div></Section>
          {a&&<Section title="Raw running KBI"><SvgPlot x={rawR} y={a.rawRunningKbiNm3} xLabel="R / nm" yLabel="raw G / nm³"/></Section>}
        </div></TabsContent>
        <TabsContent value="plateau">{a?<Section title="Plateau statistics" kicker={a.plateauStatus}>
          <div className="metrics-row"><Metric label="KBI mean (nm³)" value={formatNumber(a.estimateNm3)}/><Metric label="Median (nm³)" value={formatNumber(a.plateauMedianNm3)}/><Metric label="Radial SD (nm³)" value={formatNumber(a.plateauSdNm3)}/><Metric label="Slope (nm²)" value={formatNumber(a.plateauSlope)}/><Metric label="Variance (nm⁶)" value={formatNumber(a.plateauVariance)}/><Metric label="Samples / width" value={a.plateauSampleCount+" / "+formatNumber(a.plateauWidthNm)}/><Metric label="Lower bound (nm)" value={a.lowerBoundNm??"unknown"}/></div>
          <InlineWarning title="Candidate plateau — researcher validation required">Origin treatment: {a.originTreatment??"unknown"}. Radial stability alone does not validate time convergence or finite-size extrapolation.</InlineWarning>
          <TextField label="Plateau decision rationale" value={rationale} onChange={setRationale}/>
          <div className="section-actions"><Button disabled={!rationale.trim()} onClick={()=>accept("accepted")}>Accept plateau</Button><Button variant="outline" disabled={!rationale.trim()} onClick={()=>accept("rejected")}>Reject plateau</Button></div>
          <p className="table-note">{plateauIssues(d).join(" ")||"Plateau evidence is current and researcher accepted."}</p>
        </Section>:<p className="quiet-row">No plateau calculation. Raw running data remain available.</p>}</TabsContent>
        <TabsContent value="replicas"><Section title="Exact-state, same-pair replica summaries">
          <Field label="Replica CV disagreement threshold" type="number" step="any" value={p.replicaCvThreshold} onChange={v=>setProject({...project,analysisDefaults:{...p,replicaCvThreshold:Number(v)}})}/>
          <p className="table-note">One explicitly selected representative per independent replica. Rejected, unmapped and stale analyses are excluded. Time convergence is evaluated separately; no outlier is removed.</p>
          {groups.length?groups.map(g=><div key={g.key} className="border-b py-3"><strong>{g.label} · {g.scientificState.temperatureK} K · {g.scientificState.desId}</strong><p>Independent replicas: {g.n}; mean {formatNumber(g.mean)} nm³; SD {formatNumber(g.sd)}; SEM {formatNumber(g.se)}; 95% CI {g.ci95?.map(v=>formatNumber(v)).join(" … ")??"unavailable (n < 2)"}.</p><StatusBadge tone={g.issues.length||g.cv!==null&&g.cv>p.replicaCvThreshold?"warning":"neutral"}>{g.issues.join(" ")||("CV "+formatNumber(g.cv))}</StatusBadge><p className="text-xs break-all">Source datasets: {g.sourceDatasetIds.join(", ")}</p>{g.sourceDatasetIds.map(id=>{const x=datasets.find(d=>d.id===id)!;return <details key={id}><summary>Replica {x.scientificState!.replica}: {formatNumber(x.analysis!.estimateNm3)} nm³ · {acceptedConvergence(x,datasets,scientific)?"RESEARCHER ACCEPTED time convergence":"Time convergence unresolved"}</summary><SvgPlot x={x.analysis!.radiusNm} y={x.analysis!.runningKbiNm3} xLabel="R / nm" yLabel="G / nm³" plateau={[x.analysis!.plateauStartNm,x.analysis!.plateauEndNm]}/></details>})}</div>):<p className="quiet-row">No eligible replica representatives.</p>}
        </Section></TabsContent>
        <TabsContent value="blocks"><Section title="Selected trajectory / pair time convergence">
          <div className="form-grid form-grid-2"><Field label="Maximum time slope (nm³/ns)" type="number" step="any" value={maxSlope} onChange={v=>setMaxSlope(Number(v))}/><Field label="Maximum block SD (nm³)" type="number" step="any" value={maxSd} onChange={v=>setMaxSd(Number(v))}/></div>
          {blocks.issues.map((e,i)=><p key={i} className="table-note">{e}</p>)}
          {blocks.points.length>1&&<SvgPlot x={blocks.points.map(d=>d.metadata.trajectoryEndNs!)} y={blocks.points.map(d=>d.analysis?.estimateNm3??NaN)} xLabel="Window end time / ns" yLabel="KBI / nm³"/>}
          {blocks.diagnostics&&<p>Automated recommendation: {blocks.diagnostics.recommendation}; slope {formatNumber(blocks.diagnostics.slopeNm3PerNs)} nm³/ns; SD {formatNumber(blocks.diagnostics.sdNm3)} nm³. Cumulative windows are correlated; their SD is descriptive.</p>}
          <TextField label="Time convergence rationale" value={rationale} onChange={setRationale}/>
          <div className="section-actions">{(["not-converged","possibly-converged","converged-accepted"] as const).map(c=><Button key={c} variant="outline" disabled={!!blocks.issues.length||!rationale.trim()} onClick={()=>act(()=>setScientific({...scientific,convergenceDecisions:[...scientific.convergenceDecisions,convergenceDecision(d,datasets,c,rationale,maxSlope,maxSd)]}))}>{c}</Button>)}</div>
          <p>Authoritative status: {acceptedConvergence(d,datasets,scientific)?"RESEARCHER ACCEPTED":"Not accepted or evidence unresolved"}.</p>
        </Section></TabsContent>
        <TabsContent value="raw"><Section title="Raw source and all numerical intermediates" actions={<><Button variant="outline" onClick={()=>downloadText(d.sourceFilename,d.sourceText??"")}>Original file</Button><Button onClick={()=>downloadJson("rdf-analysis.json",d)}>JSON</Button><Button variant="outline" disabled={!a} onClick={()=>a&&downloadText("processed-kbi.csv",toCsv([["r_nm","g_processed","G_nm3"],...a.radiusNm.map((r,i)=>[r,a.processedG[i],a.runningKbiNm3[i]])]),"text/csv")}>Processed CSV</Button><Button variant="outline" onClick={exportPlot}>SVG plot</Button></>}><details><summary>Grace metadata and source</summary><pre className="overflow-auto text-xs max-h-96">{d.sourceText??"Legacy source text unavailable."}</pre></details><pre className="overflow-auto text-xs">{JSON.stringify({status:d.provenanceStatus,analysisSignatureMatches:a?analysisInputSignature(d)===a.inputSignature:null,analysis:a?{...a,rawRunningKbiNm3:undefined,runningKbiNm3:undefined,radiusNm:undefined,processedG:undefined}:null},null,2)}</pre></Section></TabsContent>
      </Tabs>
    </>}
  </>
}
