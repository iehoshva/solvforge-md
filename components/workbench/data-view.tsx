"use client"

import { useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import type { Workspace } from "@/lib/workbench/workspace"
import {
  completeArchive,
  completeProjectJson,
  importProjectJson,
  importArchive,
  runInputSnapshot,
} from "@/lib/workbench/packages"
import { provenanceGraph, provenanceCoverage, preparationReport, reportHtml } from "@/lib/workbench/provenance"
import { makeZip } from "@/lib/workbench/zip"
import { sha256 } from "@/lib/workbench/identity"
import { downloadBlob, downloadJson, downloadText, runsCsv } from "@/lib/workbench/export"
import { recordContinuation } from "@/lib/workbench/continuation"
import { toCsv } from "@/lib/workbench/csv"
import { Field, TextField, Section, ViewHeader, InlineWarning } from "./shared"

export function DataView({ workspace, onReplace }: { workspace: Workspace; onReplace: (w: Workspace) => void }) {
  const [message, setMessage] = useState("")
  const [runId, setRunId] = useState("")
  const [nodeId, setNodeId] = useState("")
  const w = workspace
  const graph = useMemo(() => provenanceGraph(w), [w])
  const coverage = useMemo(() => provenanceCoverage(w, graph), [w, graph])
  const node = graph.find((n) => n.id === nodeId)

  const [completed, setCompleted] = useState("")
  const [checkpoint, setCheckpoint] = useState("")
  const [executionEvidence, setExecutionEvidence] = useState("")
  const [continuationReason, setContinuationReason] = useState("")
  const [continuationAction, setContinuationAction] = useState<"continue" | "stop">("continue")
  const [jsonReview, setJsonReview] = useState<{ revision: string; text: string } | null>(null)
  const [pastedJson, setPastedJson] = useState("")
  const [filePath, setFilePath] = useState("")
  const [showReport, setShowReport] = useState(false)

  const frozenFiles = w.runs.find((r) => r.runId === runId)?.inputSnapshots?.[0]?.files ?? []
  const selectedFile = frozenFiles.find((f) => f.path === filePath)
  const continuation = w.decisions.filter((d) => d.type === "ProductionContinuationDecision" && d.runId === runId).at(-1)

  const act = async (fn: () => void | Promise<void>) => {
    try {
      await fn()
      setMessage("")
    } catch (e) {
      setMessage(String(e))
    }
  }

  const full = () => ({ ...w, provenance: graph })

  const packRun = (frozen = false) =>
    act(async () => {
      const run = w.runs.find((r) => r.runId === runId)
      if (!run) throw new Error("Choose a generated run.")
      const snapshot = frozen ? run.inputSnapshots?.[0] : await runInputSnapshot(w.project, run, w.qmGromacs)
      if (!snapshot) throw new Error("No frozen input snapshot.")
      for (const f of snapshot.files) {
        if ((await sha256(f.content)) !== f.sha256) throw new Error("Frozen input checksum mismatch: " + f.path)
      }
      const next = {
        ...w,
        runs: w.runs.map((r) => (r.runId === runId ? { ...r, inputSnapshots: r.inputSnapshots?.length ? r.inputSnapshots : [snapshot] } : r)),
      }
      next.provenance = provenanceGraph(next)
      onReplace(next)
      const files = snapshot.files.map((f) => ({ path: f.path, content: f.content }))
      files.push({
        path: "run_manifest.json",
        content: JSON.stringify({ ...run, inputSnapshots: [{ ...snapshot, files: snapshot.files.map(({ path, sha256: h }) => ({ path, sha256: h })) }] }, null, 2),
      })
      const checksums = await Promise.all(
        files.map(async (f) => ({ path: f.path, size: new TextEncoder().encode(f.content).length, sha256: await sha256(f.content) })),
      )
      downloadBlob(runId + "-run-inputs.zip", makeZip([...files, { path: "checksums.json", content: JSON.stringify(checksums, null, 2) }]))
    })

  return (
    <>
      <ViewHeader
        eyebrow="Packages & provenance"
        title="Run Input Packages & Project Archives"
        description="Freeze reproducible GROMACS run packages (with MoDy Analyse metadata.json), export complete project archives, and audit QM-to-MD provenance."
      />
      {message && (
        <div role="alert" className="inline-warning">
          {message}
        </div>
      )}

      <Section title="Run Input Package (GROMACS + MoDy Analyse)">
        <div className="flex flex-wrap gap-3 items-center mb-3">
          <label className="flex items-center gap-2">
            <span>Resolved run</span>
            <select aria-label="Run input package run" value={runId} onChange={(e) => setRunId(e.target.value)} className="h-9 border px-2 text-sm bg-white">
              <option value="">Choose run</option>
              {w.runs.map((r) => (
                <option key={r.runId} value={r.runId}>
                  {r.runId}
                </option>
              ))}
            </select>
          </label>
          <Button disabled={!runId} onClick={() => void packRun()}>
            Validate, freeze &amp; export Run Input Package
          </Button>
          <Button
            variant="outline"
            disabled={!w.runs.find((r) => r.runId === runId)?.inputSnapshots?.length}
            onClick={() => void packRun(true)}
          >
            Download existing frozen snapshot
          </Button>
        </div>
        <p>
          Bundles `00_input/topol.top`, `*.itp`, `packed.gro`, `index.ndx`, stage `.mdp` files, `commands.sh`, `metadata.json` (MoDy Analyse schema), and original QM sources with SHA-256 checksums.
        </p>
        {frozenFiles.length > 0 && (
          <>
            <label className="field-stack mt-3">
              Inspect frozen file
              <select aria-label="Frozen input file" value={filePath} onChange={(e) => setFilePath(e.target.value)}>
                <option value="">Choose generated artifact</option>
                {frozenFiles.map((f) => (
                  <option value={f.path} key={f.path}>
                    {f.path}
                  </option>
                ))}
              </select>
            </label>
            {selectedFile && (
              <>
                <p className="text-xs break-all">SHA-256: {selectedFile.sha256}</p>
                <pre aria-label="Frozen file contents" className="text-xs overflow-auto max-h-96">
                  {selectedFile.content}
                </pre>
              </>
            )}
          </>
        )}
      </Section>

      <Section title="Complete Project Archive">
        <div className="section-actions">
          <Button onClick={() => void act(async () => downloadBlob("solvforge-complete-project.zip", await completeArchive(full())))}>
            Export Complete Archive ZIP
          </Button>
          <Button
            variant="outline"
            onClick={() => void act(async () => downloadText("solvforge-workspace.json", await completeProjectJson(full()), "application/json"))}
          >
            Export Workspace JSON
          </Button>
          <Button variant="outline" onClick={() => downloadJson("project-manifest.json", w.project)}>
            Export Design Manifest
          </Button>
          <Button
            variant="outline"
            onClick={() => void act(async () => setJsonReview({ revision: w.savedAt, text: await completeProjectJson(full()) }))}
          >
            Inspect Workspace JSON
          </Button>
        </div>
        {jsonReview?.revision === w.savedAt && (
          <label className="field-stack mt-3">
            Complete project JSON snapshot
            <Textarea aria-label="Complete project JSON review" readOnly value={jsonReview.text} rows={10} className="font-mono text-xs" />
          </label>
        )}
        <details className="my-3">
          <summary>Restore from pasted workspace JSON</summary>
          <label className="field-stack mt-3">
            Workspace JSON
            <Textarea aria-label="Project JSON to restore" value={pastedJson} onChange={(e) => setPastedJson(e.target.value)} rows={6} />
          </label>
          <Button
            disabled={!pastedJson.trim()}
            onClick={() =>
              void act(async () => {
                const next = await importProjectJson(pastedJson)
                onReplace(next)
                setPastedJson("")
                setJsonReview(null)
              })
            }
          >
            Validate and restore pasted JSON
          </Button>
        </details>
        <label className="field-stack mt-3">
          Import workspace JSON or archive ZIP
          <input
            aria-label="Import complete project"
            type="file"
            accept=".json,.zip"
            onChange={(e) => {
              const file = e.target.files?.[0]
              e.currentTarget.value = ""
              if (file) {
                void act(async () => {
                  const next = file.name.endsWith(".zip")
                    ? await importArchive(new Uint8Array(await file.arrayBuffer()))
                    : await importProjectJson(await file.text())
                  onReplace(next)
                })
              }
            }}
          />
        </label>
        <InlineWarning title="External artifacts">
          Original QM files, geometries, and topologies are bundled inside the archive. Full GROMACS trajectories and external force-field installations remain on disk/HPC.
        </InlineWarning>
      </Section>

      <Section title="Manual production continuation">
        <p>Select a frozen run above to record checkpoint continuation commands (`gmx convert-tpr` + `gmx mdrun -cpi -append`).</p>
        <div className="form-grid form-grid-2">
          <Field label="Completed production time (ns)" type="number" value={completed} onChange={setCompleted} />
          <Field label="Checkpoint SHA-256" value={checkpoint} onChange={setCheckpoint} />
          <Field label="Execution log reference" value={executionEvidence} onChange={setExecutionEvidence} />
          <label className="field-stack">
            Action
            <select
              aria-label="Production continuation action"
              value={continuationAction}
              onChange={(e) => setContinuationAction(e.target.value as typeof continuationAction)}
              className="h-9 border px-2 text-sm bg-white"
            >
              <option value="continue">Continue from checkpoint</option>
              <option value="stop">Stop production</option>
            </select>
          </label>
        </div>
        <TextField label="Rationale" value={continuationReason} onChange={setContinuationReason} />
        <Button
          disabled={!runId}
          onClick={() =>
            void act(() => {
              const decision = recordContinuation(w, {
                runId,
                completedNs: Number(completed),
                action: continuationAction,
                checkpointSha256: checkpoint,
                executionEvidence,
                rationale: continuationReason,
              })
              onReplace({ ...w, decisions: [...w.decisions, decision] })
            })
          }
        >
          Record &amp; generate continuation command
        </Button>
        {continuation && (
          <>
            <p className="mt-2">
              {String(continuation.interpretation)} End time: {String(continuation.nextEndNs)} ns.
            </p>
            <pre className="text-xs overflow-auto">{String(continuation.commands)}</pre>
            <Button variant="outline" onClick={() => downloadText("continuation.sh", String(continuation.commands))}>
              Download continuation.sh
            </Button>
          </>
        )}
      </Section>

      <Section title="Preparation & Provenance Report">
        <div className="section-actions">
          <Button onClick={() => downloadJson("preparation-report.json", preparationReport(w, graph))}>Report JSON</Button>
          <Button variant="outline" onClick={() => downloadText("preparation-report.html", reportHtml(w), "text/html")}>
            Printable HTML
          </Button>
          <Button variant="outline" onClick={() => downloadText("runs.csv", runsCsv(w.runs), "text/csv")}>
            Runs CSV
          </Button>
          <Button
            variant="outline"
            onClick={() =>
              downloadText(
                "provenance.csv",
                toCsv([["id", "category", "status", "detail", "parents"], ...coverage.map((c) => [c.id, c.category, c.status, c.detail, c.parents.join(" ")])]),
                "text/csv",
              )
            }
          >
            Provenance CSV
          </Button>
          <Button variant="outline" onClick={() => setShowReport(!showReport)}>
            {showReport ? "Hide JSON" : "Inspect JSON"}
          </Button>
        </div>
        {showReport && (
          <pre aria-label="Preparation report JSON" className="text-xs overflow-auto max-h-96 mt-3">
            {JSON.stringify(preparationReport(w, graph), null, 2)}
          </pre>
        )}
      </Section>

      <Section title="Provenance trace">
        <table className="w-full text-xs">
          <thead>
            <tr>
              <th>Record</th>
              <th>Category</th>
              <th>Status</th>
              <th>Detail</th>
            </tr>
          </thead>
          <tbody>
            {coverage.map((c) => (
              <tr key={c.id}>
                <td>
                  <button className="underline text-left break-all" onClick={() => setNodeId(c.id)}>
                    {c.id}
                  </button>
                </td>
                <td>{c.category}</td>
                <td>{c.status}</td>
                <td>{c.detail}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {node && (
          <div className="mt-4">
            <p className="text-xs font-semibold">
              {node.type} · {node.status} · {node.actor} · v{node.softwareVersion}
            </p>
            <pre className="text-xs overflow-auto max-h-80">{JSON.stringify(node, null, 2)}</pre>
          </div>
        )}
      </Section>
    </>
  )
}
