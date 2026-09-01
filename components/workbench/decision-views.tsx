"use client"

import { useMemo, useState } from "react"
import { CheckCircle2, FlaskConical, Thermometer } from "lucide-react"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import type { ProjectState, RDFDataset, ScientificState } from "@/lib/workbench/types"
import { moleFraction } from "@/lib/workbench/runs"
import { EmptyEvidence, formatNumber, InlineWarning, Metric, Section, StatusBadge, SvgPlot, ViewHeader } from "./shared"

function evidenceFor(datasets: RDFDataset[], desId: string, soluteNames: string[], soluteCount?: number, temperature?: number) {
  const names = soluteNames.map((s) => s.toLowerCase()).filter(Boolean)
  const matches = datasets.filter((d) => d.analysis && d.metadata.desId === desId && (soluteCount === undefined || d.metadata.soluteCount === soluteCount) && (temperature === undefined || d.metadata.temperatureK === temperature) && (!names.length || names.some((n) => d.metadata.speciesA.toLowerCase().includes(n) || d.metadata.speciesB.toLowerCase().includes(n))))
  const values = matches.map((d) => d.analysis!.estimateNm3)
  const mean = values.length ? values.reduce((a, b) => a + b, 0) / values.length : null
  const stable = matches.length > 0 && matches.every((d) => Math.abs(d.analysis!.plateauSlope) < 0.1)
  return { matches, mean, stable }
}

export function ChampionView({ project, setProject, datasets, scientific }: { project: ProjectState; setProject: (p: ProjectState) => void; datasets: RDFDataset[]; scientific: ScientificState }) {
  const [notes, setNotes] = useState<Record<string, string>>({})
  const choose = (desId: string) => {
    const affected = project.selectedChampion && project.selectedChampion.valueId !== desId
    setProject({ ...project, selectedChampion: { valueId: desId, selectedAt: new Date().toISOString(), rationale: notes[desId] ?? "", supportingAnalysis: datasets.filter((d) => d.metadata.desId === desId && d.analysis).map((d) => d.id) }, selectedOptimum: affected ? null : project.selectedOptimum, overrideLog: affected ? [...project.overrideLog, { timestamp: new Date().toISOString(), action: "Champion changed", note: "Stage B/C selection invalidated for regeneration." }] : project.overrideLog })
  }
  return <>
    <ViewHeader eyebrow="Validation / Stage A" title="Champion screening" description="Compare evidence at the shared state point. The workbench does not collapse scientific judgement into a hidden aggregate score."/>
    <div className="selection-status"><FlaskConical/><div><span>Current champion</span><strong>{project.desSystems.find((d) => d.id === project.selectedChampion?.valueId)?.name ?? "Not selected"}</strong></div><StatusBadge tone={project.selectedChampion ? "good" : "warning"}>{project.selectedChampion ? `selected ${new Date(project.selectedChampion.selectedAt).toLocaleDateString()}` : "researcher decision required"}</StatusBadge></div>
    <Section title="Stage A evidence matrix" kicker={`${project.stageATemperatureK} K · ${project.stageASoluteCount} solute molecule(s) per box`}>
      <div className="table-scroll"><Table className="evidence-table min-w-[1050px]"><TableHeader><TableRow><TableHead>DES candidate</TableHead>{project.soluteIds.map((id) => <TableHead key={id}>{project.molecules.find((m) => m.id === id)?.fullName}</TableHead>)}<TableHead>Validation</TableHead><TableHead>Researcher decision</TableHead></TableRow></TableHeader><TableBody>{project.desSystems.map((des) => {
        const all = evidenceFor(datasets, des.id, [], project.stageASoluteCount, project.stageATemperatureK)
        const acceptedSsm = scientific.ssmFits.filter((fit) => fit.accepted && (fit.stateKey.includes(des.id) || scientific.ssmPoints.some((point) => fit.pointIds.includes(point.id) && point.desId === des.id))).length
        const thermo = scientific.thermodynamicResults.filter((result) => result.desId === des.id).length
        const observables = scientific.observables.filter((record) => record.desId === des.id).length
        return <TableRow key={des.id} data-selected={project.selectedChampion?.valueId === des.id}><TableCell><strong>{des.name}</strong><small>{des.ratio.join(":")} · {des.abbreviation}</small></TableCell>{project.soluteIds.map((soluteId) => { const m = project.molecules.find((x) => x.id === soluteId); const ev = evidenceFor(datasets, des.id, [m?.fullName ?? "", m?.abbreviation ?? ""], project.stageASoluteCount, project.stageATemperatureK); return <TableCell key={soluteId}>{ev.mean === null ? <StatusBadge>no KBI</StatusBadge> : <><strong>{formatNumber(ev.mean)} nm³</strong><small>{ev.matches.length} dataset(s)</small></>}</TableCell> })}<TableCell><div className="status-stack"><StatusBadge tone={all.matches.length ? (all.stable ? "good" : "warning") : "neutral"}>{all.matches.length ? (all.stable ? "plateau stable" : "review plateau") : "KBI missing"}</StatusBadge><StatusBadge tone={acceptedSsm ? "good" : "neutral"}>SSM {acceptedSsm ? `${acceptedSsm} accepted` : "missing"}</StatusBadge><StatusBadge tone={thermo ? "good" : "neutral"}>Γ states {thermo}</StatusBadge><StatusBadge tone={observables ? "good" : "neutral"}>observables {observables}</StatusBadge><StatusBadge>replicas {all.matches.length}</StatusBadge></div></TableCell><TableCell><Textarea value={notes[des.id] ?? ""} onChange={(e) => setNotes({ ...notes, [des.id]: e.target.value })} placeholder="Scientific rationale…"/><DecisionButton title={`Set ${des.name} as champion?`} description={project.selectedChampion && project.selectedChampion.valueId !== des.id ? "Changing the champion clears the existing optimum-concentration decision. Stage B/C runs may need regeneration." : "This records an explicit researcher decision and the linked analysis IDs."} label={project.selectedChampion?.valueId === des.id ? "Champion selected" : "Set as Champion"} selected={project.selectedChampion?.valueId === des.id} onConfirm={() => choose(des.id)}/></TableCell></TableRow>
      })}</TableBody></Table></div>
      {!datasets.some((d) => d.analysis) && <EmptyEvidence text="No validated Stage A analyses imported"/>}
    </Section>
    <InlineWarning title="Pareto interpretation">Prefer candidates that remain defensible across target selectivity, uncertainty, replica consistency, structural evidence, transport properties, and finite-size checks. Missing properties are shown as missing, never treated as zero.</InlineWarning>
  </>
}

