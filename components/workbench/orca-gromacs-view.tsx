"use client"

import { createContext, useContext, useMemo, useState } from "react"
import { Archive, ArrowRight, Check, CircleAlert, Copy, Download, FileCode2, FileInput, Network, Play, Plus, RotateCcw, Trash2, Upload } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import type { Molecule, ProjectState, RDFDataset, RunRecord } from "@/lib/workbench/types"
import { parseXvg } from "@/lib/workbench/kbi"
import { downloadBlob, downloadJson, downloadText, exportProjectZip } from "@/lib/workbench/export"
import {
  applyEditedTopology,
  attachOrcaOutput,
  attachXyz,
  commandText,
  emptyMoleculePreparation,
  executionFor,
  generateAtomMappingCsv,
  generateBlockRdfCommands,
  generateChargesCsv,
  generateGro,
  generateIndexNdx,
  generateItp,
  generatePackedGro,
  generatePackmolInput,
  generatePdb,
  generateRdfCommands,
  generateSsmPreparationCommands,
  generateTopolTop,
  GROMACS_STAGE_COMMANDS,
  geometryDifference,
  importTopology,
  inferPairFromFilename,
  mappedChargeSum,
  orcaDiagnostics,
  pairwiseSpecies,
  parsePackedPdb,
  preparationStatus,
  projectChecklist,
  proposeConnectivity,
  rdfDatasetMetadata,
  reconcilePreparation,
  runSpecies,
  sourceFileRecord,
  topologyDiagnostics,
  validatePackedSystem,
  x2topCommand,
  type BondRecord,
  type MoleculePreparation,
  type OrcaGromacsState,
  type PrepDiagnostic,
} from "@/lib/workbench/orca-gromacs"
import { Field, InlineWarning, Metric, Section, StatusBadge, ViewHeader, formatNumber } from "./shared"

type Props = {
  project: ProjectState
  runs: RunRecord[]
  datasets: RDFDataset[]
  setDatasets: (datasets: RDFDataset[]) => void
  state: OrcaGromacsState
  setState: (state: OrcaGromacsState) => void
  openKbi: () => void
}

const now = () => new Date().toISOString()
const safeBase = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "molecule"
const inputClass = "h-8 min-w-20 font-mono text-xs"

function diagnosticTone(severity: PrepDiagnostic["severity"]) {
  return severity === "ERROR" ? "danger" : severity === "WARNING" ? "warning" : "accent"
}

function Diagnostics({ items, empty = "No validation findings." }: { items: PrepDiagnostic[]; empty?: string }) {
  if (!items.length) return <div className="prep-pass"><Check/><span>{empty}</span></div>
  return <div className="prep-diagnostics">{items.map((item, index) => <div className={`diagnostic diagnostic-${item.severity.toLowerCase()}`} key={`${item.code}-${index}`}><StatusBadge tone={diagnosticTone(item.severity)}>{item.severity}</StatusBadge><code>{item.code}</code><span>{item.message}</span></div>)}</div>
}

function FilePicker({ label, accept, onFile, disabled }: { label: string; accept: string; onFile: (file: File) => void | Promise<void>; disabled?: boolean }) {
  const id = `file-${label.toLowerCase().replace(/\W+/g, "-")}`
  return <div className="file-picker"><Label htmlFor={id}><Upload/>{label}</Label><Input id={id} type="file" accept={accept} disabled={disabled} onChange={(event) => { const file = event.target.files?.[0]; if (file) void onFile(file); event.currentTarget.value = "" }}/></div>
}

const CommandEditingContext = createContext<{ state: OrcaGromacsState; runId: string; moleculeId: string; commit: (patch: Partial<OrcaGromacsState>) => void } | null>(null)

function CodePanel({ title, text, filename, language = "bash", onChange, onReset }: { title: string; text: string; filename: string; language?: string; onChange?: (text: string) => void; onReset?: () => void }) {
  const editing = useContext(CommandEditingContext)
  const key = filename.includes("_x2top") ? `molecule:${editing?.moleculeId || "no-molecule"}:${filename}` : `run:${editing?.runId || "no-run"}:${filename}`
  const contextual = Boolean(editing && language !== "gromacs-topology" && !onChange)
  const displayed = contextual && editing ? commandText(editing.state, key, text) : text
  const change = onChange ?? (contextual && editing ? (next: string) => editing.commit({ commandOverrides: { ...editing.state.commandOverrides, [key]: next } }) : undefined)
  const reset = onReset ?? (contextual && editing?.state.commandOverrides[key] !== undefined ? () => { const next = { ...editing.state.commandOverrides }; delete next[key]; editing.commit({ commandOverrides: next }) } : undefined)
  return <div className="code-panel"><div><strong>{title}</strong><span>{filename}{change ? " · editable" : ""}</span>{reset && <Button variant="ghost" size="sm" onClick={reset}><RotateCcw/>Reset</Button>}<Button variant="ghost" size="sm" disabled={!displayed} onClick={() => navigator.clipboard.writeText(displayed)}><Copy/>Copy</Button><Button variant="ghost" size="sm" disabled={!displayed} onClick={() => downloadText(filename, displayed)}><Download/>Download</Button></div>{change ? <Textarea aria-label={`Edit ${title}`} value={displayed} onChange={(event) => change(event.target.value)}/> : <pre data-language={language}>{displayed || "Calculation unavailable: required inputs are missing."}</pre>}</div>
}

