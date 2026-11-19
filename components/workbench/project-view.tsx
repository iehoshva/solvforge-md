"use client"

import { uuid } from "@/lib/workbench/crypto"
import { useRef } from "react"
import { Copy, Download, FilePlus2, FlaskConical, Layers, Save, Upload } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import type { ProjectState } from "@/lib/workbench/types"
import type { ImportBundle } from "@/lib/workbench/workspace"
import {
  createBlankProject,
  createExampleSolutionProject,
  createSelfContainedGaffProject,
  migrateProject,
} from "@/lib/workbench/preset"
import { downloadJson } from "@/lib/workbench/export"
import { Field, InlineWarning, Section, TextField, ViewHeader } from "./shared"

export function ProjectView({
  project,
  setProject,
  customPresets,
  setCustomPresets,
  onImportBundle,
  onDuplicate,
}: {
  project: ProjectState
  setProject: (p: ProjectState) => void
  customPresets: ProjectState[]
  setCustomPresets: (p: ProjectState[]) => void
  onImportBundle: (bundle: ImportBundle) => void | Promise<void>
  onDuplicate: (withPreparations: boolean) => void
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const update = <K extends keyof ProjectState>(key: K, value: ProjectState[K]) => setProject({ ...project, [key]: value })

  const savePreset = () => {
    const name = window.prompt("Template / preset name", `${project.projectName} template`)
    if (!name) return
    const copy = structuredClone(project)
    copy.presetName = name
    setCustomPresets([...customPresets.filter((p) => p.presetName !== name), copy])
    setProject(copy)
  }

  const importProject = async (file: File) => {
    const parsed = JSON.parse(await file.text()) as ProjectState | ImportBundle
    const manifest = "project" in parsed ? parsed.project : parsed
    if (!manifest.projectId || !manifest.molecules || !manifest.protocol) {
      throw new Error("Not a valid SolvForge project manifest or workspace archive.")
    }
    if ("project" in parsed && onImportBundle) await onImportBundle({ ...parsed, project: migrateProject(manifest) })
    else await onImportBundle({ project: migrateProject(manifest) })
  }

  return (
    <>
      <ViewHeader
        eyebrow="Setup / project"
        title="QM → GROMACS project manifest"
        description="Agnostic preparation workspace for any QM engine, charge scheme, force field, and GROMACS simulation protocol. Downstream trajectory analysis is handled externally (e.g. MoDy Analyse)."
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => downloadJson(`${project.projectAbbreviation.toLowerCase()}-project.json`, project)}>
              <Download />
              Export manifest
            </Button>
            <Button size="sm" onClick={() => fileRef.current?.click()}>
              <Upload />
              Import project
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              hidden
              onChange={(e) => e.target.files?.[0] && importProject(e.target.files[0]).catch((err) => alert(err.message))}
            />
          </>
        }
      />

      <div className="mode-strip">
        <div>
          <span>Active template</span>
          <strong>{project.presetName}</strong>
        </div>
        <span>Zero hardcoded restrictions · all force fields &amp; QM methods supported</span>
        <Button variant="outline" size="sm" onClick={() => setProject(createBlankProject())}>
          <FilePlus2 />
          New blank project
        </Button>
        <Button variant="outline" size="sm" onClick={() => setProject(createExampleSolutionProject())}>
          <FlaskConical />
          Example solution
        </Button>
        <Button variant="outline" size="sm" onClick={() => setProject(createSelfContainedGaffProject())}>
          <Layers />
          Self-contained GAFF2
        </Button>
        <Button variant="outline" size="sm" onClick={() => onDuplicate(false)}>
          <Copy />
          Duplicate design
        </Button>
        <Button variant="outline" size="sm" onClick={() => onDuplicate(true)}>
          <Copy />
          Duplicate with QM/topologies
        </Button>
      </div>

      <Tabs defaultValue="identity">
        <TabsList variant="line">
          <TabsTrigger value="identity">Identity</TabsTrigger>
          <TabsTrigger value="units">Units &amp; provenance</TabsTrigger>
          <TabsTrigger value="presets">Templates</TabsTrigger>
        </TabsList>
        <TabsContent value="identity">
          <Section title="Project identity" kicker="Manifest">
            <div className="form-grid form-grid-3">
              <Field label="Project name" value={project.projectName} onChange={(v) => update("projectName", v)} />
              <Field
                label="Project abbreviation"
                value={project.projectAbbreviation}
                onChange={(v) => update("projectAbbreviation", v)}
                note="Optional prefix in generated run IDs."
              />
              <Field label="Creation date" value={project.createdAt.slice(0, 10)} onChange={() => {}} disabled />
            </div>
            <div className="form-grid form-grid-2 mt-grid">
              <TextField label="Project description" value={project.description} onChange={(v) => update("description", v)} />
              <TextField label="Simulation objective" value={project.researchObjective} onChange={(v) => update("researchObjective", v)} />
            </div>
            <div className="mt-grid">
              <TextField label="Notes" value={project.notes} onChange={(v) => update("notes", v)} rows={4} />
            </div>
          </Section>
        </TabsContent>
        <TabsContent value="units">
          <Section title="Canonical GROMACS units & provenance" kicker="Reproducibility">
            <div className="form-grid form-grid-4">
              {Object.entries(project.defaultUnits).map(([k, v]) => (
                <Field key={k} label={k} value={v} onChange={() => {}} disabled note="GROMACS canonical unit; Å ↔ nm conversions are explicit." />
              ))}
            </div>
            <div className="provenance-list">
              <div>
                <span>Project ID</span>
                <code>{project.projectId}</code>
              </div>
              <div>
                <span>Schema</span>
                <code>{project.schemaVersion}</code>
              </div>
              <div>
                <span>Force field</span>
                <code>{project.protocol.forceField}</code>
              </div>
              <div>
                <span>Charge scheme</span>
                <code>{project.protocol.chargeScheme || "custom"}</code>
              </div>
            </div>
            <InlineWarning title="Local-first storage">
              All project data is stored locally in your browser (IndexedDB). Export a Complete Project Archive regularly for durable backups.
            </InlineWarning>
          </Section>
        </TabsContent>
        <TabsContent value="presets">
          <Section
            title="Starter templates & saved presets"
            kicker="Reusable setups"
            actions={
              <Button size="sm" onClick={savePreset}>
                <Save />
                Save current as template
              </Button>
            }
          >
            <div className="preset-row built-in">
              <div>
                <strong>Blank QM → GROMACS Project</strong>
                <p>Empty molecule library, fully editable force field and protocol</p>
              </div>
              <Button variant="outline" size="sm" onClick={() => setProject(createBlankProject())}>
                Load
              </Button>
            </div>
            <div className="preset-row built-in">
              <div>
                <strong>Example Binary Solution (Ethanol:Water + Caffeine)</strong>
                <p>Demonstrates multi-component systems, Packmol, and run matrix planning</p>
              </div>
              <Button variant="outline" size="sm" onClick={() => setProject(createExampleSolutionProject())}>
                Load
              </Button>
            </div>
            <div className="preset-row built-in">
              <div>
                <strong>Self-Contained GAFF2 / ACPYPE Protocol</strong>
                <p>No external forcefield.itp include — hoists [ defaults ] and [ atomtypes ] from .itp files</p>
              </div>
              <Button variant="outline" size="sm" onClick={() => setProject(createSelfContainedGaffProject())}>
                Load
              </Button>
            </div>
            {customPresets.map((preset, i) => (
              <div className="preset-row" key={`${preset.presetName}-${i}`}>
                <div>
                  <strong>{preset.presetName}</strong>
                  <p>Custom · browser-local</p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setProject({ ...structuredClone(preset), projectId: `project-${uuid()}` })}
                >
                  Load
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => downloadJson(`${preset.presetName.toLowerCase().replace(/\W+/g, "-")}.json`, preset)}
                >
                  Export
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    const name = prompt("Rename template", preset.presetName)
                    if (name) setCustomPresets(customPresets.map((p, j) => (j === i ? { ...p, presetName: name } : p)))
                  }}
                >
                  Rename
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setCustomPresets([...customPresets, { ...structuredClone(preset), presetName: `${preset.presetName} copy` }])}
                >
                  Duplicate
                </Button>
              </div>
            ))}
          </Section>
        </TabsContent>
      </Tabs>
    </>
  )
}