export function ConcentrationView({ project, setProject, datasets, scientific }: { project: ProjectState; setProject: (p: ProjectState) => void; datasets: RDFDataset[]; scientific: ScientificState }) {
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [comparisonSoluteId, setComparisonSoluteId] = useState(project.soluteIds[0] ?? "")
  const champion = project.desSystems.find((d) => d.id === project.selectedChampion?.valueId)
  const comparisonSolute = project.molecules.find((molecule) => molecule.id === comparisonSoluteId)
  const rows = useMemo(() => project.concentrations.map((c) => {
    const names = comparisonSolute ? [comparisonSolute.fullName, comparisonSolute.abbreviation] : []
    const ev = champion ? evidenceFor(datasets, champion.id, names, c.soluteCount, project.stageBTemperatureK) : { matches: [], mean: null, stable: false }
    const x = champion ? moleFraction(project, champion.id, c.soluteCount, comparisonSoluteId, project.stageBTemperatureK) : null
    const thermo = scientific.thermodynamicResults.find((result) => result.desId === champion?.id && result.soluteId === comparisonSoluteId && result.concentrationId === c.id)
    const activity = scientific.activityResults.find((result) => result.desId === champion?.id && result.soluteId === comparisonSoluteId)
    const activityPoint = x === null ? null : activity?.points.find((point) => Math.abs(point.x - x) < 1e-9)
    return { ...c, x, thermo, activityPoint, ...ev }
  }), [project, datasets, champion, comparisonSoluteId, comparisonSolute, scientific])
  const plottable = rows.filter((r) => r.x !== null && r.mean !== null)
  const choose = (id: string) => setProject({ ...project, selectedOptimum: { valueId: id, selectedAt: new Date().toISOString(), rationale: notes[id] ?? "", supportingAnalysis: rows.find((r) => r.id === id)?.matches.map((d) => d.id) ?? [] } })
  return <>
    <ViewHeader eyebrow="Validation / Stage B" title="Concentration optimization" description="Nominal loading and calculated composition remain separate. ‘Optimum’ is an explicit multi-property research decision."/>
    <div className="selection-status"><FlaskConical/><div><span>Champion DES</span><strong>{champion?.name ?? "Not selected"}</strong></div><StatusBadge tone={champion ? "good" : "warning"}>{champion ? `${project.stageBTemperatureK} K` : "Stage A decision required"}</StatusBadge></div>
    {!champion ? <Section title="Stage B unavailable" kicker="Hierarchy enforced"><EmptyEvidence text="Select a champion DES first"/></Section> : <>
      <Section title="Comparison composition basis" kicker="Solute-specific physical composition"><div className="form-grid form-grid-2"><div className="field-stack"><Label>Solute</Label><Select value={comparisonSoluteId} onValueChange={setComparisonSoluteId}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent>{project.soluteIds.map((id) => <SelectItem key={id} value={id}>{project.molecules.find((molecule) => molecule.id === id)?.fullName}</SelectItem>)}</SelectContent></Select></div><div className="readout-field"><Label>Interpretation</Label><strong>Nominal N and calculated x are reported separately</strong></div></div></Section>
      <Section title="Loading series" kicker={`${rows.length} editable conditions`}><div className="table-scroll"><Table className="evidence-table"><TableHeader><TableRow><TableHead>Nominal loading</TableHead><TableHead>x {comparisonSolute?.abbreviation ?? "solute"} from full box</TableHead><TableHead>KBI / nm³</TableHead><TableHead>Γ</TableHead><TableHead>γ</TableHead><TableHead>Validation</TableHead><TableHead>Decision</TableHead></TableRow></TableHeader><TableBody>{rows.map((row) => <TableRow key={row.id} data-selected={project.selectedOptimum?.valueId === row.id}><TableCell><strong>{row.soluteCount}</strong><small>{row.label}</small></TableCell><TableCell>{row.x === null ? <StatusBadge tone="warning">composition required</StatusBadge> : row.x.toFixed(7)}</TableCell><TableCell>{row.mean === null ? "—" : `${formatNumber(row.mean)} (${row.matches.length})`}</TableCell><TableCell>{row.thermo ? formatNumber(row.thermo.fixedDesRatioSoluteGamma, 6) : "—"}</TableCell><TableCell>{row.activityPoint ? formatNumber(row.activityPoint.gammaAbsolute ?? row.activityPoint.gammaRelative, 6) : "—"}</TableCell><TableCell><div className="status-stack"><StatusBadge tone={row.matches.length ? (row.stable ? "good" : "warning") : "neutral"}>{row.matches.length ? (row.stable ? "plateau stable" : "review") : "missing"}</StatusBadge><StatusBadge tone={row.thermo && row.thermo.conditionNumber <= project.analysisDefaults.matrixConditionLimit ? "good" : "warning"}>{row.thermo ? `cond ${row.thermo.conditionNumber.toExponential(2)}` : "KB matrix missing"}</StatusBadge></div></TableCell><TableCell><Textarea value={notes[row.id] ?? ""} onChange={(e) => setNotes({ ...notes, [row.id]: e.target.value })} placeholder="Why this loading?"/><DecisionButton title={`Set ${row.label} as optimum concentration?`} description="The workbench will use this loading to generate Stage C. It does not assume that the lowest activity coefficient is automatically optimal." label={project.selectedOptimum?.valueId === row.id ? "Optimum selected" : "Set as Optimum Concentration"} selected={project.selectedOptimum?.valueId === row.id} onConfirm={() => choose(row.id)}/></TableCell></TableRow>)}</TableBody></Table></div></Section>
      <div className="plot-grid"><Section title="KBI vs composition" kicker="AVAILABLE DATA">{plottable.length >= 2 ? <SvgPlot x={plottable.map((r) => r.x!)} y={plottable.map((r) => r.mean!)} xLabel="solute mole fraction, xᵢ" yLabel="KBI / nm³"/> : <EmptyEvidence text="At least two mapped composition points required"/>}</Section><Section title="Γ and γ vs composition" kicker="CALCULATED DATA">{rows.filter((row) => row.x !== null && row.thermo).length >= 2 ? <SvgPlot x={rows.filter((row) => row.x !== null && row.thermo).map((row) => row.x!)} y={rows.filter((row) => row.x !== null && row.thermo).map((row) => row.thermo!.fixedDesRatioSoluteGamma)} xLabel="solute mole fraction, xᵢ" yLabel="Γᵢ"/> : <EmptyEvidence text="At least two complete KB matrices are required for Γ(x)"/>}</Section></div>
    </>}
  </>
}

