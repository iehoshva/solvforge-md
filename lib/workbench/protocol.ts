import type { CompositionDiagnostic, ProjectState, ResolvedSimulationProtocol, RunRecord } from "./types"
import { SOFTWARE_VERSION } from "./version.ts"
import { fingerprint } from "./identity.ts"

export type Stage = "em" | "nvt" | "npt" | "prod"
export const STAGES: Stage[] = ["em", "nvt", "npt", "prod"]

/** Known GROMACS values for helpful soft warnings (never hard-blocks custom/newer GROMACS keywords). */
export const KNOWN_MDP_VALUES: Record<string, string[]> = {
  integrator: ["steep", "cg", "l-bfgs", "md", "md-vv", "md-vv-avek", "sd", "bd", "nm", "tpi", "tpic", "mimic"],
  constraints: ["none", "h-bonds", "all-bonds", "h-angles", "all-angles"],
  "constraint-algorithm": ["lincs", "shake"],
  tcoupl: ["no", "v-rescale", "nose-hoover", "berendsen", "andersen", "andersen-massive"],
  pcoupl: ["no", "c-rescale", "parrinello-rahman", "berendsen", "mttk"],
  pcoupltype: ["isotropic", "semiisotropic", "anisotropic", "surface-tension"],
  coulombtype: ["pme", "cut-off", "reaction-field", "pme-switch", "p3m-ad", "ewald", "user"],
  vdwtype: ["cut-off", "pme", "shift", "switch", "user"],
  "vdw-modifier": ["potential-shift-verlet", "potential-shift", "none", "force-switch", "potential-switch"],
  dispcorr: ["no", "enerpres", "ener"],
  "cutoff-scheme": ["verlet", "group"],
  "gen-vel": ["yes", "no"],
  continuation: ["yes", "no"],
}

const key = (s: string) => s.trim().toLowerCase().replaceAll("_", "-")

export function parseDirectives(text: string) {
  const directives: Record<string, string> = {}
  const diagnostics: CompositionDiagnostic[] = []
  text.split(/\r?\n/).forEach((line, i) => {
    const plain = line.split(";")[0].trim()
    if (!plain) return
    const m = plain.match(/^([^=\s]+)\s*=\s*(.+)$/)
    if (!m) {
      diagnostics.push({ severity: "ERROR", code: "MDP_SYNTAX", message: `Malformed MDP line ${i + 1}: "${plain}".` })
      return
    }
    const k = key(m[1])
    if (k in directives) {
      diagnostics.push({ severity: "ERROR", code: "DUPLICATE_DIRECTIVE", message: `Duplicate directive '${k}' at line ${i + 1}.` })
    }
    directives[k] = m[2].trim()
  })
  return { directives, diagnostics }
}

const NUMERIC_LIST_DIRECTIVES =
  /^(dt|nsteps|emtol|emstep|ref-t|ref-p|tau-t|tau-p|compressibility|rcoulomb|rvdw|rlist|rvdw-switch|rcoulomb-switch|fourierspacing|pme-order|gen-temp|gen-seed|ld-seed|nst.*|lincs-order|lincs-iter|verlet-buffer-tolerance|init-step|tinit)$/

const POSITIVE_SCALAR_DIRECTIVES = ["rcoulomb", "rvdw", "fourierspacing", "emtol", "emstep"]
const NONNEGATIVE_INT_DIRECTIVES = ["nsteps", "nstxout-compressed", "nstxout", "nstvout", "nstenergy", "nstlog", "pme-order", "gen-seed", "lincs-order", "lincs-iter"]

