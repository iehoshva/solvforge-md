"use client"

import { useMemo, useState } from "react"
import { Archive, Download, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"
import type { ProjectState, RunRecord } from "@/lib/workbench/types"
import {
  commands,
  emMdp,
  generateMatrixRuns,
  matrixRunCount,
  nptMdp,
  nvtMdp,
  parseRunMatrixDesign,
  prodMdp,
} from "@/lib/workbench/runs"
import { validateMdp, validateRunIds } from "@/lib/workbench/mdp"
import { downloadBlob, downloadJson, downloadText, exportProjectZip, runsCsv } from "@/lib/workbench/export"
import { ProtocolEditor } from "./protocol-editor"
import { BoxCompositionCalculator } from "./box-composition-calculator"
import { Field, InlineWarning, Metric, Section, StatusBadge, ViewHeader } from "./shared"

export function RunGeneratorView({
  project,
  setProject,
  activeRuns,
  setActiveRuns,
}: {
  project: ProjectState
  setProject: (p: ProjectState) => void
  activeRuns: RunRecord[]
  setActiveRuns: (r: RunRecord[]) => void
}) {
  const design = project.runDesign
  const setDesign = (patch: Partial<ProjectState["runDesign"]>) =>
    setProject({ ...project, runDesign: { ...design, ...patch } })
  const [approvedMatrix, setApprovedMatrix] = useState("")

  const signature = JSON.stringify({
    design,
    protocol: project.protocol,
    systems: project.systems,
    molecules: project.molecules,
  })

  const previewResult = useMemo(() => {
    try {
      const axes = parseRunMatrixDesign(design)
      const requested = matrixRunCount(axes)
      if (!Number.isSafeInteger(requested) || requested < 0) {
        throw new Error("Run count must be a non-negative integer; check matrix axes.")
      }
      if (requested > 20000) {
        throw new Error("Browser limit: 20,000 runs per batch. Split into smaller matrices.")
      }
      if (requested > 1000 && approvedMatrix !== signature) {
        return { runs: [], requested, error: "Large matrix (>1,000 runs): confirm explicitly before generating." }
      }
      return { runs: generateMatrixRuns(project, axes), requested, error: "" }
    } catch (e) {
      return { runs: [], requested: 0, error: String(e) }
    }
  }, [project, design, approvedMatrix, signature])

  const preview = previewResult.runs

  const manifestDiagnostics = useMemo(() => {
    const diagnostics = validateRunIds(preview)
    for (const run of preview) {
      diagnostics.push(
        ...run.compositionDiagnostics.map((item) => ({
          ...item,
          code: `${item.code}:${run.systemAbbreviation}:${run.temperatureK}K`,
          message: `${run.systemName}${run.soluteName ? ` + ${run.soluteName} (N=${run.soluteCount})` : ""}, ${run.temperatureK} K — ${item.message}`,
        })),
      )
      diagnostics.push(...(run.resolvedProtocol?.diagnostics ?? []))
    }
    return diagnostics.filter(
      (diagnostic, index, all) =>
        all.findIndex((other) => other.severity === diagnostic.severity && other.code === diagnostic.code && other.message === diagnostic.message) === index,
    )
  }, [preview])

  const manifestErrors = manifestDiagnostics.filter((d) => d.severity === "ERROR")
  const productionTotal = preview.reduce((sum, r) => sum + r.productionNs, 0)
  const uniqueSystems = new Set(preview.map((r) => `${r.systemId}|${r.soluteId ?? "neat"}|${r.soluteCount}`)).size

  const generate = () => {
    if (preview.length > 1000 && !window.confirm(`Generate ${preview.length} run records?`)) return
    setActiveRuns(preview)
  }

  const toggleAxis = (key: "systemIds" | "soluteIds", value: string) =>
    setDesign({
      [key]: design[key].includes(value) ? design[key].filter((id) => id !== value) : [...design[key], value],
    })

  return (
    <>
      <ViewHeader
        eyebrow="Setup / run matrix & MDP"
        title="GROMACS Run Matrix & MDP Planner"
        description="Define any combination of systems, optional solute loadings, temperatures, pressures, box sizes, and replicas. Generate editable GROMACS MDPs and run manifests."
        actions={
          <>
            <Button variant="outline" size="sm" onClick={generate} disabled={!preview.length}>
              <RefreshCw />
              Sync {preview.length} runs ({activeRuns.length} saved)
            </Button>
            <Button size="sm" disabled={!preview.length} onClick={generate}>
              Generate {preview.length} runs
            </Button>
          </>
        }
      />

      {previewResult.error && (
        <InlineWarning title="Matrix validation">
          {previewResult.error}
          {previewResult.requested > 1000 && (
            <Button className="ml-3" size="sm" onClick={() => setApprovedMatrix(signature)}>
              Confirm {previewResult.requested} runs
            </Button>
          )}
        </InlineWarning>
      )}

      <Section title="Experimental Matrix Axes" kicker="Single flexible matrix · no gated stages">
        {!project.systems.length ? (
          <InlineWarning title="System required">
            Create at least one molecular system in <strong>Molecules &amp; Systems</strong> before generating runs.
          </InlineWarning>
        ) : (
          <>
            <div className="axis-pickers">
              <AxisPicker
                title="Molecular systems"
                items={project.systems.map((s) => ({ id: s.id, label: `${s.name} (${s.abbreviation})` }))}
                selected={design.systemIds}
                onToggle={(id) => toggleAxis("systemIds", id)}
              />
              <AxisPicker
                title="Optional solute species"
                items={project.molecules.map((m) => ({ id: m.id, label: `${m.fullName} (${m.residueName})` }))}
                selected={design.soluteIds}
                onToggle={(id) => toggleAxis("soluteIds", id)}
              />
            </div>

            <div className="form-grid form-grid-4 mt-grid">
              <label className="approval-label">
                <Checkbox checked={design.includeNeatSystems} onCheckedChange={(checked) => setDesign({ includeNeatSystems: checked === true })} />
                <span>Include neat / solute-free systems</span>
              </label>
              <Field
                label="Solute counts (comma-separated)"
                value={design.soluteCounts}
                onChange={(v) => setDesign({ soluteCounts: v })}
                disabled={!design.soluteIds.length}
                note="Ignored if no solute species is checked."
              />
              <Field
                label="Temperatures (K)"
                value={design.temperaturesK}
                onChange={(v) => setDesign({ temperaturesK: v })}
                note="e.g. 298.15, 313.15, 333.15"
              />
              <Field
                label="Pressures (bar)"
                value={design.pressuresBar}
                onChange={(v) => setDesign({ pressuresBar: v })}
                note="e.g. 1"
              />
              <label className="approval-label">
                <Checkbox checked={design.useProtocolBox} onCheckedChange={(checked) => setDesign({ useProtocolBox: checked === true })} />
                <span>Use protocol box ({project.protocol.box.x}×{project.protocol.box.y}×{project.protocol.box.z} {project.protocol.box.unit ?? "nm"})</span>
              </label>
              <Field
                label="Cubic box sweep (nm)"
                value={design.boxSizesNm}
                disabled={design.useProtocolBox}
                onChange={(v) => setDesign({ boxSizesNm: v })}
                note="Uncheck 'Use protocol box' to sweep box sizes."
              />
              <Field
                label="Replicas"
                type="number"
                min="1"
                value={design.replicas}
                onChange={(v) => setDesign({ replicas: Math.max(1, Number(v) || 1) })}
              />
            </div>
          </>
        )}
      </Section>

      <BoxCompositionCalculator project={project} setProject={setProject} />

      <div className="metrics-row">
        <Metric label="Unique systems" value={uniqueSystems} />
        <Metric label="Replicas" value={design.replicas} />
        <Metric label="Planned runs" value={previewResult.requested} tone={preview.length > 1000 ? "warning" : "accent"} />
        <Metric label="Aggregate production" value={`${productionTotal.toLocaleString()} ns`} />
        <Metric label="Force field" value={project.protocol.forceField} />
      </div>

      <Section
        title="Protocol & manifest diagnostics"
        kicker={`${manifestErrors.length} error(s) · ${manifestDiagnostics.filter((item) => item.severity === "WARNING").length} warning(s)`}
      >
        {manifestDiagnostics.length === 0 ? (
          <p className="quiet-row">No manifest or protocol issues.</p>
        ) : (
          manifestDiagnostics.map((diagnostic, index) => (
            <div className={`diagnostic diagnostic-${diagnostic.severity.toLowerCase()}`} key={`${diagnostic.code}-${index}`}>
              <StatusBadge tone={diagnostic.severity === "ERROR" ? "danger" : diagnostic.severity === "WARNING" ? "warning" : "good"}>
                {diagnostic.severity}
              </StatusBadge>
              <code>{diagnostic.code}</code>
              <span>{diagnostic.message}</span>
            </div>
          ))
        )}
      </Section>

      <ProtocolEditor project={project} setProject={setProject} />
      <InputPreview project={project} runs={preview} />

      <Section
        title="Planned run manifest"
        kicker={`${preview.length} run(s)`}
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              disabled={!preview.length}
              onClick={() =>
                downloadJson("simulation-manifest.json", {
                  projectId: project.projectId,
                  generatedAt: new Date().toISOString(),
                  runs: preview,
                })
              }
            >
              <Download />
              JSON
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={!preview.length}
              onClick={() => downloadText("simulation-manifest.csv", runsCsv(preview), "text/csv")}
            >
              <Download />
              CSV
            </Button>
            <Button
              size="sm"
              disabled={!preview.length || manifestErrors.length > 0}
              onClick={() => downloadBlob(`${project.projectAbbreviation.toLowerCase()}-mdp-planning.zip`, exportProjectZip(project, preview))}
            >
              <Archive />
              MDP Planning ZIP
            </Button>
          </>
        }
      >
        {!preview.length ? (
          <p className="quiet-row">Select at least one system and valid temperature/pressure axes to generate runs.</p>
        ) : (
          <div className="table-scroll">
            <Table className="dense-table min-w-[1200px]">
              <TableHeader>
                <TableRow>
                  <TableHead>Run ID</TableHead>
                  <TableHead>Kind</TableHead>
                  <TableHead>System</TableHead>
                  <TableHead>Solute</TableHead>
                  <TableHead>N solute</TableHead>
                  <TableHead>Total mols</TableHead>
                  <TableHead>T / K</TableHead>
                  <TableHead>P / bar</TableHead>
                  <TableHead>Box / nm</TableHead>
                  <TableHead>Replica</TableHead>
                  <TableHead>Seed</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {preview.slice(0, 150).map((r) => {
                  const box = r.compositionCalculation?.boxDimensionsNm
                  return (
                    <TableRow key={r.runId}>
                      <TableCell>
                        <code>{r.runId}</code>
                      </TableCell>
                      <TableCell>
                        <StatusBadge>{r.systemKind}</StatusBadge>
                      </TableCell>
                      <TableCell>{r.systemName}</TableCell>
                      <TableCell>{r.soluteName ?? "—"}</TableCell>
                      <TableCell>{r.soluteCount}</TableCell>
                      <TableCell>{r.totalMoleculeCount ?? "unresolved"}</TableCell>
                      <TableCell>{r.temperatureK}</TableCell>
                      <TableCell>{r.pressureBar}</TableCell>
                      <TableCell>{box ? `${box.x}×${box.y}×${box.z}` : `${r.box.x}×${r.box.y}×${r.box.z}`}</TableCell>
                      <TableCell>R{String(r.replica).padStart(2, "0")}</TableCell>
                      <TableCell>{r.randomSeed}</TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </Section>
    </>
  )
}

function InputPreview({ project, runs }: { project: ProjectState; runs: RunRecord[] }) {
  const [runId, setRunId] = useState("")
  const [kind, setKind] = useState<"em" | "nvt" | "npt" | "prod" | "commands">("prod")

  const run = runs.find((r) => r.runId === runId) ?? runs[0]
  if (!run) {
    return (
      <Section title="Generated MDP / script preview" kicker="Inspect before export">
        <p className="quiet-row">Configure a valid run matrix above to inspect generated `.mdp` files and `commands.sh`.</p>
      </Section>
    )
  }

  const text =
    kind === "em"
      ? emMdp(project, run)
      : kind === "nvt"
        ? nvtMdp(project, run)
        : kind === "npt"
          ? nptMdp(project, run)
          : kind === "prod"
            ? prodMdp(project, run)
            : commands(run)

  const filename = kind === "commands" ? "commands.sh" : `${kind}.mdp`
  const diagnostics =
    kind === "commands"
      ? []
      : validateMdp(text, kind, {
          temperatureK: run.temperatureK,
          pressureBar: run.pressureBar,
          durationNs:
            kind === "nvt"
              ? project.protocol.nvt.durationNs
              : kind === "npt"
                ? project.protocol.npt.durationNs
                : kind === "prod"
                  ? run.productionNs
                  : undefined,
        })
  const hasErrors = diagnostics.some((d) => d.severity === "ERROR")

  return (
    <Section
      title="Generated MDP / script preview"
      kicker="Live resolved artifact"
      actions={
        <Button variant="outline" size="sm" disabled={hasErrors} onClick={() => downloadText(`${run.runId}-${filename}`, text)}>
          <Download />
          Download {filename}
        </Button>
      }
    >
      <div className="input-review-bar">
        <div className="field-stack">
          <Label>Run</Label>
          <Select value={run.runId} onValueChange={setRunId}>
            <SelectTrigger aria-label="Input preview run">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {runs.slice(0, 200).map((r) => (
                <SelectItem key={r.runId} value={r.runId}>
                  {r.runId}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="field-stack">
          <Label>File</Label>
          <Select value={kind} onValueChange={(v) => setKind(v as typeof kind)}>
            <SelectTrigger aria-label="Input preview file">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="em">em.mdp</SelectItem>
              <SelectItem value="nvt">nvt.mdp</SelectItem>
              <SelectItem value="npt">npt.mdp</SelectItem>
              <SelectItem value="prod">prod.mdp</SelectItem>
              <SelectItem value="commands">commands.sh</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <StatusBadge tone={hasErrors ? "danger" : "good"}>{hasErrors ? "errors found" : "resolved"}</StatusBadge>
      </div>
      <div className="code-editor">
        <div>
          <span>
            {run.runId}/{filename}
          </span>
          <small>Edit protocol settings or per-stage MDP overrides above to customize.</small>
        </div>
        <Textarea value={text} readOnly aria-label="Resolved input file" rows={16} spellCheck={false} />
      </div>
      {diagnostics.map((d, index) => (
        <div className={`diagnostic diagnostic-${d.severity.toLowerCase()}`} key={`${d.code}-${index}`}>
          <StatusBadge tone={d.severity === "ERROR" ? "danger" : d.severity === "WARNING" ? "warning" : "good"}>
            {d.severity}
          </StatusBadge>
          <code>{d.code}</code>
          <span>{d.message}</span>
        </div>
      ))}
    </Section>
  )
}

function AxisPicker({
  title,
  items,
  selected,
  onToggle,
}: {
  title: string
  items: Array<{ id: string; label: string }>
  selected: string[]
  onToggle: (id: string) => void
}) {
  return (
    <div className="axis-picker">
      <Label>{title}</Label>
      {items.map((item) => (
        <label key={item.id}>
          <Checkbox checked={selected.includes(item.id)} onCheckedChange={() => onToggle(item.id)} />
          {item.label}
        </label>
      ))}
    </div>
  )
}