export function TemperatureView({ project, datasets, scientific }: { project: ProjectState; datasets: RDFDataset[]; scientific: ScientificState }) {
  const champion = project.desSystems.find((d) => d.id === project.selectedChampion?.valueId)
  const optimum = project.concentrations.find((c) => c.id === project.selectedOptimum?.valueId)
  const points = champion && optimum ? project.temperaturesK.map((t) => ({ t, thermo: scientific.thermodynamicResults.find((result) => result.desId === champion.id && result.concentrationId === optimum.id && result.stateKey.endsWith(`|${t}K`)), activity: scientific.activityResults.find((result) => result.desId === champion.id && result.temperatureK === t), observables: scientific.observables.filter((record) => record.desId === champion.id && record.soluteCount === optimum.soluteCount && record.temperatureK === t), ...evidenceFor(datasets, champion.id, [], optimum.soluteCount, t) })) : []
  const available = points.filter((p) => p.mean !== null)
  return <>
    <ViewHeader eyebrow="Characterization / Stage C" title="Temperature characterization" description="One selected DES and one selected loading across an arbitrary temperature series—never an implicit full factorial."/>
    <div className="selection-status"><Thermometer/><div><span>Characterization state</span><strong>{champion?.name ?? "—"} · {optimum?.label ?? "—"}</strong></div><StatusBadge tone={champion && optimum ? "good" : "warning"}>{champion && optimum ? `${project.temperaturesK.length} temperatures` : "upstream decisions required"}</StatusBadge></div>
    {!champion || !optimum ? <Section title="Stage C unavailable" kicker="Hierarchy enforced"><EmptyEvidence text="Champion DES and optimum concentration are required"/></Section> : <>
      <div className="metrics-row">{points.map((p) => <Metric key={p.t} label={`${p.t} K / ${(p.t - 273.15).toFixed(2)} °C`} value={p.mean === null ? "—" : `${formatNumber(p.mean)} nm³`} detail={p.matches.length ? `${p.matches.length} dataset(s)` : "insufficient evidence"} tone={p.stable ? "good" : p.matches.length ? "warning" : "neutral"}/>)}</div>
      <div className="plot-grid"><Section title="KBI vs temperature" kicker="THERMODYNAMIC CHARACTERIZATION">{available.length >= 2 ? <SvgPlot x={available.map((p) => p.t)} y={available.map((p) => p.mean!)} xLabel="Temperature / K" yLabel="KBI / nm³"/> : <EmptyEvidence text="At least two mapped temperatures required"/>}</Section><Section title="Γ vs temperature" kicker="COMPLETE KB MATRICES">{points.filter((point) => point.thermo).length >= 2 ? <SvgPlot x={points.filter((point) => point.thermo).map((point) => point.t)} y={points.filter((point) => point.thermo).map((point) => point.thermo!.fixedDesRatioSoluteGamma)} xLabel="Temperature / K" yLabel="Γᵢ"/> : <EmptyEvidence text="At least two temperature-resolved thermodynamic results required"/>}</Section></div><Section title="Imported observables by temperature" kicker="MECHANISTIC INTERPRETATION"><div className="observable-grid">{points.flatMap((point) => point.observables.map((record) => <div key={record.id}><span>{point.t} K · {record.type}</span><StatusBadge tone="good">{formatNumber(record.value)} {record.unit}</StatusBadge></div>))}{!points.some((point) => point.observables.length) && <div><span>Density / diffusion / viscosity / structure</span><StatusBadge>not imported</StatusBadge></div>}</div></Section>
      <InlineWarning title="Convergence remains state-point specific">A trend line is not evidence that every temperature converged. Inspect replicas, block stability, and finite-size status separately.</InlineWarning>
    </>}
  </>
}

function DecisionButton({ title, description, label, selected, onConfirm }: { title: string; description: string; label: string; selected: boolean; onConfirm: () => void }) {
  return <AlertDialog><AlertDialogTrigger asChild><Button size="sm" variant={selected ? "outline" : "default"} disabled={selected}>{selected && <CheckCircle2/>}{label}</Button></AlertDialogTrigger><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{title}</AlertDialogTitle><AlertDialogDescription>{description}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={onConfirm}>Record decision</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
}
