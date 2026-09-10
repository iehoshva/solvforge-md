import type { ProjectState, RunRecord } from "./types"
import { makeZip } from "./zip.ts"
export { makeZip } from "./zip.ts"
import { commands, firstContinuation } from "./runs.ts"

export function clearPreparedExport() {
  const previous=document.getElementById("solvforge-prepared-export")
  if(previous){const link=previous.querySelector("a");if(link)URL.revokeObjectURL(link.href);previous.remove()}
}

export function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob)
  clearPreparedExport()
  const panel=document.createElement("div")
  panel.id="solvforge-prepared-export"
  panel.setAttribute("role","status")
  panel.style.cssText="position:fixed;bottom:16px;right:16px;z-index:1000;background:#fff;color:#162b22;border:1px solid #547361;padding:12px;max-width:90vw;font:14px system-ui;box-shadow:0 2px 10px #0002"
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  a.textContent="Download "+filename
  a.style.textDecoration="underline"
  const dismiss=document.createElement("button")
  dismiss.textContent="Dismiss"
  dismiss.style.marginLeft="16px"
  dismiss.onclick=()=>{URL.revokeObjectURL(url);panel.remove()}
  panel.appendChild(a)
  panel.appendChild(dismiss)
  document.body.appendChild(panel)
  // Preserve a real, visible link if an asynchronous browser download is blocked.
  // The object URL is revoked on dismissal or replacement, not before retrieval.
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
  if (!calculation) return `BOX COMPOSITION UNRESOLVED\n\nRun: ${run.runId}\nNo absolute solvent composition was generated. Provide positive manual component counts or a supported box geometry, target density at the state-point temperature, valid integer molar ratio, and molecular weights.\n\nDiagnostics:\n${run.compositionDiagnostics.map((item) => `[${item.severity}] ${item.code}: ${item.message}`).join("\n") || "No diagnostics recorded."}\n`
  const species = [...run.components.map((component) => ({ id: component.moleculeId, name: component.name, count: component.count, mw: component.molecularWeight })), ...(run.systemKind === "pure-des" ? [] : [{ id: run.soluteId, name: run.soluteName, count: run.soluteCount, mw: calculation.molecularWeightsUsed[run.soluteId] }])]
  return `BOX COMPOSITION PREPARATION NOTES\n\nRun: ${run.runId}\nMethod: ${calculation.mode}\nSolute-mass assumption: ${calculation.soluteMassMode}\nLock DES counts across series: ${calculation.lockAcrossSeries}\nRequested ratio: ${calculation.ratio.join(":")}\nActual DES ratio: ${calculation.actualDesRatio.map((value) => value.toFixed(8)).join(":")}\nBox input: ${calculation.boxInput.x} x ${calculation.boxInput.y} x ${calculation.boxInput.z} ${calculation.boxInput.unit}; ${calculation.boxInput.geometry}\nCanonical box: ${calculation.boxDimensionsNm.x} x ${calculation.boxDimensionsNm.y} x ${calculation.boxDimensionsNm.z} nm\nVolume: ${calculation.volumeNm3} nm^3\nTarget density: ${calculation.targetDensityGcm3 ?? "not supplied"} g cm^-3\nDensity reference temperature: ${calculation.densityReferenceTemperatureK ?? "not supplied"} K\nDensity label / reference: ${calculation.densityLabel || "not supplied"}; ${calculation.densityReferenceId ?? "custom record"}\nDensity provenance: ${calculation.densityStatus ?? "not supplied"}; derivation=${calculation.densityDerivation ?? "not supplied"}\nDensity uncertainty: ${calculation.densityUncertaintyGcm3 ?? "not quantified"} g cm^-3\nDensity source note: ${calculation.densitySourceNote || "no source note"}\nDensity method: ${calculation.densityMethodNote || "not supplied"}\nDensity citations: ${calculation.densitySources.map((source) => `${source.citation} — ${source.url}`).join(" | ") || "not supplied"}\nDensity resolution: ${calculation.densityResolution}\nEstimated total density: ${calculation.estimatedDensityGcm3 ?? "unavailable"} g cm^-3\nEstimated DES-only density: ${calculation.desOnlyDensityGcm3 ?? "unavailable"} g cm^-3\nTarget-density deviation: ${calculation.densityDeviationPct ?? "unavailable"} %\n\nSPECIES\n${species.map((item) => `${item.name} [${item.id}]: N=${item.count}; MW=${item.mw ?? "missing"} g mol^-1; x=${calculation.moleFractions[item.id] ?? "unavailable"}; w=${calculation.massFractions[item.id] ?? "unavailable"}; number density=${calculation.numberDensitiesNm3[item.id] ?? "unavailable"} molecules nm^-3`).join("\n")}\n\nTotal number density: ${calculation.totalNumberDensityNm3} molecules nm^-3\n\nDIAGNOSTICS\n${run.compositionDiagnostics.map((item) => `[${item.severity}] ${item.code}: ${item.message}`).join("\n") || "No diagnostics."}\n\nReview molecular structures, protonation states, topology compatibility, and packing/equilibration before production. The mass-density calculation provides an integer starting composition, not a guarantee of equilibrated density.\n`
}

