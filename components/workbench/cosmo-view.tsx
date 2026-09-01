"use client"

import { useMemo, useRef, useState } from "react"
import { Download, FileUp } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import type { CosmoRecord, ObservableRecord, ProjectState, ScientificState } from "@/lib/workbench/types"
import { comparisonStatistics } from "@/lib/workbench/scientific"
import { downloadJson, downloadText } from "@/lib/workbench/export"
import { EmptyEvidence, formatNumber, InlineWarning, Metric, Section, StatusBadge, SvgPlot, ViewHeader } from "./shared"

type ParsedCsv = { filename: string; headers: string[]; rows: string[][] }
const canonicalFields = ["des", "hba", "hbd", "ratio", "solute", "temperature", "composition", "gamma", "gamma_infinity"] as const

function parseCsv(text: string, filename: string): ParsedCsv {
  const rows = text.split(/\r?\n/).filter((line) => line.trim()).map((line) => {
    const values: string[] = []
    let current = "", quoted = false
    for (let i = 0; i < line.length; i++) {
      const character = line[i]
      if (character === '"' && line[i + 1] === '"' && quoted) { current += '"'; i++ }
      else if (character === '"') quoted = !quoted
      else if (character === "," && !quoted) { values.push(current.trim()); current = "" }
      else current += character
    }
    values.push(current.trim())
    return values
  })
  if (rows.length < 2) throw new Error("CSV requires a header and at least one data row.")
  return { filename, headers: rows[0], rows: rows.slice(1) }
}

const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "")
const numeric = (value: string | undefined) => value === undefined || value.trim() === "" || !Number.isFinite(Number(value)) ? null : Number(value)

