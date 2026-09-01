"use client"

import { useEffect, useState } from "react"
import { Atom, BookOpenText, Boxes, Cable, ChartNoAxesCombined, CircleCheckBig, Database, FlaskConical, FolderKanban, Gauge, Grid3X3, Microscope, ScanSearch, Thermometer, Workflow } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarHeader, SidebarInset, SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarProvider, SidebarSeparator, SidebarTrigger } from "@/components/ui/sidebar"
import type { ProjectState, RDFDataset, RunRecord, ScientificState } from "@/lib/workbench/types"
import { createThesisProject, migrateProject } from "@/lib/workbench/preset"
import { loadOrcaGromacsState, loadRdfDatasets, loadScientificState, saveOrcaGromacsState, saveRdfDatasets, saveScientificState } from "@/lib/workbench/storage"
import { defaultScientificState } from "@/lib/workbench/scientific"
import { defaultOrcaGromacsState, migrateOrcaGromacsState, type OrcaGromacsState } from "@/lib/workbench/orca-gromacs"
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
  const [project, setProjectState] = useState<ProjectState>(() => createThesisProject())
  const [customPresets, setCustomPresetsState] = useState<ProjectState[]>([])
  const [datasets, setDatasetsState] = useState<RDFDataset[]>([])
  const [activeRuns, setActiveRunsState] = useState<RunRecord[]>([])
  const [scientific, setScientificState] = useState<ScientificState>(() => defaultScientificState())
  const [orcaGromacs, setOrcaGromacsState] = useState<OrcaGromacsState>(() => defaultOrcaGromacsState())
  const [view, setView] = useState<ViewId>("project")
  const [hydrated, setHydrated] = useState(false)
  const [saveState, setSaveState] = useState<"saved" | "saving" | "error">("saved")

  useEffect(() => {
    let cancelled = false
    Promise.resolve().then(async () => {
      const storedProject = localStorage.getItem("gsmw.project")
      const storedPresets = localStorage.getItem("gsmw.presets")
      const storedRuns = localStorage.getItem("gsmw.runs")
      const [loadedDatasets, loadedScientific, loadedOrca] = await Promise.all([loadRdfDatasets(), loadScientificState(), loadOrcaGromacsState()])
      if (cancelled) return
      if (storedProject) setProjectState(migrateProject(JSON.parse(storedProject)))
      if (storedPresets) setCustomPresetsState(JSON.parse(storedPresets))
      if (storedRuns) setActiveRunsState(JSON.parse(storedRuns))
      setDatasetsState(loadedDatasets)
      setScientificState(loadedScientific)
      setOrcaGromacsState(loadedOrca)
      setHydrated(true)
    }).catch(() => {
      if (!cancelled) {
        setSaveState("error")
        setHydrated(true)
      }
    })
    return () => { cancelled = true }
  }, [])

  const setProject = (next: ProjectState) => {
    setProjectState(next); setSaveState("saving")
    try { localStorage.setItem("gsmw.project", JSON.stringify(next)); setSaveState("saved") } catch { setSaveState("error") }
  }
  const setCustomPresets = (next: ProjectState[]) => {
    setCustomPresetsState(next); setSaveState("saving")
    try { localStorage.setItem("gsmw.presets", JSON.stringify(next)); setSaveState("saved") } catch { setSaveState("error") }
  }
  const setActiveRuns = (next: RunRecord[]) => {
    setActiveRunsState(next); setSaveState("saving")
    try { localStorage.setItem("gsmw.runs", JSON.stringify(next)); setSaveState("saved") } catch { setSaveState("error") }
  }
  const setDatasets = (next: RDFDataset[]) => {
    setDatasetsState(next); setSaveState("saving")
    saveRdfDatasets(next).then(() => setSaveState("saved")).catch(() => setSaveState("error"))
  }
  const setScientific = (next: ScientificState) => {
    setScientificState(next); setSaveState("saving")
    saveScientificState(next).then(() => setSaveState("saved")).catch(() => setSaveState("error"))
  }
  const setOrcaGromacs = (next: OrcaGromacsState) => {
    setOrcaGromacsState(next); setSaveState("saving")
    saveOrcaGromacsState(next).then(() => setSaveState("saved")).catch(() => setSaveState("error"))
  }
  const importBundle = (bundle: { project: ProjectState; runs?: RunRecord[]; datasets?: RDFDataset[]; scientific?: ScientificState; customPresets?: ProjectState[]; orcaGromacs?: OrcaGromacsState }) => {
    setProject(bundle.project)
    if (bundle.runs) setActiveRuns(bundle.runs)
    if (bundle.datasets) setDatasets(bundle.datasets)
    if (bundle.scientific) setScientific(bundle.scientific)
    if (bundle.customPresets) setCustomPresets(bundle.customPresets)
    if (bundle.orcaGromacs) setOrcaGromacs(migrateOrcaGromacsState(bundle.orcaGromacs))
  }

  const champion = project.desSystems.find((d) => d.id === project.selectedChampion?.valueId)
  const optimum = project.concentrations.find((c) => c.id === project.selectedOptimum?.valueId)
  const render = () => {
    switch (view) {
      case "project": return <ProjectView project={project} setProject={setProject} customPresets={customPresets} setCustomPresets={setCustomPresets} onImportBundle={importBundle}/>
      case "molecules": return <MoleculesView project={project} setProject={setProject}/>
      case "runs": return <RunGeneratorView project={project} setProject={setProject} activeRuns={activeRuns} setActiveRuns={setActiveRuns}/>
      case "orca": return <OrcaGromacsView project={project} runs={activeRuns} datasets={datasets} setDatasets={setDatasets} state={orcaGromacs} setState={setOrcaGromacs} openKbi={() => setView("kbi")}/>
      case "kbi": return <KbiView project={project} setProject={setProject} datasets={datasets} setDatasets={setDatasets} scientific={scientific} setScientific={setScientific}/>
      case "champion": return <ChampionView project={project} setProject={setProject} datasets={datasets} scientific={scientific}/>
      case "concentration": return <ConcentrationView project={project} setProject={setProject} datasets={datasets} scientific={scientific}/>
      case "temperature": return <TemperatureView project={project} datasets={datasets} scientific={scientific}/>
      case "ssm": return <SsmView project={project} setProject={setProject} scientific={scientific} setScientific={setScientific}/>
      case "matrix": return <ThermoView project={project} setProject={setProject} datasets={datasets} scientific={scientific} setScientific={setScientific}/>
      case "cosmo": return <CosmoView project={project} scientific={scientific} setScientific={setScientific}/>
      case "validation": return <ValidationView scientific={scientific} setScientific={setScientific}/>
      case "methods": return <MethodsView/>
      case "data": return <DataView project={project} runs={activeRuns} datasets={datasets} customPresets={customPresets} scientific={scientific} orcaGromacs={orcaGromacs}/>
    }
  }

  if (!hydrated) return <div className="boot-screen"><Microscope/><strong>SolvForge MD</strong><span>Opening local project state…</span></div>

  return <SidebarProvider style={{ "--sidebar-width": "15.5rem" } as React.CSSProperties}>
    <Sidebar collapsible="icon" className="instrument-sidebar">
      <SidebarHeader className="app-sidebar-header"><div className="app-mark"><Microscope/></div><div className="app-name"><strong>SolvForge</strong><span>MD</span></div></SidebarHeader>
      <SidebarSeparator/>
      <SidebarContent>{navigation.map((group) => <SidebarGroup key={group.group}><SidebarGroupLabel>{group.group}</SidebarGroupLabel><SidebarGroupContent><SidebarMenu>{group.items.map((item) => <SidebarMenuItem key={item.id}><SidebarMenuButton isActive={view === item.id} tooltip={item.label} onClick={() => setView(item.id)}><item.icon/><span>{item.label}</span>{item.id === "kbi" && datasets.length > 0 && <Badge variant="secondary" className="nav-count">{datasets.length}</Badge>}</SidebarMenuButton></SidebarMenuItem>)}</SidebarMenu></SidebarGroupContent></SidebarGroup>)}</SidebarContent>
      <SidebarFooter className="sidebar-foot"><div className={`save-indicator save-${saveState}`}><span/>{saveState === "saved" ? "LOCAL · SAVED" : saveState === "saving" ? "SAVING…" : "EXPORT BACKUP"}</div><small>v1.0.0 · no account</small></SidebarFooter>
    </Sidebar>
    <SidebarInset className="workbench-shell">
      <header className="workbench-topbar"><div className="topbar-left"><SidebarTrigger/><div><strong>{project.projectName}</strong><span>{project.presetName}</span></div></div><div className="workflow-rail"><button className={project.selectedChampion ? "done" : "active"} onClick={() => setView("champion")}><span>A</span><small>screen</small></button><i/><button className={project.selectedChampion ? (project.selectedOptimum ? "done" : "active") : "locked"} onClick={() => setView("concentration")}><span>B</span><small>{champion ? champion.abbreviation : "champion"}</small></button><i/><button className={project.selectedOptimum ? "active" : "locked"} onClick={() => setView("temperature")}><span>C</span><small>{optimum ? `N=${optimum.soluteCount}` : "optimum"}</small></button></div><div className="topbar-right"><Badge variant="outline">{project.mode === "thesis" ? "THESIS MODE" : "CUSTOM MODE"}</Badge><span>{hydrated ? "LOCAL-FIRST" : "LOADING"}</span></div></header>
      <main className="workbench-main">{render()}</main>
    </SidebarInset>
  </SidebarProvider>
}
