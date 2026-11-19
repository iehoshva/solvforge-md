import type { Workspace, ProvenanceNode } from "./workspace"
import { reconcileRun } from "./packages.ts"
import { SOFTWARE_VERSION, SCHEMA_VERSION } from "./version.ts"

export function provenanceGraph(w: Workspace): ProvenanceNode[] {
  const nodes = new Map<string, ProvenanceNode>()
  const add = (
    id: string,
    type: string,
    parentIds: string[],
    payload: unknown,
    issues: string[] = [],
    actor: ProvenanceNode["actor"] = "automatic",
    version = SOFTWARE_VERSION,
    timestamp = w.savedAt,
    status: ProvenanceNode["status"] = "present",
  ) => {
    nodes.set(id, {
      id,
      projectId: w.projectId,
      type,
      parentIds: [...new Set(parentIds.filter(Boolean))],
      payload,
      issues: [...issues],
      actor,
      softwareVersion: version,
      timestamp,
      status: issues.length ? "incomplete" : status,
    })
  }

  add(w.projectId, "Project", [], w.project, [], "researcher", w.project.createdWithVersion ?? "UNKNOWN", w.project.createdAt)

  for (const run of w.runs) {
    const p = run.resolvedProtocol
    if (p) add(p.id, "ResolvedProtocol", [w.projectId], p, [], "automatic", p.softwareVersion, run.generatedAt)
    const def = "definition-" + run.runId
    add(
      def,
      "MolecularSystem",
      [w.projectId],
      { molecules: run.molecularSnapshot, composition: run.compositionCalculation, state: run.scientificState },
      run.scientificState ? [] : ["Molecular composition unresolved."],
    )
    add(
      run.runId,
      "Run",
      [p?.id ?? "UNKNOWN-PROTOCOL-" + run.runId, def],
      { ...run, inputSnapshots: undefined },
      reconcileRun(w.project, run),
      "automatic",
      run.createdWithVersion ?? "UNKNOWN",
      run.generatedAt,
    )
    for (const snapshot of run.inputSnapshots ?? []) {
      const sourceIds: string[] = []
      for (const [mol, raw] of Object.entries((snapshot.molecularSources ?? {}) as Record<string, Record<string, unknown>>)) {
        const source = (label: string, file: unknown) => {
          const f = file as { sha256?: string; importedAt?: string } | null | undefined
          if (!f?.sha256) return null
          const id = "source-" + f.sha256
          add(id, label, [], f, [], "unknown", "imported-source", f.importedAt)
          return id
        }
        const parents = [
          source("Molecular Geometry", raw.geometryFile),
          source("QM Output / Charges", raw.qmFile),
          source("Force-Field Topology", raw.originalTopologyFile),
        ].filter((id): id is string => Boolean(id))
        const id = `mapping-${snapshot.id}-${mol}`
        add(id, "AtomChargeTopologyMapping", parents, raw, [], "researcher", snapshot.softwareVersion, snapshot.generatedAt)
        sourceIds.push(id)
      }
      add(snapshot.id, "GeneratedInput", [run.runId, ...sourceIds], snapshot, [], "automatic", snapshot.softwareVersion, snapshot.generatedAt)
    }
  }

  for (const [runId, execution] of Object.entries(w.qmGromacs.execution)) {
    for (const d of execution.history ?? []) {
      add(d.id, "ExecutionReview", [runId], d, [], "researcher", d.softwareVersion, d.timestamp)
    }
  }

  for (const d of w.decisions) {
    if (typeof d.id === "string") {
      add(
        d.id,
        String(d.type ?? "ResearchDecision"),
        Array.isArray(d.sourceIds) ? (d.sourceIds as string[]) : [],
        d,
        [],
        "researcher",
        String(d.softwareVersion ?? "UNKNOWN"),
        String(d.timestamp ?? w.savedAt),
      )
    }
  }

  for (const n of nodes.values()) {
    const missing = n.parentIds.filter((id) => !nodes.has(id))
    if (missing.length) {
      n.status = "incomplete"
      n.issues.push("Missing ancestors: " + missing.join(", "))
    }
  }
  for (let pass = 0; pass < nodes.size; pass++) {
    let changed = false
    for (const n of nodes.values()) {
      if (
        n.status !== "incomplete" &&
        n.parentIds.some((id) => {
          const parent = nodes.get(id)
          return !parent || parent.status === "incomplete" || parent.status === "rejected"
        })
      ) {
        n.status = "incomplete"
        n.issues.push("One or more upstream records are incomplete or rejected.")
        changed = true
      }
    }
    if (!changed) break
  }
  return [...nodes.values()]
}