export function CosmoView({ project, scientific, setScientific }: { project: ProjectState; scientific: ScientificState; setScientific: (state: ScientificState) => void }) {
  const cosmoRef = useRef<HTMLInputElement>(null)
  const observableRef = useRef<HTMLInputElement>(null)
  const [parsed, setParsed] = useState<ParsedCsv | null>(null)
  const [mapping, setMapping] = useState<Record<string, string>>({})
  const [temperatureUnit, setTemperatureUnit] = useState<"K" | "C">("K")
  const [mode, setMode] = useState<"same-composition" | "infinite-dilution">("same-composition")
  const [message, setMessage] = useState("")
  const loadCosmo = async (file: File) => {
    try {
      const next = parseCsv(await file.text(), file.name)
      setParsed(next)
      const guessed: Record<string, string> = {}
      canonicalFields.forEach((field) => { const found = next.headers.find((header) => normalize(header) === normalize(field) || (field === "temperature" && normalize(header).includes("temperature"))); if (found) guessed[field] = found })
      setMapping(guessed)
    } catch (error) { setMessage(error instanceof Error ? error.message : "CSV import failed.") }
  }
  const commit = () => {
    if (!parsed || !mapping.des || !mapping.solute) return setMessage("Map at least DES and solute before import.")
    const column = (row: string[], field: string) => row[parsed.headers.indexOf(mapping[field])]
    const records: CosmoRecord[] = parsed.rows.map((row) => { const temperature = numeric(column(row, "temperature")); return ({ id: crypto.randomUUID(), des: column(row, "des") ?? "", hba: column(row, "hba") ?? "", hbd: column(row, "hbd") ?? "", ratio: column(row, "ratio") ?? "", solute: column(row, "solute") ?? "", temperatureK: temperature === null ? null : temperatureUnit === "C" ? temperature + 273.15 : temperature, composition: numeric(column(row, "composition")), gamma: numeric(column(row, "gamma")), gammaInfinity: numeric(column(row, "gamma_infinity")), metrics: Object.fromEntries(parsed.headers.map((header, i) => [header, numeric(row[i]) ?? row[i] ?? null])), sourceFilename: parsed.filename }) })
    setScientific({ ...scientific, cosmoRecords: [...scientific.cosmoRecords, ...records] })
    setParsed(null); setMessage(`${records.length} COSMO-RS row(s) imported with explicit column mapping.`)
  }
  const loadObservables = async (file: File) => {
    try {
      const table = parseCsv(await file.text(), file.name)
      const index = (name: string) => table.headers.findIndex((header) => normalize(header) === normalize(name))
      const records: ObservableRecord[] = table.rows.map((row) => ({ id: crypto.randomUUID(), runId: row[index("run_id")] ?? "", desId: row[index("des_id")] ?? "", soluteId: row[index("solute_id")] ?? "", temperatureK: numeric(row[index("temperature_k")]), soluteCount: numeric(row[index("solute_count")]), type: (row[index("type")] || "custom") as ObservableRecord["type"], value: Number(row[index("value")]), uncertainty: numeric(row[index("uncertainty")]), unit: row[index("unit")] ?? "", sourceFilename: file.name, notes: row[index("notes")] ?? "" })).filter((record) => Number.isFinite(record.value))
      setScientific({ ...scientific, observables: [...scientific.observables, ...records] })
      setMessage(`${records.length} observable row(s) imported. Values were associated by explicit run/system metadata.`)
    } catch (error) { setMessage(error instanceof Error ? error.message : "Observable import failed.") }
  }
  const comparisons = useMemo(() => {
    const rows: Array<{ id: string; des: string; solute: string; temperature: number | null; composition: number | null; cosmo: number; md: number; residual: number; source: string }> = []
    for (const record of scientific.cosmoRecords) {
      const des = project.desSystems.find((item) => normalize(item.name) === normalize(record.des) || normalize(item.abbreviation) === normalize(record.des) || (record.hba && record.hbd && item.componentIds.map((id) => normalize(project.molecules.find((molecule) => molecule.id === id)?.fullName ?? "")).every((name) => [normalize(record.hba), normalize(record.hbd)].includes(name))))
      const solute = project.molecules.find((item) => item.role === "solute" && (normalize(item.fullName) === normalize(record.solute) || normalize(item.abbreviation) === normalize(record.solute)))
      if (!des || !solute) continue
      const candidates = scientific.activityResults.filter((item) => item.desId === des.id && item.soluteId === solute.id && (record.temperatureK === null || Math.abs(item.temperatureK - record.temperatureK) < 0.02))
      if (mode === "infinite-dilution") {
        const md = candidates.find((item) => item.infiniteDilution)?.infiniteDilution?.gammaInfinity
        if (record.gammaInfinity !== null && md !== undefined) rows.push({ id: record.id, des: des.name, solute: solute.fullName, temperature: record.temperatureK, composition: null, cosmo: record.gammaInfinity, md, residual: md - record.gammaInfinity, source: record.sourceFilename })
      } else if (record.gamma !== null && record.composition !== null) {
        for (const candidate of candidates) {
          const point = candidate.points.filter((item) => item.gammaAbsolute !== null).sort((a, b) => Math.abs(a.x - record.composition!) - Math.abs(b.x - record.composition!))[0]
          const tolerance = Math.max(1e-6, record.composition * 0.01)
          if (point && Math.abs(point.x - record.composition) <= tolerance) rows.push({ id: record.id, des: des.name, solute: solute.fullName, temperature: record.temperatureK, composition: point.x, cosmo: record.gamma, md: point.gammaAbsolute!, residual: point.gammaAbsolute! - record.gamma, source: record.sourceFilename })
        }
      }
    }
    return rows
  }, [scientific.cosmoRecords, scientific.activityResults, project, mode])
  const stats = comparisons.length >= 2 ? comparisonStatistics(comparisons.map((row) => row.cosmo), comparisons.map((row) => row.md)) : null
  const csv = ["des,solute,temperature_K,composition,cosmo_gamma,md_kbi_gamma,residual", ...comparisons.map((row) => [row.des, row.solute, row.temperature ?? "", row.composition ?? "", row.cosmo, row.md, row.residual].map((value) => `"${String(value).replaceAll('"', '""')}"`).join(","))].join("\n")
  return <>
    <ViewHeader eyebrow="Cross-method validation" title="openCOSMO-RSpy ↔ MD/KBI" description="Import real COSMO-RS results, match by molecular metadata, and compare only scientifically compatible quantities." actions={<><Button variant="outline" size="sm" onClick={() => cosmoRef.current?.click()}><FileUp/>Import COSMO CSV</Button><input ref={cosmoRef} hidden type="file" accept=".csv,text/csv" onChange={(event) => event.target.files?.[0] && loadCosmo(event.target.files[0])}/><Button variant="outline" size="sm" onClick={() => observableRef.current?.click()}><FileUp/>Import observables</Button><input ref={observableRef} hidden type="file" accept=".csv,text/csv" onChange={(event) => event.target.files?.[0] && loadObservables(event.target.files[0])}/></>}/>
    {parsed && <Section title="Map COSMO-RS columns" kicker={parsed.filename} actions={<Button onClick={commit}>Import mapped rows</Button>}><div className="form-grid form-grid-4">{canonicalFields.map((field) => <div className="field-stack" key={field}><Label>{field.replace("_", " ")}{["des", "solute"].includes(field) ? " · required" : ""}</Label><Select value={mapping[field] ?? "__none"} onValueChange={(value) => setMapping({ ...mapping, [field]: value === "__none" ? "" : value })}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent><SelectItem value="__none">Not mapped</SelectItem>{parsed.headers.map((header) => <SelectItem key={header} value={header}>{header}</SelectItem>)}</SelectContent></Select></div>)}<div className="field-stack"><Label>Mapped temperature unit</Label><Select value={temperatureUnit} onValueChange={(value) => setTemperatureUnit(value as "K" | "C")}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent><SelectItem value="K">Kelvin</SelectItem><SelectItem value="C">Celsius</SelectItem></SelectContent></Select></div></div><p className="table-note">{parsed.rows.length} data row(s); {parsed.headers.length} source column(s). Composition is interpreted as mole fraction only when mapped; unmapped columns are retained in each record&apos;s metrics object.</p></Section>}
    <Section title="Comparison domain" kicker="Compatibility gate"><div className="form-grid form-grid-2"><div className="field-stack"><Label>Mode</Label><Select value={mode} onValueChange={(value) => setMode(value as typeof mode)}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent><SelectItem value="same-composition">Same-composition γ(x)</SelectItem><SelectItem value="infinite-dilution">Infinite-dilution γ∞</SelectItem></SelectContent></Select></div><div className="readout-field"><Label>Compatible matched pairs</Label><strong>{comparisons.length}</strong></div></div>{mode === "same-composition" ? <InlineWarning title="Same-composition rule">Only absolute, anchored MD/KBI γ values within 1% relative composition tolerance are matched. Relative γ curves are excluded.</InlineWarning> : <InlineWarning title="Infinite-dilution rule">Only researcher-generated MD/KBI x→0 extrapolations are compared with COSMO-RS γ∞. The one-molecule box is never substituted.</InlineWarning>}{message && <p className="table-note">{message}</p>}</Section>
    {stats ? <><div className="metrics-row"><Metric label="Pearson r" value={formatNumber(stats.pearson, 5)}/><Metric label="Spearman ρ" value={formatNumber(stats.spearman, 5)}/><Metric label="RMSE" value={formatNumber(stats.rmse)}/><Metric label="MAE" value={formatNumber(stats.mae)}/><Metric label="MAPE" value={stats.mape === null ? "undefined" : `${formatNumber(stats.mape, 3)}%`}/><Metric label="Ranking agreement" value={stats.rankingAgreement === null ? "insufficient" : `${formatNumber(100 * stats.rankingAgreement, 2)}%`} tone={stats.rankingAgreement !== null && stats.rankingAgreement >= 0.75 ? "good" : "warning"}/></div><div className="plot-grid"><Section title="Method comparison" kicker="Identity line reference"><SvgPlot x={comparisons.map((row) => row.cosmo)} y={comparisons.map((row) => row.md)} xLabel="COSMO-RS γ" yLabel="MD/KBI γ"/></Section><Section title="Residuals" kicker="MD/KBI − COSMO-RS"><SvgPlot x={comparisons.map((_, index) => index + 1)} y={comparisons.map((row) => row.residual)} xLabel="matched case" yLabel="residual"/></Section></div></> : <Section title="Cross-method statistics" kicker="Evidence required"><EmptyEvidence text="At least two compatible matched pairs are required for correlations and ranking statistics."/></Section>}
    <Section title="Matched comparison table" kicker={`${comparisons.length} pair(s)`} actions={<><Button variant="outline" size="sm" disabled={!comparisons.length} onClick={() => downloadText("cosmo-md-comparison.csv", csv, "text/csv")}><Download/>CSV</Button><Button variant="outline" size="sm" disabled={!comparisons.length} onClick={() => downloadJson("cosmo-md-comparison.json", { mode, comparisons, statistics: stats })}><Download/>JSON</Button></>}>{comparisons.length ? <Table><TableHeader><TableRow><TableHead>DES / solute</TableHead><TableHead>T / K</TableHead><TableHead>x</TableHead><TableHead>COSMO-RS</TableHead><TableHead>MD/KBI</TableHead><TableHead>Residual</TableHead><TableHead>Rank relation</TableHead></TableRow></TableHeader><TableBody>{comparisons.sort((a, b) => a.cosmo - b.cosmo).map((row, index) => { const mdRank = [...comparisons].sort((a, b) => a.md - b.md).findIndex((item) => item.id === row.id) + 1; return <TableRow key={`${row.id}-${index}`}><TableCell><strong>{row.des}</strong><br/><small>{row.solute}</small></TableCell><TableCell>{row.temperature ?? "—"}</TableCell><TableCell>{row.composition?.toPrecision(6) ?? "∞ dilution"}</TableCell><TableCell>{formatNumber(row.cosmo)}</TableCell><TableCell>{formatNumber(row.md)}</TableCell><TableCell>{formatNumber(row.residual)}</TableCell><TableCell><StatusBadge tone={mdRank === index + 1 ? "good" : "warning"}>{mdRank === index + 1 ? "agrees" : `reversal: ${index + 1}→${mdRank}`}</StatusBadge></TableCell></TableRow> })}</TableBody></Table> : <EmptyEvidence text="No scientifically compatible COSMO-RS ↔ MD/KBI pairs are available."/>}</Section>
    <Section title="Mechanistic observables" kicker={`${scientific.observables.length} imported values`}>{scientific.observables.length ? <Table><TableHeader><TableRow><TableHead>Run / system</TableHead><TableHead>Observable</TableHead><TableHead>Value</TableHead><TableHead>Uncertainty</TableHead><TableHead>Source</TableHead></TableRow></TableHeader><TableBody>{scientific.observables.map((record) => <TableRow key={record.id}><TableCell><code>{record.runId || `${record.desId}|${record.soluteId}`}</code></TableCell><TableCell>{record.type}</TableCell><TableCell>{formatNumber(record.value)} {record.unit}</TableCell><TableCell>{formatNumber(record.uncertainty)}</TableCell><TableCell>{record.sourceFilename}</TableCell></TableRow>)}</TableBody></Table> : <EmptyEvidence text="Import coordination, hydrogen-bond, diffusion, density, viscosity, or aggregation CSV values. Nothing is inferred from RDF unless explicitly calculated elsewhere."/>}</Section>
  </>
}
