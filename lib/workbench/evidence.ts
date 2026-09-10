import { evaluated } from "./evaluation-scope.ts"
import { uuid } from "./crypto.ts"
import type { ConvergenceDecision, RDFDataset, ResearchDecision, RunRecord, ScientificState } from "./types"
import { canonical, fingerprint, observableId, sha256, stateErrors, stateId } from "./identity.ts"
import { mean, sampleSd, tCritical95, weightedLinearRegression } from "./scientific.ts"
import { analyzeDataset } from "./kbi.ts"
import { SOFTWARE_VERSION } from "./version.ts"

export const emptyRdfMetadata: RDFDataset["metadata"] = { runId: "", desId: "", concentrationId: "", speciesA: "", speciesB: "", temperatureK: null, pressureBar: null, soluteCount: null, composition: "", boxDimensionsNm: "", replica: null, trajectoryStartNs: null, trajectoryEndNs: null, simulationDurationNs: null, distanceUnit: "", forceField: "unknown", chargeModel: "unknown", rdfSettings: "", softwareVersion: "unknown", notes: "" }
export function analysisInputSignature(d: RDFDataset) {
  return canonical({ inputSnapshotId:d.inputSnapshotId,initializationSeed:d.initializationSeed,rdfSettings:d.metadata.rdfSettings,sourceHash: d.sourceHash ?? null, series: d.seriesIndex ?? null, radius: d.radiusRaw, g: d.g, state: d.scientificState ?? null, observable: d.observable ?? null, trajectory: d.trajectory ?? null, unit: d.metadata.distanceUnit, start: d.metadata.trajectoryStartNs, end: d.metadata.trajectoryEndNs, windowKind: d.windowKind ?? "unknown" })
}
export function invalidateAnalysis(d: RDFDataset, patch: Partial<RDFDataset>): RDFDataset {
  const next = { ...d, ...patch }
  if (d.analysis && analysisInputSignature(next) !== d.analysis.inputSignature) {
    next.analysisHistory = [...(d.analysisHistory ?? []), d.analysis]
    next.analysis = undefined
  }
  return next
}
export async function identifyImportedSource(text: string, existing: RDFDataset[]) {
  const hash = await sha256(text)
  if (existing.some((d) => d.sourceHash === hash)) throw new Error("Duplicate source content detected. Reimporting the same RDF does not create an independent replica; edit the existing mapping instead.")
  return hash
}
export function mapDatasetToRun(dataset: RDFDataset, run: RunRecord, speciesA: string, speciesB: string, observableType: NonNullable<RDFDataset["observable"]>["observableType"]): RDFDataset {
  if (dataset.projectId !== run.projectId || !run.scientificState || stateErrors(run.scientificState).length) throw new Error("Run must belong to this project and contain a resolved complete molecular state.")
  if (!run.scientificState.composition.some((c) => c.moleculeId === speciesA) || !run.scientificState.composition.some((c) => c.moleculeId === speciesB)) throw new Error("Both RDF species must exist in the selected run.")
  const residue = (id: string) => run.molecularSnapshot?.find((m) => m.id === id)?.residueName
  if (!residue(speciesA) || !residue(speciesB)) throw new Error("Run molecular snapshot lacks residue mapping.")
  const select = (id: string) => `${observableType === "molecular-com-rdf" ? "res_com of " : ""}resname "${residue(id)}"`
  const snapshot=run.inputSnapshots?.[0]
  const mappedState={...structuredClone(run.scientificState),...(snapshot?{parameterizationIdentity:parameterizationIdentity(snapshot)}:{})}
  return invalidateAnalysis(dataset, { inputSnapshotId:snapshot?.id,initializationSeed:run.randomSeed, scientificState: mappedState, provenanceStatus: "researcher-mapped", observable: { speciesA, speciesB, observableType, selectionA: select(speciesA), selectionB: select(speciesB), normalization: "gromacs-rdf" }, metadata: { ...dataset.metadata, runId: run.runId, desId: run.desId, speciesA, speciesB, temperatureK: run.temperatureK, pressureBar: run.pressureBar, replica: run.replica, soluteCount: run.soluteCount, composition: JSON.stringify(run.scientificState.composition), boxDimensionsNm: run.scientificState.boxDimensionsNm.join(" × "), forceField: run.forceField, chargeModel: run.chargeScheme, softwareVersion: run.createdWithVersion ?? "unknown" } })
}
export function parameterizationIdentity(snapshot:NonNullable<RunRecord["inputSnapshots"]>[number]){
 return canonical(Object.entries(snapshot.molecularSources as Record<string,Record<string,unknown>>).sort(([a],[b])=>a.localeCompare(b)).map(([id,p])=>({id,atoms:p.atoms,topology:p.topologyText,residue:p.residueName})))
}
/** Actual frozen parameterization, not the currently edited molecule form. */
export function resolvedRunState(run: RunRecord | undefined) {
 if (!run?.scientificState) return undefined
 const snapshot=run.inputSnapshots?.[0]
 return {...run.scientificState,...(snapshot?{parameterizationIdentity:parameterizationIdentity(snapshot)}:{})}
}
export function runMatchesDataset(d:RDFDataset,run?:RunRecord){
 if(!run?.scientificState||!d.scientificState)return false
 const snapshot=run.inputSnapshots?.find(s=>s.id===d.inputSnapshotId)
 return !!snapshot&&d.scientificState.parameterizationIdentity===parameterizationIdentity(snapshot)&&d.initializationSeed===run.randomSeed&&stateId({...d.scientificState,parameterizationIdentity:undefined},{replica:true})===stateId(run.scientificState,{replica:true})
}
export function plateauIssues(d: RDFDataset): string[] {
  return [...evaluated("plateau",d,()=>computePlateauIssues(d))]
}
function computePlateauIssues(d: RDFDataset) {
  const issues = stateErrors(d.scientificState)
  if (!d.projectId || d.projectId !== d.scientificState?.projectId) issues.push("Unresolved project ownership.")
  if (!d.sourceHash || !d.sourceText) issues.push("Original source text/checksum missing.")
  if (!observableId(d.observable)) issues.push("Unknown RDF species/selection identity.")
  if(!d.inputSnapshotId||!d.scientificState?.parameterizationIdentity||!Number.isSafeInteger(d.initializationSeed))issues.push("Generated input ancestry unresolved: freeze a complete Run Input Package and explicitly remap this RDF.")
  if(d.observable?.speciesA===d.observable?.speciesB&&d.scientificState?.composition.find(c=>c.moleculeId===d.observable?.speciesA)?.count===1)issues.push("Self-species molecular RDF requires at least two molecules; a single solute cannot supply Gsolute,solute.")
  const a = d.analysis
  if (!a) return [...issues, "KBI analysis missing."]
  if (a.inputSignature !== analysisInputSignature(d)) issues.push("Analysis is stale after source/mapping changes.")
  if (a.plateauStatus !== "accepted" || a.decision?.classification !== "accepted" || !a.decision.rationale.trim()) issues.push(`Plateau is ${a.plateauStatus}; explicit researcher acceptance required.`)
  if (a.originTreatment === "unmeasured-gap" || !a.originTreatment) issues.push("Contribution from zero to the first measured radius is unresolved.")
  if (!Number.isFinite(a.estimateNm3)) issues.push("Non-finite KBI estimate.")
  // Recalculate from preserved data, units and recorded processing. A stored number
  // is not trustworthy merely because its source signature was copied unchanged.
  try {
    const rebuilt=analyzeDataset(d,{manual:true,startNm:a.plateauStartNm,endNm:a.plateauEndNm,smoothing:a.smoothing,smoothingWindow:a.smoothingWindow,rebinFactor:a.rebinFactor,minWidthNm:0,integrationMethod:a.integrationMethod,originG:a.originG})
    const keys=["estimateNm3","plateauMedianNm3","plateauSdNm3","plateauSlope","plateauVariance","plateauSampleCount","plateauWidthNm","originTreatment","lowerBoundNm","radiusNm","processedG","runningKbiNm3","rawRunningKbiNm3"] as const
    if(keys.some(k=>canonical(a[k])!==canonical(rebuilt[k])))issues.push("Stored KBI quantities disagree with a recalculation from the source and recorded settings.")
  } catch { issues.push("Stored KBI processing cannot be reproduced from the source.") }
  return issues
}
export function decidePlateau(d: RDFDataset, classification: "accepted" | "rejected", rationale: string): RDFDataset {
  if (!d.analysis || !d.projectId || !rationale.trim()) throw new Error("Analysis and a researcher rationale are required.")
  if (d.analysis.inputSignature !== analysisInputSignature(d)) throw new Error("Recalculate after source/state edits before accepting.")
  const decision: ResearchDecision = { id: uuid(), projectId: d.projectId, stateId: stateId(d.scientificState, {replica:true}) ?? "UNKNOWN", sourceIds: [d.id, d.analysis.id!], classification, rationale: rationale.trim(), timestamp: new Date().toISOString(), softwareVersion: SOFTWARE_VERSION, actor: "researcher" }
  return { ...d, analysisHistory: [...(d.analysisHistory ?? []), d.analysis], analysis: { ...d.analysis, plateauStatus: classification, decision } }
}
export function trajectoryKey(d: RDFDataset) {
  const s = stateId(d.scientificState, { replica: true }), o = observableId(d.observable), t = d.trajectory
  if (!s || !o || !t?.id || !t.runId || !t.filename || !/^[0-9a-f]{64}$/i.test(t.sha256) || !(t.actualVolumeNm3 > 0) || !t.volumeSource.trim() || t.runId !== d.metadata.runId) return null
  return canonical({state:s, observable:o, trajectoryId:t.id, hash:t.sha256, runId:t.runId, volume:t.actualVolumeNm3, volumeSource:t.volumeSource})
}
export function blockGroup(selected: RDFDataset | undefined, datasets: RDFDataset[], maxSlope = 0.01, maxSd = 0.1) {
  const key = selected && trajectoryKey(selected)
  if (!key) return { key: null, points: [] as RDFDataset[], issues: ["Select a mapped run/pair with explicit trajectory checksum and measured mean volume."], diagnostics: null }
  const points = datasets.filter((d) => trajectoryKey(d) === key && (d.windowKind === "block" || d.windowKind === "cumulative") && d.analysis?.plateauStatus !== "rejected").sort((a,b)=>(a.metadata.trajectoryEndNs ?? Infinity)-(b.metadata.trajectoryEndNs ?? Infinity))
  const issues: string[]=[]
  if (points.length<3) issues.push("At least three accepted time windows are required for a convergence decision.")
  const kinds=new Set(points.map(d=>d.windowKind));if(kinds.size>1)issues.push("Disjoint blocks and cumulative windows cannot be mixed in one time diagnostic.")
  const hashes=new Set<string>()
  points.forEach((d,i)=>{
    issues.push(...plateauIssues(d).map(e=>`${d.sourceFilename}: ${e}`))
    const start=d.metadata.trajectoryStartNs,end=d.metadata.trajectoryEndNs
    if(start===null||end===null||!Number.isFinite(start)||!Number.isFinite(end)||start<0||end<=start)issues.push("Each time window needs finite start ≥ 0 and end > start.")
    if(hashes.has(`${d.sourceHash}:${d.seriesIndex}`))issues.push("Repeated source cannot be an independent time block.");hashes.add(`${d.sourceHash}:${d.seriesIndex}`)
    if(i>0&&d.windowKind==='block'&&start!==null&&start<(points[i-1].metadata.trajectoryEndNs ?? Infinity))issues.push("Disjoint blocks overlap.")
    if(i>0&&d.windowKind==='cumulative'&&(start!==points[0].metadata.trajectoryStartNs||end!<=points[i-1].metadata.trajectoryEndNs!))issues.push("Cumulative windows must have a common start and strictly increasing end.")
  })
  if (!Number.isFinite(maxSlope)||maxSlope<0||!Number.isFinite(maxSd)||maxSd<0) issues.push("Convergence thresholds must be finite and nonnegative.")
  if(issues.length) return {key,points,issues:[...new Set(issues)],diagnostics:null}
  const fit=weightedLinearRegression(points.map(d=>d.metadata.trajectoryEndNs!),points.map(d=>d.analysis!.estimateNm3)),sd=sampleSd(points.map(d=>d.analysis!.estimateNm3))
  return {key,points,issues,diagnostics:{slopeNm3PerNs:fit.slope,sdNm3:sd,maxSlope,maxSd,recommendation:Math.abs(fit.slope)<=maxSlope&&sd<=maxSd?'possibly-converged':'not-converged',windowKind:points[0].windowKind!}}
}
export function convergenceDecision(selected: RDFDataset, datasets: RDFDataset[], classification: ConvergenceDecision["classification"], rationale: string, maxSlope: number, maxSd: number): ConvergenceDecision {
  const g=blockGroup(selected,datasets,maxSlope,maxSd)
  if(g.issues.length||!g.diagnostics||!rationale.trim())throw new Error(g.issues.join(" ")||"Researcher rationale required.")
  return {id:uuid(),projectId:selected.projectId,stateKey:stateId(selected.scientificState,{replica:true})!,observableId:observableId(selected.observable)!,trajectoryId:g.key!,sourceDatasetIds:g.points.map(d=>d.id),sourceAnalysisIds:g.points.map(d=>d.analysis!.id!),timeWindows:g.points.map(d=>[d.metadata.trajectoryStartNs!,d.metadata.trajectoryEndNs!]),diagnostics:g.diagnostics,classification,rationale,timestamp:new Date().toISOString(),softwareVersion:SOFTWARE_VERSION}
}
export function acceptedConvergence(d: RDFDataset, all: RDFDataset[], scientific: ScientificState) {
  const t=trajectoryKey(d)
  if(!t)return undefined
  const decision=scientific.convergenceDecisions.filter(c=>c.trajectoryId===t&&c.stateKey===stateId(d.scientificState,{replica:true})&&c.observableId===observableId(d.observable)).at(-1)
  if(!decision?.rationale?.trim()||decision?.classification!=="converged-accepted"||!decision.id||!decision.sourceDatasetIds?.length||!decision.sourceAnalysisIds?.length)return undefined
  if(decision.sourceDatasetIds.some((id,i)=>{const x=all.find(v=>v.id===id);return !x||trajectoryKey(x)!==t||plateauIssues(x).length>0||x.analysis?.id!==decision.sourceAnalysisIds![i]}))return undefined
  const group=blockGroup(d,all,decision.diagnostics?.maxSlope,decision.diagnostics?.maxSd)
  if(group.issues.length||canonical(group.diagnostics)!==canonical(decision.diagnostics)||canonical(group.points.map(d=>d.id))!==canonical(decision.sourceDatasetIds)||canonical(group.points.map(d=>[d.metadata.trajectoryStartNs,d.metadata.trajectoryEndNs]))!==canonical(decision.timeWindows))return undefined
  // Evidence window must actually lie inside the converged analyzed trajectory domain.
  const starts=decision.timeWindows?.map(w=>w[0])??[],ends=decision.timeWindows?.map(w=>w[1])??[]
  if(d.metadata.trajectoryStartNs===null||d.metadata.trajectoryEndNs===null||!starts.length||d.metadata.trajectoryStartNs<Math.min(...starts)||d.metadata.trajectoryEndNs>Math.max(...ends))return undefined
  return decision
}
export function replicaGroups(datasets: RDFDataset[], scientific?: ScientificState) {
  const map=new Map<string,RDFDataset[]>()
  for(const d of datasets){const s=stateId(d.scientificState),o=observableId(d.observable);if(!s||!o||!d.replicaRepresentative||plateauIssues(d).length|| (scientific&&!acceptedConvergence(d,datasets,scientific)))continue;const key=canonical({state:s,observable:o});map.set(key,[...(map.get(key)??[]),d])}
  return [...map].map(([key,ds])=>{
    const replicas=ds.map(d=>d.scientificState!.replica),sources=ds.map(d=>`${d.sourceHash}:${d.seriesIndex}`),issues:string[]=[]
    if(new Set(replicas).size!==replicas.length)issues.push("More than one representative selected for the same replica. Choose exactly one; blocks/pairs are not extra replicas.")
    if(new Set(sources).size!==sources.length)issues.push("Duplicate raw source appears under different replica IDs.")
    if(new Set(ds.map(d=>d.initializationSeed)).size!==ds.length)issues.push("Replica initializations reuse the same velocity seed.")
    if(ds.some(d=>!trajectoryKey(d)))issues.push("Trajectory provenance incomplete.")
    const values=ds.map(d=>d.analysis!.estimateNm3),center=mean(values),sd=values.length>1&&!issues.length?sampleSd(values):null,se=sd===null?null:sd/Math.sqrt(values.length),t=se===null?null:tCritical95(values.length-1)
    return {key,label:ds[0].metadata.speciesA+" ↔ "+ds[0].metadata.speciesB,id:`replicas-${fingerprint(key)}`,projectId:ds[0].projectId,scientificState:ds[0].scientificState!,observable:ds[0].observable!,n:issues.length?0:values.length,mean:issues.length?null:center,sd,se,ci95:t===null?null:[center-t*se!,center+t*se!] as [number,number],cv:sd===null||Math.abs(center)<1e-12?null:sd/Math.abs(center),values,sourceDatasetIds:ds.map(d=>d.id),sourceAnalysisIds:ds.map(d=>d.analysis!.id!),replicas,issues,uncertaintyKind:sd===null?'not-estimated':'replica-sem'}
  })
}
