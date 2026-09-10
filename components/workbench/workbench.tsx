"use client"

import { useEffect, useRef, useState } from "react"
import { Atom, BookOpenText, Boxes, Cable, ChartNoAxesCombined, CircleCheckBig, Database, FlaskConical, FolderKanban, Gauge, Grid3X3, Microscope, ScanSearch, Thermometer, Workflow } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarHeader, SidebarInset, SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarProvider, SidebarSeparator, SidebarTrigger } from "@/components/ui/sidebar"
import type { ProjectState, RDFDataset, RunRecord, ScientificState } from "@/lib/workbench/types"
import { createThesisProject, migrateProject } from "@/lib/workbench/preset"
import { loadOrcaGromacsState, loadRdfDatasets, loadScientificState } from "@/lib/workbench/storage"
import { SOFTWARE_VERSION } from "@/lib/workbench/version"
import { validateSourceIntegrity } from "@/lib/workbench/packages"
import { clearPreparedExport } from "@/lib/workbench/export"
import { provenanceGraph } from "@/lib/workbench/provenance"
import { emptyWorkspace, importWorkspace, duplicateWorkspace, mergeRuns, scopeRecords, assertProjectOwnership, type ImportBundle, type Workspace } from "@/lib/workbench/workspace"
import { loadWorkspace, saveWorkspace, listWorkspaces } from "@/lib/workbench/storage"
import { type OrcaGromacsState } from "@/lib/workbench/orca-gromacs"
import { ProjectView } from "./project-view"
import { MoleculesView } from "./molecules-view"
import { RunGeneratorView } from "./run-generator-view"
import { KbiView } from "./kbi-view"
import { ChampionView, ConcentrationView, TemperatureView } from "./decision-views"
import { SsmView } from "./ssm-view"
import { ThermoView } from "./thermo-view"
import { CosmoView } from "./cosmo-view"
import { ValidationView } from "./validation-view"
import { MethodsView } from "./methods-view"
import { DataView } from "./data-view"
import { OrcaGromacsView } from "./orca-gromacs-view"

type ViewId = "project" | "molecules" | "runs" | "orca" | "kbi" | "champion" | "concentration" | "temperature" | "ssm" | "matrix" | "cosmo" | "validation" | "methods" | "data"

const navigation: Array<{ group: string; items: Array<{ id: ViewId; label: string; icon: typeof Atom }> }> = [
  { group: "Design", items: [{ id: "project", label: "Project", icon: FolderKanban }, { id: "molecules", label: "Molecules", icon: Atom }, { id: "runs", label: "Run Generator", icon: Workflow }, { id: "orca", label: "ORCA → GROMACS", icon: Cable }] },
  { group: "Analysis", items: [{ id: "kbi", label: "KBI Analyzer", icon: ChartNoAxesCombined }, { id: "ssm", label: "SSM / Finite Size", icon: Boxes }, { id: "matrix", label: "KB Matrix / Thermo", icon: Grid3X3 }, { id: "cosmo", label: "COSMO-RS Validation", icon: ScanSearch }] },
  { group: "Thesis workflow", items: [{ id: "champion", label: "Champion Screening", icon: FlaskConical }, { id: "concentration", label: "Concentration", icon: Gauge }, { id: "temperature", label: "Temperature", icon: Thermometer }] },
  { group: "Assurance", items: [{ id: "validation", label: "Validation Tests", icon: CircleCheckBig }, { id: "methods", label: "Method / Equations", icon: BookOpenText }, { id: "data", label: "Data / Export", icon: Database }] },
]