const tutorialSteps = [
  {
    key: "em" as const,
    title: "Step 1 — Energy minimization",
    purpose: "Remove severe packing clashes and high-energy contacts before dynamics.",
    why: "Packmol optimizes geometry overlap, not potential energy under the selected force field. Dynamics from a strained structure can immediately fail.",
    inputs: "packed.gro, topol.top, molecular .itp files, em.mdp",
    outputs: "em.tpr, em.gro, em.edr, em.log",
    commands: GROMACS_STAGE_COMMANDS.em,
    checks: "Normal termination; potential energy trend; maximum force versus the configured target; no unresolved topology errors.",
    failures: "A huge force usually means overlapping atoms, bad connectivity, wrong units, or missing/incorrect parameters. Fix the cause; do not bypass it with -maxwarn.",
  },
  {
    key: "nvt" as const,
    title: "Step 2 — NVT equilibration",
    purpose: "Equilibrate temperature at fixed volume while the packed structure relaxes.",
    why: "Controlled heating lets molecular velocities and local structure adapt before pressure coupling changes the box.",
    inputs: "em.gro, topol.top, molecular .itp files, nvt.mdp",
    outputs: "nvt.tpr, nvt.gro, nvt.edr, nvt.log, nvt.xtc, nvt.cpt",
    commands: GROMACS_STAGE_COMMANDS.nvt,
    checks: "Temperature reaches the target without runaway oscillation; energy is stable; no persistent LINCS warnings.",
    failures: "An exploding system or repeated LINCS warnings points to geometry, timestep, constraints, or topology problems—not merely insufficient runtime.",
  },
  {
    key: "npt" as const,
    title: "Step 3 — NPT equilibration",
    purpose: "Equilibrate pressure, box volume, and density at the target temperature.",
    why: "The density-based starting composition does not guarantee the force field will reproduce the target density after relaxation.",
    inputs: "nvt.gro, nvt.cpt, topol.top, npt.mdp",
    outputs: "npt.tpr, npt.gro, npt.edr, npt.log, npt.xtc, npt.cpt",
    commands: GROMACS_STAGE_COMMANDS.npt,
    checks: "Inspect density and box-volume evolution, not only instantaneous pressure. Compare equilibrated density with the documented target/reference and justify deviations.",
    failures: "Slow DES relaxation can require longer equilibration. A systematic density error may indicate composition, force-field, charge, temperature, or barostat issues.",
  },
  {
    key: "production" as const,
    title: "Step 4 — Production MD",
    purpose: "Generate the equilibrium trajectory used for RDF, convergence, SSM, and KBI analysis.",
    why: "KBI is sensitive to long-range RDF behavior, so equilibrium sampling, replica agreement, and time convergence must be demonstrated.",
    inputs: "npt.gro, npt.cpt, topol.top, prod.mdp",
    outputs: "prod.tpr, prod.xtc/trr, prod.edr, prod.log, prod.gro, prod.cpt",
    commands: GROMACS_STAGE_COMMANDS.production,
    checks: "Equilibration is excluded; observables are stationary; replicas agree; saved-frame interval resolves the intended analysis; checkpoints allow safe restart.",
    failures: "A completed run is not automatically converged. Use block RDF/KBI and replica diagnostics before accepting results.",
  },
]

const dependencyFiles = [
  ["ORCA .xyz", "ORCA geometry export", "Atom mapping and PDB/GRO", "Element sequence and Cartesian geometry; normally Å."],
  ["ORCA .out", "ORCA BP86/def2-TZVP", "Mulliken parser and mapping", "Calculation metadata, final geometry when present, and raw Mulliken charges."],
  ["atom_mapping.csv", "Workbench mapping review", ".itp audit and reproducibility", "Permanent ORCA ↔ XYZ ↔ GROMACS name/type/charge trace."],
  ["molecule.gro/.pdb", "Workbench coordinate conversion", "x2top and Packmol", "One molecule, unchanged atom order; GRO is nm and PDB is Å."],
  ["molecule.itp", "Reviewed OPLS-AA topology + charge merge", "topol.top and grompp", "Bonded/LJ framework with final raw ORCA Mulliken per-atom charges."],
  ["packmol.inp", "Box composition + packing settings", "Packmol", "Exact species counts and box boundaries in Å."],
  ["packed.gro + topol.top", "Validated packed.pdb and molecule .itp files", "grompp", "System coordinates and molecule-count topology."],
  [".mdp", "Andaliman protocol preset", "grompp", "Editable integrator, coupling, cutoff, output, and duration directives."],
  [".tpr", "grompp", "mdrun and analysis", "Compiled run input after topology/coordinate/MDP validation."],
  ["prod.xtc/.edr/.gro", "mdrun", "RDF, transport, density, and convergence analysis", "Trajectory, energies, and final coordinates."],
  ["rdf_*.xvg", "gmx rdf", "KBI Analyzer", "Processed radial distribution data; not the full trajectory."],
] as const