/** Planning-only package. Runnable inputs are validated/frozen by packages.runInputSnapshot. */
export function exportProjectZip(project:ProjectState,runs:RunRecord[]){
 const files:Array<{path:string;content:string}>=[{path:"project_manifest.json",content:JSON.stringify(project,null,2)},{path:"simulation_manifest.json",content:JSON.stringify(runs,null,2)},{path:"README.txt",content:"SolvForge MD MDP Planning Package. This is not a runnable system: supply mapped OPLS-AA topologies and validated packed coordinates through ORCA → GROMACS, then export a Run Input Package from Data / Export. GROMACS and Packmol execute externally."}]
 for(const run of runs){
  if(!run.resolvedProtocol||run.resolvedProtocol.diagnostics.some(d=>d.severity==="ERROR"))throw new Error("Resolve all MDP errors before planning export.")
  const base="runs/"+run.runId
  files.push({path:base+"/resolved_protocol.json",content:JSON.stringify(run.resolvedProtocol,null,2)},{path:base+"/metadata.json",content:JSON.stringify(run,null,2)},{path:base+"/commands.sh",content:commands(run)},{path:base+"/04_prod/continuation.sh",content:firstContinuation(run)})
  for(const [stage,dir]of [["em","01_em"],["nvt","02_nvt"],["npt","03_npt"],["prod","04_prod"]]as const)files.push({path:base+"/"+dir+"/"+stage+".mdp",content:run.resolvedProtocol.stages[stage].mdp})
 }
 return makeZip(files)
}

export function runsCsv(runs: RunRecord[]) {
  const header = ["run_id", "stage", "des", "solute", "solute_count", "total_molecule_count", "solute_mole_fraction", "all_mole_fractions_json", "mass_fractions_json", "number_densities_nm-3_json", "total_number_density_nm-3", "component_counts_and_mw_json", "composition_mode", "solute_mass_mode", "lock_des_counts", "lock_reference_solute_count", "requested_ratio", "actual_des_ratio", "ratio_multiplier", "molecular_weights_used_json", "target_density_g_cm-3", "estimated_density_g_cm-3", "des_only_density_g_cm-3", "density_deviation_pct", "density_reference_temperature_K", "density_status", "density_resolution", "density_reference_id", "density_label", "density_derivation", "density_uncertainty_g_cm-3", "density_method_note", "density_sources_json", "density_source_note", "composition_diagnostics_json", "box_volume_nm3", "temperature_K", "pressure_bar", "box_nm", "box_input_unit", "box_geometry", "replica", "seed", "production_ns"]
  const rows = runs.map((r) => { const c = r.compositionCalculation; const box = c?.boxDimensionsNm; return [r.runId, r.stage, r.desName, r.soluteName, r.soluteCount, r.totalMoleculeCount ?? "", r.moleFraction ?? "", JSON.stringify(r.moleFractions), JSON.stringify(r.massFractions), JSON.stringify(r.numberDensitiesNm3), c?.totalNumberDensityNm3 ?? "", JSON.stringify(r.components), c?.mode ?? "unresolved", c?.soluteMassMode ?? "", c?.lockAcrossSeries ?? "", c?.lockReferenceSoluteCount ?? "", c?.ratio.join(":") ?? "", c?.actualDesRatio.join(":") ?? "", c?.multiplier ?? "", JSON.stringify(c?.molecularWeightsUsed ?? {}), c?.targetDensityGcm3 ?? "", c?.estimatedDensityGcm3 ?? "", c?.desOnlyDensityGcm3 ?? "", c?.densityDeviationPct ?? "", c?.densityReferenceTemperatureK ?? "", c?.densityStatus ?? "", c?.densityResolution ?? "", c?.densityReferenceId ?? "", c?.densityLabel ?? "", c?.densityDerivation ?? "", c?.densityUncertaintyGcm3 ?? "", c?.densityMethodNote ?? "", JSON.stringify(c?.densitySources ?? []), c?.densitySourceNote ?? "", JSON.stringify(r.compositionDiagnostics), r.boxVolumeNm3, r.temperatureK, r.pressureBar, box ? `${box.x}x${box.y}x${box.z}` : "", c?.boxInput.unit ?? r.box.unit ?? "nm", r.box.geometry, r.replica, r.randomSeed, r.productionNs] })
  return [header, ...rows].map((row) => row.map((v) => `"${String(v).replaceAll('"', '""')}"`).join(",")).join("\n")
}