export function validateStage(
  d: Record<string, string>,
  stage: Stage,
  expected: { temperatureK?: number; pressureBar?: number; randomSeed?: number } = {},
): CompositionDiagnostic[] {
  const out: CompositionDiagnostic[] = []
  const error = (code: string, message: string) => out.push({ severity: "ERROR", code, message: `${stage}: ${message}` })
  const warn = (code: string, message: string) => out.push({ severity: "WARNING", code, message: `${stage}: ${message}` })

  for (const [k, options] of Object.entries(KNOWN_MDP_VALUES)) {
    if (d[k] !== undefined && !options.includes(d[k].toLowerCase())) {
      warn("UNCOMMON_MDP_VALUE", `${k}=${d[k]} is not in the standard preset list (${options.join(", ")}); verify compatibility with your GROMACS version.`)
    }
  }

  for (const [k, v] of Object.entries(d)) {
    if (NUMERIC_LIST_DIRECTIVES.test(k)) {
      const tokens = v.split(/\s+/).filter(Boolean)
      if (!tokens.length || !tokens.every((s) => /^[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?$/i.test(s) && Number.isFinite(Number(s)))) {
        error("MDP_NUMBER", `Malformed numeric directive ${k}=${v}.`)
      }
    }
  }

  for (const k of NONNEGATIVE_INT_DIRECTIVES) {
    if (d[k] !== undefined) {
      const n = Number(d[k])
      if (!Number.isSafeInteger(n) || n < 0) error("MDP_INTEGER", `${k} must be a non-negative safe integer.`)
    }
  }

  if (!(Number(d.nsteps) > 0)) error("MDP_STEPS", "nsteps must be positive.")

  for (const k of POSITIVE_SCALAR_DIRECTIVES) {
    if (d[k] !== undefined && !(Number(d[k]) > 0)) error("MDP_POSITIVE", `${k} must be positive.`)
  }

  if (stage !== "em") {
    if (!(Number(d.dt) > 0)) error("MDP_TIMESTEP", "dt must be positive.")
    const tcGroups = (d["tc-grps"] ?? "").trim().split(/\s+/).filter(Boolean)
    const tcoupl = (d.tcoupl ?? "no").toLowerCase()
    if (tcoupl !== "no") {
      if (!tcGroups.length) error("TC_GRPS_MISSING", "tc-grps is required when tcoupl is enabled.")
      const refTs = (d["ref-t"] ?? "").trim().split(/\s+/).filter(Boolean).map(Number)
      const tauTs = (d["tau-t"] ?? "").trim().split(/\s+/).filter(Boolean).map(Number)
      if (tcGroups.length && refTs.length !== tcGroups.length) {
        error("TC_GROUP_COUNT_MISMATCH", `ref-t has ${refTs.length} value(s) but tc-grps specifies ${tcGroups.length} group(s).`)
      }
      if (tcGroups.length && tauTs.length !== tcGroups.length) {
        error("TAU_T_COUNT_MISMATCH", `tau-t has ${tauTs.length} value(s) but tc-grps specifies ${tcGroups.length} group(s).`)
      }
      if (tauTs.some((v) => !(v > 0))) error("MDP_POSITIVE", "tau-t values must be positive.")
      if (expected.temperatureK !== undefined && refTs.length && refTs.every((t) => Math.abs(t - expected.temperatureK!) > 1e-6)) {
        warn("TEMPERATURE_OVERRIDE", `ref-t (${d["ref-t"]} K) differs from run state temperature (${expected.temperatureK} K).`)
      }
    }

    const pcoupl = (d.pcoupl ?? "no").toLowerCase()
    if (pcoupl !== "no") {
      const compTokens = (d.compressibility ?? "").trim().split(/\s+/).filter(Boolean).map(Number)
      if (!compTokens.length || compTokens.some((v) => !Number.isFinite(v) || v < 0) || compTokens.every((v) => v === 0)) {
        error("COMPRESSIBILITY_REQUIRED", "Enter a positive isothermal compressibility (bar^-1) when pressure coupling is enabled.")
      }
      const tauP = Number(d["tau-p"])
      if (!(tauP > 0)) error("MDP_POSITIVE", "tau-p must be positive when pcoupl is enabled.")
      const refPs = (d["ref-p"] ?? "").trim().split(/\s+/).filter(Boolean).map(Number)
      if (!refPs.length || refPs.some((v) => !Number.isFinite(v))) {
        error("MDP_NUMBER", "ref-p must contain valid finite pressure value(s).")
      } else if (expected.pressureBar !== undefined && refPs.every((p) => Math.abs(p - expected.pressureBar!) > 1e-6)) {
        warn("PRESSURE_OVERRIDE", `ref-p (${d["ref-p"]} bar) differs from run state pressure (${expected.pressureBar} bar).`)
      }
    }

    if (d["gen-vel"]?.toLowerCase() === "yes" && d.continuation?.toLowerCase() === "yes") {
      error("VELOCITY_CONFLICT", "gen-vel=yes conflicts with continuation=yes in GROMACS.")
    }

    if (Number(d["nstxout-compressed"]) > Number(d.nsteps) && Number(d.nsteps) > 0) {
      warn("FRAME_EXCEEDS_RUN", "Trajectory output interval exceeds total run steps.")
    }
    if (Number(d.dt) > 0.004) {
      warn("UNUSUAL_TIMESTEP", `dt=${d.dt} ps is > 4 fs; confirm constraints/HMR compatibility.`)
    }
  }

  if (d.coulombtype?.toLowerCase().startsWith("pme")) {
    if (!(Number(d.fourierspacing) > 0) || !Number.isInteger(Number(d["pme-order"])) || Number(d["pme-order"]) < 3) {
      error("PME_SETTINGS", "PME requires positive fourierspacing and integer pme-order ≥ 3.")
    }
  }

  return out
}

function repeatForGroups(value: string | number, groupCount: number) {
  const tokens = String(value).trim().split(/\s+/).filter(Boolean)
  if (tokens.length === groupCount) return tokens.join(" ")
  if (tokens.length === 1 && groupCount > 1) return Array(groupCount).fill(tokens[0]).join(" ")
  return String(value).trim()
}

function pressureValuesForType(value: string | number, pcoupltype: string) {
  const tokens = String(value).trim().split(/\s+/).filter(Boolean)
  const lower = pcoupltype.toLowerCase()
  if (lower === "semiisotropic" && tokens.length === 1) return `${tokens[0]} ${tokens[0]}`
  if (lower === "anisotropic" && tokens.length === 1) return `${tokens[0]} ${tokens[0]} ${tokens[0]} 0 0 0`
  return tokens.join(" ")
}

export function resolveProtocol(
  project: ProjectState,
  run: Pick<RunRecord, "temperatureK" | "pressureBar" | "randomSeed">,
): ResolvedSimulationProtocol {
  const p = structuredClone(project.protocol)
  const diagnostics: CompositionDiagnostic[] = []
  const addError = (code: string, message: string) => diagnostics.push({ severity: "ERROR", code, message })

  if (!p.forceField.trim()) addError("FORCE_FIELD_REQUIRED", "Specify a force-field label (e.g. OPLS-AA, GAFF2, CHARMM36, AMBER, Custom).")
  if (!(run.temperatureK > 0) || !Number.isFinite(run.pressureBar)) addError("INVALID_STATE", "Temperature must be positive Kelvin and pressure finite bar.")
  if (!Number.isSafeInteger(run.randomSeed) || run.randomSeed < 1 || run.randomSeed > 2147483647) {
    addError("INVALID_SEED", "Replica seed must be an integer from 1 to 2147483647.")
  }

  const enabled = p.enabledStages ?? { em: true, nvt: true, npt: true, prod: true }
  if (!Object.values(enabled).some(Boolean)) addError("NO_STAGES_ENABLED", "Enable at least one GROMACS stage (EM, NVT, NPT, or Production).")

  const initialNs = p.production.initialNs
  const mode = p.production.mode
  const maximumNs = mode === "fixed" ? initialNs : p.production.maximumNs
  const extensionNs = mode === "fixed" ? 0 : p.production.extensionNs
  if (enabled.prod && (!(initialNs > 0) || !(maximumNs >= initialNs) || (mode !== "fixed" && !(extensionNs > 0)))) {
    addError("PRODUCTION_PLAN", "Production requires initial > 0, maximum ≥ initial, and positive extension for convergence-controlled runs.")
  }

  const nb: Record<string, string | number> = {
    "cutoff-scheme": p.nonbonded.cutoffScheme || "Verlet",
    coulombtype: p.nonbonded.coulombMethod || "PME",
    rcoulomb: p.nonbonded.rcoulombNm,
    vdwtype: p.nonbonded.vdwType || "Cut-off",
    rvdw: p.nonbonded.rvdwNm,
    pbc: "xyz",
  }
  if (p.nonbonded.vdwModifier && p.nonbonded.vdwModifier !== "None") nb["vdw-modifier"] = p.nonbonded.vdwModifier
  if (p.nonbonded.dispCorr && p.nonbonded.dispCorr !== "no") nb.dispcorr = p.nonbonded.dispCorr
  if ((p.nonbonded.coulombMethod || "").toLowerCase().startsWith("pme")) {
    nb["pme-order"] = p.nonbonded.pmeOrder
    nb.fourierspacing = p.nonbonded.fourierSpacingNm
  }

  // First dynamic stage generates velocities; subsequent dynamic stages continue from checkpoint
  const firstDynStage = (["nvt", "npt", "prod"] as const).find((s) => enabled[s])
  const tcGrps = (p.nvt.tcGrps || "System").trim()
  const tcCount = Math.max(1, tcGrps.split(/\s+/).filter(Boolean).length)

  const stages = {} as ResolvedSimulationProtocol["stages"]
  for (const stage of STAGES) {
    const isEnabled = Boolean(enabled[stage])
    const dtFs = stage === "nvt" ? p.nvt.timestepFs : stage === "npt" ? p.npt.timestepFs : p.production.timestepFs
    const duration = stage === "em" ? null : stage === "nvt" ? p.nvt.durationNs : stage === "npt" ? p.npt.durationNs : initialNs
    const steps = duration === null ? p.em.maxSteps : (duration * 1e6) / dtFs

    if (isEnabled && (!Number.isSafeInteger(Math.round(steps)) || steps <= 0 || Math.abs(steps - Math.round(steps)) > 1e-6)) {
      addError("STEP_CALCULATION", `${stage}: duration/timestep must produce a positive integral step count.`)
    }

    const base: Record<string, string | number> = {
      ...nb,
      integrator: stage === "em" ? p.em.method || "steep" : "md",
      nsteps: Math.max(1, Math.round(steps || 1)),
    }

    if (stage === "em") {
      base.emtol = p.em.fmax
      base.emstep = p.em.emstep ?? 0.01
      base.constraints = "none"
    } else {
      const generatesVelocities = stage === firstDynStage
      base.dt = dtFs / 1000
      base.tcoupl = p.nvt.thermostat || "V-rescale"
      if (String(base.tcoupl).toLowerCase() !== "no") {
        base["tc-grps"] = tcGrps
        base["tau-t"] = repeatForGroups(p.nvt.tauTPs, tcCount)
        base["ref-t"] = repeatForGroups(run.temperatureK, tcCount)
      }
      base.constraints = p.constraints || "h-bonds"
      if (base.constraints !== "none") base["constraint-algorithm"] = p.constraintAlgorithm || "lincs"
      base["gen-vel"] = generatesVelocities ? "yes" : "no"
      base.continuation = generatesVelocities ? "no" : "yes"
      base["ld-seed"] = run.randomSeed
      if (generatesVelocities) {
        base["gen-temp"] = run.temperatureK
        base["gen-seed"] = run.randomSeed
      }

      const useBarostat = stage === "npt" || (stage === "prod" && p.production.ensemble === "NPT")
      if (!useBarostat || (p.npt.barostat || "no").toLowerCase() === "no") {
        base.pcoupl = "no"
      } else {
        const pcoupltype = p.npt.pcoupltype || "isotropic"
        base.pcoupl = p.npt.barostat
        base.pcoupltype = pcoupltype
        base["tau-p"] = p.npt.tauPPs
        base["ref-p"] = pressureValuesForType(run.pressureBar, pcoupltype)
        if (p.npt.compressibility.trim()) {
          base.compressibility = pressureValuesForType(p.npt.compressibility, pcoupltype)
        }
      }

      const frameSteps = (p.production.framePs * 1000) / dtFs
      const energySteps = ((p.production.energyPs || p.production.framePs) * 1000) / dtFs
      if (isEnabled && (!Number.isSafeInteger(Math.round(frameSteps)) || frameSteps < 1 || Math.abs(frameSteps - Math.round(frameSteps)) > 1e-6)) {
        addError("OUTPUT_INTERVAL", `${stage}: trajectory frame interval must be a positive integral multiple of timestep.`)
      }
      base["nstxout-compressed"] = Math.max(1, Math.round(frameSteps || 1))
      base.nstenergy = Math.max(1, Math.round(energySteps || frameSteps || 1))
      base.nstlog = Math.max(1, Math.round(energySteps || frameSteps || 1))
    }

    const override = parseDirectives(p.mdpOverrides?.[stage] ?? "")
    if (isEnabled) diagnostics.push(...override.diagnostics)
    const directives = { ...Object.fromEntries(Object.entries(base).map(([k, v]) => [k, String(v)])), ...override.directives }
    if (isEnabled) diagnostics.push(...validateStage(directives, stage, run))

    const actualDuration = stage === "em" ? null : (Number(directives.dt) * Number(directives.nsteps)) / 1000
    if (isEnabled && duration !== null && actualDuration !== null && Math.abs(actualDuration - duration) > 1e-9) {
      diagnostics.push({
        severity: "INFO",
        code: "DURATION_OVERRIDE",
        message: `${stage}: resolved duration ${actualDuration} ns replaces form value ${duration} ns.`,
      })
    }

    stages[stage] = {
      enabled: isEnabled,
      directives,
      durationNs: actualDuration,
      mdp: `; SolvForge MD ${SOFTWARE_VERSION} — ${p.forceField} (${p.chargeScheme || "custom charges"}) — ${stage}\n${Object.entries(directives)
        .map(([k, v]) => `${k} = ${v}`)
        .join("\n")}\n`,
    }
  }

  const actualInitial = enabled.prod ? (stages.prod.durationNs ?? initialNs) : 0
  if (enabled.prod && mode === "convergence-controlled" && actualInitial > maximumNs) {
    addError("MAXIMUM_EXCEEDED", "Resolved production duration exceeds the configured maximum.")
  }

  return {
    id: `protocol-${fingerprint(JSON.stringify({ projectId: project.projectId, stages, p, run }))}`,
    projectId: project.projectId,
    softwareVersion: SOFTWARE_VERSION,
    forceField: p.forceField,
    forceFieldInclude: p.forceFieldInclude,
    defaultsSection: p.defaultsSection,
    chargeSource: p.chargeScheme,
    qmSoftware: p.qmSoftware,
    qmMethodBasis: p.qmMethodBasis,
    temperatureK: run.temperatureK,
    pressureBar: run.pressureBar,
    randomSeed: run.randomSeed,
    enabledStages: { ...enabled },
    production: {
      ensemble: p.production.ensemble,
      mode,
      initialNs: actualInitial,
      maximumNs: mode === "fixed" ? actualInitial : maximumNs,
      extensionNs,
      execution: "external-manual",
    },
    stages,
    diagnostics,
    inputSettings: p,
  }
}

export function continuationPlan(
  protocol: ResolvedSimulationProtocol,
  completedNs: number,
  status: "pending" | "accepted" | "rejected",
) {
  const p = protocol.production
  if (protocol.diagnostics.some((d) => d.severity === "ERROR")) throw new Error("Resolve protocol errors before continuation.")
  if (!Number.isFinite(completedNs) || completedNs < 0 || completedNs > p.maximumNs) {
    throw new Error("Completed production time must be within [0, maximumNs].")
  }
  if (p.mode === "fixed" || status === "accepted" || completedNs >= p.maximumNs) {
    return {
      stop: true,
      nextEndNs: completedNs,
      commands: "# Stop: fixed duration, researcher-accepted completion, or maximum duration reached.\n",
    }
  }
  const nextEndNs = Math.min(completedNs + p.extensionNs, p.maximumNs)
  return {
    stop: false,
    nextEndNs,
    commands: `# External manual continuation from checkpoint (bounded at ${p.maximumNs} ns).\ngmx convert-tpr -s 04_prod/prod.tpr -until ${nextEndNs * 1000} -o 04_prod/prod_${nextEndNs}ns.tpr\ngmx mdrun -s 04_prod/prod_${nextEndNs}ns.tpr -deffnm 04_prod/prod -cpi 04_prod/prod.cpt -append\n`,
  }
}