export function provenanceCoverage(w: Workspace, graph = provenanceGraph(w)) {
  const rows = graph.map((n) => ({
    id: n.id,
    category: n.type,
    status: n.issues.length ? (n.issues.some((s) => /disagree|conflict|inconsistent/.test(s)) ? "INCONSISTENT" : "MISSING") : "PRESENT",
    detail: n.issues.join(" ") || n.status,
    parents: n.parentIds,
  }))
  for (const type of ["Run", "AtomChargeTopologyMapping", "GeneratedInput"]) {
    if (!graph.some((n) => n.type === type)) {
      rows.push({ id: "none-" + type, category: type, status: "NOT_APPLICABLE", detail: "No records of this type yet.", parents: [] })
    }
  }
  return rows
}

export function preparationReport(w: Workspace, graph = provenanceGraph(w)) {
  return {
    title: "SolvForge MD — QM → GROMACS Preparation & Provenance Report",
    generatedAt: new Date().toISOString(),
    generatedWithVersion: SOFTWARE_VERSION,
    currentSchemaVersion: SCHEMA_VERSION,
    projectHistory: {
      createdWithVersion: w.project.createdWithVersion,
      originalSchemaVersion: w.project.originalSchemaVersion,
      lastOpenedWithVersion: w.project.lastOpenedWithVersion,
      migrationHistory: w.project.migrationHistory,
    },
    projectId: w.projectId,
    projectName: w.project.projectName,
    forceField: w.project.protocol.forceField,
    chargeScheme: w.project.protocol.chargeScheme,
    provenance: graph,
    coverage: provenanceCoverage(w, graph),
    note: "External execution (Packmol, gmx grompp, gmx mdrun) and downstream analysis (e.g. MoDy Analyse) remain external researcher responsibilities.",
  }
}

const escapeHtml = (v: unknown) =>
  String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!)

export function reportHtml(w: Workspace) {
  const report = preparationReport(w)
  return (
    '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>SolvForge MD Preparation Report</title><style>body{font:14px/1.5 system-ui;margin:30px;max-width:1200px}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:11px}section{border-top:1px solid #aaa;margin:18px 0}a{color:#245440}@media print{details{display:block}details>*{display:block}}</style></head><body><h1>' +
    escapeHtml(report.title) +
    "</h1><p>" +
    escapeHtml(report.projectName) +
    " · Force field: " +
    escapeHtml(report.forceField) +
    " · " +
    escapeHtml(report.generatedAt) +
    " · v" +
    escapeHtml(report.generatedWithVersion) +
    "</p><p>" +
    escapeHtml(report.note) +
    "</p><pre>" +
    escapeHtml(JSON.stringify(report.projectHistory, null, 2)) +
    "</pre>" +
    report.provenance
      .map(
        (n) =>
          '<section id="' +
          escapeHtml(n.id) +
          '"><h2>' +
          escapeHtml(n.type) +
          " · " +
          escapeHtml(n.id) +
          "</h2><p>" +
          escapeHtml(n.status) +
          "; actor=" +
          escapeHtml(n.actor) +
          "; software=" +
          escapeHtml(n.softwareVersion) +
          "; " +
          escapeHtml(n.timestamp) +
          "</p><p>" +
          escapeHtml(n.issues.join(" ")) +
          "</p><p>Parents: " +
          n.parentIds.map((id) => '<a href="#' + escapeHtml(id) + '">' + escapeHtml(id) + "</a>").join(", ") +
          "</p><details open><summary>Record details</summary><pre>" +
          escapeHtml(JSON.stringify(n.payload, null, 2)) +
          "</pre></details></section>",
      )
      .join("") +
    "</body></html>"
  )
}
