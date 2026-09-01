import type { DensityPoint, DESSystem, ProjectState } from "./types"

export type DensityReferencePreset = Omit<DensityPoint, "id"> & {
  id: string
  desId: string
  componentIds: string[]
  ratio: number[]
  shortLabel: string
}

const sources = {
  thymol: {
    citation: "Misikov et al., temperature-dependent liquid thymol density",
    url: "https://doi.org/10.1134/S1087659625601200",
  },
  dodecanol: {
    citation: "Pinto et al., J. Chem. Eng. Data (1-dodecanol density)",
    url: "https://doi.org/10.1021/acs.jced.8b00992",
  },
  butanediol: {
    citation: "George & Sastry, J. Chem. Eng. Data (2,3-butanediol density)",
    url: "https://doi.org/10.1021/je0340755",
  },
  lauric: {
    citation: "Rafique et al., J. Chem. Eng. Data (thymol + lauric acid densities)",
    url: "https://doi.org/10.1021/acs.jced.5c00704",
  },
  octanoic: {
    citation: "Vong & Tsai, J. Chem. Eng. Data (octanoic-acid density)",
    url: "https://doi.org/10.1021/je970005k",
  },
}

/**
 * Optional 323.15 K references for the built-in thesis systems.
 *
 * These records are deliberately not inserted into a new project automatically:
 * the researcher must explicitly apply one. Only THY:LAU is based on mixture
 * measurements close enough to interpolate in composition. The other three are
 * transparent ideal/additive-molar-volume screening estimates from pure-component
 * densities and must not be represented as experimental DES densities.
 */
export const THESIS_DENSITY_REFERENCES_323K: DensityReferencePreset[] = [
  {
    id: "rho-ref-thy-dod-32315",
    desId: "thy-dod",
    componentIds: ["thymol", "dodecanol"],
    ratio: [5, 1],
    shortLabel: "50 °C screening estimate",
    label: "Thymol:Dodecanol 5:1 at 323.15 K",
    densityGcm3: 0.9194,
    temperatureK: 323.15,
    status: "estimated",
    derivation: "additive-molar-volume-estimate",
    uncertaintyGcm3: null,
    sourceNote: "Ideal additive-molar-volume estimate at 323.15 K using ρ(thymol)=0.950398 g cm⁻³ and linearly interpolated ρ(1-dodecanol)=0.81255 g cm⁻³. No direct 5:1 mixture-density measurement was located; validate before production use.",
    methodNote: "ρ = (5M_THY + M_DOD) / (5M_THY/ρ_THY + M_DOD/ρ_DOD).",
    sources: [sources.thymol, sources.dodecanol],
  },
  {
    id: "rho-ref-thy-23bd-32315",
    desId: "thy-23bd",
    componentIds: ["thymol", "butanediol-23"],
    ratio: [5, 1],
    shortLabel: "50 °C screening estimate",
    label: "Thymol:2,3-butanediol 5:1 at 323.15 K",
    densityGcm3: 0.9532,
    temperatureK: 323.15,
    status: "estimated",
    derivation: "additive-molar-volume-estimate",
    uncertaintyGcm3: null,
    sourceNote: "Ideal additive-molar-volume estimate at 323.15 K using ρ(thymol)=0.950398 g cm⁻³ and linearly interpolated ρ(2,3-butanediol)=0.977355 g cm⁻³. The 2,3-butanediol stereoisomer was not specified in the thesis preset; verify compatibility with the intended material.",
    methodNote: "ρ = (5M_THY + M_23BD) / (5M_THY/ρ_THY + M_23BD/ρ_23BD).",
    sources: [sources.thymol, sources.butanediol],
  },
  {
    id: "rho-ref-thy-lau-32315",
    desId: "thy-lau",
    componentIds: ["thymol", "lauric-acid"],
    ratio: [5, 1],
    shortLabel: "50 °C literature interpolation",
    label: "Thymol:Lauric acid 5:1 at 323.15 K",
    densityGcm3: 0.9326,
    temperatureK: 323.15,
    status: "literature",
    derivation: "composition-interpolation",
    uncertaintyGcm3: null,
    sourceNote: "Linear composition interpolation at 323.15 K to x_THY=5/6 between reported mixture values ρ=0.9275 g cm⁻³ at x_THY=0.8 and ρ=0.9427 g cm⁻³ at x_THY=0.9. Reported endpoint expanded uncertainty is about 0.003 g cm⁻³; interpolation uncertainty is not quantified.",
    methodNote: "ρ(x=5/6) = ρ(0.8) + [(5/6−0.8)/(0.9−0.8)]·[ρ(0.9)−ρ(0.8)].",
    sources: [sources.lauric],
  },
  {
    id: "rho-ref-thy-oct-32315",
    desId: "thy-oct",
    componentIds: ["thymol", "octanoic-acid"],
    ratio: [5, 1],
    shortLabel: "50 °C screening estimate",
    label: "Thymol:Octanoic acid 5:1 at 323.15 K",
    densityGcm3: 0.9394,
    temperatureK: 323.15,
    status: "estimated",
    derivation: "additive-molar-volume-estimate",
    uncertaintyGcm3: null,
    sourceNote: "Ideal additive-molar-volume estimate at 323.15 K using ρ(thymol)=0.950398 g cm⁻³ and ρ(octanoic acid)≈0.88590 g cm⁻³. Published thymol–octanoic-acid data at other compositions were not treated as a direct 5:1 measurement.",
    methodNote: "ρ = (5M_THY + M_OCT) / (5M_THY/ρ_THY + M_OCT/ρ_OCT).",
    sources: [sources.thymol, sources.octanoic],
  },
]

function sameVector(a: Array<string | number>, b: Array<string | number>) {
  return a.length === b.length && a.every((value, index) => value === b[index])
}

export function compatibleDensityReferences(system: DESSystem | undefined) {
  if (!system) return []
  return THESIS_DENSITY_REFERENCES_323K.filter((reference) =>
    reference.desId === system.id &&
    sameVector(reference.componentIds, system.componentIds) &&
    sameVector(reference.ratio, system.ratio),
  )
}

export function densityPointFromReference(reference: DensityReferencePreset): DensityPoint {
  return structuredClone({
    id: reference.id,
    label: reference.label,
    densityGcm3: reference.densityGcm3,
    temperatureK: reference.temperatureK,
    status: reference.status,
    sourceNote: reference.sourceNote,
    referenceId: reference.id,
    derivation: reference.derivation,
    uncertaintyGcm3: reference.uncertaintyGcm3,
    methodNote: reference.methodNote,
    sources: reference.sources,
  })
}

export function applyDensityReference(project: ProjectState, reference: DensityReferencePreset): ProjectState {
  return {
    ...project,
    desSystems: project.desSystems.map((system) => {
      if (system.id !== reference.desId || !sameVector(system.componentIds, reference.componentIds) || !sameVector(system.ratio, reference.ratio)) return system
      const point = densityPointFromReference(reference)
      const retained = system.compositionSettings.densityPoints.filter((item) => item.referenceId !== reference.id && item.id !== reference.id)
      return {
        ...system,
        compositionSettings: {
          ...system.compositionSettings,
          densityPoints: [...retained, point],
        },
      }
    }),
  }
}

export function applyAllCompatibleThesisDensityReferences(project: ProjectState): ProjectState {
  return THESIS_DENSITY_REFERENCES_323K.reduce((next, reference) => applyDensityReference(next, reference), project)
}
