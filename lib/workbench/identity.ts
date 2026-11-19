import type { RunRecord, SystemStatePoint } from "./types"
import { sha256Portable } from "./crypto.ts"

export function canonical(value: unknown): string {
  if (value === null) return "null"
  if (typeof value === "number" && !Number.isFinite(value)) throw new Error("Non-finite scientific value")
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`
  if (typeof value === "object") {
    return (
      "{" +
      Object.entries(value as Record<string, unknown>)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
        .join(",") +
      "}"
    )
  }
  return JSON.stringify(value) ?? "null"
}

export function fingerprint(value: unknown) {
  const text = canonical(value)
  let a = 2166136261, b = 2246822507
  for (let i = 0; i < text.length; i++) {
    a = Math.imul(a ^ text.charCodeAt(i), 16777619)
    b = Math.imul(b ^ text.charCodeAt(i), 3266489909)
  }
  return `${(a >>> 0).toString(16).padStart(8, "0")}${(b >>> 0).toString(16).padStart(8, "0")}`
}

export async function sha256(text: string | Uint8Array) {
  const bytes = typeof text === "string" ? new TextEncoder().encode(text) : new Uint8Array(text)
  if (!globalThis.crypto?.subtle) return sha256Portable(bytes)
  const hash = await crypto.subtle.digest("SHA-256", bytes)
  return Array.from(new Uint8Array(hash), (n) => n.toString(16).padStart(2, "0")).join("")
}

export function stateErrors(s?: SystemStatePoint): string[] {
  if (!s) return ["UNKNOWN system state: resolve composition and regenerate run."]
  const errors: string[] = []
  if (!s.projectId || !s.systemId || !s.forceField.trim()) {
    errors.push("Missing project, system, or force-field identity.")
  }
  if (!s.molecularModel) errors.push("Molecular-model definition is unknown; regenerate run.")
  if (!(s.temperatureK > 0) || !Number.isFinite(s.pressureBar)) errors.push("Invalid temperature or pressure.")
  if (!s.boxDimensionsNm || s.boxDimensionsNm.length !== 3 || !s.boxDimensionsNm.every((n) => Number.isFinite(n) && n > 0)) {
    errors.push("Invalid box dimensions.")
  }
  if (!Number.isSafeInteger(s.replica) || s.replica < 1) errors.push("Invalid replica index.")
  if (!s.composition?.length || !s.composition.every((c) => c.moleculeId && Number.isSafeInteger(c.count) && c.count > 0 && c.moleFraction > 0)) {
    errors.push("Invalid molecular composition.")
  } else {
    const total = s.composition.reduce((n, c) => n + c.count, 0)
    if (
      new Set(s.composition.map((c) => c.moleculeId)).size !== s.composition.length ||
      s.composition.some((c) => Math.abs(c.moleFraction - c.count / total) > 1e-12)
    ) {
      errors.push("Inconsistent counts and mole fractions.")
    }
  }
  if (s.soluteId && !s.composition?.some((c) => c.moleculeId === s.soluteId)) {
    errors.push("Solute identity/composition missing.")
  }
  return errors
}

export function runState(run: RunRecord, systemRatio: number[]): SystemStatePoint | undefined {
  if (!run.projectId || !run.totalMoleculeCount || !run.moleFractions || run.components.some((c) => c.count === null)) {
    return undefined
  }
  const factor = run.box.unit === "angstrom" ? 0.1 : 1
  const composition = run.components.map((c) => ({
    moleculeId: c.moleculeId,
    count: c.count!,
    moleFraction: run.moleFractions![c.moleculeId],
  }))
  if (run.soluteId && run.soluteCount > 0) {
    composition.push({ moleculeId: run.soluteId, count: run.soluteCount, moleFraction: run.moleFraction! })
  }
  return {
    molecularModel: canonical({
      molecules: run.molecularSnapshot?.map((m) => ({
        id: m.id,
        formula: m.formula,
        mw: m.molecularWeight,
        formalCharge: m.charge,
        residue: m.residueName,
      })),
      nonbonded: run.resolvedProtocol?.inputSettings.nonbonded,
      constraints: run.resolvedProtocol?.inputSettings.constraints,
    }),
    projectId: run.projectId,
    systemId: run.systemId,
    systemComponents: run.components.map((c, i) => ({ moleculeId: c.moleculeId, ratio: systemRatio[i] ?? 1 })),
    systemKind: run.systemKind,
    soluteId: run.soluteId && run.soluteCount > 0 ? run.soluteId : null,
    composition,
    temperatureK: run.temperatureK,
    pressureBar: run.pressureBar,
    boxDimensionsNm: [run.box.x * factor, run.box.y * factor, run.box.z * factor],
    forceField: run.forceField,
    chargeSource: run.chargeScheme,
    replica: run.replica,
  }
}
