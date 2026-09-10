import type { ObservableIdentity, RunRecord, ScientificStatePoint } from "./types"
import { sha256Portable } from "./crypto.ts"

export function canonical(value: unknown): string {
  if (value === null) return "null"
  if (typeof value === "number" && !Number.isFinite(value)) throw new Error("Non-finite scientific value")
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`
  if (typeof value === "object") return "{" + Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",") + "}"
  return JSON.stringify(value) ?? "null"
}

/** Short labels only. Scientific joins use the complete canonical value, never this fingerprint. */
export function fingerprint(value: unknown) {
  const text = canonical(value)
  let a = 2166136261, b = 2246822507
  for (let i = 0; i < text.length; i++) { a = Math.imul(a ^ text.charCodeAt(i), 16777619); b = Math.imul(b ^ text.charCodeAt(i), 3266489909) }
  return `${(a >>> 0).toString(16).padStart(8, "0")}${(b >>> 0).toString(16).padStart(8, "0")}`
}

export async function sha256(text: string | Uint8Array) {
  const bytes = typeof text === "string" ? new TextEncoder().encode(text) : new Uint8Array(text)
  if(!globalThis.crypto?.subtle)return sha256Portable(bytes)
  const hash = await crypto.subtle.digest("SHA-256", bytes)
  return Array.from(new Uint8Array(hash), (n) => n.toString(16).padStart(2, "0")).join("")
}

export function stateErrors(s?: ScientificStatePoint): string[] {
  if (!s) return ["UNKNOWN scientific state: map the source to a run manifest."]
  const errors: string[] = []
  if (!s.projectId || !s.desId || !s.forceField || !s.chargeSource) errors.push("Missing project, DES, force-field or charge-source identity.")
  if (!s.molecularModel) errors.push("Molecular-model definition is unknown; regenerate or explicitly resolve legacy provenance.")
  if (!(s.temperatureK > 0) || !Number.isFinite(s.pressureBar)) errors.push("Unknown/invalid temperature or pressure.")
  if (!s.boxDimensionsNm || s.boxDimensionsNm.length !== 3 || !s.boxDimensionsNm.every((n) => Number.isFinite(n) && n > 0)) errors.push("Unknown/invalid box dimensions.")
  if (!Number.isSafeInteger(s.replica) || s.replica < 1) errors.push("Unknown/invalid replica ID.")
  if (!s.desComponents?.length || !s.desComponents.every((c) => c.moleculeId && Number.isSafeInteger(c.ratio) && c.ratio > 0)) errors.push("Unknown/invalid molecular DES ratio.")
  if (!s.composition?.length || !s.composition.every((c) => c.moleculeId && Number.isSafeInteger(c.count) && c.count > 0 && c.moleFraction > 0)) errors.push("Unknown/invalid complete molecular composition.")
  else {
    const total = s.composition.reduce((n, c) => n + c.count, 0)
    if (new Set(s.composition.map((c) => c.moleculeId)).size !== s.composition.length || s.composition.some((c) => Math.abs(c.moleFraction - c.count / total) > 1e-12)) errors.push("Inconsistent counts and mole fractions.")
  }
  if (s.systemKind === "solute" && !s.composition?.some((c) => c.moleculeId === s.soluteId)) errors.push("Solute identity/composition missing.")
  if (s.systemKind === "pure-des" && s.soluteId !== null) errors.push("Pure DES must have no solute identity.")
  const cs=s.desComponents?.map(c=>({count:s.composition?.find(x=>x.moleculeId===c.moleculeId)?.count,ratio:c.ratio}))??[]
  if(cs.length&&cs.some(c=>!c.count||Math.abs(c.count/c.ratio-cs[0].count!/cs[0].ratio)>1e-9))errors.push("Actual component counts disagree with the declared DES ratio.")
  return errors
}

export function stateId(s: ScientificStatePoint | undefined, options: { replica?: boolean; finiteSizeFamily?: boolean } = {}) {
  if (stateErrors(s).length || !s) return null
  const { replica, boxDimensionsNm, composition, ...physical } = s
  const normalized = {
    ...physical,
    desComponents: [...s.desComponents].map(c=>({...c,ratio:c.ratio/s.desComponents.reduce((n,x)=>n+x.ratio,0)})).sort((a, b) => a.moleculeId.localeCompare(b.moleculeId)),
    composition: [...composition].sort((a, b) => a.moleculeId.localeCompare(b.moleculeId)).map((c) => options.finiteSizeFamily ? { moleculeId: c.moleculeId, moleFraction: c.moleFraction } : c),
    ...(options.finiteSizeFamily ? { boxAspect: boxDimensionsNm.map(n=>Number((n/Math.cbrt(boxDimensionsNm.reduce((a,b)=>a*b,1))).toPrecision(12))) } : { boxDimensionsNm }),
    ...(options.replica ? { replica } : {}),
  }
  return canonical(normalized)
}

export function observableId(o?: ObservableIdentity) {
  if (!o?.speciesA || !o.speciesB || !o.selectionA || !o.selectionB || !o.observableType || !o.normalization) return null
  const ordered = [{ species: o.speciesA, selection: o.selectionA }, { species: o.speciesB, selection: o.selectionB }].sort((a, b) => canonical(a).localeCompare(canonical(b)))
  return canonical({ pair: ordered, type: o.observableType, normalization: o.normalization })
}

export function runState(run: RunRecord, desRatio: number[]): ScientificStatePoint | undefined {
  if (!run.projectId || !run.totalMoleculeCount || !run.moleFractions || run.components.some((c) => c.count === null)) return undefined
  const factor = run.box.unit === "angstrom" ? 0.1 : 1
  const composition = run.components.map((c) => ({ moleculeId: c.moleculeId, count: c.count!, moleFraction: run.moleFractions![c.moleculeId] }))
  if (run.systemKind !== "pure-des") composition.push({ moleculeId: run.soluteId, count: run.soluteCount, moleFraction: run.moleFraction! })
  return { molecularModel: canonical({molecules:run.molecularSnapshot?.map(m=>({id:m.id,formula:m.formula,mw:m.molecularWeight,formalCharge:m.charge,residue:m.residueName})),nonbonded:run.resolvedProtocol?.inputSettings.nonbonded,constraints:run.resolvedProtocol?.inputSettings.constraints}), projectId: run.projectId, desId: run.desId, desComponents: run.components.map((c, i) => ({ moleculeId: c.moleculeId, ratio: desRatio[i] })), systemKind: run.systemKind ?? "solute", soluteId: run.systemKind === "pure-des" ? null : run.soluteId, composition, temperatureK: run.temperatureK, pressureBar: run.pressureBar, boxDimensionsNm: [run.box.x * factor, run.box.y * factor, run.box.z * factor], forceField: run.forceField, chargeSource: run.chargeScheme, replica: run.replica }
}
