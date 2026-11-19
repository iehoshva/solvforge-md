"use client"

import { useEffect, useRef, useState } from "react"
import { Atom, BookOpenText, Cable, Database, FolderKanban, Microscope, Workflow } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarSeparator,
  SidebarTrigger,
} from "@/components/ui/sidebar"
import type { ProjectState, RunRecord } from "@/lib/workbench/types"
import { createBlankProject, migrateProject } from "@/lib/workbench/preset"
import { SOFTWARE_VERSION } from "@/lib/workbench/version"
import { validateSourceIntegrity } from "@/lib/workbench/packages"
import { clearPreparedExport } from "@/lib/workbench/export"
import { provenanceGraph } from "@/lib/workbench/provenance"
import {
  emptyWorkspace,
  importWorkspace,
  duplicateWorkspace,
  mergeRuns,
  scopeRecords,
  assertProjectOwnership,
  type ImportBundle,
  type Workspace,
} from "@/lib/workbench/workspace"
import { loadWorkspace, saveWorkspace, listWorkspaces, loadLegacyQmState } from "@/lib/workbench/storage"
import { type QmGromacsState } from "@/lib/workbench/qm-gromacs"
import { ProjectView } from "./project-view"
import { MoleculesView } from "./molecules-view"
import { RunGeneratorView } from "./run-generator-view"
import { QmGromacsView } from "./qm-gromacs-view"
import { MethodsView } from "./methods-view"
import { DataView } from "./data-view"

type ViewId = "project" | "molecules" | "qm" | "runs" | "data" | "methods"

const navigation: Array<{ group: string; items: Array<{ id: ViewId; label: string; icon: typeof Atom }> }> = [
  {
    group: "QM → GROMACS Bridge",
    items: [
      { id: "project", label: "Project", icon: FolderKanban },
      { id: "molecules", label: "Molecules & Systems", icon: Atom },
      { id: "qm", label: "QM → GROMACS", icon: Cable },
      { id: "runs", label: "Run Matrix & MDP", icon: Workflow },
    ],
  },
  {
    group: "Packages & Reference",
    items: [
      { id: "data", label: "Packages & Provenance", icon: Database },
      { id: "methods", label: "Methods & Conventions", icon: BookOpenText },
    ],
  },
]

