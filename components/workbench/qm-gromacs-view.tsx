"use client"

import { SOFTWARE_VERSION } from "@/lib/workbench/version"
import { uuid } from "@/lib/workbench/crypto"
import { canonical } from "@/lib/workbench/identity"
import { createContext, useContext, useMemo, useState } from "react"
import {
  ArrowRight,
  Check,
  CircleAlert,
  Copy,
  Download,
  FileCode2,
  Network,
  Plus,
  RotateCcw,
  Trash2,
  Upload,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import type { Molecule, ProjectState, RunRecord } from "@/lib/workbench/types"
import { downloadText } from "@/lib/workbench/export"
import {
  activeQmCharges,
  applyEditedTopology,
  attachGeometry,
  attachQmOutput,
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
  generateTopolTop,
  GROMACS_STAGE_COMMANDS,
  geometryDifference,
  importTopology,
  mappedFinalChargeSum,
  mappedRawChargeSum,
  pairwiseSpecies,
  parsePackedPdb,
  preparationStatus,
  projectChecklist,
  proposeConnectivity,
  qmDiagnostics,
  reconcilePreparation,
  runSpecies,
  sourceFileRecord,
  systemTopologyDiagnostics,
  topologyDiagnostics,
  topologyToolCommand,
  validatePackedSystem,
  type BondRecord,
  type ChargeMode,
  type MoleculePreparation,
  type NeutralizationPolicy,
  type PrepDiagnostic,
  type QmGromacsState,
  type QmSoftware,
  type TopologyHelperTool,
} from "@/lib/workbench/qm-gromacs"
import { Field, InlineWarning, Metric, Section, StatusBadge, ViewHeader, formatNumber } from "./shared"

type Props = {
  project: ProjectState
  runs: RunRecord[]
  state: QmGromacsState
  setState: (state: QmGromacsState) => void
  openRuns: () => void
  openData: () => void
}

const now = () => new Date().toISOString()
const safeBase = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "molecule"
const inputClass = "h-8 min-w-20 font-mono text-xs"

function diagnosticTone(severity: PrepDiagnostic["severity"]) {
  return severity === "ERROR" ? "danger" : severity === "WARNING" ? "warning" : "accent"
}

function Diagnostics({ items, empty = "No validation findings." }: { items: PrepDiagnostic[]; empty?: string }) {
  if (!items.length)
    return (
      <div className="prep-pass">
        <Check />
        <span>{empty}</span>
      </div>
    )
  return (
    <div className="prep-diagnostics">
      {items.map((item, index) => (
        <div className={`diagnostic diagnostic-${item.severity.toLowerCase()}`} key={`${item.code}-${index}`}>
          <StatusBadge tone={diagnosticTone(item.severity)}>{item.severity}</StatusBadge>
          <code>{item.code}</code>
          <span>{item.message}</span>
        </div>
      ))}
    </div>
  )
}

function FilePicker({
  label,
  accept,
  onFile,
  disabled,
}: {
  label: string
  accept: string
  onFile: (file: File) => void | Promise<void>
  disabled?: boolean
}) {
  const id = `file-${label.toLowerCase().replace(/\W+/g, "-")}`
  return (
    <div className="file-picker">
      <Label htmlFor={id}>
        <Upload />
        {label}
      </Label>
      <Input
        id={id}
        type="file"
        accept={accept}
        disabled={disabled}
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) void onFile(file)
          event.currentTarget.value = ""
        }}
      />
    </div>
  )
}

const CommandEditingContext = createContext<{
  state: QmGromacsState
  runId: string
  moleculeId: string
  commit: (patch: Partial<QmGromacsState>) => void
} | null>(null)

