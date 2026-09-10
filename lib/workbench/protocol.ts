import type { CompositionDiagnostic, ProjectState, ResolvedSimulationProtocol, RunRecord } from "./types"
import { CHARGE_SOURCE, FORCE_FIELD, FORCE_FIELD_INCLUDE, SOFTWARE_VERSION } from "./version.ts"
import { fingerprint } from "./identity.ts"

export type Stage = "em" | "nvt" | "npt" | "prod"
export const STAGES: Stage[] = ["em", "nvt", "npt", "prod"]
export const MDP_ENUMS: Record<string, string[]> = {
  integrator: ["steep", "cg", "md"], constraints: ["none", "h-bonds", "all-bonds"],
  "constraint-algorithm": ["lincs", "shake"], tcoupl: ["v-rescale", "nose-hoover", "berendsen"],
  pcoupl: ["no", "parrinello-rahman", "c-rescale", "berendsen"], coulombtype: ["pme", "cut-off"],
  "cutoff-scheme": ["verlet"], "pcoupltype": ["isotropic"], "gen-vel": ["yes", "no"], continuation: ["yes", "no"],
}
const key = (s: string) => s.trim().toLowerCase().replaceAll("_", "-")
export function parseDirectives(text: string) {
  const directives: Record<string, string> = {}, diagnostics: CompositionDiagnostic[] = []
  text.split(/\r?\n/).forEach((line, i) => {
    const plain = line.split(";")[0].trim()
    if (!plain) return
    const m = plain.match(/^([^=\s]+)\s*=\s*(.+)$/)
    if (!m) { diagnostics.push({ severity: "ERROR", code: "MDP_SYNTAX", message: `Malformed MDP line ${i + 1}.` }); return }
    const k = key(m[1])
    if (k in directives) diagnostics.push({ severity: "ERROR", code: "DUPLICATE_DIRECTIVE", message: `Duplicate ${k} at line ${i + 1}.` })
    directives[k] = m[2].trim()
  })
  return { directives, diagnostics }
}

