"use client"
import { uuid } from "@/lib/workbench/crypto"


import { useRef } from "react"
import { Copy, Download, FilePlus2, RotateCcw, Save, Upload } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import type { ProjectState } from "@/lib/workbench/types"
import type { ImportBundle } from "@/lib/workbench/workspace"
import { createCustomProject, createThesisProject, migrateProject } from "@/lib/workbench/preset"
import { downloadJson } from "@/lib/workbench/export"
import { Field, InlineWarning, Section, TextField, ViewHeader } from "./shared"

export function ProjectView({ project, setProject, customPresets, setCustomPresets, onImportBundle, onDuplicate }: { project: ProjectState; setProject: (p: ProjectState) => void; customPresets: ProjectState[]; setCustomPresets: (p: ProjectState[]) => void; onImportBundle: (bundle: ImportBundle) => void | Promise<void>; onDuplicate: (withEvidence: boolean) => void }) {
  const fileRef = useRef<HTMLInputElement>(null)
  const update = <K extends keyof ProjectState>(key: K, value: ProjectState[K]) => setProject({ ...project, [key]: value })
  const savePreset = () => {
    const name = window.prompt("Preset name", `${project.projectName} preset`)
    if (!name) return
    const copy = structuredClone(project)
    copy.presetName = name
    setCustomPresets([...customPresets.filter((p) => p.presetName !== name), copy])
    setProject(copy)
  }
  const importProject = async (file: File) => {
    const parsed = JSON.parse(await file.text()) as ProjectState | ImportBundle
    const manifest = "project" in parsed ? parsed.project : parsed
    if (!manifest.projectId || !manifest.molecules || !manifest.protocol) throw new Error("Not a valid workbench project manifest or complete project state.")
    if ("project" in parsed && onImportBundle) await onImportBundle({ ...parsed, project: migrateProject(manifest) })
    else await onImportBundle({ project: migrateProject(manifest) })
  }
  return <>
    <ViewHeader eyebrow="Input / project" title="Scientific project manifest" description="Own the complete experimental design locally. Built-in defaults are recoverable; supported scientific settings remain editable." actions={<>
      <Button variant="outline" size="sm" onClick={() => downloadJson(`${project.projectAbbreviation.toLowerCase()}-project.json`, project)}><Download/>Export project</Button>
      <Button size="sm" onClick={() => fileRef.current?.click()}><Upload/>Import project</Button>
      <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(e) => e.target.files?.[0] && importProject(e.target.files[0]).catch((err) => alert(err.message))}/>
    </>}/>

    <div className="mode-strip">
      <div><span>Active preset</span><strong>{project.presetName}</strong></div>
      <span>Preset label · all implemented designs remain available</span>
      <Button variant="outline" size="sm" onClick={() => setProject(createThesisProject())}><RotateCcw/>Recover thesis preset</Button>
      <Button variant="outline" size="sm" onClick={() => setProject(createCustomProject())}><FilePlus2/>New custom project</Button>
      <Button variant="outline" size="sm" onClick={() => onDuplicate(false)}><Copy/>Duplicate design</Button>
      <Button variant="outline" size="sm" onClick={() => onDuplicate(true)}><Copy/>Duplicate with evidence</Button>
    </div>

    <Tabs defaultValue="identity">
      <TabsList variant="line"><TabsTrigger value="identity">Identity</TabsTrigger><TabsTrigger value="units">Units & provenance</TabsTrigger><TabsTrigger value="presets">Presets</TabsTrigger></TabsList>
      <TabsContent value="identity">
        <Section title="Project identity" kicker="Manifest">
          <div className="form-grid form-grid-3">
            <Field label="Project name" value={project.projectName} onChange={(v) => update("projectName", v)}/>
            <Field label="Project abbreviation" value={project.projectAbbreviation} onChange={(v) => update("projectAbbreviation", v)} note="Used only when enabled in run naming."/>
            <Field label="Creation date" value={project.createdAt.slice(0, 10)} onChange={() => {}} disabled/>
          </div>
          <div className="form-grid form-grid-2 mt-grid">
            <TextField label="Project description" value={project.description} onChange={(v) => update("description", v)}/>
            <TextField label="Research objective" value={project.researchObjective} onChange={(v) => update("researchObjective", v)}/>
          </div>
          <div className="mt-grid"><TextField label="Researcher notes" value={project.notes} onChange={(v) => update("notes", v)} rows={4}/></div>
        </Section>
      </TabsContent>
      <TabsContent value="units">
        <Section title="Canonical units and provenance" kicker="Reproducibility">
          <div className="form-grid form-grid-4">
            {Object.entries(project.defaultUnits).map(([k, v]) => <Field key={k} label={k} value={v} onChange={() => {}} disabled note="Canonical unit; conversions are explicit at each import/input boundary."/>) }
          </div>
          <div className="provenance-list">
            <div><span>Project ID</span><code>{project.projectId}</code></div>
            <div><span>Schema</span><code>{project.schemaVersion}</code></div>
            <div><span>Created with</span><code>{project.createdWithVersion ?? project.softwareVersion}</code></div>
            <div><span>Override records</span><code>{project.overrideLog.length}</code></div>
          </div>
          <InlineWarning title="Local-first storage">Project state is saved in this browser. Export JSON regularly for durable, portable ownership.</InlineWarning>
        </Section>
      </TabsContent>
      <TabsContent value="presets">
        <Section title="Preset management" kicker="Reusable design" actions={<Button size="sm" onClick={savePreset}><Save/>Save current as preset</Button>}>
          <div className="preset-row built-in"><div><strong>Andaliman Thesis MD/KBI</strong><p>Built-in · always recoverable</p></div><Button variant="outline" size="sm" onClick={() => setProject(createThesisProject())}>Load</Button><Button variant="ghost" size="sm" onClick={() => downloadJson("andaliman-thesis-md-kbi-preset.json", createThesisProject())}>Export JSON</Button></div>
          {customPresets.map((preset, i) => <div className="preset-row" key={`${preset.presetName}-${i}`}><div><strong>{preset.presetName}</strong><p>Custom · browser-local</p></div><Button variant="outline" size="sm" onClick={() => setProject({ ...structuredClone(preset), projectId: `project-${uuid()}`, selectedChampion: null, selectedOptimum: null })}>Load</Button><Button variant="ghost" size="sm" onClick={() => downloadJson(`${preset.presetName.toLowerCase().replace(/\W+/g, "-")}.json`, preset)}>Export</Button><Button variant="ghost" size="sm" onClick={() => { const name = prompt("Rename preset", preset.presetName); if (name) setCustomPresets(customPresets.map((p, j) => j === i ? { ...p, presetName: name } : p)) }}>Rename</Button><Button variant="ghost" size="sm" onClick={() => setCustomPresets([...customPresets, { ...structuredClone(preset), presetName: `${preset.presetName} copy` }])}>Duplicate</Button></div>)}
          {!customPresets.length && <p className="quiet-row">No custom presets saved yet.</p>}
        </Section>
      </TabsContent>
    </Tabs>
  </>
}