function CodePanel({
  title,
  text,
  filename,
  language = "bash",
  onChange,
  onReset,
}: {
  title: string
  text: string
  filename: string
  language?: string
  onChange?: (text: string) => void
  onReset?: () => void
}) {
  const editing = useContext(CommandEditingContext)
  const key = filename.includes("_toptool")
    ? `molecule:${editing?.moleculeId || "no-molecule"}:${filename}`
    : `run:${editing?.runId || "no-run"}:${filename}`
  const contextual = Boolean(editing && language !== "gromacs-topology" && !onChange)
  const displayed = contextual && editing ? commandText(editing.state, key, text) : text
  const change =
    onChange ??
    (contextual && editing
      ? (next: string) => editing.commit({ commandOverrides: { ...editing.state.commandOverrides, [key]: next } })
      : undefined)
  const reset =
    onReset ??
    (contextual && editing?.state.commandOverrides[key] !== undefined
      ? () => {
          const next = { ...editing.state.commandOverrides }
          delete next[key]
          editing.commit({ commandOverrides: next })
        }
      : undefined)

  return (
    <div className="code-panel">
      <div>
        <strong>{title}</strong>
        <span>
          {filename}
          {change ? " · editable" : ""}
        </span>
        {reset && (
          <Button variant="ghost" size="sm" onClick={reset}>
            <RotateCcw />
            Reset
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          disabled={!displayed}
          onClick={async () => {
            try {
              if (!navigator.clipboard) throw new Error("Clipboard unavailable on this origin; select text or download.")
              await navigator.clipboard.writeText(displayed)
            } catch (error) {
              alert(String(error))
            }
          }}
        >
          <Copy />
          Copy
        </Button>
        <Button variant="ghost" size="sm" disabled={!displayed} onClick={() => downloadText(filename, displayed)}>
          <Download />
          Download
        </Button>
      </div>
      {change ? (
        <Textarea aria-label={`Edit ${title}`} value={displayed} onChange={(event) => change(event.target.value)} />
      ) : (
        <pre data-language={language}>{displayed || "Required inputs are missing."}</pre>
      )}
    </div>
  )
}

const tutorialSteps = [
  {
    key: "em" as const,
    title: "Step 1 — Energy minimization",
    purpose: "Remove severe packing clashes and high-energy contacts before dynamics.",
    inputs: "packed.gro, topol.top, molecular .itp files, index.ndx, em.mdp",
    outputs: "em.tpr, em.gro, em.edr, em.log",
    commands: GROMACS_STAGE_COMMANDS.em,
    checks: "Normal termination; negative potential energy trend; Fmax below configured threshold.",
  },
  {
    key: "nvt" as const,
    title: "Step 2 — NVT equilibration",
    purpose: "Equilibrate temperature at fixed volume using the run's replica seed.",
    inputs: "em.gro, topol.top, index.ndx, nvt.mdp",
    outputs: "nvt.tpr, nvt.gro, nvt.edr, nvt.log, nvt.cpt",
    commands: GROMACS_STAGE_COMMANDS.nvt,
    checks: "Temperature reaches target without runaway drift; no persistent LINCS warnings.",
  },
  {
    key: "npt" as const,
    title: "Step 3 — NPT equilibration",
    purpose: "Equilibrate pressure, box volume, and bulk density at target T and P.",
    inputs: "nvt.gro, nvt.cpt, topol.top, index.ndx, npt.mdp",
    outputs: "npt.tpr, npt.gro, npt.edr, npt.log, npt.cpt",
    commands: GROMACS_STAGE_COMMANDS.npt,
    checks: "Inspect density and box-volume time series for equilibration.",
  },
  {
    key: "production" as const,
    title: "Step 4 — Production MD → Downstream Analysis",
    purpose: "Generate the equilibrium trajectory for MoDy Analyse or other external analysis tools.",
    inputs: "npt.gro, npt.cpt, topol.top, index.ndx, prod.mdp",
    outputs: "prod.tpr, prod.xtc, prod.edr, prod.log, prod.gro, prod.cpt",
    commands: GROMACS_STAGE_COMMANDS.production,
    checks: "Check stationarity, energy conservation, and export directory to MoDy Analyse.",
  },
]

const dependencyFiles = [
  ["Geometry (.xyz/.pdb/.gro/.mol2/.chg)", "QM optimizer or structure builder", "Atom mapping & PDB/GRO export", "Element sequence & Cartesian coordinates."],
  ["QM Output / Charges", "ORCA, Gaussian (.log/.fchk), xTB, Multiwfn, MOL2, CSV", "Multi-scheme charge parser", "Any QM method/basis + Mulliken, Loewdin, Hirshfeld, CHELPG, RESP, NPA, CM5, xTB, or custom charges."],
  ["atom_mapping.csv + charges.csv", "SolvForge MD bridge", "Audit & reproducibility", "Complete QM ↔ geometry ↔ GROMACS mapping, scaling, and neutralization provenance."],
  ["molecule.pdb / .gro", "Coordinate converter", "Topology tools & Packmol", "Single molecule, preserved atom order (PDB in Å, GRO in nm)."],
  ["molecule.itp", "Imported FF topology + charge merge", "topol.top & gmx grompp", "Any force field (OPLS-AA, GAFF2, CHARMM36, AMBER, GROMOS, OpenFF, Custom) with merged partial charges."],
  ["packmol.inp → packed.pdb", "Packmol (external)", "Packed system validator", "Exact integer species counts and box boundaries in Å."],
  ["packed.gro + topol.top + index.ndx", "SolvForge MD validator", "gmx grompp", "Validated system coordinates, hoisted parameter sections, and residue groups."],
  [".mdp + metadata.json", "Run Matrix & Protocol", "GROMACS & MoDy Analyse", "Fully customizable GROMACS MDPs + bridge metadata for MoDy Analyse."],
] as const

export function QmGromacsView({ project, runs, state, setState, openRuns, openData }: Props) {
  const [error, setError] = useState("")
  const [softwareHint, setSoftwareHint] = useState<QmSoftware | "auto">("auto")
  const [bondDraft, setBondDraft] = useState({ ai: 1, aj: 2 })
  const [dependency, setDependency] = useState(0)

  const moleculeId = state.selectedMoleculeId || project.molecules[0]?.id || ""
  const molecule = project.molecules.find((item) => item.id === moleculeId)
  const preparation = molecule ? (state.molecules[molecule.id] ?? emptyMoleculePreparation(molecule)) : null
  const runId = state.selectedRunId || runs[0]?.runId || ""
  const run = runs.find((item) => item.runId === runId)
  const packed = run ? (state.packedSystems[run.runId] ?? null) : null

  const commit = (patch: Partial<QmGromacsState>) => setState({ ...state, ...patch, updatedAt: now() })

  const putPreparation = (next: MoleculePreparation) => {
    const prior = state.molecules[next.moleculeId]
    const important = (p: MoleculePreparation) => ({
      atoms: p.atoms,
      bonds: p.bonds,
      topologyText: p.topologyText,
      residue: p.residueName,
      formalCharge: p.expectedFormalCharge,
      geom: p.geometryFile?.sha256,
      qm: p.qmFile?.sha256,
    })
    if (prior && canonical(important(prior)) !== canonical(important(next))) {
      next = { ...next, gromppValidated: false, topologyReviewed: false }
    }
    setState({
      ...state,
      selectedMoleculeId: next.moleculeId,
      molecules: { ...state.molecules, [next.moleculeId]: { ...next, updatedAt: now() } },
      updatedAt: now(),
    })
  }

  const selectMolecule = (id: string) =>
    commit({
      selectedMoleculeId: id,
      molecules: state.molecules[id]
        ? state.molecules
        : { ...state.molecules, [id]: emptyMoleculePreparation(project.molecules.find((item) => item.id === id)!) },
    })

  const setExecution = (key: "em" | "nvt" | "npt" | "production", value: "not-run" | "failed" | "accepted") => {
    if (!run) return
    const rationale = prompt("Execution log / evidence note (records researcher review; does not execute GROMACS).")
    if (!rationale?.trim()) return
    const prior = executionFor(state, run.runId)
    commit({
      execution: {
        ...state.execution,
        [run.runId]: {
          ...prior,
          [key]: value,
          history: [
            ...(prior.history ?? []),
            {
              id: uuid(),
              projectId: project.projectId,
              stage: key,
              classification: value,
              rationale,
              timestamp: now(),
              softwareVersion: SOFTWARE_VERSION,
              actor: "researcher",
            },
          ],
        },
      },
    })
  }

  const handleFile = async (kind: "geometry" | "qm" | "topology", file: File) => {
    if (!preparation) return
    setError("")
    try {
      const source = await sourceFileRecord(file)
      if (kind === "geometry") putPreparation(attachGeometry(preparation, source))
      else if (kind === "qm") putPreparation(attachQmOutput(preparation, source, softwareHint === "auto" ? undefined : softwareHint))
      else putPreparation(importTopology(preparation, source))
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "File import failed.")
    }
  }

  const patchAtom = (index: number, patch: Partial<MoleculePreparation["atoms"][number]>, reconcile = false) => {
    if (!preparation) return
    const safePatch = patch.gromacsName === undefined ? patch : { ...patch, gromacsName: patch.gromacsName.slice(0, 4) }
    const changed = {
      ...preparation,
      geometryAcknowledged: patch.outIndex === undefined ? preparation.geometryAcknowledged : false,
      atoms: preparation.atoms.map((atom) => (atom.index === index ? { ...atom, ...safePatch } : atom)),
    }
    putPreparation(reconcile ? reconcilePreparation(changed) : changed)
  }

  const patchBond = (id: string, patch: Partial<BondRecord>) =>
    preparation &&
    putPreparation({
      ...preparation,
      bonds: preparation.bonds.map((bond) => (bond.id === id ? { ...bond, ...patch } : bond)),
      connectivityApproved: false,
    })

  const setResidue = (value: string) => {
    if (!preparation) return
    const cleaned = value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4)
    putPreparation({
      ...preparation,
      residueName: cleaned,
      atoms: preparation.atoms.map((atom) => ({ ...atom, residueName: cleaned })),
      connectivityApproved: false,
    })
  }

  const qmFindings = preparation ? qmDiagnostics(preparation) : []
  const topologyFindings = preparation ? topologyDiagnostics(preparation) : []
  const packFindings = run ? validatePackedSystem(run, packed, state.molecules) : []
  const systemFindings: PrepDiagnostic[] = [...packFindings, ...(run ? systemTopologyDiagnostics(run, state.molecules) : [])]
  const checklist = projectChecklist(run, state)
  const firstPending = checklist.find((item) => !["PASS", "AUTOMATICALLY VERIFIED", "RESEARCHER ACCEPTED"].includes(item.status))
  const pairCount = run ? pairwiseSpecies(run, state.molecules).length : 0
  const packmolInput = run ? generatePackmolInput(run, state.molecules, state.packmol) : ""
  const rdfCommands = run ? generateRdfCommands(run, state.molecules, state.rdf) : ""
  const blockCommands = run ? generateBlockRdfCommands(run, state.molecules, state.rdf) : ""
  const geometry = preparation ? geometryDifference(preparation) : null
  const topologyStatus = preparation ? preparationStatus(preparation) : "No molecule selected"
  const activeCharges = preparation ? activeQmCharges(preparation) : []

  const preparedCount = useMemo(
    () => Object.values(state.molecules).filter((item) => item.geometryAtoms.length > 0).length,
    [state.molecules],
  )

  const importPacked = async (file: File) => {
    if (!run) return
    setError("")
    try {
      const source = await sourceFileRecord(file)
      const parsed = parsePackedPdb(source.text)
      commit({
        packedSystems: {
          ...state.packedSystems,
          [run.runId]: {
            runId: run.runId,
            sourceFile: source,
            atoms: parsed.atoms,
            cryst1Angstrom: parsed.cryst1Angstrom,
            importedAt: now(),
          },
        },
      })
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Packed PDB import failed.")
    }
  }

  return (
    <CommandEditingContext.Provider value={{ state, runId, moleculeId, commit }}>
      <>
        <ViewHeader
          eyebrow="Agnostic QM → GROMACS bridge"
          title="QM → GROMACS Preparation"
          description="Bridge any quantum-chemistry calculation (ORCA, Gaussian .log/.fchk, xTB, Multiwfn, MOL2, CSV) and any force-field topology (OPLS-AA, GAFF2, CHARMM36, AMBER, GROMOS, OpenFF, Custom) into validated GROMACS inputs."
          actions={
            <label className="tutorial-toggle">
              <Switch checked={state.tutorialMode} onCheckedChange={(checked) => commit({ tutorialMode: checked })} />
              <span>
                <strong>Guidance</strong>
                <small>{state.tutorialMode ? "Hints visible" : "Compact"}</small>
              </span>
            </label>
          }
        />

        <div className="metrics-row">
          <Metric label="Prepared species" value={`${preparedCount}/${project.molecules.length}`} />
          <Metric label="Force field" value={project.protocol.forceField || "Custom"} />
          <Metric label="Planned runs" value={runs.length} />
          <Metric label="Selected run" value={run?.runId ?? "—"} />
          <Metric label="Next action" value={firstPending?.label ?? "Ready for GROMACS"} tone={firstPending ? "warning" : "good"} />
        </div>

        {error && (
          <div className="prep-error">
            <CircleAlert />
            <strong>Action failed</strong>
            <span>{error}</span>
            <Button variant="ghost" size="sm" onClick={() => setError("")}>
              Dismiss
            </Button>
          </div>
        )}

        <Tabs defaultValue="qm" className="prep-tabs">
          <TabsList variant="line" className="prep-tab-list">
            <TabsTrigger value="status">Overview</TabsTrigger>
            <TabsTrigger value="qm">1 · QM &amp; Geometry</TabsTrigger>
            <TabsTrigger value="mapping">2 · Mapping &amp; Bonds</TabsTrigger>
            <TabsTrigger value="topology">3 · Force Field &amp; .itp</TabsTrigger>
            <TabsTrigger value="packing">4 · Packing &amp; topol.top</TabsTrigger>
            <TabsTrigger value="run">5 · Run &amp; Handoff</TabsTrigger>
          </TabsList>

          <TabsContent value="status">
            <Section
              title="QM → GROMACS readiness checklist"
              kicker="TRACEABLE PIPELINE"
              actions={<RunSelector runs={runs} value={runId} onChange={(value) => commit({ selectedRunId: value })} />}
            >
              {!run && (
                <InlineWarning title="Run required for packing & system export">
                  Prepare individual molecules in tabs 1–3 at any time, then generate runs in{" "}
                  <button className="underline font-semibold" onClick={openRuns}>
                    Run Matrix &amp; MDP
                  </button>{" "}
                  to build Packmol inputs, `topol.top`, and frozen Run Input Packages.
                </InlineWarning>
              )}
              <div className="checklist-table">
                {checklist.map((item) => (
                  <div key={item.label}>
                    <StatusBadge
                      tone={item.status === "PASS" || item.status === "AUTOMATICALLY VERIFIED" || item.status === "RESEARCHER ACCEPTED" ? "good" : item.status === "FAIL" ? "danger" : item.status === "NOT RUN" ? "neutral" : "warning"}
                    >
                      {item.status}
                    </StatusBadge>
                    <strong>{item.label}</strong>
                    <span>{item.detail}</span>
                  </div>
                ))}
              </div>
              {firstPending && (
                <div className="next-action">
                  <ArrowRight />
                  <span>
                    <strong>Next:</strong> {firstPending.label}
                  </span>
                  <small>{firstPending.detail}</small>
                </div>
              )}
            </Section>

            <Section title="Bridge file map" kicker="CLICK A STEP TO INSPECT">
              <div className="dependency-map">
                {dependencyFiles.map((item, index) => (
                  <button key={item[0]} className={dependency === index ? "active" : ""} onClick={() => setDependency(index)}>
                    <FileCode2 />
                    <span>{item[0]}</span>
                    {index < dependencyFiles.length - 1 && <ArrowRight />}
                  </button>
                ))}
              </div>
              <div className="dependency-detail">
                <dl>
                  <div>
                    <dt>Artifact</dt>
                    <dd>{dependencyFiles[dependency][0]}</dd>
                  </div>
                  <div>
                    <dt>Produced by</dt>
                    <dd>{dependencyFiles[dependency][1]}</dd>
                  </div>
                  <div>
                    <dt>Consumed by</dt>
                    <dd>{dependencyFiles[dependency][2]}</dd>
                  </div>
                  <div>
                    <dt>Role</dt>
                    <dd>{dependencyFiles[dependency][3]}</dd>
                  </div>
                </dl>
              </div>
            </Section>
          </TabsContent>

          <TabsContent value="qm">
            <Section
              title="Geometry & QM charge import"
              kicker="ORCA · GAUSSIAN (.log/.fchk) · xTB · MULTIWFN · MOL2 · CSV"
              actions={<MoleculeSelector molecules={project.molecules} value={moleculeId} onChange={selectMolecule} />}
            >
              {!molecule || !preparation ? (
                <InlineWarning title="Molecule required">
                  Add a species in <strong>Molecules &amp; Systems</strong> first.
                </InlineWarning>
              ) : (
                <>
                  <div className="file-import-grid">
                    <SourceCard
                      title="Geometry (.xyz, .pdb, .gro, .mol2, .chg)"
                      file={preparation.geometryFile}
                      detail={
                        preparation.geometryAtoms.length
                          ? `${preparation.geometryAtoms.length} atoms · ${preparation.geometryComment || "loaded"}`
                          : "Optional if your QM output (.out/.log/.fchk/.chg/.mol2) already contains coordinates."
                      }
                    >
                      <FilePicker
                        label="Import geometry"
                        accept=".xyz,.pdb,.gro,.mol2,.chg,.pqr,text/plain"
                        onFile={(file) => handleFile("geometry", file)}
                      />
                    </SourceCard>
                    <SourceCard
                      title="QM output or charge table"
                      file={preparation.qmFile}
                      detail={
                        preparation.qmFile
                          ? `${preparation.qmMetadata.software.toUpperCase()} · ${preparation.qmMetadata.method}/${preparation.qmMetadata.basis} · schemes: ${preparation.qmMetadata.availableSchemes.join(", ") || "none"}`
                          : "Supports ORCA, Gaussian .log/.fchk, xTB, Multiwfn .chg/.pqr, MOL2, CSV/TSV."
                      }
                    >
                      <div className="flex flex-wrap gap-2 items-center">
                        <Select value={softwareHint} onValueChange={(v) => setSoftwareHint(v as QmSoftware | "auto")}>
                          <SelectTrigger className="h-8 w-40">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="auto">Auto-detect QM</SelectItem>
                            <SelectItem value="orca">ORCA (.out)</SelectItem>
                            <SelectItem value="gaussian">Gaussian (.log)</SelectItem>
                            <SelectItem value="gaussian-fchk">Gaussian (.fchk)</SelectItem>
                            <SelectItem value="xtb">xTB (.out / charges)</SelectItem>
                            <SelectItem value="multiwfn">Multiwfn (.chg/.pqr)</SelectItem>
                            <SelectItem value="mol2">MOL2 (.mol2)</SelectItem>
                            <SelectItem value="csv-table">CSV / TSV / TXT</SelectItem>
                          </SelectContent>
                        </Select>
                        <FilePicker
                          label="Import QM / charges"
                          accept=".out,.log,.fchk,.chg,.pqr,.mol2,.csv,.tsv,.txt,text/plain"
                          onFile={(file) => handleFile("qm", file)}
                        />
                      </div>
                    </SourceCard>
                  </div>

                  <div className="form-grid form-grid-4">
                    <div className="field-stack">
                      <Label>Charge source mode</Label>
                      <Select
                        value={preparation.chargeMode}
                        onValueChange={(v) => putPreparation(reconcilePreparation({ ...preparation, chargeMode: v as ChargeMode, chargeAcknowledged: false }))}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="qm">QM / imported charges</SelectItem>
                          <SelectItem value="topology">Keep topology native charges</SelectItem>
                          <SelectItem value="manual">Manual per-atom charges</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="field-stack">
                      <Label>Parsed charge scheme</Label>
                      <Select
                        disabled={preparation.chargeMode !== "qm" || !preparation.qmMetadata.availableSchemes.length}
                        value={preparation.selectedChargeScheme || "__none__"}
                        onValueChange={(v) =>
                          putPreparation(reconcilePreparation({ ...preparation, selectedChargeScheme: v === "__none__" ? "" : v, chargeAcknowledged: false }))
                        }
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="No scheme parsed" />
                        </SelectTrigger>
                        <SelectContent>
                          {preparation.qmMetadata.availableSchemes.length ? (
                            preparation.qmMetadata.availableSchemes.map((s) => (
                              <SelectItem key={s} value={s}>
                                {s} ({preparation.qmChargeSets[s]?.length ?? 0} atoms)
                              </SelectItem>
                            ))
                          ) : (
                            <SelectItem value="__none__">None</SelectItem>
                          )}
                        </SelectContent>
                      </Select>
                    </div>

                    <Field
                      label="Charge scale factor"
                      type="number"
                      step="0.01"
                      min="0.01"
                      value={preparation.chargeScaleFactor}
                      onChange={(value) =>
                        putPreparation(
                          reconcilePreparation({
                            ...preparation,
                            chargeScaleFactor: Number(value) > 0 ? Number(value) : 1.0,
                            chargeAcknowledged: false,
                          }),
                        )
                      }
                      note="e.g. 1.0 (unscaled) or 0.8 (polarization scaling)."
                    />

                    <div className="field-stack">
                      <Label>Residual neutralization</Label>
                      <Select
                        value={preparation.neutralizationPolicy}
                        onValueChange={(v) =>
                          putPreparation(
                            reconcilePreparation({
                              ...preparation,
                              neutralizationPolicy: v as NeutralizationPolicy,
                              chargeAcknowledged: false,
                            }),
                          )
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">None (exact raw/scaled values)</SelectItem>
                          <SelectItem value="uniform-residual">Uniform across all atoms</SelectItem>
                          <SelectItem value="heavy-atoms-residual">Uniform across heavy atoms</SelectItem>
                          <SelectItem value="largest-abs-atom">Adjust largest |q| atom</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="form-grid form-grid-4">
                    <Field label="Residue name" value={preparation.residueName} onChange={setResidue} note="Unique 1–4 alphanumeric chars." />
                    <Field
                      label="Expected formal charge"
                      type="number"
                      step="1"
                      value={preparation.expectedFormalCharge}
                      onChange={(value) =>
                        putPreparation(reconcilePreparation({ ...preparation, expectedFormalCharge: Number(value), chargeAcknowledged: false }))
                      }
                    />
                    <Field
                      label="Charge tolerance"
                      type="number"
                      step="0.000001"
                      min="0"
                      value={preparation.chargeTolerance}
                      onChange={(value) => putPreparation({ ...preparation, chargeTolerance: Math.max(0, Number(value)), chargeAcknowledged: false })}
                    />
                    <div className="field-stack">
                      <Label>Acknowledge residual</Label>
                      <label className="check-label">
                        <Checkbox
                          checked={preparation.chargeAcknowledged}
                          onCheckedChange={(checked) => putPreparation({ ...preparation, chargeAcknowledged: checked === true })}
                        />
                        <span>Accept charge sum as-is</span>
                      </label>
                    </div>
                  </div>

                  <div className="raw-meta prep-meta">
                    <span>Detected QM</span>
                    <code>
                      {preparation.qmMetadata.software} · {preparation.qmMetadata.method} / {preparation.qmMetadata.basis}
                    </code>
                    <span>Raw sum</span>
                    <code>{mappedRawChargeSum(preparation).toFixed(8)}</code>
                    <span>Final sum</span>
                    <code>{mappedFinalChargeSum(preparation).toFixed(8)}</code>
                    <span>QM vs Geom RMSD</span>
                    <code>{geometry ? `${geometry.rmsdAngstrom.toFixed(5)} Å (max ${geometry.maxDisplacementAngstrom.toFixed(5)} Å)` : "n/a"}</code>
                  </div>
                  <div className="raw-meta prep-meta">
                    <span>QM formal charge / mult</span>
                    <code>
                      {preparation.qmMetadata.parsedTotalCharge ?? "n/a"} / {preparation.qmMetadata.multiplicity ?? "n/a"}
                    </code>
                    <span>Input / route line</span>
                    <code>{preparation.qmMetadata.inputLine || "n/a"}</code>
                  </div>

                  {geometry && geometry.maxDisplacementAngstrom > 0.05 && (
                    <label className="approval-label">
                      <Checkbox
                        checked={preparation.geometryAcknowledged}
                        onCheckedChange={(checked) => putPreparation({ ...preparation, geometryAcknowledged: checked === true })}
                      />
                      <span>I confirm the coordinate difference reflects optimization/conformer difference, not atom reordering</span>
                    </label>
                  )}

                  <Diagnostics items={qmFindings} />
                </>
              )}
            </Section>
          </TabsContent>

          <TabsContent value="mapping">
            <Section
              title="Atom & charge mapping"
              kicker="EXACT BIJECTIVE INDEXING · ZERO SILENT REORDERING"
              actions={<MoleculeSelector molecules={project.molecules} value={moleculeId} onChange={selectMolecule} />}
            >
              {!preparation?.atoms.length ? (
                <InlineWarning title="Geometry required">Import a geometry or QM output with coordinates in Tab 1 first.</InlineWarning>
              ) : (
                <>
                  <div className="form-grid form-grid-4">
                    <label className="approval-label">
                      <Checkbox
                        checked={preparation.coordinateSettings.center}
                        onCheckedChange={(checked) =>
                          putPreparation({
                            ...preparation,
                            coordinateSettings: { ...preparation.coordinateSettings, center: checked === true },
                          })
                        }
                      />
                      <span>Center molecular coordinates</span>
                    </label>
                    <Field
                      label="Translate X / Å"
                      type="number"
                      step="0.1"
                      value={preparation.coordinateSettings.translateAngstrom.x}
                      onChange={(value) =>
                        putPreparation({
                          ...preparation,
                          coordinateSettings: {
                            ...preparation.coordinateSettings,
                            translateAngstrom: { ...preparation.coordinateSettings.translateAngstrom, x: Number(value) },
                          },
                        })
                      }
                    />
                    <Field
                      label="Translate Y / Å"
                      type="number"
                      step="0.1"
                      value={preparation.coordinateSettings.translateAngstrom.y}
                      onChange={(value) =>
                        putPreparation({
                          ...preparation,
                          coordinateSettings: {
                            ...preparation.coordinateSettings,
                            translateAngstrom: { ...preparation.coordinateSettings.translateAngstrom, y: Number(value) },
                          },
                        })
                      }
                    />
                    <Field
                      label="Translate Z / Å"
                      type="number"
                      step="0.1"
                      value={preparation.coordinateSettings.translateAngstrom.z}
                      onChange={(value) =>
                        putPreparation({
                          ...preparation,
                          coordinateSettings: {
                            ...preparation.coordinateSettings,
                            translateAngstrom: { ...preparation.coordinateSettings.translateAngstrom, z: Number(value) },
                          },
                        })
                      }
                    />
                  </div>

                  <div className="table-scroll prep-table">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>#</TableHead>
                          <TableHead>El</TableHead>
                          <TableHead>Coordinates / Å</TableHead>
                          <TableHead>QM index</TableHead>
                          <TableHead>QM El</TableHead>
                          <TableHead>GROMACS name</TableHead>
                          <TableHead>Raw QM q</TableHead>
                          <TableHead>Manual q override</TableHead>
                          <TableHead>Final q</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {preparation.atoms.map((atom) => (
                          <TableRow key={atom.index} className={atom.outElement && atom.outElement !== atom.element ? "row-error" : ""}>
                            <TableCell>{atom.index}</TableCell>
                            <TableCell>
                              <strong>{atom.element}</strong>
                            </TableCell>
                            <TableCell className="font-mono text-xs">
                              {atom.x.toFixed(4)}, {atom.y.toFixed(4)}, {atom.z.toFixed(4)}
                            </TableCell>
                            <TableCell>
                              <Input
                                className={inputClass}
                                type="number"
                                min={1}
                                max={activeCharges.length || undefined}
                                value={atom.outIndex}
                                onChange={(e) => patchAtom(atom.index, { outIndex: Number(e.target.value) }, true)}
                              />
                            </TableCell>
                            <TableCell>{atom.outElement ?? "—"}</TableCell>
                            <TableCell>
                              <Input
                                className={inputClass}
                                value={atom.gromacsName}
                                onChange={(e) => patchAtom(atom.index, { gromacsName: e.target.value.replace(/\s/g, "").slice(0, 4) })}
                              />
                            </TableCell>
                            <TableCell className="font-mono text-xs">{atom.rawQmCharge?.toFixed(6) ?? "—"}</TableCell>
                            <TableCell>
                              <Input
                                className={inputClass}
                                type="number"
                                step="any"
                                placeholder="auto"
                                value={atom.manualCharge ?? ""}
                                onChange={(e) =>
                                  patchAtom(
                                    atom.index,
                                    { manualCharge: e.target.value === "" ? null : Number(e.target.value) },
                                    true,
                                  )
                                }
                              />
                            </TableCell>
                            <TableCell className="font-mono text-xs font-semibold">{atom.finalCharge?.toFixed(6) ?? "MISSING"}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>

                  <div className="button-row">
                    <Button variant="outline" size="sm" onClick={() => downloadText("atom_mapping.csv", generateAtomMappingCsv(preparation), "text/csv")}>
                      <Download />
                      atom_mapping.csv
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => downloadText("charges.csv", generateChargesCsv(preparation), "text/csv")}>
                      <Download />
                      charges.csv
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => downloadText(`${safeBase(preparation.moleculeId)}.pdb`, generatePdb(preparation))}>
                      <Download />
                      PDB (Å)
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => downloadText(`${safeBase(preparation.moleculeId)}.gro`, generateGro(preparation))}>
                      <Download />
                      GRO (nm)
                    </Button>
                  </div>
                </>
              )}
            </Section>

            <Section
              title="Connectivity graph"
              kicker="COVALENT-RADIUS SUGGESTION OR IMPORTED FROM MOL2 / TOPOLOGY"
              actions={
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!preparation?.atoms.length}
                  onClick={() => preparation && putPreparation(proposeConnectivity(preparation))}
                >
                  <Network />
                  Suggest bonds
                </Button>
              }
            >
              {!preparation?.bonds.length ? (
                <InlineWarning title="No bond graph yet">
                  Click <strong>Suggest bonds</strong>, import a `.mol2`/`.itp` topology, or add bonds manually. (Single-atom ions do not require bonds.)
                </InlineWarning>
              ) : (
                <div className="table-scroll prep-table">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Accept</TableHead>
                        <TableHead>i</TableHead>
                        <TableHead>j</TableHead>
                        <TableHead>Elements</TableHead>
                        <TableHead>Distance / Å</TableHead>
                        <TableHead>Source</TableHead>
                        <TableHead />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {preparation.bonds.map((bond) => (
                        <TableRow key={bond.id}>
                          <TableCell>
                            <Checkbox checked={bond.accepted} onCheckedChange={(checked) => patchBond(bond.id, { accepted: checked === true })} />
                          </TableCell>
                          <TableCell>{bond.ai}</TableCell>
                          <TableCell>{bond.aj}</TableCell>
                          <TableCell>
                            {bond.elementI}–{bond.elementJ}
                          </TableCell>
                          <TableCell>{bond.distanceAngstrom.toFixed(4)}</TableCell>
                          <TableCell>
                            <StatusBadge>{bond.source}</StatusBadge>
                          </TableCell>
                          <TableCell>
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label="Delete bond"
                              onClick={() =>
                                putPreparation({
                                  ...preparation,
                                  bonds: preparation.bonds.filter((item) => item.id !== bond.id),
                                  connectivityApproved: false,
                                })
                              }
                            >
                              <Trash2 />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
              {preparation && (
                <div className="inline-form">
                  <Field label="Atom i" type="number" min="1" value={bondDraft.ai} onChange={(value) => setBondDraft({ ...bondDraft, ai: Number(value) })} />
                  <Field label="Atom j" type="number" min="1" value={bondDraft.aj} onChange={(value) => setBondDraft({ ...bondDraft, aj: Number(value) })} />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      const a = preparation.atoms[bondDraft.ai - 1], b = preparation.atoms[bondDraft.aj - 1]
                      if (!a || !b || a.index === b.index) return setError("Manual bond needs two distinct valid atom indices.")
                      putPreparation({
                        ...preparation,
                        bonds: [
                          ...preparation.bonds,
                          {
                            id: `user-${uuid()}`,
                            ai: a.index,
                            aj: b.index,
                            elementI: a.element,
                            elementJ: b.element,
                            distanceAngstrom: Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z),
                            proposed: false,
                            accepted: true,
                            source: "user",
                          },
                        ],
                        connectivityApproved: false,
                      })
                    }}
                  >
                    <Plus />
                    Add bond
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!preparation.bonds.length}
                    onClick={() =>
                      putPreparation({
                        ...preparation,
                        bonds: preparation.bonds.map((b) => ({ ...b, accepted: true })),
                        connectivityApproved: true,
                      })
                    }
                  >
                    <Check />
                    Accept all &amp; approve graph
                  </Button>
                  <label className="approval-label">
                    <Checkbox
                      checked={preparation.connectivityApproved}
                      disabled={!preparation.bonds.length || preparation.bonds.some((bond) => !bond.accepted)}
                      onCheckedChange={(checked) => putPreparation({ ...preparation, connectivityApproved: checked === true })}
                    />
                    <span>Approve connectivity graph</span>
                  </label>
                </div>
              )}
            </Section>
          </TabsContent>

          <TabsContent value="topology">
            <Section
              title={`Force-field topology & partial-charge merge (${project.protocol.forceField})`}
              kicker="ANY FORCE FIELD · ACPYPE · x2top · ANTECHAMBER · SOBTOP · LIGPARGEN · CGENFF"
              actions={<MoleculeSelector molecules={project.molecules} value={moleculeId} onChange={selectMolecule} />}
            >
              {state.tutorialMode && (
                <p>
                  Import a `.top`/`.itp` from any topology tool. SolvForge preserves the bonded/LJ framework and injects your chosen final partial charges (QM, scaled/neutralized, topology-native, or manual) in exact geometry atom order.
                </p>
              )}

              {!preparation?.atoms.length ? (
                <InlineWarning title="Mapping required">Import geometry / QM files in Tab 1 first.</InlineWarning>
              ) : (
                <div className="table-scroll prep-table">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Atom</TableHead>
                        <TableHead>Bonds</TableHead>
                        <TableHead>FF atom type</TableHead>
                        <TableHead>Mass</TableHead>
                        <TableHead>Topology q</TableHead>
                        <TableHead>Raw QM q</TableHead>
                        <TableHead>Final q</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {preparation.atoms.map((atom) => (
                        <TableRow key={atom.index}>
                          <TableCell>
                            <strong>{atom.gromacsName}</strong>
                            <small className="block">
                              {atom.element} · #{atom.index}
                            </small>
                          </TableCell>
                          <TableCell>{preparation.bonds.filter((bond) => bond.ai === atom.index || bond.aj === atom.index).length}</TableCell>
                          <TableCell>
                            <Input
                              className={inputClass}
                              value={atom.atomType}
                              placeholder="e.g. c3 / opls_154"
                              onChange={(event) =>
                                patchAtom(atom.index, {
                                  atomType: event.target.value.trim(),
                                  mappingStatus: event.target.value.trim() ? "USER-OVERRIDDEN" : "UNMAPPED",
                                })
                              }
                            />
                          </TableCell>
                          <TableCell>
                            <Input
                              className={inputClass}
                              type="number"
                              step="any"
                              value={atom.mass ?? ""}
                              onChange={(event) => patchAtom(atom.index, { mass: event.target.value === "" ? null : Number(event.target.value) })}
                            />
                          </TableCell>
                          <TableCell className="font-mono text-xs">{atom.existingTopologyCharge?.toFixed(6) ?? "—"}</TableCell>
                          <TableCell className="font-mono text-xs">{atom.rawQmCharge?.toFixed(6) ?? "—"}</TableCell>
                          <TableCell className="font-mono text-xs font-semibold">{atom.finalCharge?.toFixed(6) ?? "MISSING"}</TableCell>
                          <TableCell>
                            <StatusBadge tone={atom.mappingStatus === "UNMAPPED" ? "danger" : atom.mappingStatus === "REVIEW REQUIRED" ? "warning" : "good"}>
                              {atom.mappingStatus}
                            </StatusBadge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}

              {preparation && (
                <>
                  <div className="form-grid form-grid-3 mt-grid">
                    <div className="field-stack">
                      <Label>Topology generator helper</Label>
                      <Select
                        value={preparation.topologyHelperTool}
                        onValueChange={(v) => putPreparation({ ...preparation, topologyHelperTool: v as TopologyHelperTool })}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="acpype">ACPYPE (GAFF2 / AMBER)</SelectItem>
                          <SelectItem value="x2top">gmx x2top (OPLS-AA / GROMOS / etc.)</SelectItem>
                          <SelectItem value="antechamber">AmberTools Antechamber + ParmEd</SelectItem>
                          <SelectItem value="sobtop">Sobtop (QM Hessian / Bonded)</SelectItem>
                          <SelectItem value="ligpargen">LigParGen (OPLS-AA)</SelectItem>
                          <SelectItem value="cgenff">CGenFF (CHARMM36)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <CodePanel
                    title="Topology helper command"
                    text={topologyToolCommand(preparation, project.protocol.forceField)}
                    filename={`${safeBase(preparation.moleculeId)}_toptool.sh`}
                  />

                  <div className="file-import-grid">
                    <SourceCard
                      title="Import force-field topology (.top / .itp)"
                      file={
                        preparation.topologyText
                          ? {
                              name: preparation.topologyFileName || "topology.itp",
                              sha256: preparation.originalTopologyFile?.sha256 ?? "editable",
                            }
                          : null
                      }
                      detail="Imports [ atomtypes ], [ moleculetype ], [ atoms ], [ bonds ], [ pairs ], [ angles ], [ dihedrals ], etc."
                    >
                      <FilePicker label="Import .top / .itp" accept=".top,.itp,text/plain" onFile={(file) => handleFile("topology", file)} />
                    </SourceCard>
                    <div className="review-checklist">
                      <strong>Topology review checklist</strong>
                      {["Atom types & LJ parameters present", "Bonded terms (bonds/angles/dihedrals)", "1–4 pairs & exclusions match FF", "Net charge & atom order verified"].map(
                        (item) => (
                          <span key={item}>{item}</span>
                        ),
                      )}
                    </div>
                  </div>

                  {preparation.topologyText && (
                    <>
                      <Textarea
                        className="topology-editor"
                        value={preparation.topologyText}
                        onChange={(event) => putPreparation({ ...preparation, topologyText: event.target.value, topologyReviewed: false, gromppValidated: false })}
                      />
                      <div className="button-row">
                        <Button variant="outline" size="sm" onClick={() => putPreparation(applyEditedTopology(preparation, preparation.topologyText))}>
                          <RotateCcw />
                          Re-parse edited topology
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            putPreparation({
                              ...preparation,
                              atoms: preparation.atoms.map((atom) =>
                                atom.mappingStatus === "REVIEW REQUIRED" ? { ...atom, mappingStatus: "AUTO-MAPPED" as const } : atom,
                              ),
                            })
                          }
                        >
                          <Check />
                          Accept imported atom types
                        </Button>
                        <label className="approval-label">
                          <Checkbox
                            checked={preparation.topologyReviewed}
                            onCheckedChange={(checked) => putPreparation({ ...preparation, topologyReviewed: checked === true })}
                          />
                          <span>Topology reviewed</span>
                        </label>
                        <label className="approval-label">
                          <Checkbox
                            checked={preparation.gromppValidated}
                            onCheckedChange={(checked) => putPreparation({ ...preparation, gromppValidated: checked === true })}
                          />
                          <span>External `gmx grompp` passed</span>
                        </label>
                      </div>
                    </>
                  )}

                  <div className="topology-status">
                    <StatusBadge
                      tone={topologyStatus.startsWith("RESEARCHER ACCEPTED") ? "good" : topologyStatus.startsWith("READY") ? "warning" : "danger"}
                    >
                      {topologyStatus}
                    </StatusBadge>
                    <p>Generated `.itp` remains clearly flagged until all diagnostics pass.</p>
                  </div>
                  <Diagnostics items={topologyFindings} />
                  <CodePanel
                    title="Merged molecular topology (.itp)"
                    text={generateItp(preparation, project.protocol.forceField)}
                    filename={`${safeBase(preparation.moleculeId)}.itp`}
                    language="gromacs-topology"
                  />
                </>
              )}
            </Section>
          </TabsContent>

          <TabsContent value="packing">
            <Section
              title="Packmol box setup"
              kicker="EXACT COUNTS FROM SELECTED RUN"
              actions={<RunSelector runs={runs} value={runId} onChange={(value) => commit({ selectedRunId: value })} />}
            >
              {!run ? (
                <InlineWarning title="Run required">
                  Generate at least one run in{" "}
                  <button className="underline font-semibold" onClick={openRuns}>
                    Run Matrix &amp; MDP
                  </button>{" "}
                  first.
                </InlineWarning>
              ) : (
                <>
                  <div className="metrics-row">
                    <Metric label="Box" value={`${run.box.x} × ${run.box.y} × ${run.box.z} ${run.box.unit ?? "nm"}`} />
                    <Metric label="System" value={run.systemName} />
                    <Metric label="Solute" value={run.soluteName ? `${run.soluteName} (${run.soluteCount})` : "Neat"} />
                    <Metric label="Total molecules" value={run.totalMoleculeCount ?? "unresolved"} tone={run.totalMoleculeCount ? "good" : "warning"} />
                    <Metric
                      label="Estimated density"
                      value={
                        run.compositionCalculation?.estimatedDensityGcm3
                          ? `${formatNumber(run.compositionCalculation.estimatedDensityGcm3, 5)} g cm⁻³`
                          : "—"
                      }
                    />
                  </div>
                  <div className="species-strip">
                    {runSpecies(run).map((species) => (
                      <div key={species.moleculeId}>
                        <span>{state.molecules[species.moleculeId]?.residueName ?? "UNRESOLVED"}</span>
                        <strong>{species.count}</strong>
                        <small>{species.name}</small>
                      </div>
                    ))}
                  </div>
                  <div className="form-grid form-grid-3">
                    <Field
                      label="Packmol tolerance / Å"
                      type="number"
                      min="0"
                      step="0.1"
                      value={state.packmol.toleranceAngstrom}
                      onChange={(value) => commit({ packmol: { ...state.packmol, toleranceAngstrom: Number(value) } })}
                    />
                    <Field
                      label="Box margin / Å"
                      type="number"
                      min="0"
                      step="0.1"
                      value={state.packmol.marginAngstrom}
                      onChange={(value) => commit({ packmol: { ...state.packmol, marginAngstrom: Number(value) } })}
                    />
                    <label className="approval-label">
                      <Checkbox
                        checked={state.packmol.periodic}
                        onCheckedChange={(checked) => commit({ packmol: { ...state.packmol, periodic: checked === true } })}
                      />
                      <span>Write Packmol PBC directive</span>
                    </label>
                  </div>
                  <CodePanel title="Packmol input" text={packmolInput} filename="packmol.inp" language="packmol" />
                  <CodePanel title="Packmol command" text="packmol < packmol.inp" filename="run_packmol.sh" />
                </>
              )}
            </Section>

            <Section
              title="Packed system validation & topol.top"
              kicker="COORDINATES ↔ TOPOLOGY INTEGRITY"
              actions={<FilePicker label="Import packed.pdb" accept=".pdb,text/plain" disabled={!run} onFile={importPacked} />}
            >
              {state.tutorialMode && (
                <p>
                  Run Packmol locally and import `packed.pdb`. SolvForge verifies exact residue ordering, atom counts, and box bounds before exporting `packed.gro`, `topol.top`, and `index.ndx`.
                </p>
              )}
              <Diagnostics items={systemFindings} />
              {run && (
                <>
                  <div className="button-row">
                    {packed && (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={packFindings.some((item) => item.severity === "ERROR")}
                        onClick={() => downloadText("packed.gro", generatePackedGro(run, packed))}
                      >
                        <Download />
                        packed.gro
                      </Button>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={systemFindings.some((item) => item.severity === "ERROR")}
                      onClick={() => downloadText("topol.top", generateTopolTop(run, state.molecules))}
                    >
                      <Download />
                      topol.top
                    </Button>
                    {packed && (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={packFindings.some((item) => item.severity === "ERROR")}
                        onClick={() => downloadText("index.ndx", generateIndexNdx(packed, run, state.molecules))}
                      >
                        <Download />
                        index.ndx
                      </Button>
                    )}
                    <Button size="sm" onClick={openData}>
                      Freeze &amp; Export Run Package →
                    </Button>
                  </div>
                  <CodePanel title="System topology (topol.top)" text={generateTopolTop(run, state.molecules)} filename="topol.top" language="gromacs-topology" />
                </>
              )}
            </Section>
          </TabsContent>

          <TabsContent value="run">
            <Section
              title="GROMACS execution workflow"
              kicker="EXTERNAL EXECUTION · RECORD STATUS"
              actions={<RunSelector runs={runs} value={runId} onChange={(value) => commit({ selectedRunId: value })} />}
            >
              {!run ? (
                <InlineWarning title="Run required">Select a generated run first.</InlineWarning>
              ) : (
                <div className="tutorial-steps">
                  {tutorialSteps.map((step) => (
                    <article key={step.key}>
                      <header>
                        <span>{step.key === "em" ? "01" : step.key === "nvt" ? "02" : step.key === "npt" ? "03" : "04"}</span>
                        <h3>{step.title}</h3>
                        <Select
                          value={executionFor(state, run.runId)[step.key]}
                          onValueChange={(value: "not-run" | "failed" | "accepted") => setExecution(step.key, value)}
                        >
                          <SelectTrigger size="sm">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="not-run">NOT RUN</SelectItem>
                            <SelectItem value="failed">FAILED</SelectItem>
                            <SelectItem value="accepted">RESEARCHER ACCEPTED</SelectItem>
                          </SelectContent>
                        </Select>
                      </header>
                      {state.tutorialMode && (
                        <div className="tutorial-explain">
                          <TutorialRow label="Purpose" value={step.purpose} />
                          <TutorialRow label="Inputs" value={step.inputs} />
                          <TutorialRow label="Outputs" value={step.outputs} />
                          <TutorialRow label="Checks" value={step.checks} />
                        </div>
                      )}
                      <CodePanel title="Stage commands" text={step.commands} filename={`${step.key}.sh`} />
                    </article>
                  ))}
                </div>
              )}
            </Section>

            <Section title="Optional post-MD extraction & MoDy Analyse handoff" kicker={`${pairCount} PAIR(S) · NO IN-APP ANALYZER`}>
              <InlineWarning title="Analysis decoupled to MoDy Analyse">
                SolvForge MD focuses exclusively on QM → GROMACS preparation. Every exported Run Input Package includes a `metadata.json` compliant with `mody-analyse` (`run_metadata.schema.json`). Optional `gmx rdf` helper scripts are available below if you want to pre-extract XVG files on your HPC cluster.
              </InlineWarning>
              {run && (
                <>
                  <div className="form-grid form-grid-4">
                    <div className="field-stack">
                      <Label>RDF selection mode</Label>
                      <Select
                        value={state.rdf.mode}
                        onValueChange={(value: QmGromacsState["rdf"]["mode"]) => commit({ rdf: { ...state.rdf, mode: value } })}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="center-of-mass">Center of mass</SelectItem>
                          <SelectItem value="atom-based">Atom based</SelectItem>
                          <SelectItem value="custom">Custom selections</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <Field
                      label="Bin width / nm"
                      type="number"
                      min="0.000001"
                      step="0.001"
                      value={state.rdf.binWidthNm}
                      onChange={(value) => commit({ rdf: { ...state.rdf, binWidthNm: Number(value) } })}
                    />
                    <Field
                      label="Max radius / nm"
                      type="number"
                      min="0.000001"
                      step="0.1"
                      value={state.rdf.rmaxNm}
                      onChange={(value) => commit({ rdf: { ...state.rdf, rmaxNm: Number(value) } })}
                    />
                    <Field
                      label="Start time / ns"
                      type="number"
                      value={state.rdf.beginNs}
                      onChange={(v) => commit({ rdf: { ...state.rdf, beginNs: Number(v) } })}
                    />
                    <Field
                      label="End time / ns"
                      type="number"
                      value={state.rdf.endNs}
                      onChange={(v) => commit({ rdf: { ...state.rdf, endNs: Number(v) } })}
                    />
                  </div>
                  <Field
                    label="Block windows / ns"
                    value={state.rdf.blocks}
                    onChange={(value) => commit({ rdf: { ...state.rdf, blocks: value } })}
                    note="Example: 0-10, 10-20, 20-30"
                  />
                  <CodePanel title="Pairwise RDF extraction script" text={rdfCommands} filename="rdf_all_pairs.sh" />
                  <CodePanel title="Block RDF extraction script" text={blockCommands} filename="rdf_blocks.sh" />
                </>
              )}
            </Section>
          </TabsContent>
        </Tabs>
      </>
    </CommandEditingContext.Provider>
  )
}

function MoleculeSelector({ molecules, value, onChange }: { molecules: Molecule[]; value: string; onChange: (id: string) => void }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="w-60">
        <SelectValue placeholder="Choose molecule" />
      </SelectTrigger>
      <SelectContent>
        {molecules.map((m) => (
          <SelectItem key={m.id} value={m.id}>
            {m.fullName} ({m.residueName})
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function RunSelector({ runs, value, onChange }: { runs: RunRecord[]; value: string; onChange: (id: string) => void }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="w-72">
        <SelectValue placeholder="Choose generated run" />
      </SelectTrigger>
      <SelectContent>
        {runs.map((r) => (
          <SelectItem key={r.runId} value={r.runId}>
            {r.runId}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function SourceCard({
  title,
  file,
  detail,
  children,
}: {
  title: string
  file: { name: string; sha256: string } | null
  detail: string
  children: React.ReactNode
}) {
  return (
    <div className="source-card">
      <div>
        <strong>{title}</strong>
        <p>{detail}</p>
        {file && (
          <small>
            <code>{file.name}</code> · SHA-256 <code>{file.sha256.slice(0, 12)}…</code>
          </small>
        )}
      </div>
      {children}
    </div>
  )
}

function TutorialRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <strong>{label}:</strong> <span>{value}</span>
    </div>
  )
}
