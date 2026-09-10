"use client"
import type { ProjectState, Protocol } from "@/lib/workbench/types"
import { STAGES } from "@/lib/workbench/protocol"
import { CHARGE_SOURCE, FORCE_FIELD } from "@/lib/workbench/version"
import { Field, Section, TextField, InlineWarning } from "./shared"

function Choice<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: T[]; onChange: (v: T) => void }) {
  return <label className="field-stack">{label}<select className="h-9 border px-2 text-sm" aria-label={label} value={value} onChange={(e) => onChange(e.target.value as T)}>{options.map((v) => <option key={v} value={v}>{v}</option>)}</select></label>
}
export function ProtocolEditor({ project, setProject }: { project: ProjectState; setProject: (p: ProjectState) => void }) {
  const p = project.protocol, set = (protocol: Protocol) => setProject({ ...project, protocol })
  const number = (label: string, value: number | null, update: (v: number) => void, note?: string, disabled = false) => <Field label={label} type="number" step="any" value={value ?? ""} onChange={(v) => update(v === "" ? NaN : Number(v))} note={note} disabled={disabled}/>
  return <Section title="Simulation protocol" kicker="Settings used by generated inputs">
    <div className="form-grid form-grid-3">
      <Field label="Protocol name (metadata)" value={p.name} onChange={(v) => set({ ...p, name: v })}/>
      <Field label="Implemented force field" value={FORCE_FIELD} disabled onChange={() => {}}/>
      <Field label="Implemented charge pipeline" value={CHARGE_SOURCE} disabled onChange={() => {}}/>
      {number("Pressure (bar)", p.pressureBar, (v) => set({ ...p, pressureBar: v }))}
      {(["x", "y", "z"] as const).map((axis) => <div key={axis}>{number(`Box ${axis.toUpperCase()} (${p.box.unit === "angstrom" ? "Å" : "nm"})`, p.box[axis], (v) => set({ ...p, box: { ...p.box, [axis]: v } }))}</div>)}
      <Choice label="Box geometry" value={p.box.geometry} options={["cubic", "orthorhombic"]} onChange={(v) => set({ ...p, box: { ...p.box, geometry: v } })}/>
      {number("Replicas", p.replicas, (v) => set({ ...p, replicas: v }))}
      {number("Random seed base", p.randomSeedBase, (v) => set({ ...p, randomSeedBase: v }), "NVT generates velocities with base + replica − 1. Later stages continue checkpoints.")}
    </div>
    <h3 className="mt-6 mb-3 font-semibold">EM and equilibration</h3>
    <div className="form-grid form-grid-3">
      <Choice label="EM integrator" value={p.em.method} options={["steep", "cg"]} onChange={(v) => set({ ...p, em: { ...p.em, method: v } })}/>
      {number("EM maximum steps", p.em.maxSteps, (v) => set({ ...p, em: { ...p.em, maxSteps: v } }))}
      {number("Fmax target (kJ mol⁻¹ nm⁻¹)", p.em.fmax, (v) => set({ ...p, em: { ...p.em, fmax: v } }))}
      {number("NVT duration (ns)", p.nvt.durationNs, (v) => set({ ...p, nvt: { ...p.nvt, durationNs: v } }))}
      <Choice label="Thermostat" value={p.nvt.thermostat} options={["V-rescale", "Nose-Hoover", "Berendsen"]} onChange={(v) => set({ ...p, nvt: { ...p.nvt, thermostat: v } })}/>
      {number("Temperature coupling τT (ps)", p.nvt.tauTPs, (v) => set({ ...p, nvt: { ...p.nvt, tauTPs: v } }))}
      {number("NVT timestep (fs)", p.nvt.timestepFs, (v) => set({ ...p, nvt: { ...p.nvt, timestepFs: v } }))}
      {number("NPT duration (ns)", p.npt.durationNs, (v) => set({ ...p, npt: { ...p.npt, durationNs: v } }))}
      <Choice label="Barostat" value={p.npt.barostat} options={["Parrinello-Rahman", "C-rescale", "Berendsen"]} onChange={(v) => set({ ...p, npt: { ...p.npt, barostat: v } })}/>
      {number("Pressure coupling τP (ps)", p.npt.tauPPs, (v) => set({ ...p, npt: { ...p.npt, tauPPs: v } }))}
      {number("NPT timestep (fs)", p.npt.timestepFs, (v) => set({ ...p, npt: { ...p.npt, timestepFs: v } }))}
      {number("Compressibility (bar⁻¹)", p.npt.compressibilityBarInverse, (v) => set({ ...p, npt: { ...p.npt, compressibilityBarInverse: Number.isFinite(v) ? v : null } }), "Required physical input. Choose a justified value for this system; no water value is assumed.")}
    </div>
    <h3 className="mt-6 mb-3 font-semibold">Production plan</h3>
    <label className="flex gap-2 mb-3"><input type="checkbox" checked={p.production.pureDes.enabled} onChange={(e) => set({ ...p, production: { ...p.production, pureDes: { ...p.production.pureDes, enabled: e.target.checked } } })}/>Generate separate solvent-only runs</label>
    <div className="form-grid form-grid-3">
      {number("Pure DES production (ns)", p.production.pureDes.durationNs, (v) => set({ ...p, production: { ...p.production, pureDes: { ...p.production.pureDes, durationNs: v } } }), undefined, !p.production.pureDes.enabled)}
      <Choice label="Solute production mode" value={p.production.solute.mode} options={["fixed", "convergence-controlled"]} onChange={(v) => set({ ...p, production: { ...p.production, solute: { ...p.production.solute, mode: v } } })}/>
      {number("Initial production duration (ns)", p.production.solute.initialNs, (v) => set({ ...p, production: { ...p.production, solute: { ...p.production.solute, initialNs: v } } }))}
      {number("Maximum production duration (ns)", p.production.solute.maximumNs, (v) => set({ ...p, production: { ...p.production, solute: { ...p.production.solute, maximumNs: v } } }), undefined, p.production.solute.mode === "fixed")}
      {number("Continuation increment (ns)", p.production.solute.extensionNs, (v) => set({ ...p, production: { ...p.production, solute: { ...p.production.solute, extensionNs: v } } }), undefined, p.production.solute.mode === "fixed")}
      {number("Production timestep (fs)", p.production.timestepFs, (v) => set({ ...p, production: { ...p.production, timestepFs: v } }))}
      {number("Trajectory frame interval (ps)", p.production.framePs, (v) => set({ ...p, production: { ...p.production, framePs: v } }))}
    </div>
    <p className="table-note">Convergence-controlled execution is manual: execute initial inputs externally, inspect block evidence, then generate a bounded checkpoint continuation. The application does not execute or automatically extend GROMACS.</p>
    <h3 className="mt-6 mb-3 font-semibold">Nonbonded and constraints</h3>
    <div className="form-grid form-grid-3">
      <Choice label="Coulomb method" value={p.nonbonded.coulombMethod} options={["PME", "Cut-off"]} onChange={(v) => set({ ...p, nonbonded: { ...p.nonbonded, coulombMethod: v } })}/>
      {number("Nonbonded cutoff (nm)", p.nonbonded.cutoffNm, (v) => set({ ...p, nonbonded: { ...p.nonbonded, cutoffNm: v } }))}
      {number("PME order", p.nonbonded.pmeOrder, (v) => set({ ...p, nonbonded: { ...p.nonbonded, pmeOrder: v } }), undefined, p.nonbonded.coulombMethod !== "PME")}
      {number("Fourier spacing (nm)", p.nonbonded.fourierSpacingNm, (v) => set({ ...p, nonbonded: { ...p.nonbonded, fourierSpacingNm: v } }), undefined, p.nonbonded.coulombMethod !== "PME")}
      <Choice label="Constraints" value={p.constraints} options={["none", "h-bonds", "all-bonds"]} onChange={(v) => set({ ...p, constraints: v })}/>
      <Choice label="Constraint algorithm" value={p.constraintAlgorithm} options={["lincs", "shake"]} onChange={(v) => set({ ...p, constraintAlgorithm: v })}/>
    </div>
    <InlineWarning title="Override provenance">Overrides become the actual directive maps in the resolved protocol. State identity, initialization policy, supported algorithms and malformed settings are validated before export. Changing design settings does not mutate previously generated runs.</InlineWarning>
    <div className="form-grid form-grid-2">{STAGES.map((stage) => <TextField key={stage} label={`${stage.toUpperCase()} MDP overrides`} value={p.mdpOverrides?.[stage] ?? ""} rows={5} onChange={(v) => set({ ...p, mdpOverrides: { em: "", nvt: "", npt: "", prod: "", ...p.mdpOverrides, [stage]: v } })}/>)}</div>
    <div className="form-grid form-grid-2"><TextField label="Equilibration notes (metadata)" value={p.equilibrationNotes} onChange={(v) => set({ ...p, equilibrationNotes: v })}/><TextField label="Production notes (metadata)" value={p.productionNotes} onChange={(v) => set({ ...p, productionNotes: v })}/></div>
    <h3 className="mt-6 mb-3 font-semibold">Readable run ID fields</h3>
    <div className="naming-grid">{Object.entries(project.runNaming).map(([k, enabled]) => <label key={k}><input type="checkbox" checked={enabled} onChange={(e) => setProject({ ...project, runNaming: { ...project.runNaming, [k]: e.target.checked } })}/>{k.replace("include", "Include ")}</label>)}</div>
  </Section>
}
