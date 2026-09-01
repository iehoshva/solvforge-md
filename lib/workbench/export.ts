import type { ProjectState, RDFDataset, RunRecord, ScientificState } from "./types"
import { THESIS_DENSITY_REFERENCES_323K } from "./density-presets"
import { commands, emMdp, nptMdp, nvtMdp, prodMdp } from "./runs"
import { commandText, generateBlockRdfCommands, generateIndexNdx, generatePackedGro, generatePackmolInput, generateRdfCommands, generateSsmPreparationCommands, generateTopolTop, GROMACS_STAGE_COMMANDS, preparationPackageFiles, validatePackedSystem, type OrcaGromacsState } from "./orca-gromacs"

export function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function downloadJson(filename: string, data: unknown) {
  downloadBlob(filename, new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }))
}

export function downloadText(filename: string, text: string, type = "text/plain") {
  downloadBlob(filename, new Blob([text], { type }))
}

function crc32(data: Uint8Array) {
  let crc = 0xffffffff
  for (const byte of data) {
    crc ^= byte
    for (let j = 0; j < 8; j++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1))
  }
  return (crc ^ 0xffffffff) >>> 0
}

function u16(n: number) { return [n & 255, (n >>> 8) & 255] }
function u32(n: number) { return [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255] }

export function makeZip(files: Array<{ path: string; content: string }>) {
  const encoder = new TextEncoder()
  const local: number[] = [], central: number[] = []
  let offset = 0
  for (const file of files) {
    const name = encoder.encode(file.path), data = encoder.encode(file.content), crc = crc32(data)
    const header = [...u32(0x04034b50), ...u16(20), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(name.length), ...u16(0)]
    local.push(...header, ...name, ...data)
    const c = [...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(name.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(offset)]
    central.push(...c, ...name)
    offset += header.length + name.length + data.length
  }
  const end = [...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(files.length), ...u16(files.length), ...u32(central.length), ...u32(local.length), ...u16(0)]
  return new Blob([new Uint8Array([...local, ...central, ...end])], { type: "application/zip" })
}

function compositionPreparationNotes(run: RunRecord) {
  const calculation = run.compositionCalculation
  if (!calculation) return `BOX COMPOSITION UNRESOLVED\n\nRun: ${run.runId}\nNo absolute solvent composition was generated. Provide positive manual component counts or a supported box geometry, target density at the state-point temperature, valid integer molar ratio, and molecular weights.\n\nDiagnostics:\n${run.compositionDiagnostics.map((item) => `[${item.severity}] ${item.code}: ${item.message}`).join("\n") || "No diagnostics recorded."}\n`
  const species = [...run.components.map((component) => ({ id: component.moleculeId, name: component.name, count: component.count, mw: component.molecularWeight })), { id: run.soluteId, name: run.soluteName, count: run.soluteCount, mw: calculation.molecularWeightsUsed[run.soluteId] }]
  return `BOX COMPOSITION PREPARATION NOTES\n\nRun: ${run.runId}\nMethod: ${calculation.mode}\nSolute-mass assumption: ${calculation.soluteMassMode}\nLock DES counts across series: ${calculation.lockAcrossSeries}\nRequested ratio: ${calculation.ratio.join(":")}\nActual DES ratio: ${calculation.actualDesRatio.map((value) => value.toFixed(8)).join(":")}\nBox input: ${calculation.boxInput.x} x ${calculation.boxInput.y} x ${calculation.boxInput.z} ${calculation.boxInput.unit}; ${calculation.boxInput.geometry}\nCanonical box: ${calculation.boxDimensionsNm.x} x ${calculation.boxDimensionsNm.y} x ${calculation.boxDimensionsNm.z} nm\nVolume: ${calculation.volumeNm3} nm^3\nTarget density: ${calculation.targetDensityGcm3 ?? "not supplied"} g cm^-3\nDensity reference temperature: ${calculation.densityReferenceTemperatureK ?? "not supplied"} K\nDensity label / reference: ${calculation.densityLabel || "not supplied"}; ${calculation.densityReferenceId ?? "custom record"}\nDensity provenance: ${calculation.densityStatus ?? "not supplied"}; derivation=${calculation.densityDerivation ?? "not supplied"}\nDensity uncertainty: ${calculation.densityUncertaintyGcm3 ?? "not quantified"} g cm^-3\nDensity source note: ${calculation.densitySourceNote || "no source note"}\nDensity method: ${calculation.densityMethodNote || "not supplied"}\nDensity citations: ${calculation.densitySources.map((source) => `${source.citation} — ${source.url}`).join(" | ") || "not supplied"}\nDensity resolution: ${calculation.densityResolution}\nEstimated total density: ${calculation.estimatedDensityGcm3 ?? "unavailable"} g cm^-3\nEstimated DES-only density: ${calculation.desOnlyDensityGcm3 ?? "unavailable"} g cm^-3\nTarget-density deviation: ${calculation.densityDeviationPct ?? "unavailable"} %\n\nSPECIES\n${species.map((item) => `${item.name} [${item.id}]: N=${item.count}; MW=${item.mw ?? "missing"} g mol^-1; x=${calculation.moleFractions[item.id] ?? "unavailable"}; w=${calculation.massFractions[item.id] ?? "unavailable"}; number density=${calculation.numberDensitiesNm3[item.id] ?? "unavailable"} molecules nm^-3`).join("\n")}\n\nTotal number density: ${calculation.totalNumberDensityNm3} molecules nm^-3\n\nDIAGNOSTICS\n${run.compositionDiagnostics.map((item) => `[${item.severity}] ${item.code}: ${item.message}`).join("\n") || "No diagnostics."}\n\nReview molecular structures, protonation states, topology compatibility, and packing/equilibration before production. The mass-density calculation provides an integer starting composition, not a guarantee of equilibrated density.\n`
}

export function exportProjectZip(project: ProjectState, runs: RunRecord[], datasets: RDFDataset[] = [], scientific?: ScientificState, orcaGromacs?: OrcaGromacsState) {
  const root = `${project.projectAbbreviation.toLowerCase()}-md-workbench`
  const files: Array<{ path: string; content: string }> = [
    { path: `${root}/project_manifest.json`, content: JSON.stringify(project, null, 2) },
    { path: `${root}/protocol.json`, content: JSON.stringify(project.protocol, null, 2) },
    { path: `${root}/molecule_library.json`, content: JSON.stringify(project.molecules, null, 2) },
    { path: `${root}/presets/density_reference_library_323.15K.json`, content: JSON.stringify(THESIS_DENSITY_REFERENCES_323K, null, 2) },
    { path: `${root}/simulation_manifest.json`, content: JSON.stringify(runs, null, 2) },
    { path: `${root}/composition_manifest.csv`, content: runsCsv(runs) },
    { path: `${root}/analysis/rdf_datasets.json`, content: JSON.stringify(datasets, null, 2) },
    ...(scientific ? [{ path: `${root}/analysis/scientific_state.json`, content: JSON.stringify(scientific, null, 2) }] : []),
    { path: `${root}/presets/active_preset.json`, content: JSON.stringify({ name: project.presetName, project }, null, 2) },
    ...(orcaGromacs ? [{ path: `${root}/manifests/orca_gromacs_state.json`, content: JSON.stringify(orcaGromacs, null, 2) }] : []),
    { path: `${root}/README.txt`, content: "SolvForge MD v1.0\n\nRun order: prepare and validate each molecule from ORCA → calculate box composition → run Packmol → validate packed coordinates against topol.top → grompp/mdrun EM → NVT → NPT → production → gmx rdf → KBI.\n\nGenerated inputs are research artifacts, not a guarantee of scientific validity. Review every atom mapping, OPLS-AA type, bonded parameter, Mulliken charge, molecular count, density source, index/selection group, coupling group, MDP directive, and GROMACS diagnostic. Absolute molecule counts are never inferred from a molar ratio alone. ORCA supplies geometry and charges; it does not supply an OPLS-AA force field. Never use an INCOMPLETE molecular .itp for production MD.\n" },
    ...(orcaGromacs ? [{ path: `${root}/README_ORCA_TO_GROMACS.txt`, content: "ORCA → GROMACS PREPARATION\n\n1. Inspect original .xyz and .out files in molecules/*/source.\n2. Audit atom_mapping.csv and charges.csv. Atom order is preserved; Mulliken charges are not normalized.\n3. Run/review x2top or another defensible OPLS-AA parameter mapping. Confirm atom types, LJ parameters, bonds, angles, proper/improper torsions, pairs, and exclusions.\n4. Accept connectivity and topology only after chemical review. Run gmx grompp; do not suppress unresolved errors.\n5. Run Packmol with packing/<RUN_ID>/packmol.inp. Import packed.pdb into the Workbench and validate species/atom counts.\n6. Use generated packed.gro, topol.top, index.ndx and editable .mdp files for EM, NVT, NPT, and production.\n7. Inspect maximum force, temperature, density/volume, pressure, LINCS messages, replica consistency, and block convergence.\n8. Run scripts/rdf_all_pairs.sh and import RDF .xvg files into KBI Analyzer.\n\nThe thesis preset records OPLS-AA plus raw ORCA BP86/def2-TZVP Mulliken partial charges.\n" }] : []),
  ]
  if (orcaGromacs) {
    for (const file of preparationPackageFiles(orcaGromacs)) files.push({ path: `${root}/${file.path}`, content: file.content })
    for (const preparation of Object.values(orcaGromacs.molecules)) {
      if (preparation.xyzFile) files.push({ path: `${root}/orca/${preparation.moleculeId}/${preparation.xyzFile.name}`, content: preparation.xyzFile.text })
      if (preparation.outFile) files.push({ path: `${root}/orca/${preparation.moleculeId}/${preparation.outFile.name}`, content: preparation.outFile.text })
    }
  }
  for (const run of runs) {
    const base = `${root}/runs/${run.runId}`
    files.push(
      { path: `${base}/metadata.json`, content: JSON.stringify(run, null, 2) },
      { path: `${base}/composition.json`, content: JSON.stringify({ components: run.components, solute: { moleculeId: run.soluteId, name: run.soluteName, count: run.soluteCount }, calculation: run.compositionCalculation, diagnostics: run.compositionDiagnostics }, null, 2) },
      { path: `${base}/molecule_manifest.json`, content: JSON.stringify({ components: run.components, solute: project.molecules.find((molecule) => molecule.id === run.soluteId), molecularWeightsUsed: run.compositionCalculation?.molecularWeightsUsed ?? {} }, null, 2) },
      { path: `${base}/01_em/em.mdp`, content: emMdp(project) },
      { path: `${base}/02_nvt/nvt.mdp`, content: nvtMdp(project, run) },
      { path: `${base}/03_npt/npt.mdp`, content: nptMdp(project, run) },
      { path: `${base}/04_prod/prod.mdp`, content: prodMdp(project, run) },
      { path: `${base}/commands.sh`, content: commands(run) },
      { path: `${base}/00_input/README.txt`, content: `Place reviewed coordinates, topology, force-field files, and index files here.\n\n${compositionPreparationNotes(run)}` },
      { path: `${base}/00_input/composition-preparation.txt`, content: compositionPreparationNotes(run) },
      { path: `${base}/analysis/rdf/.keep`, content: "" },
      { path: `${base}/analysis/blocks/.keep`, content: "" },
      { path: `${base}/analysis/kbi/.keep`, content: "" },
      { path: `${base}/analysis/ssm/.keep`, content: "" },
      { path: `${base}/analysis/kb_matrix/.keep`, content: "" },
      { path: `${base}/analysis/thermo/.keep`, content: "" },
      { path: `${base}/analysis/cosmo_validation/.keep`, content: "" },
    )
    if (orcaGromacs) {
      const packed = orcaGromacs.packedSystems[run.runId]
      const packDiagnostics = validatePackedSystem(run, packed ?? null, orcaGromacs.molecules)
      const editable = (filename: string, generated: string) => commandText(orcaGromacs, `run:${run.runId}:${filename}`, generated)
      files.push(
        { path: `${root}/packing/${run.runId}/packmol.inp`, content: editable("packmol.inp", generatePackmolInput(run, orcaGromacs.molecules, orcaGromacs.packmol)) },
        { path: `${root}/packing/${run.runId}/run_packmol.sh`, content: `#!/usr/bin/env bash\nset -euo pipefail\n${editable("run_packmol.sh", "packmol < packmol.inp")}\n` },
        { path: `${root}/topology/${run.runId}/topol.top`, content: generateTopolTop(run, orcaGromacs.molecules, "../../molecules") },
        { path: `${base}/00_input/topol.top`, content: generateTopolTop(run, orcaGromacs.molecules) },
        { path: `${root}/scripts/${run.runId}/em.sh`, content: editable("em.sh", GROMACS_STAGE_COMMANDS.em) },
        { path: `${root}/scripts/${run.runId}/nvt.sh`, content: editable("nvt.sh", GROMACS_STAGE_COMMANDS.nvt) },
        { path: `${root}/scripts/${run.runId}/npt.sh`, content: editable("npt.sh", GROMACS_STAGE_COMMANDS.npt) },
        { path: `${root}/scripts/${run.runId}/production.sh`, content: editable("production.sh", GROMACS_STAGE_COMMANDS.production) },
        { path: `${root}/scripts/${run.runId}/rdf_all_pairs.sh`, content: editable("rdf_all_pairs.sh", generateRdfCommands(run, orcaGromacs.molecules, orcaGromacs.rdf)) },
        { path: `${root}/scripts/${run.runId}/rdf_blocks.sh`, content: editable("rdf_blocks.sh", generateBlockRdfCommands(run, orcaGromacs.molecules, orcaGromacs.rdf)) },
        { path: `${root}/scripts/${run.runId}/ssm_prepare.sh`, content: editable("ssm_prepare.sh", generateSsmPreparationCommands(run, orcaGromacs.molecules, orcaGromacs)) },
        { path: `${root}/manifests/${run.runId}_preparation_validation.json`, content: JSON.stringify({ packedSystemImported: Boolean(packed), diagnostics: packDiagnostics, execution: orcaGromacs.execution[run.runId] ?? null }, null, 2) },
        { path: `${base}/run_em.sh`, content: editable("em.sh", GROMACS_STAGE_COMMANDS.em) },
        { path: `${base}/run_nvt.sh`, content: editable("nvt.sh", GROMACS_STAGE_COMMANDS.nvt) },
        { path: `${base}/run_npt.sh`, content: editable("npt.sh", GROMACS_STAGE_COMMANDS.npt) },
        { path: `${base}/run_production.sh`, content: editable("production.sh", GROMACS_STAGE_COMMANDS.production) },
        { path: `${base}/analysis/rdf/rdf_all_pairs.sh`, content: editable("rdf_all_pairs.sh", generateRdfCommands(run, orcaGromacs.molecules, orcaGromacs.rdf)) },
        { path: `${base}/analysis/blocks/rdf_blocks.sh`, content: editable("rdf_blocks.sh", generateBlockRdfCommands(run, orcaGromacs.molecules, orcaGromacs.rdf)) },
        { path: `${base}/analysis/ssm/ssm_prepare.sh`, content: editable("ssm_prepare.sh", generateSsmPreparationCommands(run, orcaGromacs.molecules, orcaGromacs)) },
      )
      for (const species of run.components.map((component) => component.moleculeId).concat(run.soluteId)) {
        const preparation = orcaGromacs.molecules[species]
        if (preparation) files.push({ path: `${base}/00_input/${species.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "")}.itp`, content: preparationPackageFiles({ ...orcaGromacs, molecules: { [species]: preparation } }).find((file) => file.path.endsWith(".itp"))?.content ?? "; INCOMPLETE — molecular topology unavailable\n" })
      }
      if (packed) {
        files.push(
          { path: `${root}/packing/${run.runId}/${packed.sourceFile.name}`, content: packed.sourceFile.text },
          { path: `${root}/packing/${run.runId}/packed.gro`, content: generatePackedGro(run, packed) },
          { path: `${root}/topology/${run.runId}/index.ndx`, content: generateIndexNdx(packed, run, orcaGromacs.molecules) },
          { path: `${base}/00_input/${packed.sourceFile.name}`, content: packed.sourceFile.text },
          { path: `${base}/00_input/packed.gro`, content: generatePackedGro(run, packed) },
          { path: `${base}/00_input/index.ndx`, content: generateIndexNdx(packed, run, orcaGromacs.molecules) },
        )
      }
    }
  }
  return makeZip(files)
}

export function runsCsv(runs: RunRecord[]) {
  const header = ["run_id", "stage", "des", "solute", "solute_count", "total_molecule_count", "solute_mole_fraction", "all_mole_fractions_json", "mass_fractions_json", "number_densities_nm-3_json", "total_number_density_nm-3", "component_counts_and_mw_json", "composition_mode", "solute_mass_mode", "lock_des_counts", "lock_reference_solute_count", "requested_ratio", "actual_des_ratio", "ratio_multiplier", "molecular_weights_used_json", "target_density_g_cm-3", "estimated_density_g_cm-3", "des_only_density_g_cm-3", "density_deviation_pct", "density_reference_temperature_K", "density_status", "density_resolution", "density_reference_id", "density_label", "density_derivation", "density_uncertainty_g_cm-3", "density_method_note", "density_sources_json", "density_source_note", "composition_diagnostics_json", "box_volume_nm3", "temperature_K", "pressure_bar", "box_nm", "box_input_unit", "box_geometry", "replica", "seed", "production_ns"]
  const rows = runs.map((r) => { const c = r.compositionCalculation; const box = c?.boxDimensionsNm; return [r.runId, r.stage, r.desName, r.soluteName, r.soluteCount, r.totalMoleculeCount ?? "", r.moleFraction ?? "", JSON.stringify(r.moleFractions), JSON.stringify(r.massFractions), JSON.stringify(r.numberDensitiesNm3), c?.totalNumberDensityNm3 ?? "", JSON.stringify(r.components), c?.mode ?? "unresolved", c?.soluteMassMode ?? "", c?.lockAcrossSeries ?? "", c?.lockReferenceSoluteCount ?? "", c?.ratio.join(":") ?? "", c?.actualDesRatio.join(":") ?? "", c?.multiplier ?? "", JSON.stringify(c?.molecularWeightsUsed ?? {}), c?.targetDensityGcm3 ?? "", c?.estimatedDensityGcm3 ?? "", c?.desOnlyDensityGcm3 ?? "", c?.densityDeviationPct ?? "", c?.densityReferenceTemperatureK ?? "", c?.densityStatus ?? "", c?.densityResolution ?? "", c?.densityReferenceId ?? "", c?.densityLabel ?? "", c?.densityDerivation ?? "", c?.densityUncertaintyGcm3 ?? "", c?.densityMethodNote ?? "", JSON.stringify(c?.densitySources ?? []), c?.densitySourceNote ?? "", JSON.stringify(r.compositionDiagnostics), r.boxVolumeNm3, r.temperatureK, r.pressureBar, box ? `${box.x}x${box.y}x${box.z}` : "", c?.boxInput.unit ?? r.box.unit ?? "nm", r.box.geometry, r.replica, r.randomSeed, r.productionNs] })
  return [header, ...rows].map((row) => row.map((v) => `"${String(v).replaceAll('"', '""')}"`).join(",")).join("\n")
}