export function validateStage(d: Record<string, string>, stage: Stage, expected: { temperatureK?: number; pressureBar?: number; randomSeed?: number } = {}): CompositionDiagnostic[] {
  const out: CompositionDiagnostic[] = []
  const error = (code: string, message: string) => out.push({ severity: "ERROR", code, message: `${stage}: ${message}` })
  for (const [k, options] of Object.entries(MDP_ENUMS)) if (d[k] !== undefined && !options.includes(d[k].toLowerCase())) error("MDP_ENUM", `Unsupported ${k}=${d[k]}; supported: ${options.join(", ")}.`)
  const numeric = /^(dt|nsteps|emtol|emstep|ref-t|ref-p|tau-t|tau-p|compressibility|rcoulomb|rvdw|rlist|fourierspacing|pme-order|gen-temp|gen-seed|ld-seed|nst.*|lincs-order|lincs-iter|verlet-buffer-tolerance|init-step|tinit)$/
  for (const [k, v] of Object.entries(d)) if (numeric.test(k) && !v.split(/\s+/).every((s) => /^[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?$/i.test(s) && Number.isFinite(Number(s)))) error("MDP_NUMBER", `Malformed ${k}=${v}.`)
  for (const k of ["nsteps", "nstxout-compressed", "pme-order", "gen-seed", "lincs-order", "lincs-iter"]) if (d[k] !== undefined && (!Number.isSafeInteger(Number(d[k])) || Number(d[k]) < 0)) error("MDP_INTEGER", `${k} must be a nonnegative safe integer.`)
  if (!(Number(d.nsteps) > 0)) error("MDP_STEPS", "nsteps must be positive.")
  for (const k of ["rcoulomb", "rvdw", "tau-t", "tau-p", "fourierspacing", "compressibility", "emtol"]) if (d[k] !== undefined && !(Number(d[k]) > 0)) error("MDP_POSITIVE", `${k} must be positive.`)
  if (stage !== "em") {
    if (d.integrator !== "md") error("MDP_INTEGRATOR", "This MD stage requires integrator=md.")
    if (!(Number(d.dt) > 0)) error("MDP_TIMESTEP", "dt must be positive.")
    if (d["tc-grps"] !== "System") error("COUPLING_GROUPS", "Only the explicitly defined System coupling group is supported by this generator.")
    if (expected.temperatureK !== undefined && Number(d["ref-t"]) !== expected.temperatureK) error("TEMPERATURE_MISMATCH", "ref-t differs from the run state.")
    if (stage === "nvt") {
      if (d.pcoupl !== "no") error("NVT_PRESSURE", "NVT requires pcoupl=no.")
      if (d["gen-vel"] !== "yes" || d.continuation !== "no") error("VELOCITY_POLICY", "NVT must initialize velocities after minimization.")
      if (expected.randomSeed !== undefined && Number(d["gen-seed"]) !== expected.randomSeed) error("REPLICA_SEED", "gen-seed differs from the run seed.")
      if (expected.temperatureK !== undefined && Number(d["gen-temp"]) !== expected.temperatureK) error("VELOCITY_TEMPERATURE", "gen-temp differs from the run state.")
    } else {
      if (!d.pcoupl || d.pcoupl === "no") error("NPT_PRESSURE", "Pressure coupling is required for this NPT/production protocol.")
      if (!(Number(d.compressibility) > 0)) error("COMPRESSIBILITY_REQUIRED", "Enter a researched positive isothermal compressibility (bar^-1); no universal value is assumed.")
      if (d["gen-vel"] !== "no" || d.continuation !== "yes") error("CHECKPOINT_POLICY", "Continue velocities/constraints from the preceding checkpoint.")
      if (expected.pressureBar !== undefined && Number(d["ref-p"]) !== expected.pressureBar) error("PRESSURE_MISMATCH", "ref-p differs from the run state.")
    }
    if (Number(d["nstxout-compressed"]) > Number(d.nsteps)) out.push({ severity: "WARNING", code: "FRAME_EXCEEDS_RUN", message: `${stage}: trajectory frame interval exceeds the run duration.` })
  }
  if (d.coulombtype?.toLowerCase() === "pme" && (!(Number(d["fourierspacing"]) > 0) || !Number.isInteger(Number(d["pme-order"])) || Number(d["pme-order"]) < 3)) error("PME_SETTINGS", "PME requires positive spacing and integer order ≥ 3.")
  return out
}

/** GROMACS MDP directives are the authoritative protocol. See manual.gromacs.org/current/user-guide/mdp-options.html.
 * OPLS-AA and ORCA Mulliken are the only implemented parameter/charge pipeline.
 * Overrides are parsed into the same maps used by files and reports; identity-changing overrides fail validation.
 */
export function resolveProtocol(project: ProjectState, run: Pick<RunRecord, "temperatureK" | "pressureBar" | "randomSeed" | "systemKind">): ResolvedSimulationProtocol {
  const p = structuredClone(project.protocol), diagnostics: CompositionDiagnostic[] = []
  const add = (code: string, message: string) => diagnostics.push({ severity: "ERROR", code, message })
  if (p.forceField !== FORCE_FIELD || p.chargeScheme !== CHARGE_SOURCE) add("METHOD_ARTIFACT_MISMATCH", "Only OPLS-AA with ORCA BP86/def2-TZVP Mulliken is implemented. Conflicting force-field/charge metadata blocks export.")
  if (!(run.temperatureK > 0) || !Number.isFinite(run.pressureBar)) add("INVALID_STATE", "Temperature must be positive Kelvin and pressure finite bar.")
  if (!Number.isSafeInteger(run.randomSeed) || run.randomSeed < 1 || run.randomSeed > 2147483647) add("INVALID_SEED", "Replica seed must be an integer from 1 to 2147483647.")
  const pure = run.systemKind === "pure-des"
  const initialNs = pure ? p.production.pureDes.durationNs : p.production.solute.initialNs
  const mode = pure ? "fixed" : p.production.solute.mode
  const maximumNs = mode === "fixed" ? initialNs : p.production.solute.maximumNs
  const extensionNs = mode === "fixed" ? 0 : p.production.solute.extensionNs
  if (!(initialNs > 0) || !(maximumNs >= initialNs) || (mode !== "fixed" && !(extensionNs > 0))) add("PRODUCTION_PLAN", "Production requires initial > 0, maximum ≥ initial, and positive extension for manual convergence-controlled runs.")
  const nb: Record<string, string | number> = { "cutoff-scheme": "Verlet", "coulombtype": p.nonbonded.coulombMethod, rcoulomb: p.nonbonded.cutoffNm, rvdw: p.nonbonded.cutoffNm, pbc: "xyz" }
  if (p.nonbonded.coulombMethod === "PME") Object.assign(nb, { "pme-order": p.nonbonded.pmeOrder, fourierspacing: p.nonbonded.fourierSpacingNm })
  const stages = {} as ResolvedSimulationProtocol["stages"]
  for (const stage of STAGES) {
    const dtFs = stage === "nvt" ? p.nvt.timestepFs : stage === "npt" ? p.npt.timestepFs : p.production.timestepFs
    const duration = stage === "em" ? null : stage === "nvt" ? p.nvt.durationNs : stage === "npt" ? p.npt.durationNs : initialNs
    const steps = duration === null ? p.em.maxSteps : duration * 1e6 / dtFs
    if (!Number.isSafeInteger(Math.round(steps)) || steps <= 0 || Math.abs(steps - Math.round(steps)) > 1e-6) add("STEP_CALCULATION", `${stage}: duration/timestep must produce a positive integral step count.`)
    const base: Record<string, string | number> = { ...nb, integrator: stage === "em" ? p.em.method : "md", nsteps: Math.round(steps) }
    if (stage === "em") Object.assign(base, { emtol: p.em.fmax, constraints: "none" })
    else {
      Object.assign(base, { dt: dtFs / 1000, tcoupl: p.nvt.thermostat, "tc-grps": "System", "tau-t": p.nvt.tauTPs, "ref-t": run.temperatureK, constraints: p.constraints, "constraint-algorithm": p.constraintAlgorithm, "gen-vel": stage === "nvt" ? "yes" : "no", continuation: stage === "nvt" ? "no" : "yes", "ld-seed": run.randomSeed })
      if (stage === "nvt") Object.assign(base, { pcoupl: "no", "gen-temp": run.temperatureK, "gen-seed": run.randomSeed })
      else { Object.assign(base, { pcoupl: p.npt.barostat, pcoupltype: "isotropic", "tau-p": p.npt.tauPPs, "ref-p": run.pressureBar }); if (p.npt.compressibilityBarInverse !== null) base.compressibility = p.npt.compressibilityBarInverse }
      const frameSteps = p.production.framePs * 1000 / dtFs
      if (!Number.isSafeInteger(Math.round(frameSteps)) || frameSteps < 1 || Math.abs(frameSteps - Math.round(frameSteps)) > 1e-6) add("OUTPUT_INTERVAL", `${stage}: frame interval must be a positive integral number of timesteps.`)
      base["nstxout-compressed"] = Math.round(frameSteps)
    }
    const override = parseDirectives(p.mdpOverrides?.[stage] ?? "")
    diagnostics.push(...override.diagnostics)
    const directives = { ...Object.fromEntries(Object.entries(base).map(([k, v]) => [k, String(v)])), ...override.directives }
    diagnostics.push(...validateStage(directives, stage, run))
    const actualDuration = stage === "em" ? null : Number(directives.dt) * Number(directives.nsteps) / 1000
    if (duration !== null && actualDuration !== duration) diagnostics.push({ severity: "INFO", code: "DURATION_OVERRIDE", message: `${stage}: resolved duration ${actualDuration} ns replaces requested ${duration} ns; the resolved value is reported.` })
    stages[stage] = { directives, durationNs: actualDuration, mdp: `; SolvForge MD ${SOFTWARE_VERSION}; resolved ${stage}\n${Object.entries(directives).map(([k, v]) => `${k} = ${v}`).join("\n")}\n` }
  }
  const actualInitial = stages.prod.durationNs!
  if (mode === "convergence-controlled" && actualInitial > maximumNs) add("MAXIMUM_EXCEEDED", "Resolved production duration exceeds the convergence-controlled maximum.")
  return { id: `protocol-${fingerprint(JSON.stringify({ projectId: project.projectId, stages, p, run }))}`, projectId: project.projectId, softwareVersion: SOFTWARE_VERSION, forceField: p.forceField, chargeSource: p.chargeScheme, topologyInclude: FORCE_FIELD_INCLUDE, temperatureK: run.temperatureK, pressureBar: run.pressureBar, randomSeed: run.randomSeed, velocityPolicy: "generate-nvt-continue-checkpoints", systemKind: pure ? "pure-des" : "solute", production: { mode, initialNs: actualInitial, maximumNs: mode === "fixed" ? actualInitial : maximumNs, extensionNs, execution: "external-manual" }, stages, diagnostics, inputSettings: p }
}

export function continuationPlan(protocol: ResolvedSimulationProtocol, completedNs: number, convergence: "pending" | "accepted" | "rejected") {
  const p = protocol.production
  if (protocol.diagnostics.some((d) => d.severity === "ERROR")) throw new Error("Resolve protocol errors before continuation.")
  if (!Number.isFinite(completedNs) || completedNs < p.initialNs || completedNs > p.maximumNs) throw new Error("Completed production time must be within the resolved production plan.")
  if (p.mode === "fixed" || convergence === "accepted" || completedNs >= p.maximumNs) return { stop: true, nextEndNs: completedNs, commands: "# Stop: fixed duration, researcher-accepted convergence, or maximum duration reached.\n" }
  const nextEndNs = Math.min(completedNs + p.extensionNs, p.maximumNs)
  return { stop: false, nextEndNs, commands: `# External manual continuation. Verify completed time from the log/checkpoint.\n# Do not run this extension after researcher acceptance or beyond ${p.maximumNs} ns.\ngmx convert-tpr -s 04_prod/prod.tpr -until ${nextEndNs * 1000} -o 04_prod/prod_${nextEndNs}ns.tpr\ngmx mdrun -s 04_prod/prod_${nextEndNs}ns.tpr -deffnm 04_prod/prod -cpi 04_prod/prod.cpt -append\n# Re-import block RDFs and record a new convergence decision before another extension.\n` }
}
