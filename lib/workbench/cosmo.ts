import { withEvidenceEvaluation } from "./evaluation-scope.ts"
import type { ActivityResult,CosmoRecord,ProjectState,RDFDataset,RunRecord,ScientificState } from "./types"
import { canonical } from "./identity.ts"
import { currentActivity,currentInfiniteDilution } from "./thermodynamics.ts"
import { comparisonStatistics } from "./scientific.ts"
import { uuid } from "./crypto.ts"
import { SOFTWARE_VERSION } from "./version.ts"
export function normalizedRatio(components:Array<{moleculeId:string;ratio:number}>){
  if(!components.length||components.some(c=>!c.moleculeId||!Number.isFinite(c.ratio)||c.ratio<=0)||new Set(components.map(c=>c.moleculeId)).size!==components.length)return null
  const sum=components.reduce((n,c)=>n+c.ratio,0)
  return components.map(c=>({moleculeId:c.moleculeId,ratio:c.ratio/sum})).sort((a,b)=>a.moleculeId.localeCompare(b.moleculeId))
}
export function mapCosmoRecord(record:CosmoRecord,project:ProjectState,desId:string,soluteId:string,rationale:string){
  const des=project.desSystems.find(d=>d.id===desId),solute=project.molecules.find(m=>m.id===soluteId)
  const ratios=record.ratio.split(/[:/]/).map(Number)
  if(!des||!solute||!rationale.trim()||ratios.length!==des.componentIds.length||ratios.some(v=>!Number.isFinite(v)||v<=0))throw new Error("Explicit molecular mapping, source ratio in component order, and rationale are required. Missing ratios cannot be inferred.")
  return {...record,mapping:{desComponents:des.componentIds.map((moleculeId,i)=>({moleculeId,ratio:ratios[i]})),soluteId,mappedBy:"researcher" as const,rationale,timestamp:new Date().toISOString()}}
}
export function matchCompatibility(c:CosmoRecord,a:ActivityResult,mode:"same-composition"|"infinite-dilution"){
  const issues:string[]=[]
  if(!c.mapping||!a.seriesIdentity||!c.sourceHash||!c.sourceText)issues.push("AUTOMATIC MATCH DISABLED: molecular mapping or raw provenance missing.")
  if(c.projectId!==a.projectId)issues.push("Project differs.")
  if(!c.mapping||!a.seriesIdentity||canonical(normalizedRatio(c.mapping.desComponents))!==canonical(normalizedRatio(a.seriesIdentity.desComponents)))issues.push("DES components or molar ratio differ / unknown.")
  if(c.mapping?.soluteId!==a.soluteId)issues.push("Solute identity differs / unknown.")
  if(c.temperatureK===null||!Number.isFinite(c.temperatureK)||Math.abs(c.temperatureK-a.temperatureK)>1e-8)issues.push("Temperature differs / unknown.")
  if(c.pressureBar===null||c.pressureBar===undefined||!Number.isFinite(c.pressureBar)||!a.seriesIdentity||Math.abs(c.pressureBar-a.seriesIdentity.pressureBar)>1e-8)issues.push("Pressure differs / unknown.")
  if(!c.compatibilityReview?.standardStateCompatible||!c.compatibilityReview.independentAnchor||!c.compatibilityReview.rationale.trim())issues.push("Review standard-state compatibility and anchor independence before cross-validation.")
  if(a.anchor.type!=="composition")issues.push("Only absolute anchored activities can be compared.")
  if(mode==="same-composition"){
    if(c.composition===null||!Number.isFinite(c.composition)||!a.points.some(p=>Math.abs(p.x-c.composition!)<=1e-12))issues.push("Exact sampled composition is missing; no nearest-composition substitution.")
    if(c.gamma===null||!Number.isFinite(c.gamma)||c.gamma<=0)issues.push("Finite-composition COSMO γ is missing.")
  }else{
    if(c.gammaInfinity===null||!Number.isFinite(c.gammaInfinity)||c.gammaInfinity<=0)issues.push("COSMO γ∞ is missing.")
    if(!currentInfiniteDilution(a))issues.push("MD/KBI infinite-dilution fit is not researcher accepted with reproducible current values.")
  }
  return issues
}
export function cosmoComparisons(science:ScientificState,runs:RunRecord[],datasets:RDFDataset[],mode:"same-composition"|"infinite-dilution"){
 return withEvidenceEvaluation(()=>computeCosmoComparisons(science,runs,datasets,mode))
}
function computeCosmoComparisons(science:ScientificState,runs:RunRecord[],datasets:RDFDataset[],mode:"same-composition"|"infinite-dilution"){
  const rows:Array<{id:string;cosmoId:string;activityId:string;des:string;solute:string;temperatureK:number;pressureBar:number;composition:number|null;quantity:string;cosmo:number;md:number;residual:number;stratum:string}>=[],diagnostics:Array<{cosmoId:string;reasons:string[]}>=[]
  for(const c of science.cosmoRecords){
    const candidates=science.activityResults.filter(a=>currentActivity(a,science,runs,datasets)),matches=candidates.filter(a=>!matchCompatibility(c,a,mode).length)
    if(matches.length!==1){diagnostics.push({cosmoId:c.id,reasons:matches.length>1?["Multiple compatible MD results: reject superseded curves or explicitly resolve the ambiguity."]:candidates.length?[...new Set(candidates.flatMap(a=>matchCompatibility(c,a,mode)))]:["No current accepted MD/KBI activity results."]});continue}
    const a=matches[0],md=mode==="infinite-dilution"?a.infiniteDilution!.gammaInfinity:a.points.find(p=>Math.abs(p.x-c.composition!)<=1e-12)!.gammaAbsolute!,cosmo=mode==="infinite-dilution"?c.gammaInfinity!:c.gamma!
    const stratum=canonical({solute:a.soluteId,temperatureK:a.temperatureK,pressureBar:a.seriesIdentity!.pressureBar,composition:mode==="infinite-dilution"?null:c.composition,quantity:mode})
    rows.push({id:c.id+":"+a.id,cosmoId:c.id,activityId:a.id,des:c.des,solute:a.soluteId,temperatureK:a.temperatureK,pressureBar:a.seriesIdentity!.pressureBar,composition:mode==="infinite-dilution"?null:c.composition,quantity:mode,cosmo,md,residual:md-cosmo,stratum})
  }
  const strata=[...new Set(rows.map(r=>r.stratum))].map(id=>{const group=rows.filter(r=>r.stratum===id);return {id,rows:group,statistics:group.length>=2?comparisonStatistics(group.map(r=>r.cosmo),group.map(r=>r.md)):null}})
  return {mode,rows,diagnostics,strata}
}

export function comparisonSnapshot(science:ScientificState,runs:RunRecord[],datasets:RDFDataset[],mode:"same-composition"|"infinite-dilution") {
 const result=cosmoComparisons(science,runs,datasets,mode)
 if(!science.projectId||!result.rows.length)throw new Error("At least one compatible current comparison is required.")
 const sourceIds=[...new Set(result.rows.flatMap(row=>{const a=science.activityResults.find(a=>a.id===row.activityId)!;return [row.cosmoId,row.activityId,a.decision!.id,...(mode==="infinite-dilution"?[a.infiniteDilution!.decision!.id]:[])]}))]
 return {id:uuid(),projectId:science.projectId,sourceIds,result,timestamp:new Date().toISOString(),softwareVersion:SOFTWARE_VERSION}
}
export function currentComparison(snapshot:NonNullable<ScientificState["comparisons"]>[number],science:ScientificState,runs:RunRecord[],datasets:RDFDataset[]) {
 const result=snapshot.result as ReturnType<typeof cosmoComparisons>
 if(!result||!["same-composition","infinite-dilution"].includes(result.mode))return false
 return canonical(result)===canonical(cosmoComparisons(science,runs,datasets,result.mode))
}