export function OrcaGromacsView({ project, runs, datasets, setDatasets, state, setState, openKbi }: Props) {
  const [error, setError] = useState("")
  const [bondDraft, setBondDraft] = useState({ ai: 1, aj: 2 })
  const [dependency, setDependency] = useState(0)
  const moleculeId = state.selectedMoleculeId || project.molecules[0]?.id || ""
  const molecule = project.molecules.find((item) => item.id === moleculeId)
  const preparation = molecule ? state.molecules[molecule.id] ?? emptyMoleculePreparation(molecule) : null
  const runId = state.selectedRunId || runs[0]?.runId || ""
  const run = runs.find((item) => item.runId === runId)
  const packed = run ? state.packedSystems[run.runId] ?? null : null

  const commit = (patch: Partial<OrcaGromacsState>) => setState({ ...state, ...patch, updatedAt: now() })
  const putPreparation = (next: MoleculePreparation) => setState({ ...state, selectedMoleculeId: next.moleculeId, molecules: { ...state.molecules, [next.moleculeId]: { ...next, updatedAt: now() } }, updatedAt: now() })
  const selectMolecule = (id: string) => commit({ selectedMoleculeId: id, molecules: state.molecules[id] ? state.molecules : { ...state.molecules, [id]: emptyMoleculePreparation(project.molecules.find((item) => item.id === id)!) } })
  const setExecution = (key: "em" | "nvt" | "npt" | "production", value: "not-run" | "failed" | "accepted") => {
    if (!run) return
    commit({ execution: { ...state.execution, [run.runId]: { ...executionFor(state, run.runId), [key]: value } } })
  }
  const handleFile = async (kind: "xyz" | "out" | "topology", file: File) => {
    if (!preparation) return
    setError("")
    try {
      const source = await sourceFileRecord(file)
      putPreparation(kind === "xyz" ? attachXyz(preparation, source) : kind === "out" ? attachOrcaOutput(preparation, source) : importTopology(preparation, source))
    } catch (caught) { setError(caught instanceof Error ? caught.message : "File import failed.") }
  }
  const patchAtom = (index: number, patch: Partial<MoleculePreparation["atoms"][number]>, reconcile = false) => {
    if (!preparation) return
    const safePatch = patch.gromacsName === undefined ? patch : { ...patch, gromacsName: patch.gromacsName.slice(0, 4) }
    const changed = { ...preparation, geometryAcknowledged: patch.outIndex === undefined ? preparation.geometryAcknowledged : false, atoms: preparation.atoms.map((atom) => atom.index === index ? { ...atom, ...safePatch } : atom) }
    putPreparation(reconcile ? reconcilePreparation(changed) : changed)
  }
  const patchBond = (id: string, patch: Partial<BondRecord>) => preparation && putPreparation({ ...preparation, bonds: preparation.bonds.map((bond) => bond.id === id ? { ...bond, ...patch } : bond), connectivityApproved: false })
  const setResidue = (value: string) => preparation && putPreparation({ ...preparation, residueName: value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4), atoms: preparation.atoms.map((atom) => ({ ...atom, residueName: value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4) })), connectivityApproved: false })

  const orcaFindings = preparation ? orcaDiagnostics(preparation) : []
  const topologyFindings = preparation ? topologyDiagnostics(preparation) : []
  const packFindings = run ? validatePackedSystem(run, packed, state.molecules) : []
  const molecularTopologiesReady = run ? runSpecies(run).every((species) => state.molecules[species.moleculeId] && preparationStatus(state.molecules[species.moleculeId]).startsWith("VALIDATED")) : false
  const systemFindings: PrepDiagnostic[] = [...packFindings, ...(run && !molecularTopologiesReady ? [{ severity: "ERROR" as const, code: "MOLECULAR_TOPOLOGIES_NOT_VALIDATED", message: "System topology export is blocked until every included molecular .itp has complete OPLS-AA mapping and recorded grompp validation." }] : [])]
  const checklist = projectChecklist(run, state, datasets)
  const firstPending = checklist.find((item) => item.status !== "PASS")
  const pairCount = run ? pairwiseSpecies(run, state.molecules).length : 0
  const packmolInput = run ? generatePackmolInput(run, state.molecules, state.packmol) : ""
  const rdfCommands = run ? generateRdfCommands(run, state.molecules, state.rdf) : ""
  const blockCommands = run ? generateBlockRdfCommands(run, state.molecules, state.rdf) : ""
  const ssmCommands = run ? generateSsmPreparationCommands(run, state.molecules, state) : ""
  const geometry = preparation ? geometryDifference(preparation) : null
  const topologyStatus = preparation ? preparationStatus(preparation) : "No molecule selected"

  const preparedCount = useMemo(() => Object.values(state.molecules).filter((item) => item.xyzFile && item.outFile).length, [state.molecules])

  const importPacked = async (file: File) => {
    if (!run) return
    setError("")
    try {
      const source = await sourceFileRecord(file)
      const parsed = parsePackedPdb(source.text)
      commit({ packedSystems: { ...state.packedSystems, [run.runId]: { runId: run.runId, sourceFile: source, atoms: parsed.atoms, cryst1Angstrom: parsed.cryst1Angstrom, importedAt: now() } } })
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Packed PDB import failed.") }
  }

  const importRdfs = async (files: FileList | null) => {
    if (!run || !files?.length) return
    setError("")
    try {
      const additions: RDFDataset[] = []
      for (const file of Array.from(files)) {
        const pair = inferPairFromFilename(file.name, run, state.molecules)
        if (!pair) throw new Error(`${file.name}: molecular pair could not be inferred from the deterministic filename. Rename it rdf_A_B.xvg or import it manually in KBI Analyzer.`)
        const parsed = parseXvg(await file.text(), file.name)
        parsed.forEach((series, index) => additions.push({ ...series, id: `rdf-${crypto.randomUUID()}`, radiusNm: [...series.radiusRaw], sourceFilename: parsed.length > 1 ? `${file.name} [${series.legend || index + 1}]` : file.name, metadata: rdfDatasetMetadata(run, pair, state, file.name) }))
      }
      setDatasets([...datasets, ...additions])
    } catch (caught) { setError(caught instanceof Error ? caught.message : "RDF import failed.") }
  }

  return <CommandEditingContext.Provider value={{ state, runId, moleculeId, commit }}><>
    <ViewHeader eyebrow="Preparation / execution tutorial" title="ORCA → GROMACS" description="Build a traceable OPLS-AA molecular-mechanics project while preserving raw ORCA BP86/def2-TZVP Mulliken charges and atom order." actions={<label className="tutorial-toggle"><Switch checked={state.tutorialMode} onCheckedChange={(checked) => commit({ tutorialMode: checked })}/><span><strong>Tutorial Mode</strong><small>{state.tutorialMode ? "Explanations visible" : "Compact workflow"}</small></span></label>}/>
    <div className="metrics-row"><Metric label="Molecules with ORCA pair" value={`${preparedCount}/${project.molecules.length}`}/><Metric label="Generated runs" value={runs.length}/><Metric label="Selected run" value={run?.runId ?? "—"}/><Metric label="Required RDF pairs" value={pairCount}/><Metric label="Next valid step" value={firstPending?.label ?? "Pipeline complete"} tone={firstPending ? "warning" : "good"}/></div>
    <InlineWarning title="Scientific boundary">ORCA supplies quantum-chemical geometry and Mulliken charges. It does not contain OPLS-AA atom types, Lennard–Jones parameters, bonds, angles, torsions, pairs, or exclusions. This wizard will stop production-ready topology status until those parameters are independently mapped and validated.</InlineWarning>
    {error && <div className="prep-error"><CircleAlert/><strong>Action failed</strong><span>{error}</span><Button variant="ghost" size="sm" onClick={() => setError("")}>Dismiss</Button></div>}

    <Tabs defaultValue="status" className="prep-tabs">
      <TabsList variant="line" className="prep-tab-list"><TabsTrigger value="status">Status</TabsTrigger><TabsTrigger value="orca">1 · ORCA</TabsTrigger><TabsTrigger value="mapping">2 · Mapping</TabsTrigger><TabsTrigger value="topology">3 · OPLS-AA</TabsTrigger><TabsTrigger value="packing">4 · Packing</TabsTrigger><TabsTrigger value="run">5 · Run & RDF</TabsTrigger></TabsList>

      <TabsContent value="status">
        <Section title="End-to-end project checklist" kicker="NEXT SCIENTIFICALLY VALID ACTION" actions={<RunSelector runs={runs} value={runId} onChange={(value) => commit({ selectedRunId: value })}/>}>
          {!run && <InlineWarning title="Run required">Generate Stage A, B, C, or a custom matrix in Run Generator, then return here. `.mdp` files alone are not runnable: coordinates, molecular topologies, system topology, and compiled `.tpr` inputs are also required.</InlineWarning>}
          <div className="checklist-table">{checklist.map((item) => <div key={item.label}><StatusBadge tone={item.status === "PASS" ? "good" : item.status === "FAIL" ? "danger" : item.status === "NOT RUN" ? "neutral" : "warning"}>{item.status}</StatusBadge><strong>{item.label}</strong><span>{item.detail}</span></div>)}</div>
          {firstPending && <div className="next-action"><ArrowRight/><span><strong>Next:</strong> {firstPending.label}</span><small>{firstPending.detail}</small></div>}
        </Section>
        <Section title="File dependency map" kicker="CLICK A FILE TO INSPECT"><div className="dependency-map">{dependencyFiles.map((item, index) => <button key={item[0]} className={dependency === index ? "active" : ""} onClick={() => setDependency(index)}><FileCode2/><span>{item[0]}</span>{index < dependencyFiles.length - 1 && <ArrowRight/>}</button>)}</div><div className="dependency-detail"><dl><div><dt>File</dt><dd>{dependencyFiles[dependency][0]}</dd></div><div><dt>Generated by</dt><dd>{dependencyFiles[dependency][1]}</dd></div><div><dt>Consumed by</dt><dd>{dependencyFiles[dependency][2]}</dd></div><div><dt>Contains</dt><dd>{dependencyFiles[dependency][3]}</dd></div></dl></div></Section>
      </TabsContent>

      <TabsContent value="orca">
        <Section title="ORCA source import" kicker="ORIGINAL FILES PRESERVED" actions={<MoleculeSelector molecules={project.molecules} value={moleculeId} onChange={selectMolecule}/>}>
          {!molecule || !preparation ? <InlineWarning title="Molecule required">Add a molecular species in the Molecule Library first.</InlineWarning> : <>
            <div className="file-import-grid"><SourceCard title="Geometry (.xyz)" file={preparation.xyzFile} detail={preparation.xyzFile ? `${preparation.xyzAtoms.length} atoms · ${preparation.xyzComment || "no comment"}` : "Expected: atom count, comment, then element + x/y/z in Å."}><FilePicker label="Import .xyz" accept=".xyz,text/plain" onFile={(file) => handleFile("xyz", file)}/></SourceCard><SourceCard title="ORCA output (.out)" file={preparation.outFile} detail={preparation.outFile ? `${preparation.outCharges.length} Mulliken charges · ${preparation.orcaMetadata.method}/${preparation.orcaMetadata.basis}` : "Expected: a complete MULLIKEN ATOMIC CHARGES section."}><FilePicker label="Import .out" accept=".out,.log,text/plain" onFile={(file) => handleFile("out", file)}/></SourceCard></div>
            <div className="form-grid form-grid-4"><Field label="Residue name" value={preparation.residueName} onChange={setResidue} note="Unique, editable, ≤5 alphanumeric characters."/><Field label="Expected formal charge" type="number" step="1" value={preparation.expectedFormalCharge} onChange={(value) => putPreparation({ ...preparation, expectedFormalCharge: Number(value), chargeAcknowledged: false })}/><Field label="Charge tolerance" type="number" step="0.000001" min="0" value={preparation.chargeTolerance} onChange={(value) => putPreparation({ ...preparation, chargeTolerance: Math.max(0, Number(value)), chargeAcknowledged: false })}/><div className="field-stack"><Label>Charge mismatch acknowledgement</Label><label className="check-label"><Checkbox checked={preparation.chargeAcknowledged} onCheckedChange={(checked) => putPreparation({ ...preparation, chargeAcknowledged: checked === true })}/><span>I acknowledge without changing charges</span></label><small>No normalization or redistribution is performed.</small></div></div>
            <div className="raw-meta prep-meta"><span>Parsed Mulliken sum</span><code>{mappedChargeSum(preparation).toFixed(8)}</code><span>Difference</span><code>{(mappedChargeSum(preparation) - preparation.expectedFormalCharge).toExponential(3)}</code><span>Final ORCA geometry comparison</span><code>{geometry ? `RMSD ${geometry.rmsdAngstrom.toFixed(5)} Å; max ${geometry.maxDisplacementAngstrom.toFixed(5)} Å` : "not available"}</code><span>Normal termination</span><code>{preparation.orcaMetadata.terminatedNormally ? "detected" : "not detected"}</code></div>
            <div className="raw-meta prep-meta"><span>ORCA-declared total charge</span><code>{preparation.orcaMetadata.parsedTotalCharge ?? "not detected"}</code><span>Input line</span><code>{preparation.orcaMetadata.inputLine || "not detected"}</code></div>
            {geometry && geometry.maxDisplacementAngstrom > 0.05 && <label className="approval-label"><Checkbox checked={preparation.geometryAcknowledged} onCheckedChange={(checked) => putPreparation({ ...preparation, geometryAcknowledged: checked === true })}/><span>I confirm the mapped coordinate difference is molecular geometry change, not atom reordering</span></label>}
            <Diagnostics items={orcaFindings}/>
          </>}
        </Section>
      </TabsContent>

      <TabsContent value="mapping">
        {preparation?.bonds.length ? <Section title="Bond-definition review" kicker="EDITABLE · CONNECTIVITY IS NOT A PARAMETER"><p>Record the intended bond definition or the imported GROMACS function/parameter fields. This annotation does not manufacture OPLS-AA parameters; the reviewed topology remains authoritative.</p><div className="table-scroll prep-table"><Table><TableHeader><TableRow><TableHead>Atoms</TableHead><TableHead>Elements</TableHead><TableHead>Distance / Å</TableHead><TableHead>Definition / imported fields</TableHead><TableHead>Source</TableHead></TableRow></TableHeader><TableBody>{preparation.bonds.map((bond) => <TableRow key={bond.id}><TableCell>{bond.ai}–{bond.aj}</TableCell><TableCell>{bond.elementI}–{bond.elementJ}</TableCell><TableCell>{bond.distanceAngstrom.toFixed(4)}</TableCell><TableCell><Input className="min-w-96 font-mono text-xs" value={bond.definition ?? ""} placeholder="e.g. function type and reviewed parameters" onChange={(event) => patchBond(bond.id, { definition: event.target.value })}/></TableCell><TableCell><StatusBadge>{bond.source}</StatusBadge></TableCell></TableRow>)}</TableBody></Table></div></Section> : null}
        <Section title="Stable atom and charge mapping" kicker="NO SILENT REORDERING" actions={<MoleculeSelector molecules={project.molecules} value={moleculeId} onChange={selectMolecule}/>}>
          {!preparation?.atoms.length ? <InlineWarning title="ORCA pair required">Import the molecule `.xyz` and corresponding `.out` first.</InlineWarning> : <><div className="form-grid form-grid-4"><label className="approval-label"><Checkbox checked={preparation.coordinateSettings.center} onCheckedChange={(checked) => putPreparation({ ...preparation, coordinateSettings: { ...preparation.coordinateSettings, center: checked === true } })}/><span>Center molecular coordinates</span></label><Field label="Translate X / Å" type="number" step="0.1" value={preparation.coordinateSettings.translateAngstrom.x} onChange={(value) => putPreparation({ ...preparation, coordinateSettings: { ...preparation.coordinateSettings, translateAngstrom: { ...preparation.coordinateSettings.translateAngstrom, x: Number(value) } } })}/><Field label="Translate Y / Å" type="number" step="0.1" value={preparation.coordinateSettings.translateAngstrom.y} onChange={(value) => putPreparation({ ...preparation, coordinateSettings: { ...preparation.coordinateSettings, translateAngstrom: { ...preparation.coordinateSettings.translateAngstrom, y: Number(value) } } })}/><Field label="Translate Z / Å" type="number" step="0.1" value={preparation.coordinateSettings.translateAngstrom.z} onChange={(value) => putPreparation({ ...preparation, coordinateSettings: { ...preparation.coordinateSettings, translateAngstrom: { ...preparation.coordinateSettings.translateAngstrom, z: Number(value) } } })}/></div><div className="table-scroll prep-table"><Table><TableHeader><TableRow><TableHead>XYZ</TableHead><TableHead>Element</TableHead><TableHead>Coordinates / Å</TableHead><TableHead>ORCA out index</TableHead><TableHead>Out element</TableHead><TableHead>GROMACS name</TableHead><TableHead>Mulliken</TableHead></TableRow></TableHeader><TableBody>{preparation.atoms.map((atom) => <TableRow key={atom.index} className={atom.outElement && atom.outElement !== atom.element ? "row-error" : ""}><TableCell>{atom.index}</TableCell><TableCell><strong>{atom.element}</strong></TableCell><TableCell className="font-mono text-xs">{atom.x.toFixed(5)}, {atom.y.toFixed(5)}, {atom.z.toFixed(5)}</TableCell><TableCell><Input className={inputClass} type="number" min={1} max={preparation.outCharges.length || undefined} value={atom.outIndex} onChange={(event) => patchAtom(atom.index, { outIndex: Number(event.target.value) }, true)}/></TableCell><TableCell>{atom.outElement ?? "—"}</TableCell><TableCell><Input className={inputClass} value={atom.gromacsName} onChange={(event) => patchAtom(atom.index, { gromacsName: event.target.value.replace(/\s/g, "").slice(0, 5) })}/></TableCell><TableCell className="font-mono text-xs">{atom.mullikenCharge?.toFixed(8) ?? "MISSING"}</TableCell></TableRow>)}</TableBody></Table></div></>}
          {preparation?.atoms.length ? <div className="button-row"><Button variant="outline" size="sm" onClick={() => downloadText("atom_mapping.csv", generateAtomMappingCsv(preparation), "text/csv")}><Download/>atom_mapping.csv</Button><Button variant="outline" size="sm" onClick={() => downloadText("charges.csv", generateChargesCsv(preparation), "text/csv")}><Download/>charges.csv</Button><Button variant="outline" size="sm" onClick={() => downloadText(`${safeBase(preparation.moleculeId)}.pdb`, generatePdb(preparation))}><Download/>PDB (Å)</Button><Button variant="outline" size="sm" onClick={() => downloadText(`${safeBase(preparation.moleculeId)}.gro`, generateGro(preparation))}><Download/>GRO (nm)</Button></div> : null}
        </Section>
        <Section title="Connectivity builder" kicker="DISTANCE HEURISTIC · RESEARCHER APPROVAL REQUIRED" actions={<Button variant="outline" size="sm" disabled={!preparation?.atoms.length} onClick={() => preparation && putPreparation(proposeConnectivity(preparation))}><Network/>Suggest bonds</Button>}>
          {state.tutorialMode && <p>XYZ has no bond topology. The suggestion uses covalent radii and distances only. Every retained bond begins unchecked; review chemical connectivity and protonation before approving the complete graph.</p>}
          {!preparation?.bonds.length ? <InlineWarning title="No bond graph">Suggest bonds or add bonds manually. No inferred bond becomes authoritative automatically.</InlineWarning> : <div className="table-scroll prep-table"><Table><TableHeader><TableRow><TableHead>Accept</TableHead><TableHead>Atom i</TableHead><TableHead>Atom j</TableHead><TableHead>Elements</TableHead><TableHead>Distance / Å</TableHead><TableHead>Source</TableHead><TableHead/></TableRow></TableHeader><TableBody>{preparation.bonds.map((bond) => <TableRow key={bond.id}><TableCell><Checkbox checked={bond.accepted} onCheckedChange={(checked) => patchBond(bond.id, { accepted: checked === true })}/></TableCell><TableCell>{bond.ai}</TableCell><TableCell>{bond.aj}</TableCell><TableCell>{bond.elementI}–{bond.elementJ}</TableCell><TableCell>{bond.distanceAngstrom.toFixed(4)}</TableCell><TableCell><StatusBadge tone={bond.source === "user" ? "accent" : "neutral"}>{bond.source}</StatusBadge></TableCell><TableCell><Button variant="ghost" size="icon" aria-label="Delete bond" onClick={() => putPreparation({ ...preparation, bonds: preparation.bonds.filter((item) => item.id !== bond.id), connectivityApproved: false })}><Trash2/></Button></TableCell></TableRow>)}</TableBody></Table></div>}
          {preparation && <div className="inline-form"><Field label="Atom i" type="number" min="1" value={bondDraft.ai} onChange={(value) => setBondDraft({ ...bondDraft, ai: Number(value) })}/><Field label="Atom j" type="number" min="1" value={bondDraft.aj} onChange={(value) => setBondDraft({ ...bondDraft, aj: Number(value) })}/><Button variant="outline" size="sm" onClick={() => { const a = preparation.atoms[bondDraft.ai - 1], b = preparation.atoms[bondDraft.aj - 1]; if (!a || !b || a.index === b.index) return setError("Manual bond needs two distinct valid atom indices."); putPreparation({ ...preparation, bonds: [...preparation.bonds, { id: `user-${crypto.randomUUID()}`, ai: a.index, aj: b.index, elementI: a.element, elementJ: b.element, distanceAngstrom: Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z), proposed: false, accepted: true, source: "user" }], connectivityApproved: false }) }}><Plus/>Add bond</Button><label className="approval-label"><Checkbox checked={preparation.connectivityApproved} disabled={!preparation.bonds.length || preparation.bonds.some((bond) => !bond.accepted)} onCheckedChange={(checked) => putPreparation({ ...preparation, connectivityApproved: checked === true })}/><span>I approve this complete connectivity graph</span></label></div>}
        </Section>
      </TabsContent>

      <TabsContent value="topology">
        <Section title="OPLS-AA atom typing and Mulliken charge merge" kicker="THESIS METHOD: OPLS-AA + ORCA MULLIKEN" actions={<MoleculeSelector molecules={project.molecules} value={moleculeId} onChange={selectMolecule}/>}>
          {state.tutorialMode && <p>Use `gmx x2top` as an assistant, then import and review its topology. OPLS-AA supplies atom types, Lennard–Jones and bonded definitions; the final `[ atoms ]` charge column remains the unmodified ORCA Mulliken value mapped to the same physical atom.</p>}
          {!preparation?.atoms.length ? <InlineWarning title="Mapping required">Import and map ORCA geometry/charges before atom typing.</InlineWarning> : <div className="table-scroll prep-table"><Table><TableHeader><TableRow><TableHead>Atom</TableHead><TableHead>Connectivity</TableHead><TableHead>OPLS-AA type</TableHead><TableHead>Existing charge</TableHead><TableHead>ORCA Mulliken</TableHead><TableHead>Final charge</TableHead><TableHead>LJ source</TableHead><TableHead>Status</TableHead></TableRow></TableHeader><TableBody>{preparation.atoms.map((atom) => <TableRow key={atom.index}><TableCell><strong>{atom.gromacsName}</strong><small className="block">{atom.element} · #{atom.index}</small></TableCell><TableCell>{preparation.bonds.filter((bond) => bond.ai === atom.index || bond.aj === atom.index).length}</TableCell><TableCell><Input className={inputClass} value={atom.oplsType} placeholder="UNMAPPED" onChange={(event) => patchAtom(atom.index, { oplsType: event.target.value.trim(), mappingStatus: event.target.value.trim() ? "USER-OVERRIDDEN" : "UNMAPPED", ljSource: event.target.value.trim() ? "Researcher assignment; validate against oplsaa.ff and grompp" : "" })}/></TableCell><TableCell>{atom.existingTopologyCharge?.toFixed(8) ?? "—"}</TableCell><TableCell>{atom.mullikenCharge?.toFixed(8) ?? "MISSING"}</TableCell><TableCell><strong>{atom.finalCharge?.toFixed(8) ?? "MISSING"}</strong></TableCell><TableCell><Input className={`${inputClass} min-w-56`} value={atom.ljSource} placeholder="Parameter source" onChange={(event) => patchAtom(atom.index, { ljSource: event.target.value })}/></TableCell><TableCell><StatusBadge tone={atom.mappingStatus === "UNMAPPED" ? "danger" : atom.mappingStatus === "REVIEW REQUIRED" ? "warning" : "good"}>{atom.mappingStatus}</StatusBadge></TableCell></TableRow>)}</TableBody></Table></div>}
          {preparation && <><CodePanel title="x2top assistant command" text={x2topCommand(preparation)} filename={`${safeBase(preparation.moleculeId)}_x2top.sh`}/><div className="file-import-grid"><SourceCard title="Import x2top / reviewed topology" file={preparation.topologyText ? { ...preparation.xyzFile!, name: preparation.topologyFileName, sha256: "editable", text: preparation.topologyText } : null} detail="Imports [ atoms ], [ bonds ], [ pairs ], [ angles ], [ dihedrals ], and related sections. Existing charges are retained for comparison only."><FilePicker label="Import .top / .itp" accept=".top,.itp,text/plain" onFile={(file) => handleFile("topology", file)}/></SourceCard><div className="review-checklist"><strong>Required topology review</strong>{["Atom types resolved", "Bond topology correct", "Angles present", "Proper dihedrals present", "Improper dihedrals reviewed", "LJ types resolved", "Exclusions/pairs appropriate"].map((item) => <span key={item}><Check/>{item}</span>)}</div></div>{preparation.topologyText && <><Textarea className="topology-editor" value={preparation.topologyText} onChange={(event) => putPreparation({ ...preparation, topologyText: event.target.value, topologyReviewed: false, gromppValidated: false })}/><div className="button-row"><Button variant="outline" size="sm" onClick={() => putPreparation(applyEditedTopology(preparation, preparation.topologyText))}><RotateCcw/>Parse edited topology</Button><Button variant="outline" size="sm" onClick={() => putPreparation({ ...preparation, atoms: preparation.atoms.map((atom) => atom.mappingStatus === "REVIEW REQUIRED" ? { ...atom, mappingStatus: "AUTO-MAPPED" as const } : atom) })}><Check/>Accept imported type mappings</Button><label className="approval-label"><Checkbox checked={preparation.topologyReviewed} onCheckedChange={(checked) => putPreparation({ ...preparation, topologyReviewed: checked === true })}/><span>Bonded topology and checklist reviewed</span></label><label className="approval-label"><Checkbox checked={preparation.gromppValidated} onCheckedChange={(checked) => putPreparation({ ...preparation, gromppValidated: checked === true })}/><span>`gmx grompp` succeeded; diagnostics reviewed</span></label></div></>}
            <div className="topology-status"><StatusBadge tone={topologyStatus.startsWith("VALIDATED") ? "good" : topologyStatus.startsWith("READY") ? "warning" : "danger"}>{topologyStatus}</StatusBadge><p>A generated `.itp` remains explicitly incomplete when any scientific input is missing. No fictional force-field parameter is inserted.</p></div><Diagnostics items={topologyFindings}/><CodePanel title="Merged molecular topology preview" text={generateItp(preparation)} filename={`${safeBase(preparation.moleculeId)}.itp`} language="gromacs-topology"/></>}
        </Section>
      </TabsContent>

      <TabsContent value="packing">
        <Section title="Box composition → Packmol" kicker="EXACT COUNTS FROM SELECTED RUN" actions={<RunSelector runs={runs} value={runId} onChange={(value) => commit({ selectedRunId: value })}/>}>
          {!run ? <InlineWarning title="Run required">Use Run Generator to calculate composition from density/box/MW or enter manual counts. A molar ratio alone never determines Packmol counts.</InlineWarning> : <>
            <div className="metrics-row"><Metric label="Box" value={`${run.box.x} × ${run.box.y} × ${run.box.z} ${run.box.unit ?? "nm"}`}/><Metric label="DES" value={run.desName}/><Metric label="Solute loading" value={run.soluteCount}/><Metric label="Total molecules" value={run.totalMoleculeCount ?? "unresolved"} tone={run.totalMoleculeCount ? "good" : "warning"}/><Metric label="Estimated density" value={run.compositionCalculation?.estimatedDensityGcm3 ? `${formatNumber(run.compositionCalculation.estimatedDensityGcm3, 5)} g cm⁻³` : "unavailable"}/></div>
            <div className="species-strip">{runSpecies(run).map((species) => <div key={species.moleculeId}><span>{state.molecules[species.moleculeId]?.residueName ?? "UNRESOLVED"}</span><strong>{species.count}</strong><small>{species.name}</small></div>)}</div>
            <div className="form-grid form-grid-3"><Field label="Packmol tolerance / Å" type="number" min="0" step="0.1" value={state.packmol.toleranceAngstrom} onChange={(value) => commit({ packmol: { ...state.packmol, toleranceAngstrom: Number(value) } })}/><Field label="Box margin / Å" type="number" min="0" step="0.1" value={state.packmol.marginAngstrom} onChange={(value) => commit({ packmol: { ...state.packmol, marginAngstrom: Number(value) } })}/><label className="approval-label"><Checkbox checked={state.packmol.periodic} onCheckedChange={(checked) => commit({ packmol: { ...state.packmol, periodic: checked === true } })}/><span>Write Packmol periodic boundary directive</span></label></div>
            <CodePanel title="Packmol input" text={packmolInput} filename="packmol.inp" language="packmol"/>
            <CodePanel title="Packmol command" text="packmol < packmol.inp" filename="run_packmol.sh"/>
          </>}
        </Section>
        <Section title="Packed system validation" kicker="COORDINATES ↔ TOPOLOGY COUNTS" actions={<FilePicker label="Import packed.pdb" accept=".pdb,text/plain" disabled={!run} onFile={importPacked}/>}>
          {state.tutorialMode && <p>Packmol must be run locally. Upload its `packed.pdb`; the Workbench checks atom/species counts and box bounds before generating `packed.gro`, `topol.top`, and `index.ndx`.</p>}
          <Diagnostics items={systemFindings}/>
          {run && packed && <><div className="button-row"><Button variant="outline" size="sm" disabled={packFindings.some((item) => item.severity === "ERROR")} onClick={() => downloadText("packed.gro", generatePackedGro(run, packed))}><Download/>packed.gro</Button><Button variant="outline" size="sm" disabled={systemFindings.some((item) => item.severity === "ERROR")} onClick={() => downloadText("topol.top", generateTopolTop(run, state.molecules))}><Download/>topol.top</Button><Button variant="outline" size="sm" disabled={packFindings.some((item) => item.severity === "ERROR")} onClick={() => downloadText("index.ndx", generateIndexNdx(packed, run, state.molecules))}><Download/>index.ndx</Button></div><CodePanel title="System topology" text={generateTopolTop(run, state.molecules)} filename="topol.top" language="gromacs-topology"/></>}
        </Section>
      </TabsContent>

      <TabsContent value="run">
        <Section title="Interactive GROMACS tutorial" kicker="RUN LOCALLY · RECORD VALIDATION" actions={<RunSelector runs={runs} value={runId} onChange={(value) => commit({ selectedRunId: value })}/>}>
          {!run ? <InlineWarning title="Run required">Select a generated run before using commands.</InlineWarning> : <div className="tutorial-steps">{tutorialSteps.map((step) => <article key={step.key}><header><span>{step.key === "em" ? "01" : step.key === "nvt" ? "02" : step.key === "npt" ? "03" : "04"}</span><h3>{step.title}</h3><Select value={executionFor(state, run.runId)[step.key]} onValueChange={(value: "not-run" | "failed" | "accepted") => setExecution(step.key, value)}><SelectTrigger size="sm"><SelectValue/></SelectTrigger><SelectContent><SelectItem value="not-run">NOT RUN</SelectItem><SelectItem value="failed">FAILED</SelectItem><SelectItem value="accepted">CONVERGED / ACCEPTED</SelectItem></SelectContent></Select></header>{state.tutorialMode && <div className="tutorial-explain"><TutorialRow label="What are we doing?" value={step.purpose}/><TutorialRow label="Why is this necessary?" value={step.why}/><TutorialRow label="Required files" value={step.inputs}/><TutorialRow label="Generated files" value={step.outputs}/><TutorialRow label="What must I check?" value={step.checks}/><TutorialRow label="Common failure modes" value={step.failures}/></div>}<CodePanel title="Editable command sequence" text={step.commands} filename={`${step.key}.sh`}/></article>)}</div>}
        </Section>
        <Section title="Pairwise RDF and convergence commands" kicker={`${pairCount} PAIRS · DIRECT KBI HANDOFF`}>
          {run && <><div className="form-grid form-grid-4"><div className="field-stack"><Label>RDF definition</Label><Select value={state.rdf.mode} onValueChange={(value: OrcaGromacsState["rdf"]["mode"]) => commit({ rdf: { ...state.rdf, mode: value } })}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent><SelectItem value="center-of-mass">Center of mass</SelectItem><SelectItem value="atom-based">Atom based</SelectItem><SelectItem value="custom">Custom selections</SelectItem></SelectContent></Select><small>COM and atom RDF are scientifically different.</small></div><Field label="Bin width / nm" type="number" min="0.000001" step="0.001" value={state.rdf.binWidthNm} onChange={(value) => commit({ rdf: { ...state.rdf, binWidthNm: Number(value) } })}/><Field label="Maximum radius / nm" type="number" min="0.000001" step="0.1" value={state.rdf.rmaxNm} onChange={(value) => commit({ rdf: { ...state.rdf, rmaxNm: Number(value) } })}/><Field label="Time / ns" value={`${state.rdf.beginNs}-${state.rdf.endNs}`} onChange={(value) => { const match = value.match(/^\s*([\d.]+)\s*-\s*([\d.]+)\s*$/); if (match) commit({ rdf: { ...state.rdf, beginNs: Number(match[1]), endNs: Number(match[2]) } }) }} note="Converted to ps in commands."/></div><Field label="Block windows / ns" value={state.rdf.blocks} onChange={(value) => commit({ rdf: { ...state.rdf, blocks: value } })} note="Example: 0-20, 20-40, 40-60"/><CodePanel title="All symmetric RDF pairs" text={rdfCommands} filename="rdf_all_pairs.sh"/><CodePanel title="Block RDFs" text={blockCommands} filename="rdf_blocks.sh"/></>}
          <div className="rdf-import"><Label>Import generated .xvg files</Label><Input type="file" accept=".xvg,text/plain" multiple disabled={!run} onChange={(event) => { void importRdfs(event.target.files); event.currentTarget.value = "" }}/><span>Distance unit is set explicitly to nm because these commands use GROMACS `gmx rdf`. Pair metadata is inferred from deterministic filenames and remains editable in KBI Analyzer.</span><Button size="sm" disabled={!datasets.length} onClick={openKbi}><Play/>Open KBI Analyzer</Button></div>
        </Section>
        {run && state.rdf.mode === "custom" && <Section title="Custom GROMACS selections" kicker="EXPLICIT PER-SPECIES DEFINITIONS"><InlineWarning title="Selection review required">These expressions are inserted verbatim into `gmx rdf`. Confirm that each expression selects the intended atoms or molecular centers and that all species use a scientifically consistent definition.</InlineWarning><div className="form-grid form-grid-3">{runSpecies(run).map((species) => { const label = state.molecules[species.moleculeId]?.residueName ?? species.name.toUpperCase().replace(/\W+/g, "_"); return <Field key={species.moleculeId} label={`${label} selection`} value={state.rdf.customSelections[label] ?? ""} onChange={(value) => commit({ rdf: { ...state.rdf, customSelections: { ...state.rdf.customSelections, [label]: value } } })} placeholder={`res_com of resname ${label}`}/> })}</div></Section>}
        <Section title="Small System Method preparation" kicker="INDEPENDENT FINITE-SIZE DATASETS">{run && <div className="field-stack compact-select"><Label>Molecular pair</Label><Select value={state.ssm.pair || `${pairwiseSpecies(run, state.molecules)[0]?.a}-${pairwiseSpecies(run, state.molecules)[0]?.b}`} onValueChange={(value) => commit({ ssm: { ...state.ssm, pair: value } })}><SelectTrigger><SelectValue placeholder="Select pair"/></SelectTrigger><SelectContent>{pairwiseSpecies(run, state.molecules).map((pair) => <SelectItem key={`${pair.a}-${pair.b}`} value={`${pair.a}-${pair.b}`}>{pair.a}–{pair.b}</SelectItem>)}</SelectContent></Select></div>}<div className="form-grid form-grid-3"><Field label="Finite-system sizes L / nm" value={state.ssm.sizesNm} onChange={(value) => commit({ ssm: { ...state.ssm, sizesNm: value } })}/><Field label="Time start / ns" type="number" min="0" value={state.ssm.beginNs} onChange={(value) => commit({ ssm: { ...state.ssm, beginNs: Number(value) } })}/><Field label="Time end / ns" type="number" min="0" value={state.ssm.endNs} onChange={(value) => commit({ ssm: { ...state.ssm, endNs: Number(value) } })}/></div><InlineWarning title="Method boundary">Cropping one trajectory is not automatically a valid SSM ensemble. The generated script expects independently prepared and validated finite-size trajectories for each L.</InlineWarning><CodePanel title="SSM RDF preparation" text={ssmCommands} filename="ssm_prepare.sh"/></Section>
        <Section title="Full preparation project" kicker="ORIGINAL SOURCES + GENERATED FILES + PROVENANCE" actions={<><Button variant="outline" size="sm" onClick={() => downloadJson("orca-gromacs-state.json", state)}><Download/>State JSON</Button><Button size="sm" disabled={!runs.length && !Object.keys(state.molecules).length} onClick={() => downloadBlob(`${project.projectAbbreviation.toLowerCase()}-orca-gromacs.zip`, exportProjectZip(project, runs, datasets, undefined, state))}><Archive/>Complete ZIP</Button></>}><p>The package contains original ORCA files, permanent atom/charge mapping, coordinate conversions, topology drafts and imports, Packmol/system files where available, run inputs, RDF/block/SSM scripts, and a reconstructable state manifest.</p></Section>
      </TabsContent>
    </Tabs>
  </></CommandEditingContext.Provider>
}

function MoleculeSelector({ molecules, value, onChange }: { molecules: Molecule[]; value: string; onChange: (value: string) => void }) {
  return <Select value={value} onValueChange={onChange}><SelectTrigger className="min-w-60"><SelectValue placeholder="Select molecule"/></SelectTrigger><SelectContent>{molecules.map((molecule) => <SelectItem key={molecule.id} value={molecule.id}>{molecule.fullName} · {molecule.role}</SelectItem>)}</SelectContent></Select>
}

function RunSelector({ runs, value, onChange }: { runs: RunRecord[]; value: string; onChange: (value: string) => void }) {
  return <Select value={value} onValueChange={onChange}><SelectTrigger className="max-w-96 min-w-64"><SelectValue placeholder="Select generated run"/></SelectTrigger><SelectContent>{runs.map((run) => <SelectItem key={run.runId} value={run.runId}>{run.runId}</SelectItem>)}</SelectContent></Select>
}

function SourceCard({ title, file, detail, children }: { title: string; file: ({ name: string; sha256: string } & Record<string, unknown>) | null; detail: string; children: React.ReactNode }) {
  return <article className="source-card"><header><FileInput/><div><strong>{title}</strong><span>{file?.name ?? "Not imported"}</span></div>{file && <StatusBadge tone="good">preserved</StatusBadge>}</header><p>{detail}</p>{file && <code>SHA-256 {file.sha256.slice(0, 16)}…</code>}{children}</article>
}

function TutorialRow({ label, value }: { label: string; value: string }) { return <div><strong>{label}</strong><p>{value}</p></div> }
