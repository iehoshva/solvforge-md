"use client"

import { useMemo, useRef, useState } from "react"
import { Check, Copy, Download, FileUp, Play } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"
import type { ProjectState, ScientificState, SSMPoint } from "@/lib/workbench/types"
import { fitSsm } from "@/lib/workbench/scientific"
import { downloadJson, downloadText } from "@/lib/workbench/export"
import { EmptyEvidence, Field, formatNumber, InlineWarning, Metric, Section, StatusBadge, SvgPlot, ViewHeader } from "./shared"

export function SsmView({ project, setProject, scientific, setScientific }: { project: ProjectState; setProject: (project: ProjectState) => void; scientific: ScientificState; setScientific: (state: ScientificState) => void }) {
  const [source, setSource] = useState("04_prod/prod.xtc")
  const [topology, setTopology] = useState("04_prod/prod.tpr")
  const [reference, setReference] = useState("<CENTRAL_REFERENCE_GROUP>")
  const [target, setTarget] = useState("<TARGET_GROUP>")
  const [pair, setPair] = useState("SOLUTE,THYMOL")
  const [stateKey, setStateKey] = useState("stage-b|323.15K|N01")
  const [sizes, setSizes] = useState("1.5, 2.0, 2.5, 3.0")
  const [begin, setBegin] = useState("0")
  const [end, setEnd] = useState("100000")
  const [binWidth, setBinWidth] = useState("0.002")
  const [rmax, setRmax] = useState("1.4")
  const [prefix, setPrefix] = useState("ssm_rdf")
  const [commands, setCommands] = useState("")
  const [pointsText, setPointsText] = useState("# L_nm, Gv_nm3, uncertainty_nm3, replica\n")
  const [representation, setRepresentation] = useState<"g-vs-inverse-l" | "lg-vs-l">("g-vs-inverse-l")
  const [message, setMessage] = useState("")
  const pointFileRef = useRef<HTMLInputElement>(null)
  const generated = useMemo(() => sizes.split(/[,;\s]+/).filter(Boolean).map((size) => `# Effective SSM length: ${size} nm\n# Review the subvolume construction and normalization for the selected SSM method.\ngmx trjconv -f '${source}' -s '${topology}' -b ${begin} -e ${end} -center -pbc mol -o '${prefix}_L${size}.xtc'\ngmx rdf -f '${prefix}_L${size}.xtc' -s '${topology}' -ref '${reference}' -sel '${target}' -bin ${binWidth} -rmax ${rmax} -o '${prefix}_L${size}.xvg'`).join("\n\n"), [source, topology, reference, target, sizes, begin, end, prefix, binWidth, rmax])
  const parsed = useMemo(() => pointsText.split(/\r?\n/).filter((line) => line.trim() && !line.trim().startsWith("#")).map((line) => line.split(/[,;\s]+/).map(Number)).filter((row) => row.length >= 2 && row.slice(0, 2).every(Number.isFinite)), [pointsText])
  const pairNames = pair.split(/[,;]+/).map((value) => value.trim())
  const candidatePoints: SSMPoint[] = parsed.map((row) => ({ id: `ssm-${crypto.randomUUID()}`, stateKey, desId: project.selectedChampion?.valueId ?? "", soluteId: project.soluteIds[0] ?? "", speciesA: pairNames[0] || "A", speciesB: pairNames[1] || "B", temperatureK: project.stageBTemperatureK, soluteCount: project.concentrations[0]?.soluteCount ?? 1, effectiveLengthNm: row[0], finiteKbiNm3: row[1], uncertaintyNm3: Number.isFinite(row[2]) && row[2] > 0 ? row[2] : null, replica: Number.isFinite(row[3]) ? row[3] : null, source: "manual finite-size table", accepted: true }))
  const matchingPoints = scientific.ssmPoints.filter((point) => point.stateKey === stateKey && [point.speciesA, point.speciesB].sort().join("|") === [pairNames[0], pairNames[1]].sort().join("|"))
  const latestFit = [...scientific.ssmFits].reverse().find((fit) => fit.stateKey === stateKey && fit.pairKey === [pairNames[0], pairNames[1]].sort().join("—"))
  const savePoints = () => {
    const retained = scientific.ssmPoints.filter((point) => !(point.stateKey === stateKey && [point.speciesA, point.speciesB].sort().join("|") === [pairNames[0], pairNames[1]].sort().join("|")))
    setScientific({ ...scientific, ssmPoints: [...retained, ...candidatePoints] })
    setMessage(`${candidatePoints.length} finite-size point(s) saved.`)
  }
  const runFit = () => {
    try {
      const sourcePoints = matchingPoints.length ? matchingPoints : candidatePoints
      const fit = fitSsm(sourcePoints, representation, project.analysisDefaults.ssmMinimumPoints)
      setScientific({ ...scientific, ssmPoints: matchingPoints.length ? scientific.ssmPoints : [...scientific.ssmPoints, ...candidatePoints], ssmFits: [...scientific.ssmFits, fit] })
      setMessage("Regression completed. Inspect diagnostics before accepting G∞.")
    } catch (error) { setMessage(error instanceof Error ? error.message : "SSM regression failed.") }
  }
  const saveCommands = () => setScientific({ ...scientific, commandProvenance: [...scientific.commandProvenance, { type: "ssm", settings: { source, topology, reference, target, pair, stateKey, sizes, begin, end, binWidth, rmax, prefix, commands: commands || generated }, timestamp: new Date().toISOString() }] })
  return <>
    <ViewHeader eyebrow="Validation / finite size" title="Small System Method" description="Generate auditable preparation commands and extrapolate finite-volume KB integrals to the thermodynamic limit." actions={<><Button variant="outline" size="sm" onClick={() => navigator.clipboard.writeText(commands || generated)}><Copy/>Copy commands</Button><Button variant="outline" size="sm" onClick={() => { saveCommands(); downloadText("ssm_commands.sh", commands || generated) }}><Download/>Download .sh</Button></>}/>
    <Section title="SSM command assistant" kicker="Editable preparation script">
      <div className="form-grid form-grid-4"><Field label="Source trajectory" value={source} onChange={setSource}/><Field label="Topology / TPR" value={topology} onChange={setTopology}/><Field label="Central reference group" value={reference} onChange={setReference}/><Field label="Target group" value={target} onChange={setTarget}/><Field label="Pair A, B" value={pair} onChange={setPair}/><Field label="State-point key" value={stateKey} onChange={setStateKey}/><Field label="Subvolume sizes (nm)" value={sizes} onChange={setSizes}/><Field label="Time interval (ps)" value={`${begin}, ${end}`} onChange={(value) => { const parts = value.split(/[,;]+/); setBegin(parts[0]?.trim() ?? ""); setEnd(parts[1]?.trim() ?? "") }}/><Field label="RDF bin width (nm)" value={binWidth} onChange={setBinWidth}/><Field label="Maximum RDF radius (nm)" value={rmax} onChange={setRmax}/><Field label="Output prefix" value={prefix} onChange={setPrefix}/></div>
      <div className="code-editor"><div><span>COMMAND SCRIPT</span><Button variant="ghost" size="sm" onClick={() => setCommands(generated)}>Reset generated</Button></div><Textarea value={commands || generated} onChange={(event) => setCommands(event.target.value)} rows={14} spellCheck={false}/></div>
      <InlineWarning title="Methodology boundary">The commands preserve settings but do not validate a particular subvolume estimator. Centering, boundary treatment, normalization, and selection semantics remain the researcher&apos;s responsibility.</InlineWarning>
    </Section>
    <div className="plot-grid">
      <Section title="Finite-size measurements" kicker={`${matchingPoints.length || candidatePoints.length} point(s)`} actions={<><Button variant="outline" size="sm" onClick={() => pointFileRef.current?.click()}><FileUp/>Import CSV</Button><input ref={pointFileRef} hidden type="file" accept=".csv,text/csv,text/plain" onChange={(event) => event.target.files?.[0] && event.target.files[0].text().then(setPointsText)}/><Button variant="outline" size="sm" onClick={savePoints}>Store points</Button></>}>
        <Label>CSV or whitespace table</Label><Textarea value={pointsText} onChange={(event) => setPointsText(event.target.value)} rows={9} spellCheck={false}/><small>Columns: L (nm), Gᵛ(L) (nm³), optional uncertainty (nm³), optional replica.</small>
        <div className="form-grid form-grid-2 mt-grid"><div className="field-stack"><Label>Regression representation</Label><Select value={representation} onValueChange={(value) => setRepresentation(value as typeof representation)}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent><SelectItem value="g-vs-inverse-l">Gᵛ versus 1/L</SelectItem><SelectItem value="lg-vs-l">L Gᵛ versus L</SelectItem></SelectContent></Select></div><Field label="Minimum accepted sizes" type="number" value={project.analysisDefaults.ssmMinimumPoints} onChange={(value) => setProject({ ...project, analysisDefaults: { ...project.analysisDefaults, ssmMinimumPoints: Math.max(2, Number(value)) } })}/></div>
        <Button className="mt-grid" onClick={runFit}><Play/>Perform SSM regression</Button>{message && <p className="table-note">{message}</p>}
      </Section>
      <Section title="Thermodynamic-limit result" kicker="Gᵛ(L) = G∞ + F∞/L">
        {latestFit ? <><div className="metrics-row"><Metric label="G∞" value={`${formatNumber(latestFit.gInfinityNm3)} nm³`} tone="accent"/><Metric label="95% CI" value={`${formatNumber(latestFit.gInfinityCi95[0])} … ${formatNumber(latestFit.gInfinityCi95[1])}`}/><Metric label="F∞" value={`${formatNumber(latestFit.fInfinityNm4)} nm⁴`}/><Metric label="R²" value={formatNumber(latestFit.r2, 5)} tone={latestFit.r2 >= 0.95 ? "good" : "warning"}/></div><SvgPlot x={(matchingPoints.length ? matchingPoints : candidatePoints).map((point) => representation === "g-vs-inverse-l" ? 1 / point.effectiveLengthNm : point.effectiveLengthNm)} y={(matchingPoints.length ? matchingPoints : candidatePoints).map((point) => representation === "g-vs-inverse-l" ? point.finiteKbiNm3 : point.effectiveLengthNm * point.finiteKbiNm3)} xLabel={representation === "g-vs-inverse-l" ? "1/L / nm⁻¹" : "L / nm"} yLabel={representation === "g-vs-inverse-l" ? "Gᵛ / nm³" : "L Gᵛ / nm⁴"}/><div className="metrics-row"><Metric label="Max |residual|" value={formatNumber(Math.max(...latestFit.residuals.map(Math.abs)))}/><Metric label="Max leverage" value={formatNumber(Math.max(...latestFit.leverage), 4)}/><Metric label="Accepted" value={latestFit.accepted ? "yes" : "researcher review"} tone={latestFit.accepted ? "good" : "warning"}/></div><Button variant={latestFit.accepted ? "outline" : "default"} onClick={() => setScientific({ ...scientific, ssmFits: scientific.ssmFits.map((fit) => fit.id === latestFit.id ? { ...fit, accepted: !fit.accepted } : fit) })}>{latestFit.accepted ? "Reopen fit" : <><Check/>Accept G∞</>}</Button><Button variant="outline" className="ml-grid" onClick={() => downloadJson("ssm-fit.json", latestFit)}>Export fit</Button></> : <EmptyEvidence text={`Insufficient finite-size data for thermodynamic-limit extrapolation. Provide at least ${project.analysisDefaults.ssmMinimumPoints} accepted, distinct L values.`}/>} 
      </Section>
    </div>
    {scientific.ssmFits.length > 0 && <Section title="Stored SSM fits" kicker="Provenance"><Table><TableHeader><TableRow><TableHead>State / pair</TableHead><TableHead>Representation</TableHead><TableHead>G∞ / nm³</TableHead><TableHead>F∞ / nm⁴</TableHead><TableHead>R²</TableHead><TableHead>Status</TableHead></TableRow></TableHeader><TableBody>{scientific.ssmFits.map((fit) => <TableRow key={fit.id}><TableCell><code>{fit.stateKey}</code><br/><small>{fit.pairKey}</small></TableCell><TableCell>{fit.representation}</TableCell><TableCell>{formatNumber(fit.gInfinityNm3)}</TableCell><TableCell>{formatNumber(fit.fInfinityNm4)}</TableCell><TableCell>{formatNumber(fit.r2, 5)}</TableCell><TableCell><StatusBadge tone={fit.accepted ? "good" : "warning"}>{fit.accepted ? "accepted" : "candidate"}</StatusBadge></TableCell></TableRow>)}</TableBody></Table></Section>}
  </>
}