export default function Workbench() {
  const [workspace, setWorkspaceState] = useState<Workspace>(() => emptyWorkspace(createThesisProject()))
  const latest = useRef(workspace)
  const writes = useRef<Promise<void>>(Promise.resolve())
  const [savedProjects, setSavedProjects] = useState<Array<{ projectId: string; projectName: string; savedAt: string }>>([])
  const { project, customPresets, datasets, runs: activeRuns, scientific, orcaGromacs } = workspace
  const [view, setView] = useState<ViewId>("project")
  const [hydrated, setHydrated] = useState(false)
  const [saveState, setSaveState] = useState<"saved" | "saving" | "error">("saved")
  const [storageError, setStorageError] = useState("")
  useEffect(() => {
    let cancelled = false
    void (async () => {
      let next = await loadWorkspace()
      if (!next) {
        const old = localStorage.getItem("gsmw.project")
        next = emptyWorkspace(old ? migrateProject(JSON.parse(old)) : createThesisProject())
        const [rdf, science, orca] = await Promise.all([loadRdfDatasets(), loadScientificState(), loadOrcaGromacsState()])
        const runs = localStorage.getItem("gsmw.runs")
        if (old || runs || rdf.length || science.ssmPoints.length || Object.keys(orca.molecules).length) next.legacyEvidence = { reason: "Legacy global stores have unresolved project ownership. Kept outside the active scientific workspace.", project: old ? JSON.parse(old) : null, runs: runs ? JSON.parse(runs) : [], datasets: rdf, scientific: science, orcaGromacs: orca }
        next.customPresets = JSON.parse(localStorage.getItem("gsmw.presets") ?? "[]")
        await saveWorkspace(next)
      }
      // Reopening updates migration/opening provenance, never the version of
      // historical runs or scientific results. The full envelope stays intact.
      next = importWorkspace(next)
      await validateSourceIntegrity(next)
      await saveWorkspace(next)
      if (cancelled) return
      latest.current = next; setWorkspaceState(next); setSavedProjects(await listWorkspaces()); setHydrated(true)
    })().catch((e) => { if (!cancelled) { setStorageError(String(e)); setSaveState("error"); setHydrated(true) } })
    return () => { cancelled = true }
  }, [])
  const commitWorkspace = (next: Workspace) => {
    assertProjectOwnership(next, next.projectId)
    clearPreparedExport()
    next = { ...next, savedAt: new Date().toISOString(), savedWithVersion: SOFTWARE_VERSION }
    next.provenance = provenanceGraph(next)
    latest.current = next; setWorkspaceState(next); setSaveState("saving")
    const revision = next.savedAt
    writes.current = writes.current.catch(() => {}).then(() => saveWorkspace(next)).then(async () => {
      if (latest.current.savedAt === revision) { setSaveState("saved"); setStorageError("") }
      setSavedProjects(await listWorkspaces())
    }).catch((e) => { setSaveState("error"); setStorageError(String(e)) })
  }
  const setProject = (next: ProjectState) => {
    const w = latest.current
    if(next.projectId!==w.projectId){commitWorkspace({...emptyWorkspace(next),customPresets:w.customPresets});return}
    const molecules={...w.orcaGromacs.molecules}
    for(const m of next.molecules){const p=molecules[m.id];if(p&&(p.residueName!==m.residueName||p.expectedFormalCharge!==m.charge))molecules[m.id]={...p,residueName:m.residueName,expectedFormalCharge:m.charge,atoms:p.atoms.map(a=>({...a,residueName:m.residueName})),topologyReviewed:false,gromppValidated:false,chargeAcknowledged:false}}
    commitWorkspace({...w,project:next,orcaGromacs:{...w.orcaGromacs,molecules}})
  }
  const setCustomPresets = (next: ProjectState[]) => commitWorkspace({ ...latest.current, customPresets: next })
  const setActiveRuns = (next: RunRecord[]) => {
    try { commitWorkspace({ ...latest.current, runs: mergeRuns(latest.current.runs, scopeRecords(next, latest.current.projectId)) }) }
    catch (e) { alert(String(e)) }
  }
  const setDatasets = (next: RDFDataset[]) => commitWorkspace({ ...latest.current, datasets: scopeRecords(next, latest.current.projectId) })
  const setScientific = (next: ScientificState) => commitWorkspace({ ...latest.current, scientific: { ...scopeRecords(next, latest.current.projectId), projectId: latest.current.projectId } })
  const setOrcaGromacs = (next: OrcaGromacsState) => {
    const w=latest.current
    const molecules=w.project.molecules.map(m=>next.molecules[m.id]?{...m,residueName:next.molecules[m.id].residueName,charge:next.molecules[m.id].expectedFormalCharge}:m)
    commitWorkspace({...w,project:{...w.project,molecules},orcaGromacs:{...scopeRecords(next,w.projectId),projectId:w.projectId}})
  }
  const importBundle = async (bundle: ImportBundle) => { const next=importWorkspace(bundle);await validateSourceIntegrity(next);commitWorkspace(next) }
  const openProject = async (id: string) => {
    await writes.current
    const next = await loadWorkspace(id)
    if (!next) throw new Error("Saved project unavailable.")
    const restored = importWorkspace(next)
    await validateSourceIntegrity(restored)
    commitWorkspace(restored)
  }

  const champion = project.desSystems.find((d) => d.id === project.selectedChampion?.valueId)
  const optimum = project.concentrations.find((c) => c.id === project.selectedOptimum?.valueId)
  const render = () => {
    switch (view) {
      case "project": return <ProjectView project={project} setProject={setProject} customPresets={customPresets} setCustomPresets={setCustomPresets} onImportBundle={importBundle} onDuplicate={(evidence) => commitWorkspace(duplicateWorkspace(latest.current, evidence))}/>
      case "molecules": return <MoleculesView project={project} setProject={setProject}/>
      case "runs": return <RunGeneratorView project={project} setProject={setProject} activeRuns={activeRuns} setActiveRuns={setActiveRuns}/>
      case "orca": return <OrcaGromacsView project={project} runs={activeRuns} datasets={datasets} setDatasets={setDatasets} state={orcaGromacs} setState={setOrcaGromacs} openKbi={() => setView("kbi")} openData={()=>setView("data")} openSsm={()=>setView("ssm")}/>
      case "kbi": return <KbiView project={project} setProject={setProject} datasets={datasets} setDatasets={setDatasets} scientific={scientific} setScientific={setScientific} runs={activeRuns}/>
      case "champion": return <ChampionView project={project} setProject={setProject} datasets={datasets} scientific={scientific} runs={activeRuns}/>
      case "concentration": return <ConcentrationView project={project} setProject={setProject} datasets={datasets} scientific={scientific} runs={activeRuns}/>
      case "temperature": return <TemperatureView project={project} datasets={datasets} scientific={scientific} runs={activeRuns}/>
      case "ssm": return <SsmView project={project} setProject={setProject} scientific={scientific} setScientific={setScientific} runs={activeRuns} setRuns={setActiveRuns} datasets={datasets}/>
      case "matrix": return <ThermoView project={project} setProject={setProject} datasets={datasets} scientific={scientific} setScientific={setScientific} runs={activeRuns}/>
      case "cosmo": return <CosmoView project={project} scientific={scientific} setScientific={setScientific} runs={activeRuns} datasets={datasets}/>
      case "validation": return <ValidationView scientific={scientific} setScientific={setScientific}/>
      case "methods": return <MethodsView/>
      case "data": return <DataView workspace={workspace} onReplace={commitWorkspace}/>
    }
  }

  if (!hydrated) return <div className="boot-screen"><Microscope/><strong>SolvForge MD</strong><span>Opening local project state…</span></div>

  return <SidebarProvider style={{ "--sidebar-width": "15.5rem" } as React.CSSProperties}>
    <Sidebar collapsible="icon" className="instrument-sidebar">
      <SidebarHeader className="app-sidebar-header"><div className="app-mark"><Microscope/></div><div className="app-name"><strong>SolvForge</strong><span>MD</span></div></SidebarHeader>
      <SidebarSeparator/>
      <SidebarContent>{navigation.map((group) => <SidebarGroup key={group.group}><SidebarGroupLabel>{group.group}</SidebarGroupLabel><SidebarGroupContent><SidebarMenu>{group.items.map((item) => <SidebarMenuItem key={item.id}><SidebarMenuButton isActive={view === item.id} tooltip={item.label} onClick={() => setView(item.id)}><item.icon/><span>{item.label}</span>{item.id === "kbi" && datasets.length > 0 && <Badge variant="secondary" className="nav-count">{datasets.length}</Badge>}</SidebarMenuButton></SidebarMenuItem>)}</SidebarMenu></SidebarGroupContent></SidebarGroup>)}</SidebarContent>
      <SidebarFooter className="sidebar-foot"><div className={`save-indicator save-${saveState}`}><span/>{saveState === "saved" ? "LOCAL · SAVED" : saveState === "saving" ? "SAVING…" : "EXPORT BACKUP"}</div><small>v{SOFTWARE_VERSION} · no account</small></SidebarFooter>
    </Sidebar>
    <SidebarInset className="workbench-shell">
      <header className="workbench-topbar"><div className="topbar-left"><SidebarTrigger/><div><strong>{project.projectName}</strong><span>{project.presetName}</span></div></div><div className="workflow-rail"><button className={project.selectedChampion ? "done" : "active"} onClick={() => setView("champion")}><span>A</span><small>screen</small></button><i/><button className={project.selectedChampion ? (project.selectedOptimum ? "done" : "active") : "locked"} onClick={() => setView("concentration")}><span>B</span><small>{champion ? champion.abbreviation : "champion"}</small></button><i/><button className={project.selectedOptimum ? "active" : "locked"} onClick={() => setView("temperature")}><span>C</span><small>{optimum ? `N=${optimum.soluteCount}` : "optimum"}</small></button></div><div className="topbar-right"><Badge variant="outline">{project.mode === "thesis" ? "THESIS PRESET" : "CUSTOM PRESET"}</Badge><span>{hydrated ? "LOCAL-FIRST" : "LOADING"}</span></div></header>
      <main className="workbench-main">
        {storageError && <div role="alert" className="inline-warning">Local save failed: {storageError}. Export a complete archive before closing.</div>}
        {view === "project" && <label className="field-stack mb-4">Open saved project<select aria-label="Open saved project" value={project.projectId} onChange={(e) => void openProject(e.target.value).catch((err) => alert(String(err)))}>{[{projectId:project.projectId,projectName:project.projectName},...savedProjects.filter(p=>p.projectId!==project.projectId)].map((p) => <option key={p.projectId} value={p.projectId}>{p.projectName}</option>)}</select></label>}
        {workspace.legacyEvidence !== undefined && <div className="inline-warning">Legacy evidence is preserved separately with unresolved ownership. It cannot enter active scientific calculations. Export it from Data / Export.</div>}
        <div key={project.projectId}>{render()}</div></main>
    </SidebarInset>
  </SidebarProvider>
}
