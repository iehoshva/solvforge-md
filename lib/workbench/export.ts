import type { ProjectState, RunRecord } from "./types"
import { makeZip } from "./zip.ts"
export { makeZip } from "./zip.ts"
import { commands, firstContinuation } from "./runs.ts"
import { SOFTWARE_VERSION } from "./version.ts"

export function clearPreparedExport() {
  if (typeof document === "undefined") return
  const previous = document.getElementById("solvforge-prepared-export")
  if (previous) {
    const link = previous.querySelector("a")
    if (link) URL.revokeObjectURL(link.href)
    previous.remove()
  }
}

export function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob)
  clearPreparedExport()
  const panel = document.createElement("div")
  panel.id = "solvforge-prepared-export"
  panel.setAttribute("role", "status")
  panel.style.cssText =
    "position:fixed;bottom:16px;right:16px;z-index:1000;background:#fff;color:#162b22;border:1px solid #547361;padding:12px;max-width:90vw;font:14px system-ui;box-shadow:0 2px 10px #0002"
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  a.textContent = "Download " + filename
  a.style.textDecoration = "underline"
  const dismiss = document.createElement("button")
  dismiss.textContent = "Dismiss"
  dismiss.style.marginLeft = "16px"
  dismiss.onclick = () => {
    URL.revokeObjectURL(url)
    panel.remove()
  }
  panel.appendChild(a)
  panel.appendChild(dismiss)
  document.body.appendChild(panel)
  a.click()
}

export function downloadJson(filename: string, data: unknown) {
  downloadBlob(filename, new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }))
}

export function downloadText(filename: string, text: string, type = "text/plain") {
  downloadBlob(filename, new Blob([text], { type }))
}

export function compositionPreparationNotes(run: RunRecord) {
  const calculation = run.compositionCalculation
  if (!calculation) {
    return `BOX COMPOSITION UNRESOLVED\n\nRun: ${run.runId}\nSupply manual molecule counts or target density + molecular weights.\n\nDiagnostics:\n${run.compositionDiagnostics.map((item) => `[${item.severity}] ${item.code}: ${item.message}`).join("\n") || "None"}\n`
  }
  const species = [
    ...run.components.map((component) => ({ id: component.moleculeId, name: component.name, count: component.count, mw: component.molecularWeight })),
    ...(run.soluteId && run.soluteCount > 0
      ? [{ id: run.soluteId, name: run.soluteName ?? run.soluteId, count: run.soluteCount, mw: calculation.molecularWeightsUsed[run.soluteId] }]
      : []),
  ]
  return [
    "BOX COMPOSITION PREPARATION NOTES",
    "",
    `Run: ${run.runId}`,
    `System: ${run.systemName} (${run.systemKind})`,
    `Method: ${calculation.mode}`,
    `Box: ${calculation.boxDimensionsNm.x} x ${calculation.boxDimensionsNm.y} x ${calculation.boxDimensionsNm.z} nm (V = ${calculation.volumeNm3} nm^3)`,
    `Target density: ${calculation.targetDensityGcm3 ?? "not supplied"} g cm^-3`,
    `Estimated density: ${calculation.estimatedDensityGcm3 ?? "unavailable"} g cm^-3`,
    "",
    "SPECIES",
    ...species.map(
      (item) =>
        `${item.name} [${item.id}]: N=${item.count}; MW=${item.mw ?? "n/a"} g mol^-1; x=${calculation.moleFractions[item.id] ?? "n/a"}; w=${calculation.massFractions[item.id] ?? "n/a"}`,
    ),
    "",
    `Total number density: ${calculation.totalNumberDensityNm3} molecules nm^-3`,
    "",
  ].join("\n")
}

export function exportProjectZip(project: ProjectState, runs: RunRecord[]) {
  const files: Array<{ path: string; content: string }> = [
    { path: "project_manifest.json", content: JSON.stringify(project, null, 2) },
    { path: "simulation_manifest.json", content: JSON.stringify(runs, null, 2) },
    {
      path: "README.txt",
      content: `SolvForge MD ${SOFTWARE_VERSION} MDP Planning Package. Pair with mapped topologies and packed coordinates in QM → GROMACS, then export a complete Run Input Package from Packages & Provenance.`,
    },
  ]
  for (const run of runs) {
    if (!run.resolvedProtocol || run.resolvedProtocol.diagnostics.some((d) => d.severity === "ERROR")) {
      throw new Error("Resolve all MDP errors before planning export.")
    }
    const base = "runs/" + run.runId
    files.push(
      { path: base + "/resolved_protocol.json", content: JSON.stringify(run.resolvedProtocol, null, 2) },
      {
        path: base + "/metadata.json",
        content: JSON.stringify(
          {
            runId: run.runId,
            systemKind: run.systemKind,
            soluteAbbreviation: run.soluteAbbreviation,
            replica: run.replica,
            temperatureK: run.temperatureK,
            pressureBar: run.pressureBar,
            forceField: run.forceField,
            chargeScheme: run.chargeScheme,
            components: run.components,
            soluteCount: run.soluteCount,
          },
          null,
          2,
        ),
      },
      { path: base + "/commands.sh", content: commands(run) },
    )
    if (run.resolvedProtocol.stages.prod?.enabled) {
      files.push({ path: base + "/04_prod/continuation.sh", content: firstContinuation(run) })
    }
    for (const [stage, dir] of [
      ["em", "01_em"],
      ["nvt", "02_nvt"],
      ["npt", "03_npt"],
      ["prod", "04_prod"],
    ] as const) {
      if (run.resolvedProtocol.stages[stage]?.enabled) {
        files.push({ path: `${base}/${dir}/${stage}.mdp`, content: run.resolvedProtocol.stages[stage].mdp })
      }
    }
  }
  return makeZip(files)
}

export function runsCsv(runs: RunRecord[]) {
  const header = [
    "run_id",
    "system_kind",
    "system",
    "solute",
    "solute_count",
    "total_molecule_count",
    "solute_mole_fraction",
    "force_field",
    "force_field_include",
    "charge_scheme",
    "temperature_K",
    "pressure_bar",
    "box_nm",
    "box_geometry",
    "replica",
    "seed",
    "production_ns",
  ]
  const rows = runs.map((r) => {
    const box = r.compositionCalculation?.boxDimensionsNm
    return [
      r.runId,
      r.systemKind,
      r.systemName,
      r.soluteName ?? "",
      r.soluteCount,
      r.totalMoleculeCount ?? "",
      r.moleFraction ?? "",
      r.forceField,
      r.forceFieldInclude,
      r.chargeScheme,
      r.temperatureK,
      r.pressureBar,
      box ? `${box.x}x${box.y}x${box.z}` : `${r.box.x}x${r.box.y}x${r.box.z}`,
      r.box.geometry,
      r.replica,
      r.randomSeed,
      r.productionNs,
    ]
  })
  return [header, ...rows].map((row) => row.map((v) => `"${String(v).replaceAll('"', '""')}"`).join(",")).join("\n")
}
