"use client"

import { Plus, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import type { MolecularSystem, Molecule, MoleculeRole, ProjectState } from "@/lib/workbench/types"
import { defaultCompositionSettings, newId } from "@/lib/workbench/preset"
import { BoxCompositionCalculator } from "./box-composition-calculator"
import { InlineWarning, Section, ViewHeader } from "./shared"

const roles: MoleculeRole[] = ["solute", "solvent", "HBA", "HBD", "ion", "co-solvent", "ligand", "custom"]

const blankMolecule = (): Molecule => ({
  id: newId("mol"),
  fullName: "New molecule",
  abbreviation: "MOL",
  role: "custom",
  formula: "",
  molecularWeight: null,
  charge: 0,
  moleculeCount: null,
  topologyFile: "",
  coordinateFile: "",
  residueName: "MOL",
  notes: "",
})

const blankSystem = (): MolecularSystem => ({
  id: newId("sys"),
  name: "New molecular system",
  abbreviation: "SYS",
  componentIds: [],
  ratio: [],
  boxCounts: [],
  compositionSettings: defaultCompositionSettings(),
  notes: "",
})

export function MoleculesView({ project, setProject }: { project: ProjectState; setProject: (p: ProjectState) => void }) {
  const patchMol = (id: string, patch: Partial<Molecule>) =>
    setProject({ ...project, molecules: project.molecules.map((m) => (m.id === id ? { ...m, ...patch } : m)) })
  const patchSystem = (id: string, patch: Partial<MolecularSystem>) =>
    setProject({ ...project, systems: project.systems.map((s) => (s.id === id ? { ...s, ...patch } : s)) })

  return (
    <>
      <ViewHeader
        eyebrow="Setup / species registry"
        title="Molecules & molecular systems"
        description="Register any molecular species (organics, solvents, ions, DES components, ligands, salts) and assemble 1-to-N component simulation systems."
        actions={
          <Button size="sm" onClick={() => setProject({ ...project, molecules: [...project.molecules, blankMolecule()] })}>
            <Plus />
            Add molecule
          </Button>
        }
      />

      <Section title="Molecule registry" kicker={`${project.molecules.length} species`}>
        {!project.molecules.length ? (
          <InlineWarning title="No molecules yet">
            Click <strong>Add molecule</strong> to register your first species, then proceed to <strong>QM → GROMACS</strong> to import geometry, QM charges, and topology.
          </InlineWarning>
        ) : (
          <div className="table-scroll">
            <Table className="dense-table min-w-[1250px]">
              <TableHeader>
                <TableRow>
                  <TableHead>Name / ID</TableHead>
                  <TableHead>Abbrev.</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Optional solute axis</TableHead>
                  <TableHead>Formula</TableHead>
                  <TableHead>MW (g mol⁻¹)</TableHead>
                  <TableHead>Formal charge</TableHead>
                  <TableHead>Residue (≤4 chars)</TableHead>
                  <TableHead>Notes</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {project.molecules.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell>
                      <Input value={m.fullName} onChange={(e) => patchMol(m.id, { fullName: e.target.value })} />
                      <code className="record-id">{m.id}</code>
                    </TableCell>
                    <TableCell>
                      <Input value={m.abbreviation} onChange={(e) => patchMol(m.id, { abbreviation: e.target.value })} />
                    </TableCell>
                    <TableCell>
                      <Select value={m.role} onValueChange={(v) => patchMol(m.id, { role: v as MoleculeRole })}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {roles.map((r) => (
                            <SelectItem key={r} value={r}>
                              {r}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      <input
                        aria-label={`Use ${m.fullName} as solute axis`}
                        type="checkbox"
                        checked={project.soluteIds.includes(m.id)}
                        onChange={(e) =>
                          setProject({
                            ...project,
                            soluteIds: e.target.checked
                              ? [...project.soluteIds, m.id]
                              : project.soluteIds.filter((id) => id !== m.id),
                          })
                        }
                      />
                    </TableCell>
                    <TableCell>
                      <Input value={m.formula} onChange={(e) => patchMol(m.id, { formula: e.target.value })} />
                    </TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        step="any"
                        value={m.molecularWeight ?? ""}
                        onChange={(e) => patchMol(m.id, { molecularWeight: e.target.value === "" ? null : Number(e.target.value) })}
                      />
                    </TableCell>
                    <TableCell>
                      <Input type="number" step="1" value={m.charge} onChange={(e) => patchMol(m.id, { charge: Number(e.target.value) })} />
                    </TableCell>
                    <TableCell>
                      <Input
                        value={m.residueName}
                        onChange={(e) => patchMol(m.id, { residueName: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4) })}
                      />
                    </TableCell>
                    <TableCell>
                      <Input value={m.notes} onChange={(e) => patchMol(m.id, { notes: e.target.value })} />
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Delete ${m.fullName}`}
                        onClick={() =>
                          setProject({
                            ...project,
                            molecules: project.molecules.filter((x) => x.id !== m.id),
                            soluteIds: project.soluteIds.filter((id) => id !== m.id),
                            systems: project.systems.map((s) => {
                              const indices = s.componentIds.map((id, idx) => (id === m.id ? idx : -1)).filter((idx) => idx >= 0)
                              const overrides = { ...s.compositionSettings.molecularWeightOverrides }
                              delete overrides[m.id]
                              return {
                                ...s,
                                componentIds: s.componentIds.filter((id) => id !== m.id),
                                ratio: s.ratio.filter((_, idx) => !indices.includes(idx)),
                                boxCounts: s.boxCounts.filter((_, idx) => !indices.includes(idx)),
                                compositionSettings: { ...s.compositionSettings, molecularWeightOverrides: overrides },
                              }
                            }),
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
      </Section>

      <Section
        title="Molecular systems (1..N components)"
        kicker="Explicit species & counts"
        actions={
          <Button variant="outline" size="sm" onClick={() => setProject({ ...project, systems: [...project.systems, blankSystem()] })}>
            <Plus />
            Add system
          </Button>
        }
      >
        <InlineWarning title="Flexible system definition">
          Define neat liquids, binary/ternary mixtures, ionic liquids, DES, or solute-solvent boxes. Set absolute molecule counts directly in Manual mode, or compute them from box volume and target density below.
        </InlineWarning>
        <div className="system-grid">
          {project.systems.map((s) => (
            <article className="system-editor" key={s.id}>
              <div className="system-title">
                <Input value={s.name} onChange={(e) => patchSystem(s.id, { name: e.target.value })} />
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => setProject({ ...project, systems: project.systems.filter((x) => x.id !== s.id) })}
                >
                  <Trash2 />
                </Button>
              </div>
              <div className="form-grid form-grid-2">
                <Input value={s.abbreviation} placeholder="Abbrev." onChange={(e) => patchSystem(s.id, { abbreviation: e.target.value })} />
                <Input
                  value={s.ratio.join(":")}
                  placeholder="Molar ratio (e.g. 1:2)"
                  onChange={(e) => patchSystem(s.id, { ratio: e.target.value.split(":").map((v) => Math.max(1, Math.round(Number(v) || 1))) })}
                />
              </div>
              <div className="component-editor">
                {s.componentIds.map((id, index) => (
                  <div key={`${id}-${index}`}>
                    <Select
                      value={id}
                      onValueChange={(v) => {
                        const ids = [...s.componentIds]
                        ids[index] = v
                        patchSystem(s.id, { componentIds: ids })
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {project.molecules.map((m) => (
                          <SelectItem value={m.id} key={m.id}>
                            {m.fullName} ({m.residueName})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Input
                      type="number"
                      min="1"
                      disabled={s.compositionSettings.mode !== "manual"}
                      value={s.boxCounts[index] ?? ""}
                      placeholder="count"
                      onChange={(e) => {
                        const counts = [...s.boxCounts]
                        counts[index] = e.target.value === "" ? null : Number(e.target.value)
                        patchSystem(s.id, { boxCounts: counts })
                      }}
                    />
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() =>
                        patchSystem(s.id, {
                          componentIds: s.componentIds.filter((_, i) => i !== index),
                          ratio: s.ratio.filter((_, i) => i !== index),
                          boxCounts: s.boxCounts.filter((_, i) => i !== index),
                        })
                      }
                    >
                      <Trash2 />
                    </Button>
                  </div>
                ))}
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={!project.molecules.length}
                  onClick={() =>
                    patchSystem(s.id, {
                      componentIds: [...s.componentIds, project.molecules[0]?.id ?? ""],
                      ratio: [...s.ratio, 1],
                      boxCounts: [...s.boxCounts, 100],
                    })
                  }
                >
                  <Plus />
                  Component
                </Button>
              </div>
              <Input value={s.notes} onChange={(e) => patchSystem(s.id, { notes: e.target.value })} placeholder="System notes" />
              <code className="record-id">{s.id}</code>
            </article>
          ))}
        </div>
      </Section>

      <BoxCompositionCalculator project={project} setProject={setProject} />
    </>
  )
}
