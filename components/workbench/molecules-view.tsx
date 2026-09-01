"use client"

import { Plus, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import type { DESSystem, Molecule, MoleculeRole, ProjectState } from "@/lib/workbench/types"
import { defaultCompositionSettings, newId } from "@/lib/workbench/preset"
import { BoxCompositionCalculator } from "./box-composition-calculator"
import { InlineWarning, Section, ViewHeader } from "./shared"

const roles: MoleculeRole[] = ["solute", "HBA", "HBD", "solvent component", "ion", "co-solvent", "custom"]
const blankMolecule = (): Molecule => ({ id: newId("mol"), fullName: "New molecule", abbreviation: "MOL", role: "custom", formula: "", molecularWeight: null, charge: 0, moleculeCount: null, topologyFile: "", coordinateFile: "", residueName: "MOL", notes: "" })
const blankDes = (): DESSystem => ({ id: newId("des"), name: "New solvent system", abbreviation: "SYS", componentIds: [], ratio: [], boxCounts: [], compositionSettings: defaultCompositionSettings(), notes: "" })

export function MoleculesView({ project, setProject }: { project: ProjectState; setProject: (p: ProjectState) => void }) {
  const patchMol = (id: string, patch: Partial<Molecule>) => setProject({ ...project, molecules: project.molecules.map((m) => m.id === id ? { ...m, ...patch } : m) })
  const patchDes = (id: string, patch: Partial<DESSystem>) => setProject({ ...project, desSystems: project.desSystems.map((d) => d.id === id ? { ...d, ...patch } : d) })
  return <>
    <ViewHeader eyebrow="Input / molecule registry" title="Molecules and solvent systems" description="Scientific calculations reference stable IDs and explicit composition, never hardcoded molecule names." actions={<Button size="sm" onClick={() => setProject({ ...project, molecules: [...project.molecules, blankMolecule()] })}><Plus/>Add molecule</Button>}/>
    <Section title="Molecule library" kicker={`${project.molecules.length} records`}>
      <div className="table-scroll"><Table className="dense-table min-w-[1300px]"><TableHeader><TableRow><TableHead>Name / ID</TableHead><TableHead>Abbrev.</TableHead><TableHead>Role</TableHead><TableHead>Formula</TableHead><TableHead>MW</TableHead><TableHead>Charge</TableHead><TableHead>Residue</TableHead><TableHead>Topology</TableHead><TableHead>Coordinates</TableHead><TableHead>Notes</TableHead><TableHead/></TableRow></TableHeader><TableBody>
        {project.molecules.map((m) => <TableRow key={m.id}>
          <TableCell><Input value={m.fullName} onChange={(e) => patchMol(m.id, { fullName: e.target.value })}/><code className="record-id">{m.id}</code></TableCell>
          <TableCell><Input value={m.abbreviation} onChange={(e) => patchMol(m.id, { abbreviation: e.target.value })}/></TableCell>
          <TableCell><Select value={m.role} onValueChange={(v) => patchMol(m.id, { role: v as MoleculeRole })}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent>{roles.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent></Select></TableCell>
          <TableCell><Input value={m.formula} onChange={(e) => patchMol(m.id, { formula: e.target.value })}/></TableCell>
          <TableCell><Input type="number" value={m.molecularWeight ?? ""} onChange={(e) => patchMol(m.id, { molecularWeight: e.target.value === "" ? null : Number(e.target.value) })}/></TableCell>
          <TableCell><Input type="number" value={m.charge} onChange={(e) => patchMol(m.id, { charge: Number(e.target.value) })}/></TableCell>
          <TableCell><Input value={m.residueName} onChange={(e) => patchMol(m.id, { residueName: e.target.value })}/></TableCell>
          <TableCell><Input value={m.topologyFile} onChange={(e) => patchMol(m.id, { topologyFile: e.target.value })}/></TableCell>
          <TableCell><Input value={m.coordinateFile} onChange={(e) => patchMol(m.id, { coordinateFile: e.target.value })}/></TableCell>
          <TableCell><Input value={m.notes} onChange={(e) => patchMol(m.id, { notes: e.target.value })}/></TableCell>
          <TableCell><Button variant="ghost" size="icon-sm" aria-label={`Delete ${m.fullName}`} onClick={() => setProject({ ...project, molecules: project.molecules.filter((x) => x.id !== m.id), soluteIds: project.soluteIds.filter((id) => id !== m.id), desSystems: project.desSystems.map((d) => { const indices = d.componentIds.map((id, index) => id === m.id ? index : -1).filter((index) => index >= 0); const overrides = { ...d.compositionSettings.molecularWeightOverrides }; delete overrides[m.id]; return { ...d, componentIds: d.componentIds.filter((id) => id !== m.id), ratio: d.ratio.filter((_, index) => !indices.includes(index)), boxCounts: d.boxCounts.filter((_, index) => !indices.includes(index)), compositionSettings: { ...d.compositionSettings, molecularWeightOverrides: overrides } } }) })}><Trash2/></Button></TableCell>
        </TableRow>)}
      </TableBody></Table></div>
    </Section>

    <Section title="Solvent-system composition" kicker="Explicit species" actions={<Button variant="outline" size="sm" onClick={() => setProject({ ...project, desSystems: [...project.desSystems, blankDes()] })}><Plus/>Add system</Button>}>
      <InlineWarning title="Ratio is not an absolute box composition">A ratio such as 5:1 only fixes relative counts. Supply absolute counts in Manual mode, or use box volume, target density, and molecular weights in the calculator below.</InlineWarning>
      <div className="system-grid">
        {project.desSystems.map((d) => <article className="system-editor" key={d.id}>
          <div className="system-title"><Input value={d.name} onChange={(e) => patchDes(d.id, { name: e.target.value })}/><Button variant="ghost" size="icon-sm" onClick={() => setProject({ ...project, desSystems: project.desSystems.filter((x) => x.id !== d.id) })}><Trash2/></Button></div>
          <div className="form-grid form-grid-2"><Input value={d.abbreviation} onChange={(e) => patchDes(d.id, { abbreviation: e.target.value })}/><Input value={d.ratio.join(":" )} placeholder="Ratio, e.g. 5:1" onChange={(e) => patchDes(d.id, { ratio: e.target.value.split(":").map(Number).filter(Number.isFinite) })}/></div>
          <div className="component-editor">
            {d.componentIds.map((id, index) => <div key={`${id}-${index}`}>
              <Select value={id} onValueChange={(v) => { const ids = [...d.componentIds]; ids[index] = v; patchDes(d.id, { componentIds: ids }) }}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent>{project.molecules.filter((m) => m.role !== "solute").map((m) => <SelectItem value={m.id} key={m.id}>{m.fullName}</SelectItem>)}</SelectContent></Select>
              <Input type="number" min="0" value={d.boxCounts[index] ?? ""} placeholder="box count" onChange={(e) => { const counts = [...d.boxCounts]; counts[index] = e.target.value === "" ? null : Number(e.target.value); patchDes(d.id, { boxCounts: counts }) }}/>
              <Button variant="ghost" size="icon-sm" onClick={() => patchDes(d.id, { componentIds: d.componentIds.filter((_, i) => i !== index), ratio: d.ratio.filter((_, i) => i !== index), boxCounts: d.boxCounts.filter((_, i) => i !== index) })}><Trash2/></Button>
            </div>)}
            <Button variant="ghost" size="sm" onClick={() => patchDes(d.id, { componentIds: [...d.componentIds, project.molecules.find((m) => m.role !== "solute")?.id ?? ""], ratio: [...d.ratio, 1], boxCounts: [...d.boxCounts, null] })}><Plus/>Component</Button>
          </div>
          <Input value={d.notes} onChange={(e) => patchDes(d.id, { notes: e.target.value })} placeholder="System notes"/>
          <code className="record-id">{d.id}</code>
        </article>)}
      </div>
    </Section>
    <BoxCompositionCalculator project={project} setProject={setProject} context="system"/>
  </>
}
