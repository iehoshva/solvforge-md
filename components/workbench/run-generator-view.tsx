"use client"

import { useMemo, useState } from "react"
import { Archive, ChevronDown, ChevronUp, Download, Plus, RefreshCw, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import type { ProjectState, RunRecord } from "@/lib/workbench/types"
import { newId } from "@/lib/workbench/preset"
import { commands, emMdp, generateCustomRuns, generateStageRuns, nptMdp, nvtMdp, prodMdp, parseNumericAxis, stageRunCount, customRunCount, type CustomAxes } from "@/lib/workbench/runs"
import { validateMdp, validateRunIds } from "@/lib/workbench/mdp"
import { downloadBlob, downloadJson, downloadText, exportProjectZip, runsCsv } from "@/lib/workbench/export"
import { ProtocolEditor } from "./protocol-editor"
import { BoxCompositionCalculator } from "./box-composition-calculator"
import { Field, InlineWarning, Metric, Section, StatusBadge, ViewHeader } from "./shared"



export function RunGeneratorView({ project, setProject, setActiveRuns }: { project: ProjectState; setProject: (p: ProjectState) => void; activeRuns: RunRecord[]; setActiveRuns: (r: RunRecord[]) => void }) {
  const design=project.runDesign??{mode:"A" as const,custom:{desIds:project.desSystems.slice(0,1).map(d=>d.id),soluteIds:project.soluteIds.slice(0,1),soluteCounts:"1",temperaturesK:"323.15",pressuresBar:"1",boxSizesNm:"5",replicas:project.protocol.replicas}}
  const mode=design.mode,custom=design.custom
  const setMode=(mode:typeof design.mode)=>setProject({...project,runDesign:{...design,mode}})
  const setCustom=(custom:typeof design.custom)=>setProject({...project,runDesign:{...design,custom}})
  const [approvedMatrix,setApprovedMatrix]=useState("")
  const signature=JSON.stringify({design,protocol:project.protocol,concentrations:project.concentrations,temperatures:project.temperaturesK,des:project.desSystems,solutes:project.soluteIds})
  const previewResult=useMemo(()=>{
    try{
      const a:CustomAxes={...custom,soluteCounts:parseNumericAxis(custom.soluteCounts),temperaturesK:parseNumericAxis(custom.temperaturesK),pressuresBar:parseNumericAxis(custom.pressuresBar),boxSizesNm:parseNumericAxis(custom.boxSizesNm)}
      const requested=mode==="custom"?customRunCount(a):stageRunCount(project,mode)
      if(!Number.isSafeInteger(requested)||requested<0)throw new Error("Run count must be a nonnegative integer; check replicas and axes.")
      if(requested>20000)throw new Error("Browser limit: 20000 records per batch. Split the matrix into explicit batches.")
      if(requested>1000&&approvedMatrix!==signature)return{runs:[],requested,error:"Large matrix: explicitly confirm before allocating run records."}
      return{runs:mode==="custom"?generateCustomRuns(project,a):generateStageRuns(project,mode),requested,error:""}
    }catch(e){return{runs:[],requested:0,error:String(e)}}
  },[project,mode,custom,approvedMatrix,signature])
  const preview=previewResult.runs
  const manifestDiagnostics = useMemo(() => {
    const diagnostics = validateRunIds(preview)
    for (const run of preview) {
      diagnostics.push(...run.compositionDiagnostics.map((item) => ({ ...item, code: `${item.code}:${run.desAbbreviation}:${run.soluteAbbreviation}:N${run.soluteCount}:${run.temperatureK}K`, message: `${run.desName} / ${run.soluteName}, N=${run.soluteCount}, ${run.temperatureK} K — ${item.message}` })))
      diagnostics.push(...(run.resolvedProtocol?.diagnostics ?? []), ...validateMdp(emMdp(project, run), "em"), ...validateMdp(nvtMdp(project, run), "nvt", { temperatureK: run.temperatureK, durationNs: project.protocol.nvt.durationNs }), ...validateMdp(nptMdp(project, run), "npt", { temperatureK: run.temperatureK, pressureBar: run.pressureBar, durationNs: project.protocol.npt.durationNs }), ...validateMdp(prodMdp(project, run), "prod", { temperatureK: run.temperatureK, pressureBar: run.pressureBar, durationNs: run.productionNs }))
    }
    return diagnostics.filter((diagnostic, index, all) => all.findIndex((other) => other.severity === diagnostic.severity && other.code === diagnostic.code && other.message === diagnostic.message) === index)
  }, [preview, project])
  const manifestErrors = manifestDiagnostics.filter((diagnostic) => diagnostic.severity === "ERROR")
  const productionTotal = preview.reduce((sum, r) => sum + r.productionNs, 0)
  const uniqueSystems = new Set(preview.map((r) => `${r.desId}|${r.soluteId}|${r.soluteCount}`)).size
  const statePoints = new Set(preview.map((r) => JSON.stringify({kind:r.systemKind,des:r.desId,solute:r.soluteId,composition:r.components,count:r.soluteCount,temperature:r.temperatureK,pressure:r.pressureBar,box:r.box}))).size
  const protocol = project.protocol
  const generate = () => {
    if (preview.length > 1000 && !window.confirm(`Generate ${preview.length} run records? This is a very large matrix.`)) return
    setActiveRuns(preview)
  }
  const toggleAxis = (key: "desIds" | "soluteIds", value: string) => setCustom({ ...custom, [key]: custom[key].includes(value) ? custom[key].filter((id) => id !== value) : [...custom[key], value] })
  return <>
    <ViewHeader eyebrow="Run design / generator" title="Hierarchical GROMACS run planning" description="Generate editable inputs and deterministic metadata without executing GROMACS." actions={<><Button variant="outline" size="sm" onClick={generate}><RefreshCw/>Refresh manifest</Button><Button size="sm" disabled={!preview.length} onClick={generate}>Generate {preview.length} runs</Button></>}/>
    <InlineWarning title="Research settings, not universal recommendations">Simulation parameters are user-defined research settings and are not guaranteed to be scientifically optimal for every molecular system.</InlineWarning>

    {previewResult.error&&<InlineWarning title="Matrix validation">{previewResult.error}{previewResult.requested>1000&&<Button onClick={()=>setApprovedMatrix(signature)}>Confirm {previewResult.requested} run records</Button>}</InlineWarning>}
    <Tabs value={mode} onValueChange={(v) => setMode(v as typeof mode)} className="run-tabs">
      <TabsList><TabsTrigger value="A">Stage A</TabsTrigger><TabsTrigger value="B">Stage B</TabsTrigger><TabsTrigger value="C">Stage C</TabsTrigger><TabsTrigger value="custom">Custom matrix</TabsTrigger></TabsList>
      <TabsContent value="A"><Section title="DES champion screening" kicker="Stage A · comparison">
        <div className="stage-form"><Field label="Comparison temperature (K)" type="number" step="0.01" value={project.stageATemperatureK} onChange={(v) => setProject({ ...project, stageATemperatureK: Number(v) })}/><Field label="Solute molecules per box" type="number" value={project.stageASoluteCount} onChange={(v) => setProject({ ...project, stageASoluteCount: Number(v) })} note="Explicit editable comparison loading."/><AxisSummary label="DES candidates" values={project.desSystems.map((d) => d.name)}/><AxisSummary label="Solutes" values={project.soluteIds.map((id) => project.molecules.find((m) => m.id === id)?.fullName ?? id)}/></div>
      </Section></TabsContent>
      <TabsContent value="B"><Section title="Concentration optimization" kicker="Stage B · champion required" actions={<Button size="sm" variant="outline" onClick={() => setProject({ ...project, concentrations: [...project.concentrations, { id: newId("conc"), label: "Custom loading", soluteCount: 1 }] })}><Plus/>Loading</Button>}>
        {!project.selectedChampion && <InlineWarning title="Stage B is gated">Select a champion DES explicitly in Champion Screening. No run matrix is generated until then.</InlineWarning>}
        <div className="form-grid form-grid-2"><Field label="Optimization temperature (K)" type="number" step="0.01" value={project.stageBTemperatureK} onChange={(v) => setProject({ ...project, stageBTemperatureK: Number(v) })}/><div className="readout-field"><Label>Champion DES</Label><strong>{project.desSystems.find((d) => d.id === project.selectedChampion?.valueId)?.name ?? "Not selected"}</strong></div></div>
        <EditableSeries project={project} setProject={setProject} type="concentration"/>
      </Section></TabsContent>
      <TabsContent value="C"><Section title="Temperature characterization" kicker="Stage C · champion + optimum required" actions={<Button size="sm" variant="outline" onClick={() => setProject({ ...project, temperaturesK: [...project.temperaturesK, 323.15] })}><Plus/>Temperature</Button>}>
        {(!project.selectedChampion || !project.selectedOptimum) && <InlineWarning title="Stage C is gated">Select both a champion DES and an optimum concentration. The workbench will not silently create a full temperature × concentration factorial.</InlineWarning>}
        <div className="selection-strip"><span>DES <strong>{project.desSystems.find((d) => d.id === project.selectedChampion?.valueId)?.name ?? "—"}</strong></span><span>Concentration <strong>{project.concentrations.find((c) => c.id === project.selectedOptimum?.valueId)?.label ?? "—"}</strong></span></div>
        <EditableSeries project={project} setProject={setProject} type="temperature"/>
      </Section></TabsContent>
      <TabsContent value="custom"><Section title="Arbitrary experimental matrix" kicker="Custom mode">
        <div className="axis-pickers"><AxisPicker title="DES systems" items={project.desSystems.map((d) => ({ id: d.id, label: d.name }))} selected={custom.desIds} onToggle={(id) => toggleAxis("desIds", id)}/><AxisPicker title="Solutes" items={project.soluteIds.map((id) => ({ id, label: project.molecules.find((m) => m.id === id)?.fullName ?? id }))} selected={custom.soluteIds} onToggle={(id) => toggleAxis("soluteIds", id)}/></div>
        <div className="form-grid form-grid-4 mt-grid">
          <Field label="Solute counts" value={custom.soluteCounts} onChange={(v) => setCustom({ ...custom, soluteCounts: v })} note="Comma-separated"/>
          <Field label="Temperatures (K)" value={custom.temperaturesK} onChange={(v) => setCustom({ ...custom, temperaturesK: v })}/>
          <Field label="Pressures (bar)" value={custom.pressuresBar} onChange={(v) => setCustom({ ...custom, pressuresBar: v })}/>
          <Field label="Cubic box sizes (nm)" value={custom.boxSizesNm} onChange={(v) => setCustom({ ...custom, boxSizesNm: v })}/>
          <Field label="Replicas" type="number" value={custom.replicas} onChange={(v) => setCustom({ ...custom, replicas: Number(v) })}/>
        </div>
      </Section></TabsContent>
    </Tabs>

    <BoxCompositionCalculator key={`composition-${mode}-${project.selectedChampion?.valueId ?? "none"}-${project.selectedOptimum?.valueId ?? "none"}`} project={project} setProject={setProject} context={mode}/>

    <div className="metrics-row">
      <Metric label="Unique systems" value={uniqueSystems}/><Metric label="State points" value={statePoints}/><Metric label="Replicas" value={mode === "custom" ? custom.replicas : protocol.replicas}/><Metric label="Total runs" value={previewResult.requested} tone={preview.length > 1000 ? "warning" : "accent"}/><Metric label="Aggregate production" value={`${productionTotal.toLocaleString()} ns`} detail="No wall-time estimate"/>
    </div>

    <Section title="MDP / manifest validation" kicker={`${manifestErrors.length} error(s) · ${manifestDiagnostics.filter((item) => item.severity === "WARNING").length} warning(s)`}>{manifestDiagnostics.map((diagnostic, index) => <div className={`diagnostic diagnostic-${diagnostic.severity.toLowerCase()}`} key={`${diagnostic.code}-${index}`}><StatusBadge tone={diagnostic.severity === "ERROR" ? "danger" : diagnostic.severity === "WARNING" ? "warning" : "good"}>{diagnostic.severity}</StatusBadge><code>{diagnostic.code}</code><span>{diagnostic.message}</span></div>)}</Section>

    <ProtocolEditor project={project} setProject={setProject}/>
    <InputPreview project={project} runs={preview}/>

    <Section title="Deterministic run manifest" kicker={`${preview.length} planned runs`} actions={<><Button variant="outline" size="sm" disabled={!preview.length} onClick={() => downloadJson("simulation-manifest.json", { projectId: project.projectId, generatedAt: new Date().toISOString(), runs: preview })}><Download/>JSON</Button><Button variant="outline" size="sm" disabled={!preview.length} onClick={() => downloadText("simulation-manifest.csv", runsCsv(preview), "text/csv")}><Download/>CSV</Button><Button size="sm" disabled={!preview.length || manifestErrors.length > 0} onClick={() => downloadBlob(`${project.projectAbbreviation.toLowerCase()}-gromacs-project.zip`, exportProjectZip(project, preview))}><Archive/>MDP Planning ZIP</Button></>}>
      {!preview.length ? <p className="quiet-row">No valid runs. Complete the required upstream selection or custom dimensions.</p> : <div className="table-scroll"><Table className="dense-table min-w-[1350px]"><TableHeader><TableRow><TableHead>Run ID</TableHead><TableHead>Stage</TableHead><TableHead>DES</TableHead><TableHead>Solute</TableHead><TableHead>N</TableHead><TableHead>xᵢ</TableHead><TableHead>Composition</TableHead><TableHead>Target ρ</TableHead><TableHead>Estimated ρ</TableHead><TableHead>T / K</TableHead><TableHead>P / bar</TableHead><TableHead>Box / nm</TableHead><TableHead>Replica</TableHead><TableHead>Seed</TableHead></TableRow></TableHeader><TableBody>{preview.slice(0, 150).map((r) => { const box = r.compositionCalculation?.boxDimensionsNm; const hasCompositionError = r.compositionDiagnostics.some((item) => item.severity === "ERROR"); return <TableRow key={r.runId}><TableCell><code>{r.runId}</code></TableCell><TableCell>{r.stage}</TableCell><TableCell>{r.desName}</TableCell><TableCell>{r.soluteName}</TableCell><TableCell>{r.soluteCount}</TableCell><TableCell>{r.moleFraction === null ? <StatusBadge tone="warning">composition required</StatusBadge> : r.moleFraction.toFixed(6)}</TableCell><TableCell><StatusBadge tone={hasCompositionError ? "danger" : r.compositionDiagnostics.some((item) => item.severity === "WARNING") ? "warning" : "good"}>{hasCompositionError ? "unresolved" : r.compositionCalculation?.mode ?? "unresolved"}</StatusBadge></TableCell><TableCell>{r.compositionCalculation?.targetDensityGcm3?.toFixed(5) ?? "—"}</TableCell><TableCell>{r.compositionCalculation?.estimatedDensityGcm3?.toFixed(5) ?? "—"}</TableCell><TableCell>{r.temperatureK}</TableCell><TableCell>{r.pressureBar}</TableCell><TableCell>{box ? `${box.x} × ${box.y} × ${box.z}` : "—"}</TableCell><TableCell>R{String(r.replica).padStart(2, "0")}</TableCell><TableCell>{r.randomSeed}</TableCell></TableRow> })}</TableBody></Table></div>}
      {preview.length > 150 && <p className="table-note">Showing first 150 rows. Exports contain all {preview.length} runs.</p>}
    </Section>
  </>
}

function InputPreview({ project, runs }: { project: ProjectState; runs: RunRecord[] }) {
  const [runId, setRunId] = useState("")
  const [kind, setKind] = useState<"em" | "nvt" | "npt" | "prod" | "commands">("prod")

  const run = runs.find((r) => r.runId === runId) ?? runs[0]
  if (!run) return <Section title="Generated input review" kicker="MDP / COMMANDS"><p className="quiet-row">Generate a valid run matrix to inspect input files.</p></Section>
  const generated = kind === "em" ? emMdp(project, run) : kind === "nvt" ? nvtMdp(project, run) : kind === "npt" ? nptMdp(project, run) : kind === "prod" ? prodMdp(project, run) : commands(run)
  const text = generated
  const filename = kind === "commands" ? "commands.sh" : `${kind}.mdp`
  const diagnostics = kind === "commands" ? [] : validateMdp(text, kind, { temperatureK: run.temperatureK, pressureBar: run.pressureBar, durationNs: kind === "nvt" ? project.protocol.nvt.durationNs : kind === "npt" ? project.protocol.npt.durationNs : kind === "prod" ? run.productionNs : undefined })
  const hasErrors = diagnostics.some((diagnostic) => diagnostic.severity === "ERROR")
  return <Section title="Generated input review" kicker="Resolved protocol artifact" actions={<Button variant="outline" size="sm" disabled={hasErrors} onClick={() => downloadText(`${run.runId}-${filename}`, text)}><Download/>Download reviewed file</Button>}>
    <div className="input-review-bar"><div className="field-stack"><Label>Run</Label><Select value={run.runId} onValueChange={setRunId}><SelectTrigger aria-label="Input preview run"><SelectValue/></SelectTrigger><SelectContent>{runs.slice(0, 200).map((r) => <SelectItem key={r.runId} value={r.runId}>{r.runId}</SelectItem>)}</SelectContent></Select></div><div className="field-stack"><Label>File</Label><Select value={kind} onValueChange={(v) => setKind(v as typeof kind)}><SelectTrigger aria-label="Input preview file"><SelectValue/></SelectTrigger><SelectContent><SelectItem value="em">em.mdp</SelectItem><SelectItem value="nvt">nvt.mdp</SelectItem><SelectItem value="npt">npt.mdp</SelectItem><SelectItem value="prod">prod.mdp</SelectItem><SelectItem value="commands">commands.sh</SelectItem></SelectContent></Select></div><StatusBadge tone="good">resolved input</StatusBadge></div>
    <div className="code-editor"><div><span>{run.runId}/{filename}</span><small>Review topology paths, groups, coupling, and scientific settings.</small></div><Textarea value={text} readOnly aria-label="Resolved input file" rows={17} spellCheck={false}/></div>
    {diagnostics.map((diagnostic, index) => <div className={`diagnostic diagnostic-${diagnostic.severity.toLowerCase()}`} key={`${diagnostic.code}-${index}`}><StatusBadge tone={diagnostic.severity === "ERROR" ? "danger" : diagnostic.severity === "WARNING" ? "warning" : "good"}>{diagnostic.severity}</StatusBadge><code>{diagnostic.code}</code><span>{diagnostic.message}{diagnostic.line ? ` · line ${diagnostic.line}` : ""}</span></div>)}
    <p className="table-note">Edit the persistent MDP overrides in the protocol editor, then generate a new run revision. Preview, download and package use the identical resolved directives.</p>
  </Section>
}

function AxisSummary({ label, values }: { label: string; values: string[] }) { return <div className="axis-summary"><Label>{label}</Label><div>{values.map((v) => <span key={v}>{v}</span>)}</div></div> }
function AxisPicker({ title, items, selected, onToggle }: { title: string; items: Array<{ id: string; label: string }>; selected: string[]; onToggle: (id: string) => void }) { return <div className="axis-picker"><Label>{title}</Label>{items.map((item) => <label key={item.id}><Checkbox checked={selected.includes(item.id)} onCheckedChange={() => onToggle(item.id)}/>{item.label}</label>)}</div> }

function EditableSeries({ project, setProject, type }: { project: ProjectState; setProject: (p: ProjectState) => void; type: "concentration" | "temperature" }) {
  if (type === "temperature") return <div className="series-editor">{project.temperaturesK.map((t, i) => <div key={`${t}-${i}`}><span>{i + 1}</span><Input type="number" step="0.01" value={t} onChange={(e) => { const ts = [...project.temperaturesK]; ts[i] = Number(e.target.value); setProject({ ...project, temperaturesK: ts }) }}/><small>K / {(t - 273.15).toFixed(2)} °C</small><Button variant="ghost" size="icon-sm" onClick={() => setProject({ ...project, temperaturesK: project.temperaturesK.filter((_, j) => j !== i) })}><Trash2/></Button><div className="reorder"><Button variant="ghost" size="icon-sm" disabled={!i} onClick={() => { const ts = [...project.temperaturesK]; [ts[i - 1], ts[i]] = [ts[i], ts[i - 1]]; setProject({ ...project, temperaturesK: ts }) }}><ChevronUp/></Button><Button variant="ghost" size="icon-sm" disabled={i === project.temperaturesK.length - 1} onClick={() => { const ts = [...project.temperaturesK]; [ts[i + 1], ts[i]] = [ts[i], ts[i + 1]]; setProject({ ...project, temperaturesK: ts }) }}><ChevronDown/></Button></div></div>)}</div>
  return <div className="series-editor concentration-series">{project.concentrations.map((c, i) => <div key={c.id}><span>{i + 1}</span><Input type="number" min="0" value={c.soluteCount} onChange={(e) => setProject({ ...project, concentrations: project.concentrations.map((x) => x.id === c.id ? { ...x, soluteCount: Number(e.target.value) } : x) })}/><Input value={c.label} onChange={(e) => setProject({ ...project, concentrations: project.concentrations.map((x) => x.id === c.id ? { ...x, label: e.target.value } : x) })}/><Button variant="ghost" size="icon-sm" onClick={() => setProject({ ...project, concentrations: project.concentrations.filter((x) => x.id !== c.id) })}><Trash2/></Button></div>)}</div>
}
