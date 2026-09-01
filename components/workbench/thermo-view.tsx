"use client"

import { useState } from "react"
import { Calculator, Download } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"
import type { ActivityResult, Molecule, ProjectState, RDFDataset, ScientificState } from "@/lib/workbench/types"
import { calculateBoxComposition } from "@/lib/workbench/composition"
import { buildThermodynamicResult, extrapolateInfiniteDilution, integrateActivity, sampleSd } from "@/lib/workbench/scientific"
import { downloadJson } from "@/lib/workbench/export"
import { EmptyEvidence, Field, formatNumber, InlineWarning, Metric, Section, StatusBadge, SvgPlot, ViewHeader } from "./shared"

const normalized = (value: string) => value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "")
const pairMatches = (a: string, b: string, x: string, y: string) => [normalized(a), normalized(b)].sort().join("|") === [normalized(x), normalized(y)].sort().join("|")

export function ThermoView({ project, setProject, datasets, scientific, setScientific }: { project: ProjectState; setProject: (project: ProjectState) => void; datasets: RDFDataset[]; scientific: ScientificState; setScientific: (state: ScientificState) => void }) {
  const champion = project.desSystems.find((des) => des.id === project.selectedChampion?.valueId) ?? project.desSystems[0]
  const [soluteId, setSoluteId] = useState(project.soluteIds[0] ?? "")
  const [concentrationId, setConcentrationId] = useState(project.selectedOptimum?.valueId ?? project.concentrations[0]?.id ?? "")
  const [temperature, setTemperature] = useState(String(project.stageBTemperatureK))
  const [matrixValues, setMatrixValues] = useState<Record<string, string>>({})
  const [matrixUncertainty, setMatrixUncertainty] = useState<Record<string, string>>({})
  const [message, setMessage] = useState("")
  const [override, setOverride] = useState(false)
  const [overrideReason, setOverrideReason] = useState("")
  const [anchorType, setAnchorType] = useState<ActivityResult["anchor"]["type"]>("none")
  const [anchorGamma, setAnchorGamma] = useState("")
  const [anchorX, setAnchorX] = useState("")
  const [infiniteModel, setInfiniteModel] = useState<"linear" | "quadratic">("linear")
  const [maxX, setMaxX] = useState("0.1")
  const solute = project.molecules.find((molecule) => molecule.id === soluteId)
  const componentMolecules = champion?.componentIds.slice(0, 2).map((id) => project.molecules.find((molecule) => molecule.id === id)).filter((molecule): molecule is Molecule => Boolean(molecule)) ?? []
  const species: Molecule[] = solute && componentMolecules.length === 2 ? [solute, ...componentMolecules] : []
  const concentration = project.concentrations.find((point) => point.id === concentrationId)
  const stateKey = `${champion?.id}|${soluteId}|N${concentration?.soluteCount ?? "?"}|${Number(temperature)}K`
  const sourceFor = (row: number, column: number) => {
    if (species.length !== 3) return null
    const a = species[row]!.fullName, b = species[column]!.fullName
    const acceptedFit = [...scientific.ssmFits].reverse().find((fit) => fit.accepted && pairMatches(fit.pairKey.split("—")[0] ?? "", fit.pairKey.split("—")[1] ?? "", a, b) && (fit.stateKey === stateKey || fit.stateKey.includes(String(Number(temperature)))))
    if (acceptedFit) return { value: acceptedFit.gInfinityNm3, uncertainty: acceptedFit.gInfinitySe, source: `SSM:${acceptedFit.id}`, status: "finite-size corrected" }
    const matches = datasets.filter((dataset) => dataset.analysis && dataset.analysis.plateauStatus !== "rejected" && dataset.metadata.desId === champion?.id && pairMatches(dataset.metadata.speciesA, dataset.metadata.speciesB, a, b) && (dataset.metadata.temperatureK === null || Math.abs(dataset.metadata.temperatureK - Number(temperature)) < 1e-6) && (dataset.metadata.soluteCount === null || dataset.metadata.soluteCount === concentration?.soluteCount))
    if (!matches.length) return null
    const estimates = matches.map((dataset) => dataset.analysis!.estimateNm3)
    const value = estimates.reduce((sum, estimate) => sum + estimate, 0) / estimates.length
    const uncertainty = estimates.length > 1 ? sampleSd(estimates) / Math.sqrt(estimates.length) : matches[0].analysis!.plateauSdNm3
    const accepted = matches.every((dataset) => ["accepted", "manual"].includes(dataset.analysis!.plateauStatus))
    return { value, uncertainty, source: matches.map((dataset) => dataset.id).join(","), status: accepted ? "plateau accepted" : "candidate / unconverged" }
  }
  const effectiveCell = (row: number, column: number) => {
    const key = `${Math.min(row, column)}-${Math.max(row, column)}`
    const detected = sourceFor(row, column)
    const manual = matrixValues[key]
    const value = manual !== undefined && manual !== "" ? Number(manual) : detected?.value ?? null
    const manualU = matrixUncertainty[key]
    const uncertainty = manualU !== undefined && manualU !== "" ? Number(manualU) : detected?.uncertainty ?? 0
    return { key, value: Number.isFinite(value) ? value : null, uncertainty: Number.isFinite(uncertainty) ? uncertainty : 0, source: manual !== undefined && manual !== "" ? "manual reviewed value" : detected?.source ?? "", status: manual !== undefined && manual !== "" ? "manual" : detected?.status ?? "missing" }
  }
  const uniqueCells = species.length ? [[0, 0], [0, 1], [0, 2], [1, 1], [1, 2], [2, 2]].map(([row, column]) => effectiveCell(row, column)) : []
  const complete = uniqueCells.length === 6 && uniqueCells.every((cell) => cell.value !== null)
  const compositionResolution = champion && concentration && species.length === 3 ? calculateBoxComposition(project, champion.id, soluteId, concentration.soluteCount, Number(temperature)) : null
  const composition = (() => {
    const metadata = compositionResolution?.metadata
    const componentCounts = compositionResolution?.componentCounts
    if (!metadata || !componentCounts || componentCounts.length < 2) return null
    return { counts: [concentration!.soluteCount, componentCounts[0], componentCounts[1]], moleFractions: [metadata.moleFractions[soluteId], metadata.moleFractions[champion!.componentIds[0]], metadata.moleFractions[champion!.componentIds[1]]], densities: [metadata.numberDensitiesNm3[soluteId], metadata.numberDensitiesNm3[champion!.componentIds[0]], metadata.numberDensitiesNm3[champion!.componentIds[1]]], volume: metadata.volumeNm3 }
  })()
  const calculate = () => {
    if (!champion || species.length !== 3) return setMessage("Calculation unavailable: define a solute and exactly two DES molecular components.")
    if (!complete) return setMessage("Calculation unavailable: one or more component-resolved KBI terms are missing.")
    if (!composition) return setMessage(`Calculation unavailable: ${compositionResolution?.diagnostics.filter((item) => item.severity === "ERROR").map((item) => item.message).join(" ") || "complete molecular composition and positive box dimensions are required."}`)
    const matrix = Array.from({ length: 3 }, () => Array(3).fill(0))
    const uncertainty = Array.from({ length: 3 }, () => Array(3).fill(0))
    const sourceIds: string[] = []
    for (const [row, column] of [[0, 0], [0, 1], [0, 2], [1, 1], [1, 2], [2, 2]]) {
      const cell = effectiveCell(row, column)
      matrix[row][column] = matrix[column][row] = cell.value!
      uncertainty[row][column] = uncertainty[column][row] = cell.uncertainty
      if (cell.source) sourceIds.push(cell.source)
    }
    try {
      const result = buildThermodynamicResult({ stateKey, desId: champion.id, soluteId, concentrationId, species: species.map((item) => item.fullName), moleculeCounts: composition.counts, moleFractions: composition.moleFractions, numberDensitiesNm3: composition.densities, kbiMatrixNm3: matrix, kbiUncertaintyNm3: uncertainty, sourceTermIds: sourceIds }, project.analysisDefaults.bootstrapSamples, project.analysisDefaults.bootstrapSeed)
      if (result.conditionNumber > project.analysisDefaults.matrixConditionLimit && !override) return setMessage(`KB matrix inversion unstable: condition number ${result.conditionNumber.toExponential(3)} exceeds the selected tolerance ${project.analysisDefaults.matrixConditionLimit.toExponential(3)}. Enable and justify the advanced override to retain it.`)
      if (override && !overrideReason.trim()) return setMessage("An advanced override requires a written scientific reason.")
      setScientific({ ...scientific, thermodynamicResults: [...scientific.thermodynamicResults.filter((item) => item.stateKey !== stateKey), result], matrixOverrides: override ? [...scientific.matrixOverrides, { stateKey, reason: overrideReason, timestamp: new Date().toISOString() }] : scientific.matrixOverrides })
      setMessage("Ternary thermodynamic factor calculated and stored.")
    } catch (error) { setMessage(error instanceof Error ? error.message : "Thermodynamic calculation failed.") }
  }
  const current = [...scientific.thermodynamicResults].reverse().find((result) => result.stateKey === stateKey)
  const series = scientific.thermodynamicResults.filter((result) => result.desId === champion?.id && result.soluteId === soluteId && Math.abs(Number(result.stateKey.match(/\|([\d.]+)K$/)?.[1] ?? temperature) - Number(temperature)) < 1e-6).sort((a, b) => a.moleFractions[0] - b.moleFractions[0])
  const activity = [...scientific.activityResults].reverse().find((result) => result.desId === champion?.id && result.soluteId === soluteId && Math.abs(result.temperatureK - Number(temperature)) < 1e-6)
  const calculateActivity = () => {
    if (!champion) return setMessage("Calculation unavailable: no DES is selected.")
    try {
      const anchor: ActivityResult["anchor"] = { type: anchorType, x: anchorX === "" ? null : Number(anchorX), gamma: anchorGamma === "" ? null : Number(anchorGamma) }
      const points = integrateActivity(series.map((result) => ({ x: result.moleFractions[0], thermodynamicFactor: result.fixedDesRatioSoluteGamma })), project.analysisDefaults.gammaInterpolation, anchor)
      const result: ActivityResult = { id: crypto.randomUUID(), desId: champion.id, soluteId, temperatureK: Number(temperature), interpolation: project.analysisDefaults.gammaInterpolation, points, anchor, createdAt: new Date().toISOString() }
      setScientific({ ...scientific, activityResults: [...scientific.activityResults.filter((item) => !(item.desId === result.desId && item.soluteId === result.soluteId && item.temperatureK === result.temperatureK)), result] })
      setMessage(anchorType === "none" ? "Relative activity coefficient calculated. Absolute γ remains unavailable until an external thermodynamic anchor is supplied." : "Anchored activity coefficient calculated.")
    } catch (error) { setMessage(error instanceof Error ? error.message : "Activity integration failed.") }
  }
  const extrapolate = () => {
    if (!activity) return
    const absolute = activity.points.filter((point) => point.gammaAbsolute !== null).map((point) => ({ x: point.x, gamma: point.gammaAbsolute! }))
    try {
      const fit = extrapolateInfiniteDilution(absolute, infiniteModel, Number(maxX))
      const next = { ...activity, infiniteDilution: fit }
      setScientific({ ...scientific, activityResults: scientific.activityResults.map((item) => item.id === activity.id ? next : item) })
      setMessage("Infinite-dilution extrapolation stored. Inspect fit range, R², confidence interval, and sensitivity.")
    } catch (error) { setMessage(`γ∞ extrapolation rejected: ${error instanceof Error ? error.message : "insufficient validated low-x data."}`) }
  }
  return <>
    <ViewHeader eyebrow="Analysis / multicomponent KB" title="KB matrix & thermodynamics" description="Build a complete component-resolved ternary KB matrix, inspect conditioning, then derive Γ along the fixed-DES-ratio composition path." actions={current && <Button variant="outline" size="sm" onClick={() => downloadJson(`${stateKey}-thermodynamics.json`, current)}><Download/>Export result</Button>}/>
    <Section title="State point and composition" kicker="Three molecular species">
      <div className="form-grid form-grid-4"><div className="field-stack"><Label>Solute</Label><Select value={soluteId} onValueChange={setSoluteId}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent>{project.soluteIds.map((id) => <SelectItem key={id} value={id}>{project.molecules.find((molecule) => molecule.id === id)?.fullName}</SelectItem>)}</SelectContent></Select></div><div className="field-stack"><Label>Loading</Label><Select value={concentrationId} onValueChange={setConcentrationId}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent>{project.concentrations.map((point) => <SelectItem key={point.id} value={point.id}>{point.label} · N={point.soluteCount}</SelectItem>)}</SelectContent></Select></div><Field label="Temperature (K)" type="number" step="0.01" value={temperature} onChange={setTemperature}/><div className="readout-field"><Label>DES</Label><strong>{champion?.name ?? "No DES"}</strong></div><Field label="Condition-number limit" type="number" value={project.analysisDefaults.matrixConditionLimit} onChange={(value) => setProject({ ...project, analysisDefaults: { ...project.analysisDefaults, matrixConditionLimit: Number(value) } })}/><Field label="Monte Carlo samples" type="number" value={project.analysisDefaults.bootstrapSamples} onChange={(value) => setProject({ ...project, analysisDefaults: { ...project.analysisDefaults, bootstrapSamples: Math.max(100, Number(value)) } })}/><Field label="Monte Carlo seed" type="number" value={project.analysisDefaults.bootstrapSeed} onChange={(value) => setProject({ ...project, analysisDefaults: { ...project.analysisDefaults, bootstrapSeed: Number(value) } })}/><div className="field-stack"><Label>γ interpolation</Label><Select value={project.analysisDefaults.gammaInterpolation} onValueChange={(value) => setProject({ ...project, analysisDefaults: { ...project.analysisDefaults, gammaInterpolation: value as "linear" | "monotone-cubic" } })}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent><SelectItem value="linear">Linear</SelectItem><SelectItem value="monotone-cubic">Monotone cubic</SelectItem></SelectContent></Select></div></div>
      {composition ? <div className="metrics-row"><Metric label="Counts" value={composition.counts.join(" / ")} detail={species.map((item) => item.abbreviation).join(" / ")}/><Metric label="Solute xᵢ" value={composition.moleFractions[0].toFixed(7)}/><Metric label="Box volume" value={`${formatNumber(composition.volume)} nm³`}/><Metric label="Number densities" value={composition.densities.map((value) => formatNumber(value, 4)).join(" / ")} detail="nm⁻³"/></div> : <InlineWarning title="Composition unavailable">{compositionResolution?.diagnostics.filter((item) => item.severity === "ERROR").map((item) => item.message).join(" ") || "Resolve the physical box composition first. Molecule loading alone is not thermodynamic concentration."}</InlineWarning>}
    </Section>
    <Section title="Complete symmetric KB matrix" kicker="Gᵢⱼ / nm³">
      {species.length === 3 ? <div className="kb-matrix" style={{ gridTemplateColumns: "10rem repeat(3, minmax(12rem, 1fr))" }}><div/>{species.map((item) => <strong key={`head-${item.id}`}>{item.abbreviation}<small>{item.fullName}</small></strong>)}{species.flatMap((rowSpecies, row) => [<strong key={`row-${rowSpecies.id}`}>{rowSpecies.abbreviation}<small>{rowSpecies.fullName}</small></strong>, ...species.map((columnSpecies, column) => { const cell = effectiveCell(row, column); return <div key={`${row}-${column}`} className={`matrix-cell matrix-${cell.value === null ? "missing" : cell.status.includes("candidate") ? "unconverged" : "available"}`}><span>G<sub>{rowSpecies.abbreviation},{columnSpecies.abbreviation}</sub></span><Input aria-label={`G ${rowSpecies.fullName} ${columnSpecies.fullName}`} value={matrixValues[cell.key] ?? (cell.value ?? "")} onChange={(event) => setMatrixValues({ ...matrixValues, [cell.key]: event.target.value })} disabled={column < row}/><Input aria-label="Uncertainty" placeholder="σ / nm³" value={matrixUncertainty[cell.key] ?? (cell.uncertainty || "")} onChange={(event) => setMatrixUncertainty({ ...matrixUncertainty, [cell.key]: event.target.value })} disabled={column < row}/><small>{cell.status}</small></div> })])}</div> : <EmptyEvidence text="A solute and exactly two DES components are required for the implemented ternary formalism."/>}
      {!complete && <InlineWarning title="Thermodynamic-factor calculation unavailable">Missing terms: {uniqueCells.filter((cell) => cell.value === null).map((cell) => cell.key).join(", ") || "matrix not defined"}. Import/accept pairwise KBI values or enter reviewed values with provenance.</InlineWarning>}
      <label className="override-row"><Checkbox checked={override} onCheckedChange={(value) => setOverride(Boolean(value))}/><span><strong>Advanced conditioning override</strong><small>Does not fill missing terms. It only permits storing a complete but ill-conditioned result.</small></span></label>{override && <Textarea placeholder="Required scientific justification" value={overrideReason} onChange={(event) => setOverrideReason(event.target.value)} rows={2}/>}<Button className="mt-grid" onClick={calculate}><Calculator/>Calculate ternary Γ</Button>{message && <p className="table-note">{message}</p>}
    </Section>
    {current && <><div className="metrics-row"><Metric label="Γsolute · fixed DES ratio" value={formatNumber(current.fixedDesRatioSoluteGamma, 7)} tone="accent"/><Metric label="Condition number" value={current.conditionNumber.toExponential(4)} tone={current.conditionNumber > project.analysisDefaults.matrixConditionLimit ? "warning" : "good"}/><Metric label="det B" value={current.determinantB.toExponential(4)}/><Metric label="MC uncertainty" value={current.uncertainty ? `${formatNumber(current.uncertainty.sd)} SD` : "not supplied"}/></div><Section title="Inspectable transformation" kicker="Bᵢⱼ = ρᵢρⱼGᵢⱼ + ρᵢδᵢⱼ"><MatrixTable title="B" matrix={current.transformedB}/><MatrixTable title="B⁻¹" matrix={current.inverseB}/><MatrixTable title="Γ (independent x₁,x₂; x₃ dependent)" matrix={current.gammaMatrix}/>{current.uncertainty && <InlineWarning title="Monte Carlo propagation">{current.uncertainty.validSamples} of {current.uncertainty.requestedSamples} draws were valid. 95% interval for the fixed-ratio solute factor: {formatNumber(current.uncertainty.ci95[0])} to {formatNumber(current.uncertainty.ci95[1])}.</InlineWarning>}</Section></>}
    <div className="plot-grid"><Section title="Thermodynamic factor series" kicker={`${series.length} composition point(s)`}>{series.length ? <><SvgPlot x={series.map((result) => result.moleFractions[0])} y={series.map((result) => result.fixedDesRatioSoluteGamma)} xLabel="solute mole fraction xᵢ" yLabel="Γᵢ"/><Table><TableHeader><TableRow><TableHead>xᵢ</TableHead><TableHead>Γᵢ</TableHead><TableHead>Condition</TableHead></TableRow></TableHeader><TableBody>{series.map((result) => <TableRow key={result.id}><TableCell>{result.moleFractions[0].toPrecision(7)}</TableCell><TableCell>{formatNumber(result.fixedDesRatioSoluteGamma, 7)}</TableCell><TableCell>{result.conditionNumber.toExponential(3)}</TableCell></TableRow>)}</TableBody></Table></> : <EmptyEvidence text="Calculate at least one complete concentration state point."/>}</Section><Section title="Activity coefficient" kicker="d ln γᵢ / d ln xᵢ = Γᵢ − 1"><div className="form-grid form-grid-2"><div className="field-stack"><Label>Interpolation</Label><Select value={project.analysisDefaults.gammaInterpolation} disabled><SelectTrigger><SelectValue/></SelectTrigger></Select></div><div className="field-stack"><Label>Absolute reference</Label><Select value={anchorType} onValueChange={(value) => setAnchorType(value as typeof anchorType)}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent><SelectItem value="none">None · relative γ only</SelectItem><SelectItem value="composition">Known γ at composition</SelectItem><SelectItem value="infinite-dilution">Known external γ∞</SelectItem></SelectContent></Select></div>{anchorType !== "none" && <><Field label="Reference γ" type="number" value={anchorGamma} onChange={setAnchorGamma}/>{anchorType === "composition" && <Field label="Reference x" type="number" value={anchorX} onChange={setAnchorX}/>}</>}</div><Button className="mt-grid" onClick={calculateActivity} disabled={series.length < 2}>Integrate Γ(x)</Button><InlineWarning title="Thermodynamic integration constant">KBI-derived Γ determines γ ratios, not the absolute activity-coefficient scale. Without an explicit external anchor, the plot is γ(x)/γ(xmin); the first simulated point is not silently treated as γ∞.</InlineWarning>{activity && <><SvgPlot x={activity.points.map((point) => point.x)} y={activity.points.map((point) => point.gammaAbsolute ?? point.gammaRelative)} xLabel="solute mole fraction xᵢ" yLabel={activity.points.some((point) => point.gammaAbsolute !== null) ? "γᵢ" : "γᵢ / γᵢ(xmin)"}/><StatusBadge tone={activity.anchor.type === "none" ? "warning" : "good"}>{activity.anchor.type === "none" ? "relative scale" : "absolute anchor supplied"}</StatusBadge></>}</Section></div>
    <Section title="Infinite Dilution Analysis" kicker="Controlled x → 0 extrapolation"><div className="form-grid form-grid-4"><div className="field-stack"><Label>Fit model for ln γ(x)</Label><Select value={infiniteModel} onValueChange={(value) => setInfiniteModel(value as typeof infiniteModel)}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent><SelectItem value="linear">Linear low-x fit</SelectItem><SelectItem value="quadratic">Quadratic low-x fit</SelectItem></SelectContent></Select></div><Field label="Maximum fitted x" type="number" value={maxX} onChange={setMaxX}/><div className="readout-field"><Label>Absolute low-x points</Label><strong>{activity?.points.filter((point) => point.gammaAbsolute !== null && point.x <= Number(maxX)).length ?? 0}</strong></div><Button onClick={extrapolate} disabled={!activity || activity.anchor.type === "none"}>Fit x → 0</Button></div>{activity?.infiniteDilution ? <div className="metrics-row"><Metric label="γ∞" value={formatNumber(activity.infiniteDilution.gammaInfinity, 7)} tone="accent"/><Metric label="95% CI" value={`${formatNumber(activity.infiniteDilution.ci95[0])} … ${formatNumber(activity.infiniteDilution.ci95[1])}`}/><Metric label="R²" value={formatNumber(activity.infiniteDilution.r2, 5)}/><Metric label="Fit-range sensitivity" value={formatNumber(activity.infiniteDilution.sensitivity)}/></div> : <EmptyEvidence text="A validated absolute activity-coefficient scale and enough low-x composition points are required. One molecule per box is not automatically γ∞."/>}</Section>
  </>
}

function MatrixTable({ title, matrix }: { title: string; matrix: number[][] }) { return <div className="matrix-table"><Label>{title}</Label><Table><TableBody>{matrix.map((row, i) => <TableRow key={i}>{row.map((value, j) => <TableCell key={j}><code>{value.toExponential(6)}</code></TableCell>)}</TableRow>)}</TableBody></Table></div> }
