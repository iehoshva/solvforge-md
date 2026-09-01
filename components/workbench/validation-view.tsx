"use client"

import { CheckCircle2, Download, Play, XCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import type { ScientificState } from "@/lib/workbench/types"
import { runValidationSuite } from "@/lib/workbench/scientific"
import { downloadJson } from "@/lib/workbench/export"
import { EmptyEvidence, formatNumber, Metric, Section, StatusBadge, ViewHeader } from "./shared"

export function ValidationView({ scientific, setScientific }: { scientific: ScientificState; setScientific: (state: ScientificState) => void }) {
  const run = () => setScientific({ ...scientific, validationResults: runValidationSuite() })
  const passed = scientific.validationResults.filter((result) => result.passed).length
  return <>
    <ViewHeader eyebrow="Numerical assurance" title="Validation / Unit Tests" description="Deterministic synthetic tests exercise integration, finite-size regression, matrix inversion, and activity integration in the same numerical modules used by analyses." actions={<><Button onClick={run}><Play/>Run all tests</Button><Button variant="outline" size="sm" disabled={!scientific.validationResults.length} onClick={() => downloadJson("numerical-validation.json", scientific.validationResults)}><Download/>Export results</Button></>}/>
    <div className="metrics-row"><Metric label="Tests" value={scientific.validationResults.length}/><Metric label="PASS" value={passed} tone={passed === scientific.validationResults.length && passed > 0 ? "good" : "neutral"}/><Metric label="FAIL" value={scientific.validationResults.length - passed} tone={scientific.validationResults.length - passed ? "warning" : "good"}/><Metric label="Last run" value={scientific.validationResults[0]?.runAt ? new Date(scientific.validationResults[0].runAt).toLocaleString() : "not run"}/></div>
    <Section title="Core numerical tests" kicker="Visible PASS / FAIL">{scientific.validationResults.length ? <Table><TableHeader><TableRow><TableHead>Status</TableHead><TableHead>Test</TableHead><TableHead>Expected</TableHead><TableHead>Calculated</TableHead><TableHead>Absolute error</TableHead><TableHead>Relative error</TableHead><TableHead>Tolerance</TableHead></TableRow></TableHeader><TableBody>{scientific.validationResults.map((result) => <TableRow key={result.id}><TableCell><StatusBadge tone={result.passed ? "good" : "warning"}>{result.passed ? <><CheckCircle2/> PASS</> : <><XCircle/> FAIL</>}</StatusBadge></TableCell><TableCell><strong>{result.name}</strong><br/><small>{result.detail}</small></TableCell><TableCell><code>{String(result.expected)}</code></TableCell><TableCell><code>{String(result.calculated)}</code></TableCell><TableCell>{formatNumber(result.absoluteError)}</TableCell><TableCell>{result.relativeError === null ? "—" : result.relativeError.toExponential(3)}</TableCell><TableCell>{result.tolerance.toExponential(2)}</TableCell></TableRow>)}</TableBody></Table> : <EmptyEvidence text="Run the validation suite. Failed tests are retained and displayed; they are never suppressed."/>}</Section>
  </>
}
