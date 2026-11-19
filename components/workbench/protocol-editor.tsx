"use client"

import type { ProjectState, Protocol } from "@/lib/workbench/types"
import { STAGES } from "@/lib/workbench/protocol"
import { COMMON_FORCE_FIELDS, COMMON_CHARGE_SCHEMES } from "@/lib/workbench/version"
import { Field, Section, TextField, InlineWarning } from "./shared"

function EditableChoice({
  label,
  value,
  options,
  onChange,
  note,
}: {
  label: string
  value: string
  options: readonly string[]
  onChange: (v: string) => void
  note?: string
}) {
  const listId = `list-${label.toLowerCase().replace(/\W+/g, "-")}`
  return (
    <div className="field-stack">
      <label>{label}</label>
      <input
        className="h-9 border px-2 text-sm bg-white"
        aria-label={label}
        list={listId}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      <datalist id={listId}>
        {options.map((v) => (
          <option key={v} value={v} />
        ))}
      </datalist>
      {note && <small>{note}</small>}
    </div>
  )
}

export function ProtocolEditor({ project, setProject }: { project: ProjectState; setProject: (p: ProjectState) => void }) {
  const p = project.protocol
  const set = (protocol: Protocol) => setProject({ ...project, protocol })
  const number = (label: string, value: number | null, update: (v: number) => void, note?: string, disabled = false) => (
    <Field
      label={label}
      type="number"
      step="any"
      value={value ?? ""}
      onChange={(v) => update(v === "" ? NaN : Number(v))}
      note={note}
      disabled={disabled}
    />
  )

  const applyForceFieldPreset = (ffName: string) => {
    const preset = COMMON_FORCE_FIELDS.find((item) => item.name === ffName)
    if (preset) {
      set({ ...p, forceField: preset.name, forceFieldInclude: preset.include, defaultsSection: preset.defaults })
    } else {
      set({ ...p, forceField: ffName })
    }
  }

  return (
    <Section title="GROMACS Simulation Protocol" kicker="100% editable · no hardcoded force-field or QM locks">
      <div className="form-grid form-grid-3">
        <Field label="Protocol name" value={p.name} onChange={(v) => set({ ...p, name: v })} />
        <EditableChoice
          label="Force field"
          value={p.forceField}
          options={COMMON_FORCE_FIELDS.map((f) => f.name)}
          onChange={applyForceFieldPreset}
          note="Pick any preset or type a custom force-field name."
        />
        <Field
          label="Force-field #include (optional)"
          value={p.forceFieldInclude}
          placeholder="e.g. oplsaa.ff/forcefield.itp (leave blank for self-contained)"
          onChange={(v) => set({ ...p, forceFieldInclude: v })}
          note="Leave empty for self-contained topologies (GAFF2/ACPYPE/OpenFF/LigParGen)."
        />
        <Field
          label="[ defaults ] directive (if self-contained)"
          value={p.defaultsSection}
          placeholder="e.g. 1 2 yes 0.5 0.83333333"
          onChange={(v) => set({ ...p, defaultsSection: v })}
          note="Used in topol.top when #include is blank (or auto-hoisted from .itp)."
        />
        <EditableChoice
          label="Charge scheme label"
          value={p.chargeScheme}
          options={COMMON_CHARGE_SCHEMES}
          onChange={(v) => set({ ...p, chargeScheme: v })}
          note="Metadata tag — actual per-atom charges are configured per molecule in QM → GROMACS."
        />
        <Field
          label="QM method / basis note (optional)"
          value={p.qmMethodBasis}
          placeholder="e.g. wB97X-D3/def2-TZVP, r2SCAN-3c, GFN2-xTB"
          onChange={(v) => set({ ...p, qmMethodBasis: v })}
        />
        {number("Pressure (bar)", p.pressureBar, (v) => set({ ...p, pressureBar: v }))}
        {(["x", "y", "z"] as const).map((axis) => (
          <div key={axis}>
            {number(`Box ${axis.toUpperCase()} (${p.box.unit === "angstrom" ? "Å" : "nm"})`, p.box[axis], (v) =>
              set({ ...p, box: { ...p.box, [axis]: v } }),
            )}
          </div>
        ))}
        <EditableChoice
          label="Box geometry"
          value={p.box.geometry}
          options={["cubic", "orthorhombic"]}
          onChange={(v) => set({ ...p, box: { ...p.box, geometry: v } })}
        />
        {number("Replicas", p.replicas, (v) => set({ ...p, replicas: v }))}
        {number(
          "Random seed base",
          p.randomSeedBase,
          (v) => set({ ...p, randomSeedBase: v }),
          "First dynamic stage initializes velocities with base + replica − 1.",
        )}
      </div>

      <h3 className="mt-6 mb-3 font-semibold">Enabled simulation stages</h3>
      <div className="naming-grid">
        {STAGES.map((stage) => (
          <label key={stage}>
            <input
              type="checkbox"
              checked={p.enabledStages[stage]}
              onChange={(e) => set({ ...p, enabledStages: { ...p.enabledStages, [stage]: e.target.checked } })}
            />
            Enable {stage.toUpperCase()}
          </label>
        ))}
      </div>

      <h3 className="mt-6 mb-3 font-semibold">EM &amp; Equilibration</h3>
      <div className="form-grid form-grid-3">
        <EditableChoice
          label="EM integrator"
          value={p.em.method}
          options={["steep", "cg", "l-bfgs"]}
          onChange={(v) => set({ ...p, em: { ...p.em, method: v } })}
        />
        {number("EM maximum steps", p.em.maxSteps, (v) => set({ ...p, em: { ...p.em, maxSteps: v } }))}
        {number("Fmax target (kJ mol⁻¹ nm⁻¹)", p.em.fmax, (v) => set({ ...p, em: { ...p.em, fmax: v } }))}
        {number("NVT duration (ns)", p.nvt.durationNs, (v) => set({ ...p, nvt: { ...p.nvt, durationNs: v } }))}
        <EditableChoice
          label="Thermostat"
          value={p.nvt.thermostat}
          options={["V-rescale", "Nose-Hoover", "Berendsen", "andersen", "no"]}
          onChange={(v) => set({ ...p, nvt: { ...p.nvt, thermostat: v } })}
        />
        <Field
          label="Temperature coupling groups (tc-grps)"
          value={p.nvt.tcGrps}
          onChange={(v) => set({ ...p, nvt: { ...p.nvt, tcGrps: v } })}
          note="e.g. System, or 'Solute Solvent' (space-separated)."
        />
        {number("Temperature coupling τT (ps)", p.nvt.tauTPs, (v) => set({ ...p, nvt: { ...p.nvt, tauTPs: v } }))}
        {number("NVT timestep (fs)", p.nvt.timestepFs, (v) => set({ ...p, nvt: { ...p.nvt, timestepFs: v } }))}
        {number("NPT duration (ns)", p.npt.durationNs, (v) => set({ ...p, npt: { ...p.npt, durationNs: v } }))}
        <EditableChoice
          label="Barostat"
          value={p.npt.barostat}
          options={["C-rescale", "Parrinello-Rahman", "Berendsen", "MTTK", "no"]}
          onChange={(v) => set({ ...p, npt: { ...p.npt, barostat: v } })}
        />
        <EditableChoice
          label="Pressure coupling type"
          value={p.npt.pcoupltype}
          options={["isotropic", "semiisotropic", "anisotropic", "surface-tension"]}
          onChange={(v) => set({ ...p, npt: { ...p.npt, pcoupltype: v } })}
        />
        {number("Pressure coupling τP (ps)", p.npt.tauPPs, (v) => set({ ...p, npt: { ...p.npt, tauPPs: v } }))}
        {number("NPT timestep (fs)", p.npt.timestepFs, (v) => set({ ...p, npt: { ...p.npt, timestepFs: v } }))}
        <Field
          label="Compressibility (bar⁻¹)"
          value={p.npt.compressibility}
          placeholder="e.g. 4.5e-5 (or '4.5e-5 4.5e-5' for semiisotropic)"
          onChange={(v) => set({ ...p, npt: { ...p.npt, compressibility: v } })}
        />
      </div>

      <h3 className="mt-6 mb-3 font-semibold">Production MD</h3>
      <div className="form-grid form-grid-3">
        <EditableChoice
          label="Production ensemble"
          value={p.production.ensemble}
          options={["NPT", "NVT"]}
          onChange={(v) => set({ ...p, production: { ...p.production, ensemble: v === "NVT" ? "NVT" : "NPT" } })}
        />
        <EditableChoice
          label="Production mode"
          value={p.production.mode}
          options={["fixed", "convergence-controlled"]}
          onChange={(v) =>
            set({ ...p, production: { ...p.production, mode: v === "convergence-controlled" ? "convergence-controlled" : "fixed" } })
          }
        />
        {number("Production duration (ns)", p.production.initialNs, (v) => set({ ...p, production: { ...p.production, initialNs: v } }))}
        {number(
          "Maximum duration (ns)",
          p.production.maximumNs,
          (v) => set({ ...p, production: { ...p.production, maximumNs: v } }),
          undefined,
          p.production.mode === "fixed",
        )}
        {number(
          "Continuation increment (ns)",
          p.production.extensionNs,
          (v) => set({ ...p, production: { ...p.production, extensionNs: v } }),
          undefined,
          p.production.mode === "fixed",
        )}
        {number("Production timestep (fs)", p.production.timestepFs, (v) => set({ ...p, production: { ...p.production, timestepFs: v } }))}
        {number("Trajectory frame interval (ps)", p.production.framePs, (v) => set({ ...p, production: { ...p.production, framePs: v } }))}
        {number("Energy/log output interval (ps)", p.production.energyPs, (v) => set({ ...p, production: { ...p.production, energyPs: v } }))}
      </div>

      <h3 className="mt-6 mb-3 font-semibold">Nonbonded &amp; Constraints</h3>
      <div className="form-grid form-grid-3">
        <EditableChoice
          label="Cutoff scheme"
          value={p.nonbonded.cutoffScheme}
          options={["Verlet", "Group"]}
          onChange={(v) => set({ ...p, nonbonded: { ...p.nonbonded, cutoffScheme: v } })}
        />
        <EditableChoice
          label="Coulomb method"
          value={p.nonbonded.coulombMethod}
          options={["PME", "Cut-off", "Reaction-Field", "PME-Switch", "P3M-AD"]}
          onChange={(v) => set({ ...p, nonbonded: { ...p.nonbonded, coulombMethod: v } })}
        />
        {number("rcoulomb (nm)", p.nonbonded.rcoulombNm, (v) => set({ ...p, nonbonded: { ...p.nonbonded, rcoulombNm: v } }))}
        <EditableChoice
          label="vdW method"
          value={p.nonbonded.vdwType}
          options={["Cut-off", "PME", "Switch", "Shift"]}
          onChange={(v) => set({ ...p, nonbonded: { ...p.nonbonded, vdwType: v } })}
        />
        <EditableChoice
          label="vdW modifier"
          value={p.nonbonded.vdwModifier}
          options={["Potential-shift-Verlet", "Force-switch", "Potential-switch", "None"]}
          onChange={(v) => set({ ...p, nonbonded: { ...p.nonbonded, vdwModifier: v } })}
        />
        {number("rvdw (nm)", p.nonbonded.rvdwNm, (v) => set({ ...p, nonbonded: { ...p.nonbonded, rvdwNm: v } }))}
        <EditableChoice
          label="Dispersion correction"
          value={p.nonbonded.dispCorr}
          options={["EnerPres", "Ener", "no"]}
          onChange={(v) => set({ ...p, nonbonded: { ...p.nonbonded, dispCorr: v } })}
        />
        {number("PME order", p.nonbonded.pmeOrder, (v) => set({ ...p, nonbonded: { ...p.nonbonded, pmeOrder: v } }))}
        {number("Fourier spacing (nm)", p.nonbonded.fourierSpacingNm, (v) => set({ ...p, nonbonded: { ...p.nonbonded, fourierSpacingNm: v } }))}
        <EditableChoice
          label="Constraints"
          value={p.constraints}
          options={["h-bonds", "all-bonds", "none", "h-angles", "all-angles"]}
          onChange={(v) => set({ ...p, constraints: v })}
        />
        <EditableChoice
          label="Constraint algorithm"
          value={p.constraintAlgorithm}
          options={["lincs", "shake"]}
          onChange={(v) => set({ ...p, constraintAlgorithm: v })}
        />
      </div>

      <InlineWarning title="Raw MDP overrides">
        Any valid GROMACS directive entered below merges directly into the generated stage `.mdp` file (e.g., `rvdw-switch = 1.0`, `annealing = single`, `comm-mode = Linear`, `energygrps = ...`).
      </InlineWarning>
      <div className="form-grid form-grid-2">
        {STAGES.map((stage) => (
          <TextField
            key={stage}
            label={`${stage.toUpperCase()} MDP overrides`}
            value={p.mdpOverrides?.[stage] ?? ""}
            rows={4}
            placeholder="key = value"
            onChange={(v) => set({ ...p, mdpOverrides: { ...p.mdpOverrides, [stage]: v } })}
          />
        ))}
      </div>

      <h3 className="mt-6 mb-3 font-semibold">Run ID naming options</h3>
      <div className="naming-grid">
        {Object.entries(project.runNaming).map(([k, enabled]) => (
          <label key={k}>
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setProject({ ...project, runNaming: { ...project.runNaming, [k]: e.target.checked } })}
            />
            {k.replace("include", "Include ")}
          </label>
        ))}
      </div>
    </Section>
  )
}
