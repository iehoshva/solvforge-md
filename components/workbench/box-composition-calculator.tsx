"use client"

import { useMemo, useState } from "react"
import { Check, Plus, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import type { BoxCompositionSettings, DensityPoint, ProjectState } from "@/lib/workbench/types"
import { boxDimensionsNm, boxVolumeNm3, calculateBoxComposition, compositionStateKey } from "@/lib/workbench/composition"
import { newId } from "@/lib/workbench/preset"
import { EmptyEvidence, Field, InlineWarning, Metric, Section, StatusBadge } from "./shared"

export function BoxCompositionCalculator({ project, setProject }: { project: ProjectState; setProject: (project: ProjectState) => void }) {
  const [systemId, setSystemId] = useState(project.systems[0]?.id ?? "")
  const [soluteId, setSoluteId] = useState(project.soluteIds[0] ?? "")
  const [soluteCount, setSoluteCount] = useState(0)
  const [temperatureK, setTemperatureK] = useState(298.15)

  const activeSystemId = project.systems.some((s) => s.id === systemId) ? systemId : (project.systems[0]?.id ?? "")
  const system = project.systems.find((item) => item.id === activeSystemId)
  const activeSoluteId = soluteId && project.molecules.some((m) => m.id === soluteId) ? soluteId : ""

  const result = useMemo(
    () => calculateBoxComposition(project, activeSystemId, activeSoluteId, soluteCount, temperatureK),
    [project, activeSystemId, activeSoluteId, soluteCount, temperatureK],
  )
  const dimensionsNm = boxDimensionsNm(project.protocol.box)

  const patchSystem = (patch: Partial<NonNullable<typeof system>>) =>
    system && setProject({ ...project, systems: project.systems.map((item) => (item.id === system.id ? { ...item, ...patch } : item)) })
  const patchSettings = (patch: Partial<BoxCompositionSettings>) =>
    system && patchSystem({ compositionSettings: { ...system.compositionSettings, ...patch } })
  const patchDensity = (id: string, patch: Partial<DensityPoint>) =>
    system &&
    patchSettings({
      densityPoints: system.compositionSettings.densityPoints.map((point) =>
        point.id === id ? { ...point, ...patch, derivation: "user-supplied" } : point,
      ),
    })

  const changeBoxUnit = (unit: "nm" | "angstrom") => {
    const current = project.protocol.box.unit ?? "nm"
    if (unit === current) return
    const factor = unit === "angstrom" ? 10 : 0.1
    setProject({
      ...project,
      protocol: {
        ...project.protocol,
        box: { ...project.protocol.box, x: project.protocol.box.x * factor, y: project.protocol.box.y * factor, z: project.protocol.box.z * factor, unit },
      },
    })
  }

  const candidateKey = system
    ? compositionStateKey(
        temperatureK,
        activeSoluteId,
        system.compositionSettings.lockAcrossSeries ? system.compositionSettings.lockReferenceSoluteCount : soluteCount,
        project,
        system,
      )
    : ""

  const selectCandidate = (multiplier: number) => {
    if (!system || !Number.isInteger(multiplier) || multiplier <= 0) return
    patchSettings({ selectedMultipliers: { ...system.compositionSettings.selectedMultipliers, [candidateKey]: multiplier } })
  }

  const resetCandidate = () => {
    if (!system) return
    const next = { ...system.compositionSettings.selectedMultipliers }
    delete next[candidateKey]
    patchSettings({ selectedMultipliers: next })
  }

  const metadata = result.metadata
  const selected = result.selected
  const usedCounts = result.componentCounts
  const hasError = result.diagnostics.some((item) => item.severity === "ERROR")

  return (
    <Section
      title="Box Composition Calculator"
      kicker={system?.compositionSettings.mode === "manual" ? "Manual molecule counts" : "Box volume + target density"}
      actions={
        <StatusBadge tone={hasError ? "danger" : result.diagnostics.some((i) => i.severity === "WARNING") ? "warning" : "good"}>
          {hasError ? "input required" : usedCounts ? "composition resolved" : "waiting"}
        </StatusBadge>
      }
    >
      <div className="form-grid form-grid-4">
        <div className="field-stack">
          <Label>Molecular system</Label>
          <Select value={activeSystemId} onValueChange={setSystemId}>
            <SelectTrigger>
              <SelectValue placeholder="Select system" />
            </SelectTrigger>
            <SelectContent>
              {project.systems.map((item) => (
                <SelectItem key={item.id} value={item.id}>
                  {item.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="field-stack">
          <Label>Composition mode</Label>
          <Select
            value={system?.compositionSettings.mode ?? "manual"}
            onValueChange={(value) => patchSettings({ mode: value as "manual" | "density" })}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="manual">Manual molecule counts</SelectItem>
              <SelectItem value="density">Calculate from box + density</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="field-stack">
          <Label>Optional solute preview</Label>
          <Select value={activeSoluteId || "__none__"} onValueChange={(v) => setSoluteId(v === "__none__" ? "" : v)}>
            <SelectTrigger>
              <SelectValue placeholder="None (neat)" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">None (neat system)</SelectItem>
              {project.molecules.map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  {m.fullName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Field label="Preview solute count" type="number" min="0" value={soluteCount} onChange={(value) => setSoluteCount(Math.max(0, Number(value)))} />
        <Field label="Preview temperature (K)" type="number" step="0.01" value={temperatureK} onChange={(value) => setTemperatureK(Number(value))} />
        <Field
          label={`Box X (${project.protocol.box.unit === "angstrom" ? "Å" : "nm"})`}
          type="number"
          step="0.1"
          value={project.protocol.box.x}
          onChange={(value) => setProject({ ...project, protocol: { ...project.protocol, box: { ...project.protocol.box, x: Number(value) } } })}
        />
        <Field
          label={`Box Y (${project.protocol.box.unit === "angstrom" ? "Å" : "nm"})`}
          type="number"
          step="0.1"
          value={project.protocol.box.y}
          onChange={(value) => setProject({ ...project, protocol: { ...project.protocol, box: { ...project.protocol.box, y: Number(value) } } })}
        />
        <Field
          label={`Box Z (${project.protocol.box.unit === "angstrom" ? "Å" : "nm"})`}
          type="number"
          step="0.1"
          value={project.protocol.box.z}
          onChange={(value) => setProject({ ...project, protocol: { ...project.protocol, box: { ...project.protocol.box, z: Number(value) } } })}
        />
        <div className="field-stack">
          <Label>Box unit</Label>
          <Select value={project.protocol.box.unit ?? "nm"} onValueChange={(value) => changeBoxUnit(value as "nm" | "angstrom")}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="nm">nanometre (nm)</SelectItem>
              <SelectItem value="angstrom">ångström (Å)</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="field-stack">
          <Label>Box geometry</Label>
          <Select
            value={project.protocol.box.geometry}
            onValueChange={(value) => setProject({ ...project, protocol: { ...project.protocol, box: { ...project.protocol.box, geometry: value } } })}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="cubic">Cubic</SelectItem>
              <SelectItem value="orthorhombic">Orthorhombic</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {system && (
        <>
          {system.compositionSettings.mode === "manual" ? (
            <Section title="Manual molecule counts" kicker="Direct absolute counts">
              <div className="form-grid form-grid-4">
                {system.componentIds.map((id, index) => (
                  <Field
                    key={`${id}-${index}`}
                    label={`${project.molecules.find((item) => item.id === id)?.fullName ?? id} count`}
                    type="number"
                    min="1"
                    value={system.boxCounts[index] ?? ""}
                    onChange={(value) => {
                      const counts = [...system.boxCounts]
                      counts[index] = value === "" ? null : Number(value)
                      patchSystem({ boxCounts: counts })
                    }}
                  />
                ))}
              </div>
            </Section>
          ) : (
            <>
              <Section
                title="Target-density records"
                kicker={`${system.compositionSettings.densityPoints.length} point(s)`}
                actions={
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      patchSettings({
                        densityPoints: [
                          ...system.compositionSettings.densityPoints,
                          {
                            id: newId("rho"),
                            label: "Density record",
                            densityGcm3: null,
                            temperatureK,
                            status: "experimental",
                            sourceNote: "",
                            derivation: "user-supplied",
                          },
                        ],
                      })
                    }
                  >
                    <Plus />
                    Add density point
                  </Button>
                }
              >
                <div className="form-grid form-grid-4">
                  <div className="field-stack">
                    <Label>Density unit</Label>
                    <Select
                      value={system.compositionSettings.densityInputUnit}
                      onValueChange={(value) => patchSettings({ densityInputUnit: value as "g/cm3" | "kg/m3" })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="g/cm3">g cm⁻³</SelectItem>
                        <SelectItem value="kg/m3">kg m⁻³</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="field-stack">
                    <Label>Temperature lookup</Label>
                    <Select
                      value={system.compositionSettings.densityResolution}
                      onValueChange={(value) => patchSettings({ densityResolution: value as BoxCompositionSettings["densityResolution"] })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="exact-only">Exact temperature only</SelectItem>
                        <SelectItem value="nearest">Nearest known point</SelectItem>
                        <SelectItem value="linear-interpolation">Linear interpolation</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <Field
                    label="Solute mass mode"
                    value={system.compositionSettings.soluteMassMode}
                    onChange={(v) => patchSettings({ soluteMassMode: v === "add-after" ? "add-after" : "include-in-target" })}
                    note="include-in-target or add-after"
                  />
                  <label className="override-row">
                    <Checkbox
                      checked={system.compositionSettings.lockAcrossSeries}
                      onCheckedChange={(value) => patchSettings({ lockAcrossSeries: Boolean(value) })}
                    />
                    <span>
                      <strong>Lock base counts across solute loadings</strong>
                    </span>
                  </label>
                </div>

                {system.compositionSettings.densityPoints.length ? (
                  <div className="table-scroll mt-grid">
                    <Table className="dense-table">
                      <TableHeader>
                        <TableRow>
                          <TableHead>Density ({system.compositionSettings.densityInputUnit === "kg/m3" ? "kg m⁻³" : "g cm⁻³"})</TableHead>
                          <TableHead>Temperature (K)</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Source note</TableHead>
                          <TableHead />
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {system.compositionSettings.densityPoints.map((point) => (
                          <TableRow key={point.id}>
                            <TableCell>
                              <Input
                                type="number"
                                step="any"
                                value={
                                  point.densityGcm3 === null
                                    ? ""
                                    : point.densityGcm3 * (system.compositionSettings.densityInputUnit === "kg/m3" ? 1000 : 1)
                                }
                                onChange={(e) =>
                                  patchDensity(point.id, {
                                    densityGcm3:
                                      e.target.value === ""
                                        ? null
                                        : Number(e.target.value) / (system.compositionSettings.densityInputUnit === "kg/m3" ? 1000 : 1),
                                  })
                                }
                              />
                            </TableCell>
                            <TableCell>
                              <Input
                                type="number"
                                step="0.01"
                                value={point.temperatureK ?? ""}
                                onChange={(e) => patchDensity(point.id, { temperatureK: e.target.value === "" ? null : Number(e.target.value) })}
                              />
                            </TableCell>
                            <TableCell>
                              <Select
                                value={point.status}
                                onValueChange={(v) => patchDensity(point.id, { status: v as DensityPoint["status"] })}
                              >
                                <SelectTrigger>
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {["experimental", "literature", "estimated", "MD-derived"].map((st) => (
                                    <SelectItem value={st} key={st}>
                                      {st}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </TableCell>
                            <TableCell>
                              <Input value={point.sourceNote} placeholder="Reference or note" onChange={(e) => patchDensity(point.id, { sourceNote: e.target.value })} />
                            </TableCell>
                            <TableCell>
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                onClick={() =>
                                  patchSettings({ densityPoints: system.compositionSettings.densityPoints.filter((p) => p.id !== point.id) })
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
                ) : (
                  <InlineWarning title="Target density required">
                    Add a density point above (or switch to Manual molecule counts).
                  </InlineWarning>
                )}
              </Section>
            </>
          )}

          {result.diagnostics.map((item, index) => (
            <div className={`diagnostic diagnostic-${item.severity.toLowerCase()}`} key={`${item.code}-${index}`}>
              <StatusBadge tone={item.severity === "ERROR" ? "danger" : item.severity === "WARNING" ? "warning" : "good"}>
                {item.severity}
              </StatusBadge>
              <code>{item.code}</code>
              <span>{item.message}</span>
            </div>
          ))}

          {result.candidates.length > 0 && (
            <Section title="Integer-ratio candidates" kicker="Choose multiplier n">
              <div className="table-scroll">
                <Table className="dense-table">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Use</TableHead>
                      <TableHead>n</TableHead>
                      {system.componentIds.map((id) => (
                        <TableHead key={id}>N ({project.molecules.find((item) => item.id === id)?.abbreviation ?? id})</TableHead>
                      ))}
                      <TableHead>Estimated ρ (g cm⁻³)</TableHead>
                      <TableHead>Relative error</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {result.candidates.map((candidate) => (
                      <TableRow key={candidate.multiplier} data-selected={selected?.multiplier === candidate.multiplier}>
                        <TableCell>
                          <Button
                            size="sm"
                            variant={selected?.multiplier === candidate.multiplier ? "default" : "outline"}
                            onClick={() => selectCandidate(candidate.multiplier)}
                          >
                            {selected?.multiplier === candidate.multiplier ? (
                              <>
                                <Check />
                                Selected
                              </>
                            ) : (
                              "Use"
                            )}
                          </Button>
                        </TableCell>
                        <TableCell>
                          {candidate.multiplier}
                          {candidate.mathematicallyClosest && <small className="candidate-best"> closest</small>}
                        </TableCell>
                        {candidate.componentCounts.map((count, index) => (
                          <TableCell key={index}>{count}</TableCell>
                        ))}
                        <TableCell>{candidate.estimatedDensityGcm3.toFixed(5)}</TableCell>
                        <TableCell>{candidate.relativeDensityErrorPct.toFixed(3)}%</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <div className="candidate-control">
                <Field label="Direct multiplier n" type="number" min="1" value={selected?.multiplier ?? ""} onChange={(value) => selectCandidate(Number(value))} />
                <Button variant="outline" size="sm" onClick={resetCandidate}>
                  Reset to closest
                </Button>
              </div>
            </Section>
          )}

          {metadata && usedCounts && (
            <Section title="Resolved box composition" kicker="Summary">
              <div className="metrics-row">
                <Metric label="Box" value={`${dimensionsNm.x.toFixed(3)} × ${dimensionsNm.y.toFixed(3)} × ${dimensionsNm.z.toFixed(3)} nm`} />
                <Metric label="Volume" value={`${boxVolumeNm3(project.protocol.box).toFixed(3)} nm³`} />
                <Metric label="Total molecules" value={usedCounts.reduce((s, v) => s + v, activeSoluteId ? soluteCount : 0)} />
                <Metric
                  label="Estimated density"
                  value={metadata.estimatedDensityGcm3 !== null ? `${metadata.estimatedDensityGcm3.toFixed(5)} g cm⁻³` : "add MWs to compute"}
                />
              </div>
            </Section>
          )}
        </>
      )}

      {!system && <EmptyEvidence text="Create a molecular system above to configure box composition." />}
    </Section>
  )
}
