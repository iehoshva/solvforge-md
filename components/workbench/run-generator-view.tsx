"use client"

import { useMemo, useState } from "react"
import { Archive, ChevronDown, ChevronUp, Download, Plus, RefreshCw, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import type { ProjectState, RunRecord } from "@/lib/workbench/types"
import { newId } from "@/lib/workbench/preset"
import { commands, emMdp, generateCustomRuns, generateStageRuns, nptMdp, nvtMdp, prodMdp, type CustomAxes } from "@/lib/workbench/runs"
import { validateMdp, validateRunIds } from "@/lib/workbench/mdp"
import { downloadBlob, downloadJson, downloadText, exportProjectZip, runsCsv } from "@/lib/workbench/export"
import { BoxCompositionCalculator } from "./box-composition-calculator"
import { Field, InlineWarning, Metric, Section, StatusBadge, TextField, ViewHeader } from "./shared"

const parseNums = (text: string) => text.split(/[,;\s]+/).map(Number).filter(Number.isFinite)

export function RunGeneratorView({ project, setProject, setActiveRuns }: { project: ProjectState; setProject: (p: ProjectState) => void; activeRuns: RunRecord[]; setActiveRuns: (r: RunRecord[]) => void }) {
  const [mode, setMode] = useState<"A" | "B" | "C" | "custom">("A")
  const [custom, setCustom] = useState<CustomAxes>({ desIds: project.desSystems.map((d) => d.id).slice(0, 1), soluteIds: project.soluteIds.slice(0, 1), soluteCounts: [1], temperaturesK: [323.15], pressuresBar: [1], boxSizesNm: [5], replicas: project.protocol.replicas })
  const preview = useMemo(() => mode === "custom" ? generateCustomRuns(project, custom) : generateStageRuns(project, mode), [project, mode, custom])
  const manifestDiagnostics = useMemo(() => {
    const diagnostics = validateRunIds(preview)
    for (const run of preview) {
      diagnostics.push(...run.compositionDiagnostics.map((item) => ({ ...item, code: `${item.code}:${run.desAbbreviation}:${run.soluteAbbreviation}:N${run.soluteCount}:${run.temperatureK}K`, message: `${run.desName} / ${run.soluteName}, N=${run.soluteCount}, ${run.temperatureK} K — ${item.message}` })))
      diagnostics.push(...validateMdp(emMdp(project), "em"), ...validateMdp(nvtMdp(project, run), "nvt", { temperatureK: run.temperatureK, durationNs: project.protocol.nvt.durationNs }), ...validateMdp(nptMdp(project, run), "npt", { temperatureK: run.temperatureK, pressureBar: run.pressureBar, durationNs: project.protocol.npt.durationNs }), ...validateMdp(prodMdp(project, run), "prod", { temperatureK: run.temperatureK, pressureBar: run.pressureBar, durationNs: run.productionNs }))
    }
    return diagnostics.filter((diagnostic, index, all) => all.findIndex((other) => other.severity === diagnostic.severity && other.code === diagnostic.code && other.message === diagnostic.message) === index)
  }, [preview, project])
  const manifestErrors = manifestDiagnostics.filter((diagnostic) => diagnostic.severity === "ERROR")
  const productionTotal = preview.reduce((sum, r) => sum + r.productionNs, 0)
  const uniqueSystems = new Set(preview.map((r) => `${r.desId}|${r.soluteId}|${r.soluteCount}`)).size
  const statePoints = new Set(preview.map((r) => `${r.desId}|${r.soluteId}|${r.soluteCount}|${r.temperatureK}|${r.pressureBar}|${r.box.x}`)).size
  const protocol = project.protocol
  const generate = () => {
    if (preview.length > 1000 && !window.confirm(`Generate ${preview.length} run records? This is a very large matrix.`)) return
    setActiveRuns(preview)
  }
  const toggleAxis = (key: "desIds" | "soluteIds", value: string) => setCustom({ ...custom, [key]: custom[key].includes(value) ? custom[key].filter((id) => id !== value) : [...custom[key], value] })
  return <>
    <ViewHeader eyebrow="Run design / generator" title="Hierarchical GROMACS run planning" description="Generate editable inputs and deterministic metadata without executing GROMACS." actions={<><Button variant="outline" size="sm" onClick={() => setActiveRuns(preview)}><RefreshCw/>Refresh manifest</Button><Button size="sm" disabled={!preview.length} onClick={generate}>Generate {preview.length} runs</Button></>}/>
    <InlineWarning title="Research settings, not universal recommendations">Simulation parameters are user-defined research settings and are not guaranteed to be scientifically optimal for every molecular system.</InlineWarning>

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
          <Field label="Solute counts" value={custom.soluteCounts.join(", ")} onChange={(v) => setCustom({ ...custom, soluteCounts: parseNums(v) })} note="Comma-separated"/>
          <Field label="Temperatures (K)" value={custom.temperaturesK.join(", ")} onChange={(v) => setCustom({ ...custom, temperaturesK: parseNums(v) })}/>
          <Field label="Pressures (bar)" value={custom.pressuresBar.join(", ")} onChange={(v) => setCustom({ ...custom, pressuresBar: parseNums(v) })}/>
          <Field label="Cubic box sizes (nm)" value={custom.boxSizesNm.join(", ")} onChange={(v) => setCustom({ ...custom, boxSizesNm: parseNums(v) })}/>
          <Field label="Replicas" type="number" value={custom.replicas} onChange={(v) => setCustom({ ...custom, replicas: Math.max(1, Number(v)) })}/>
        </div>
      </Section></TabsContent>
    </Tabs>

    <BoxCompositionCalculator key={`composition-${mode}-${project.selectedChampion?.valueId ?? "none"}-${project.selectedOptimum?.valueId ?? "none"}`} project={project} setProject={setProject} context={mode}/>

    <div className="metrics-row">
      <Metric label="Unique systems" value={uniqueSystems}/><Metric label="State points" value={statePoints}/><Metric label="Replicas" value={mode === "custom" ? custom.replicas : protocol.replicas}/><Metric label="Total runs" value={preview.length} tone={preview.length > 1000 ? "warning" : "accent"}/><Metric label="Aggregate production" value={`${productionTotal.toLocaleString()} ns`} detail="No wall-time estimate"/>
    </div>

    <Section title="MDP / manifest validation" kicker={`${manifestErrors.length} error(s) · ${manifestDiagnostics.filter((item) => item.severity === "WARNING").length} warning(s)`}>{manifestDiagnostics.map((diagnostic, index) => <div className={`diagnostic diagnostic-${diagnostic.severity.toLowerCase()}`} key={`${diagnostic.code}-${index}`}><StatusBadge tone={diagnostic.severity === "ERROR" ? "danger" : diagnostic.severity === "WARNING" ? "warning" : "good"}>{diagnostic.severity}</StatusBadge><code>{diagnostic.code}</code><span>{diagnostic.message}</span></div>)}</Section>

    <ProtocolEditor project={project} setProject={setProject}/>
    <InputPreview project={project} runs={preview}/>

    <Section title="Deterministic run manifest" kicker={`${preview.length} planned runs`} actions={<><Button variant="outline" size="sm" disabled={!preview.length} onClick={() => downloadJson("simulation-manifest.json", { projectId: project.projectId, generatedAt: new Date().toISOString(), runs: preview })}><Download/>JSON</Button><Button variant="outline" size="sm" disabled={!preview.length} onClick={() => downloadText("simulation-manifest.csv", runsCsv(preview), "text/csv")}><Download/>CSV</Button><Button size="sm" disabled={!preview.length || manifestErrors.length > 0} onClick={() => downloadBlob(`${project.projectAbbreviation.toLowerCase()}-gromacs-project.zip`, exportProjectZip(project, preview))}><Archive/>Complete ZIP</Button></>}>
      {!preview.length ? <p className="quiet-row">No valid runs. Complete the required upstream selection or custom dimensions.</p> : <div className="table-scroll"><Table className="dense-table min-w-[1350px]"><TableHeader><TableRow><TableHead>Run ID</TableHead><TableHead>Stage</TableHead><TableHead>DES</TableHead><TableHead>Solute</TableHead><TableHead>N</TableHead><TableHead>xᵢ</TableHead><TableHead>Composition</TableHead><TableHead>Target ρ</TableHead><TableHead>Estimated ρ</TableHead><TableHead>T / K</TableHead><TableHead>P / bar</TableHead><TableHead>Box / nm</TableHead><TableHead>Replica</TableHead><TableHead>Seed</TableHead></TableRow></TableHeader><TableBody>{preview.slice(0, 150).map((r) => { const box = r.compositionCalculation?.boxDimensionsNm; const hasCompositionError = r.compositionDiagnostics.some((item) => item.severity === "ERROR"); return <TableRow key={r.runId}><TableCell><code>{r.runId}</code></TableCell><TableCell>{r.stage}</TableCell><TableCell>{r.desName}</TableCell><TableCell>{r.soluteName}</TableCell><TableCell>{r.soluteCount}</TableCell><TableCell>{r.moleFraction === null ? <StatusBadge tone="warning">composition required</StatusBadge> : r.moleFraction.toFixed(6)}</TableCell><TableCell><StatusBadge tone={hasCompositionError ? "danger" : r.compositionDiagnostics.some((item) => item.severity === "WARNING") ? "warning" : "good"}>{hasCompositionError ? "unresolved" : r.compositionCalculation?.mode ?? "unresolved"}</StatusBadge></TableCell><TableCell>{r.compositionCalculation?.targetDensityGcm3?.toFixed(5) ?? "—"}</TableCell><TableCell>{r.compositionCalculation?.estimatedDensityGcm3?.toFixed(5) ?? "—"}</TableCell><TableCell>{r.temperatureK}</TableCell><TableCell>{r.pressureBar}</TableCell><TableCell>{box ? `${box.x} × ${box.y} × ${box.z}` : "—"}</TableCell><TableCell>R{String(r.replica).padStart(2, "0")}</TableCell><TableCell>{r.randomSeed}</TableCell></TableRow> })}</TableBody></Table></div>}
      {preview.length > 150 && <p className="table-note">Showing first 150 rows. Exports contain all {preview.length} runs.</p>}
    </Section>
  </>
}

function InputPreview({ project, runs }: { project: ProjectState; runs: RunRecord[] }) {
  const [runId, setRunId] = useState("")
  const [kind, setKind] = useState<"em" | "nvt" | "npt" | "prod" | "commands">("prod")
  const [overrides, setOverrides] = useState<Record<string, string>>({})
  const run = runs.find((r) => r.runId === runId) ?? runs[0]
  if (!run) return <Section title="Generated input review" kicker="MDP / COMMANDS"><p className="quiet-row">Generate a valid run matrix to inspect input files.</p></Section>
  const generated = kind === "em" ? emMdp(project) : kind === "nvt" ? nvtMdp(project, run) : kind === "npt" ? nptMdp(project, run) : kind === "prod" ? prodMdp(project, run) : commands(run)
  const key = `${run.runId}:${kind}`
  const text = overrides[key] ?? generated
  const filename = kind === "commands" ? "commands.sh" : `${kind}.mdp`
  const diagnostics = kind === "commands" ? [] : validateMdp(text, kind, { temperatureK: run.temperatureK, pressureBar: run.pressureBar, durationNs: kind === "nvt" ? project.protocol.nvt.durationNs : kind === "npt" ? project.protocol.npt.durationNs : kind === "prod" ? run.productionNs : undefined })
  const hasErrors = diagnostics.some((diagnostic) => diagnostic.severity === "ERROR")
  return <Section title="Generated input review" kicker="Editable before individual export" actions={<Button variant="outline" size="sm" disabled={hasErrors} onClick={() => downloadText(`${run.runId}-${filename}`, text)}><Download/>Download reviewed file</Button>}>
    <div className="input-review-bar"><div className="field-stack"><Label>Run</Label><Select value={run.runId} onValueChange={setRunId}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent>{runs.slice(0, 200).map((r) => <SelectItem key={r.runId} value={r.runId}>{r.runId}</SelectItem>)}</SelectContent></Select></div><div className="field-stack"><Label>File</Label><Select value={kind} onValueChange={(v) => setKind(v as typeof kind)}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent><SelectItem value="em">em.mdp</SelectItem><SelectItem value="nvt">nvt.mdp</SelectItem><SelectItem value="npt">npt.mdp</SelectItem><SelectItem value="prod">prod.mdp</SelectItem><SelectItem value="commands">commands.sh</SelectItem></SelectContent></Select></div><StatusBadge tone={overrides[key] !== undefined ? "warning" : "good"}>{overrides[key] !== undefined ? "local edit" : "generated"}</StatusBadge><Button variant="ghost" size="sm" onClick={() => { const next = { ...overrides }; delete next[key]; setOverrides(next) }}>Reset file</Button></div>
    <div className="code-editor"><div><span>{run.runId}/{filename}</span><small>Review topology paths, groups, coupling, and scientific settings.</small></div><Textarea value={text} onChange={(e) => setOverrides({ ...overrides, [key]: e.target.value })} rows={17} spellCheck={false}/></div>
    {diagnostics.map((diagnostic, index) => <div className={`diagnostic diagnostic-${diagnostic.severity.toLowerCase()}`} key={`${diagnostic.code}-${index}`}><StatusBadge tone={diagnostic.severity === "ERROR" ? "danger" : diagnostic.severity === "WARNING" ? "warning" : "good"}>{diagnostic.severity}</StatusBadge><code>{diagnostic.code}</code><span>{diagnostic.message}{diagnostic.line ? ` · line ${diagnostic.line}` : ""}</span></div>)}
    <p className="table-note">Individual reviewed-file edits are downloaded directly. The complete ZIP is deterministically regenerated from the structured protocol so state-point temperatures and metadata remain consistent.</p>
  </Section>
}

function AxisSummary({ label, values }: { label: string; values: string[] }) { return <div className="axis-summary"><Label>{label}</Label><div>{values.map((v) => <span key={v}>{v}</span>)}</div></div> }
function AxisPicker({ title, items, selected, onToggle }: { title: string; items: Array<{ id: string; label: string }>; selected: string[]; onToggle: (id: string) => void }) { return <div className="axis-picker"><Label>{title}</Label>{items.map((item) => <label key={item.id}><Checkbox checked={selected.includes(item.id)} onCheckedChange={() => onToggle(item.id)}/>{item.label}</label>)}</div> }

function EditableSeries({ project, setProject, type }: { project: ProjectState; setProject: (p: ProjectState) => void; type: "concentration" | "temperature" }) {
  if (type === "temperature") return <div className="series-editor">{project.temperaturesK.map((t, i) => <div key={`${t}-${i}`}><span>{i + 1}</span><Input type="number" step="0.01" value={t} onChange={(e) => { const ts = [...project.temperaturesK]; ts[i] = Number(e.target.value); setProject({ ...project, temperaturesK: ts }) }}/><small>K / {(t - 273.15).toFixed(2)} °C</small><Button variant="ghost" size="icon-sm" onClick={() => setProject({ ...project, temperaturesK: project.temperaturesK.filter((_, j) => j !== i) })}><Trash2/></Button><div className="reorder"><Button variant="ghost" size="icon-sm" disabled={!i} onClick={() => { const ts = [...project.temperaturesK]; [ts[i - 1], ts[i]] = [ts[i], ts[i - 1]]; setProject({ ...project, temperaturesK: ts }) }}><ChevronUp/></Button><Button variant="ghost" size="icon-sm" disabled={i === project.temperaturesK.length - 1} onClick={() => { const ts = [...project.temperaturesK]; [ts[i + 1], ts[i]] = [ts[i], ts[i + 1]]; setProject({ ...project, temperaturesK: ts }) }}><ChevronDown/></Button></div></div>)}</div>
  return <div className="series-editor concentration-series">{project.concentrations.map((c, i) => <div key={c.id}><span>{i + 1}</span><Input type="number" min="0" value={c.soluteCount} onChange={(e) => setProject({ ...project, concentrations: project.concentrations.map((x) => x.id === c.id ? { ...x, soluteCount: Number(e.target.value) } : x) })}/><Input value={c.label} onChange={(e) => setProject({ ...project, concentrations: project.concentrations.map((x) => x.id === c.id ? { ...x, label: e.target.value } : x) })}/><Button variant="ghost" size="icon-sm" onClick={() => setProject({ ...project, concentrations: project.concentrations.filter((x) => x.id !== c.id) })}><Trash2/></Button></div>)}</div>
}

function ProtocolEditor({ project, setProject }: { project: ProjectState; setProject: (p: ProjectState) => void }) {
  const p = project.protocol
  const set = (next: ProjectState["protocol"]) => setProject({ ...project, protocol: next })
  return <Section title="Simulation protocol" kicker={p.name}>
    <Tabs defaultValue="system"><TabsList variant="line"><TabsTrigger value="system">System</TabsTrigger><TabsTrigger value="equil">EM / equilibration</TabsTrigger><TabsTrigger value="production">Production</TabsTrigger><TabsTrigger value="nonbonded">Nonbonded</TabsTrigger><TabsTrigger value="directives">MDP directives</TabsTrigger><TabsTrigger value="naming">Run naming</TabsTrigger></TabsList>
      <TabsContent value="system"><div className="form-grid form-grid-4">
        <Field label="Protocol name" value={p.name} onChange={(v) => set({ ...p, name: v })}/><Field label="Force field" value={p.forceField} onChange={(v) => set({ ...p, forceField: v })}/><Field label="Partial-charge scheme" value={p.chargeScheme} onChange={(v) => set({ ...p, chargeScheme: v })}/><Field label="Pressure (bar)" type="number" step="0.1" value={p.pressureBar} onChange={(v) => set({ ...p, pressureBar: Number(v) })}/><Field label={`Box X (${p.box.unit === "angstrom" ? "Å" : "nm"})`} type="number" step="0.1" value={p.box.x} onChange={(v) => set({ ...p, box: { ...p.box, x: Number(v) } })}/><Field label={`Box Y (${p.box.unit === "angstrom" ? "Å" : "nm"})`} type="number" step="0.1" value={p.box.y} onChange={(v) => set({ ...p, box: { ...p.box, y: Number(v) } })}/><Field label={`Box Z (${p.box.unit === "angstrom" ? "Å" : "nm"})`} type="number" step="0.1" value={p.box.z} onChange={(v) => set({ ...p, box: { ...p.box, z: Number(v) } })}/><Field label="Box geometry" value={p.box.geometry} onChange={(v) => set({ ...p, box: { ...p.box, geometry: v } })}/><div className="readout-field"><Label>Box unit</Label><strong>{p.box.unit === "angstrom" ? "ångström (Å)" : "nanometre (nm)"} · change in composition calculator</strong></div><Field label="Replicas" type="number" value={p.replicas} onChange={(v) => set({ ...p, replicas: Math.max(1, Number(v)) })}/><Field label="Random-seed base" type="number" value={p.randomSeedBase} onChange={(v) => set({ ...p, randomSeedBase: Number(v) })}/>
      </div></TabsContent>
      <TabsContent value="equil"><div className="form-grid form-grid-4"><Field label="EM method" value={p.em.method} onChange={(v) => set({ ...p, em: { ...p.em, method: v } })}/><Field label="EM maximum steps" type="number" value={p.em.maxSteps} onChange={(v) => set({ ...p, em: { ...p.em, maxSteps: Number(v) } })}/><Field label="Fmax target (kJ mol⁻¹ nm⁻¹)" type="number" value={p.em.fmax} onChange={(v) => set({ ...p, em: { ...p.em, fmax: Number(v) } })}/><Field label="NVT duration (ns)" type="number" value={p.nvt.durationNs} onChange={(v) => set({ ...p, nvt: { ...p.nvt, durationNs: Number(v) } })}/><Field label="Thermostat" value={p.nvt.thermostat} onChange={(v) => set({ ...p, nvt: { ...p.nvt, thermostat: v } })}/><Field label="τT (ps)" type="number" step="0.01" value={p.nvt.tauTPs} onChange={(v) => set({ ...p, nvt: { ...p.nvt, tauTPs: Number(v) } })}/><Field label="NVT timestep (fs)" type="number" step="0.5" value={p.nvt.timestepFs} onChange={(v) => set({ ...p, nvt: { ...p.nvt, timestepFs: Number(v) } })}/><Field label="NPT duration (ns)" type="number" value={p.npt.durationNs} onChange={(v) => set({ ...p, npt: { ...p.npt, durationNs: Number(v) } })}/><Field label="Barostat" value={p.npt.barostat} onChange={(v) => set({ ...p, npt: { ...p.npt, barostat: v } })}/><Field label="τP (ps)" type="number" step="0.1" value={p.npt.tauPPs} onChange={(v) => set({ ...p, npt: { ...p.npt, tauPPs: Number(v) } })}/><Field label="NPT timestep (fs)" type="number" step="0.5" value={p.npt.timestepFs} onChange={(v) => set({ ...p, npt: { ...p.npt, timestepFs: Number(v) } })}/></div><div className="mt-grid"><TextField label="Equilibration notes" value={p.equilibrationNotes} onChange={(v) => set({ ...p, equilibrationNotes: v })}/></div></TabsContent>
      <TabsContent value="production"><div className="form-grid form-grid-4"><Field label="Pure DES production (ns)" type="number" value={p.production.pureDesNs} onChange={(v) => set({ ...p, production: { ...p.production, pureDesNs: Number(v) } })}/><Field label="Solute production minimum (ns)" type="number" value={p.production.soluteMinNs} onChange={(v) => set({ ...p, production: { ...p.production, soluteMinNs: Number(v) } })}/><Field label="Solute production maximum (ns)" type="number" value={p.production.soluteMaxNs} onChange={(v) => set({ ...p, production: { ...p.production, soluteMaxNs: Number(v) } })}/><Field label="Production timestep (fs)" type="number" step="0.5" value={p.production.timestepFs} onChange={(v) => set({ ...p, production: { ...p.production, timestepFs: Number(v) } })}/><Field label="Trajectory frame interval (ps)" type="number" value={p.production.framePs} onChange={(v) => set({ ...p, production: { ...p.production, framePs: Number(v) } })}/><div className="field-stack"><Label>Duration interpretation</Label><Select value={p.production.exactOrRange} onValueChange={(v) => set({ ...p, production: { ...p.production, exactOrRange: v as "exact" | "range" } })}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent><SelectItem value="exact">Exact duration</SelectItem><SelectItem value="range">Planned range</SelectItem></SelectContent></Select></div></div><div className="mt-grid"><TextField label="Production notes" value={p.productionNotes} onChange={(v) => set({ ...p, productionNotes: v })}/></div></TabsContent>
      <TabsContent value="nonbonded"><div className="form-grid form-grid-4"><Field label="Coulomb method" value={p.nonbonded.coulombMethod} onChange={(v) => set({ ...p, nonbonded: { ...p.nonbonded, coulombMethod: v } })}/><Field label="Cutoff (nm)" type="number" step="0.1" value={p.nonbonded.cutoffNm} onChange={(v) => set({ ...p, nonbonded: { ...p.nonbonded, cutoffNm: Number(v) } })}/><Field label="PME order" type="number" value={p.nonbonded.pmeOrder} onChange={(v) => set({ ...p, nonbonded: { ...p.nonbonded, pmeOrder: Number(v) } })}/><Field label="Fourier spacing (nm)" type="number" step="0.01" value={p.nonbonded.fourierSpacingNm} onChange={(v) => set({ ...p, nonbonded: { ...p.nonbonded, fourierSpacingNm: Number(v) } })}/><Field label="Constraints" value={p.constraints} onChange={(v) => set({ ...p, constraints: v })}/></div></TabsContent>
      <TabsContent value="directives"><InlineWarning title="Researcher-controlled MDP overrides">Directives entered here replace generated directives with the same normalized key and are included in complete ZIP exports. Duplicate entries inside an override block remain validation errors.</InlineWarning><div className="form-grid form-grid-2">{(["em","nvt","npt","prod"] as const).map((kind) => <div className="field-stack" key={kind}><Label>{kind.toUpperCase()} overrides / additional directives</Label><Textarea rows={8} spellCheck={false} placeholder="; one directive per line" value={p.mdpOverrides?.[kind] ?? ""} onChange={(event) => set({ ...p, mdpOverrides: { em: p.mdpOverrides?.em ?? "", nvt: p.mdpOverrides?.nvt ?? "", npt: p.mdpOverrides?.npt ?? "", prod: p.mdpOverrides?.prod ?? "", [kind]: event.target.value } })}/></div>)}</div></TabsContent>
      <TabsContent value="naming"><div className="naming-grid">{Object.entries(project.runNaming).map(([key, enabled]) => <label key={key}><Switch checked={enabled} onCheckedChange={(checked) => setProject({ ...project, runNaming: { ...project.runNaming, [key]: checked } })}/><span>{key.replace(/^include/, "Include ").replace(/([A-Z])/g, " $1").toLowerCase()}</span></label>)}</div><p className="table-note">Readable IDs are labels only. Full names and all state-point metadata remain in each run manifest.</p></TabsContent>
    </Tabs>
  </Section>
}