export default function Workbench() {
  const [workspace, setWorkspaceState] = useState<Workspace>(() => emptyWorkspace(createBlankProject()))
  const latest = useRef(workspace)
  const writes = useRef<Promise<void>>(Promise.resolve())
  const [savedProjects, setSavedProjects] = useState<Array<{ projectId: string; projectName: string; savedAt: string }>>([])
  const { project, customPresets, runs: activeRuns, qmGromacs } = workspace
  const [view, setView] = useState<ViewId>("qm")
  const [hydrated, setHydrated] = useState(false)
  const [saveState, setSaveState] = useState<"saved" | "saving" | "error">("saved")
  const [storageError, setStorageError] = useState("")

  useEffect(() => {
    let cancelled = false
    void (async () => {
      let next = await loadWorkspace()
      if (!next) {
        const old = localStorage.getItem("gsmw.project")
        next = emptyWorkspace(old ? migrateProject(JSON.parse(old)) : createBlankProject())
        const legacyQm = await loadLegacyQmState()
        if (legacyQm && Object.keys(legacyQm.molecules).length) {
          next.legacyEvidence = {
            reason: "Legacy SolvForge 1.0 preparations preserved separately. Import explicitly if needed.",
            qmGromacs: legacyQm,
          }
        }
        next.customPresets = JSON.parse(localStorage.getItem("gsmw.presets") ?? "[]").map((p: ProjectState) => migrateProject(p))
        await saveWorkspace(next)
      }
      next = importWorkspace(next)
      await validateSourceIntegrity(next)
      await saveWorkspace(next)
      if (cancelled) return
      latest.current = next
      setWorkspaceState(next)
      setSavedProjects(await listWorkspaces())
      setHydrated(true)
    })().catch((e) => {
      if (!cancelled) {
        setStorageError(String(e))
        setSaveState("error")
        setHydrated(true)
      }
    })
    return () => {
      cancelled = true
    }
  }, [])

  const commitWorkspace = (next: Workspace) => {
    assertProjectOwnership(next, next.projectId)
    clearPreparedExport()
    next = { ...next, savedAt: new Date().toISOString(), savedWithVersion: SOFTWARE_VERSION }
    next.provenance = provenanceGraph(next)
    latest.current = next
    setWorkspaceState(next)
    setSaveState("saving")
    const revision = next.savedAt
    writes.current = writes.current
      .catch(() => {})
      .then(() => saveWorkspace(next))
      .then(async () => {
        if (latest.current.savedAt === revision) {
          setSaveState("saved")
          setStorageError("")
        }
        setSavedProjects(await listWorkspaces())
      })
      .catch((e) => {
        setSaveState("error")
        setStorageError(String(e))
      })
  }

  const setProject = (next: ProjectState) => {
    const w = latest.current
    if (next.projectId !== w.projectId) {
      commitWorkspace({ ...emptyWorkspace(next), customPresets: w.customPresets })
      return
    }
    const molecules = { ...w.qmGromacs.molecules }
    for (const m of next.molecules) {
      const p = molecules[m.id]
      if (p && (p.residueName !== m.residueName || p.expectedFormalCharge !== m.charge)) {
        molecules[m.id] = {
          ...p,
          residueName: m.residueName,
          expectedFormalCharge: m.charge,
          atoms: p.atoms.map((a) => ({ ...a, residueName: m.residueName })),
          topologyReviewed: false,
          gromppValidated: false,
          chargeAcknowledged: false,
        }
      }
    }
    commitWorkspace({ ...w, project: next, qmGromacs: { ...w.qmGromacs, molecules } })
  }

  const setCustomPresets = (next: ProjectState[]) => commitWorkspace({ ...latest.current, customPresets: next })

  const setActiveRuns = (next: RunRecord[]) => {
    try {
      commitWorkspace({
        ...latest.current,
        runs: mergeRuns(latest.current.runs, scopeRecords(next, latest.current.projectId)),
      })
    } catch (e) {
      alert(String(e))
    }
  }

  const setQmGromacs = (next: QmGromacsState) => {
    const w = latest.current
    const molecules = w.project.molecules.map((m) =>
      next.molecules[m.id]
        ? { ...m, residueName: next.molecules[m.id].residueName, charge: next.molecules[m.id].expectedFormalCharge }
        : m,
    )
    commitWorkspace({
      ...w,
      project: { ...w.project, molecules },
      qmGromacs: { ...scopeRecords(next, w.projectId), projectId: w.projectId },
    })
  }

  const importBundle = async (bundle: ImportBundle) => {
    const next = importWorkspace(bundle)
    await validateSourceIntegrity(next)
    commitWorkspace(next)
  }

  const openProject = async (id: string) => {
    await writes.current
    const next = await loadWorkspace(id)
    if (!next) throw new Error("Saved project unavailable.")
    const restored = importWorkspace(next)
    await validateSourceIntegrity(restored)
    commitWorkspace(restored)
  }

  const render = () => {
    switch (view) {
      case "project":
        return (
          <ProjectView
            project={project}
            setProject={setProject}
            customPresets={customPresets}
            setCustomPresets={setCustomPresets}
            onImportBundle={importBundle}
            onDuplicate={(withPreps) => commitWorkspace(duplicateWorkspace(latest.current, withPreps))}
          />
        )
      case "molecules":
        return <MoleculesView project={project} setProject={setProject} />
      case "qm":
        return (
          <QmGromacsView
            project={project}
            runs={activeRuns}
            state={qmGromacs}
            setState={setQmGromacs}
            openRuns={() => setView("runs")}
            openData={() => setView("data")}
          />
        )
      case "runs":
        return <RunGeneratorView project={project} setProject={setProject} activeRuns={activeRuns} setActiveRuns={setActiveRuns} />
      case "data":
        return <DataView workspace={workspace} onReplace={commitWorkspace} />
      case "methods":
        return <MethodsView />
    }
  }

  if (!hydrated) {
    return (
      <div className="boot-screen">
        <Microscope />
        <strong>SolvForge MD</strong>
        <span>Opening local QM → GROMACS workspace…</span>
      </div>
    )
  }

  return (
    <SidebarProvider style={{ "--sidebar-width": "15.5rem" } as React.CSSProperties}>
      <Sidebar collapsible="icon" className="instrument-sidebar">
        <SidebarHeader className="app-sidebar-header">
          <div className="app-mark">
            <Microscope />
          </div>
          <div className="app-name">
            <strong>SolvForge</strong>
            <span>QM → GROMACS</span>
          </div>
        </SidebarHeader>
        <SidebarSeparator />
        <SidebarContent>
          {navigation.map((group) => (
            <SidebarGroup key={group.group}>
              <SidebarGroupLabel>{group.group}</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {group.items.map((item) => (
                    <SidebarMenuItem key={item.id}>
                      <SidebarMenuButton isActive={view === item.id} tooltip={item.label} onClick={() => setView(item.id)}>
                        <item.icon />
                        <span>{item.label}</span>
                        {item.id === "runs" && activeRuns.length > 0 && (
                          <Badge variant="secondary" className="nav-count">
                            {activeRuns.length}
                          </Badge>
                        )}
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          ))}
        </SidebarContent>
        <SidebarFooter className="sidebar-foot">
          <div className={`save-indicator save-${saveState}`}>
            <span />
            {saveState === "saved" ? "LOCAL · SAVED" : saveState === "saving" ? "SAVING…" : "EXPORT BACKUP"}
          </div>
          <small>v{SOFTWARE_VERSION} · local-first</small>
        </SidebarFooter>
      </Sidebar>
      <SidebarInset className="workbench-shell">
        <header className="workbench-topbar">
          <div className="topbar-left">
            <SidebarTrigger />
            <div>
              <strong>{project.projectName}</strong>
              <span>{project.presetName}</span>
            </div>
          </div>
          <div className="topbar-center flex items-center gap-2">
            <Badge variant="outline">{project.protocol.forceField || "Custom FF"}</Badge>
            <Badge variant="secondary">{project.protocol.forceFieldInclude || "Self-contained"}</Badge>
          </div>
          <div className="topbar-right">
            <Badge variant="outline">QM → GROMACS</Badge>
            <span>LOCAL-FIRST</span>
          </div>
        </header>
        <main className="workbench-main">
          {storageError && (
            <div role="alert" className="inline-warning">
              Local save failed: {storageError}. Export a complete archive before closing.
            </div>
          )}
          {view === "project" && (
            <label className="field-stack mb-4">
              Open saved project
              <select
                aria-label="Open saved project"
                value={project.projectId}
                onChange={(e) => void openProject(e.target.value).catch((err) => alert(String(err)))}
              >
                {[
                  { projectId: project.projectId, projectName: project.projectName },
                  ...savedProjects.filter((p) => p.projectId !== project.projectId),
                ].map((p) => (
                  <option key={p.projectId} value={p.projectId}>
                    {p.projectName}
                  </option>
                ))}
              </select>
            </label>
          )}
          <div key={project.projectId}>{render()}</div>
        </main>
      </SidebarInset>
    </SidebarProvider>
  )
}
