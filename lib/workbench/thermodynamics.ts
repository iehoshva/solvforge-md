import { uuid } from "./crypto.ts"
import type { ActivityResult, ProjectState, RDFDataset, RunRecord, ScientificState, ScientificStatePoint, ThermodynamicResult } from "./types"
import {decisionMatches} from "./decisions.ts"
import { canonical, stateId } from "./identity.ts"
import { acceptedConvergence, analysisInputSignature, plateauIssues, replicaGroups, runMatchesDataset } from "./evidence.ts"
import { currentSsmFit } from "./finite-size.ts"
import { buildThermodynamicResult, integrateActivity, mean, quantile, sampleSd, extrapolateInfiniteDilution, propagateTernaryUncertainty,ternaryThermodynamicFactor,seededRandom } from "./scientific.ts"
import { SOFTWARE_VERSION } from "./version.ts"

export const pairs3 = [[0,0],[0,1],[0,2],[1,1],[1,2],[2,2]]
export const pairId=(a:string,b:string)=>canonical([a,b].sort())
export function ternarySpecies(s?:ScientificStatePoint) {
  if(!stateId(s)||!s||s.systemKind!=="solute"||s.desComponents.length!==2||s.composition.length!==3)throw new Error("An exact solute + two molecular DES components state is required.")
  return [s.soluteId!,...s.desComponents.map(c=>c.moleculeId)]
}
export function matrixOptions(s:ScientificStatePoint,science:ScientificState,runs:RunRecord[],datasets:RDFDataset[]) {
  const options: NonNullable<ThermodynamicResult["matrixTerms"]>=[]
  for(const f of science.ssmFits){
    if(f.familyId!==stateId(s,{finiteSizeFamily:true})||!currentSsmFit(f,science,runs,datasets))continue
    const point=science.ssmPoints.find(p=>p.id===f.pointIds[0])!
    options.push({pair:[point.speciesA,point.speciesB],sourceId:f.id,kind:"ssm",value:f.gInfinityNm3,uncertainty:f.gInfinitySe,datasetIds:f.sourceDatasetIds!})
  }
  for(const g of replicaGroups(datasets,science)){
    if(stateId(g.scientificState)!==stateId(s)||g.observable.observableType!=="molecular-com-rdf"||g.issues.length||g.mean===null)continue
    const sources=g.sourceDatasetIds.map(id=>datasets.find(d=>d.id===id)!)
    const rs=sources.map(d=>runs.find(r=>r.runId===d.metadata.runId&&r.projectId===s.projectId))
    if(rs.some((r,i)=>!r||!runMatchesDataset(sources[i],r))||new Set(rs.map(r=>r!.randomSeed)).size!==rs.length)continue
    options.push({pair:[g.observable.speciesA,g.observable.speciesB],sourceId:g.id,kind:"replicas",value:g.mean,uncertainty:g.se,datasetIds:g.sourceDatasetIds})
  }
  return options
}
function sourceSignature(terms:NonNullable<ThermodynamicResult["matrixTerms"]>,density:RDFDataset,datasets:RDFDataset[],science:ScientificState){
  const ids=[...new Set(terms.flatMap(t=>t.datasetIds).concat(density.id))]
  return canonical({terms,density:analysisInputSignature(density),parents:ids.map(id=>{const d=datasets.find(d=>d.id===id);return {id,analysis:d?.analysis,convergence:d?acceptedConvergence(d,datasets,science):undefined}}),fits:terms.filter(t=>t.kind==="ssm").map(t=>science.ssmFits.find(f=>f.id===t.sourceId))})
}
export function calculateThermodynamics(project:ProjectState,run:RunRecord,selection:Record<string,string>,densitySourceId:string,science:ScientificState,runs:RunRecord[],datasets:RDFDataset[],overrideReason="",covariance?:number[][]):ThermodynamicResult {
  const density=datasets.find(d=>d.id===densitySourceId)
  if(!density||!runMatchesDataset(density,run))throw new Error("Density source must map to exact generated run inputs.")
  const s=density.scientificState,species=ternarySpecies(s)
  if(run.projectId!==project.projectId||!run.resolvedProtocol)throw new Error("Resolved run in this project required.")
  const options=matrixOptions(s!,science,runs,datasets),terms=pairs3.map(([i,j])=>{
    const key=pairId(species[i],species[j]),t=options.find(o=>o.sourceId===selection[key]&&pairId(...o.pair)===key)
    if(!t)throw new Error("Calculation unavailable: accepted exact-state "+species[i]+"–"+species[j]+" KBI source is missing or ambiguous.")
    return t
  })
  if(!density||stateId(density.scientificState)!==stateId(s)||plateauIssues(density).length||!acceptedConvergence(density,datasets,science)||!density.trajectory)throw new Error("Choose a current accepted exact-state trajectory with measured mean volume for the number-density vector.")
  const failed=terms.some(t=>t.kind!=="ssm")?["Finite-size correction missing for one or more matrix terms."]: []
  if(failed.length&&!overrideReason.trim())throw new Error(failed.join(" ")+" Explicit scientific override and rationale required.")
  const matrix=Array.from({length:3},()=>Array(3).fill(0)),uncertainty=matrix.map(r=>[...r])
  pairs3.forEach(([i,j],k)=>{matrix[i][j]=matrix[j][i]=terms[k].value;uncertainty[i][j]=uncertainty[j][i]=terms[k].uncertainty??0})
  const counts=species.map(id=>s!.composition.find(c=>c.moleculeId===id)!.count),total=counts.reduce((a,b)=>a+b,0),sourceIds=[...new Set(terms.flatMap(t=>t.datasetIds))]
  const result=buildThermodynamicResult({projectId:project.projectId,scientificState:structuredClone(s),stateKey:stateId(s)!,desId:run.desId,soluteId:run.soluteId,concentrationId:run.concentrationLabel,species,moleculeCounts:counts,moleFractions:counts.map(n=>n/total),numberDensitiesNm3:counts.map(n=>n/density.trajectory!.actualVolumeNm3),kbiMatrixNm3:matrix,kbiUncertaintyNm3:uncertainty,sourceTermIds:terms.map(t=>t.sourceId),sourceDatasetIds:sourceIds,sourceAnalysisIds:sourceIds.map(id=>datasets.find(d=>d.id===id)!.analysis!.id!),sourceDecisionIds:sourceIds.flatMap(id=>{const d=datasets.find(d=>d.id===id)!;return [d.analysis!.decision!.id,acceptedConvergence(d,datasets,science)!.id!]}),matrixTerms:terms,densitySourceId,evidenceSignature:sourceSignature(terms,density,datasets,science),uncertaintyProvenance:terms.map(t=>({pair:t.pair,kind:t.uncertainty===null?"unknown":t.kind==="ssm"?"ssm-regression-se":"replica-sem",sourceIds:[t.sourceId]})),softwareVersion:SOFTWARE_VERSION},project.analysisDefaults.bootstrapSamples,project.analysisDefaults.bootstrapSeed)
  if(!Number.isFinite(project.analysisDefaults.matrixConditionLimit)||project.analysisDefaults.matrixConditionLimit<1)throw new Error("Condition-number limit must be finite and ≥ 1.")
  if(result.conditionNumber>project.analysisDefaults.matrixConditionLimit)failed.push("Condition number exceeds selected tolerance.")
  if(failed.length){
    if(!overrideReason.trim())throw new Error(failed.join(" "))
    result.override={id:uuid(),projectId:project.projectId,stateId:result.stateKey,sourceIds:[...result.sourceTermIds,...sourceIds],classification:"overridden",failedValidation:failed,rationale:overrideReason.trim(),timestamp:new Date().toISOString(),softwareVersion:SOFTWARE_VERSION,actor:"researcher"}
  }
  if(covariance&&terms.some(t=>t.uncertainty===null))throw new Error("Covariance propagation requires documented uncertainty for every source term.")
  result.propagationSettings={covariance:covariance?structuredClone(covariance):undefined,conditionLimit:project.analysisDefaults.matrixConditionLimit,samples:project.analysisDefaults.bootstrapSamples,seed:project.analysisDefaults.bootstrapSeed}
  if(terms.every(t=>t.uncertainty!==null))result.uncertainty=propagateTernaryUncertainty(matrix,uncertainty,result.numberDensitiesNm3,project.analysisDefaults.bootstrapSamples,project.analysisDefaults.bootstrapSeed,project.analysisDefaults.matrixConditionLimit,covariance)
  result.propagationAssumption=result.uncertainty?.assumption??"Uncertainty not estimated: at least one term lacks statistical uncertainty. Radial plateau SD is never substituted. Number densities treated as fixed."
  return result
}
export function currentThermodynamic(r:ThermodynamicResult,science:ScientificState,runs:RunRecord[],datasets:RDFDataset[]) {
  if(!r.scientificState||!r.matrixTerms?.length||!r.evidenceSignature)return false
  const options=matrixOptions(r.scientificState,science,runs,datasets),density=datasets.find(d=>d.id===r.densitySourceId)
  if(!density||plateauIssues(density).length||!acceptedConvergence(density,datasets,science))return false
  if(r.matrixTerms.some(t=>!options.some(o=>canonical(t)===canonical(o))))return false
  if(r.evidenceSignature!==sourceSignature(r.matrixTerms,density,datasets,science))return false
  try{
    const species=ternarySpecies(r.scientificState),counts=species.map(id=>r.scientificState!.composition.find(c=>c.moleculeId===id)!.count)
    const run=runs.find(run=>run.runId===density.metadata.runId&&run.projectId===density.projectId)
    if(!run||!runMatchesDataset(density,run)||stateId(r.scientificState)!==stateId(density.scientificState)||r.projectId!==run.projectId||r.desId!==run.desId||r.soluteId!==run.soluteId||r.stateKey!==stateId(r.scientificState)||canonical(r.moleFractions)!==canonical(counts.map(n=>n/counts.reduce((a,b)=>a+b,0))))return false
    if(r.matrixTerms.length!==6||pairs3.some(([i,j],k)=>pairId(...r.matrixTerms![k].pair)!==pairId(species[i],species[j])))return false
    const datasetsUsed=[...new Set(r.matrixTerms.flatMap(t=>t.datasetIds))]
    if(canonical(r.sourceTermIds)!==canonical(r.matrixTerms.map(t=>t.sourceId))||canonical(r.sourceDatasetIds)!==canonical(datasetsUsed)||canonical(r.sourceAnalysisIds)!==canonical(datasetsUsed.map(id=>datasets.find(d=>d.id===id)!.analysis!.id))||canonical(r.sourceDecisionIds)!==canonical(datasetsUsed.flatMap(id=>{const d=datasets.find(d=>d.id===id)!;return[d.analysis!.decision!.id,acceptedConvergence(d,datasets,science)!.id]})))return false
    const settings=r.propagationSettings
    if(!settings||!Number.isFinite(settings.conditionLimit)||settings.conditionLimit<1)return false
    const failed=[...(r.matrixTerms.some(t=>t.kind!=="ssm")?["Finite-size correction missing for one or more matrix terms."]:[]),...(r.conditionNumber>settings.conditionLimit?["Condition number exceeds selected tolerance."]:[])]
    if(failed.length&&(!decisionMatches(r.override,r.projectId,r.stateKey,[...r.sourceTermIds,...datasetsUsed],"overridden")||canonical(failed)!==canonical(r.override!.failedValidation)))return false
    const uncertaintyProvenance=r.matrixTerms.map(t=>({pair:t.pair,kind:t.uncertainty===null?"unknown":t.kind==="ssm"?"ssm-regression-se":"replica-sem",sourceIds:[t.sourceId]}))
    if(canonical(uncertaintyProvenance)!==canonical(r.uncertaintyProvenance)||pairs3.some(([i,j],k)=>r.kbiUncertaintyNm3[i][j]!== (r.matrixTerms![k].uncertainty??0)||r.kbiUncertaintyNm3[j][i]!== (r.matrixTerms![k].uncertainty??0)))return false
    const expectedUncertainty=r.matrixTerms.every(t=>t.uncertainty!==null)?propagateTernaryUncertainty(r.kbiMatrixNm3,r.kbiUncertaintyNm3,r.numberDensitiesNm3,settings.samples,settings.seed,settings.conditionLimit,settings.covariance):undefined
    if(canonical(r.uncertainty)!==canonical(expectedUncertainty))return false
    if(canonical(r.species)!==canonical(species)||canonical(counts)!==canonical(r.moleculeCounts)||canonical(counts.map(n=>n/density.trajectory!.actualVolumeNm3))!==canonical(r.numberDensitiesNm3))return false
    if(pairs3.some(([i,j],k)=>r.kbiMatrixNm3[i][j]!==r.matrixTerms![k].value||r.kbiMatrixNm3[j][i]!==r.matrixTerms![k].value))return false
    const calculated=ternaryThermodynamicFactor(r.kbiMatrixNm3,r.numberDensitiesNm3)
    return (["transformedB","inverseB","structureFactor","inverseStructureFactor","gibbsProjection","gammaMatrix","fixedDesRatioSoluteGamma","conditionNumber"] as const).every(k=>canonical(r[k])===canonical(calculated[k]))
  }catch{return false}
}
export function activitySeriesId(s?:ScientificStatePoint) {
  if(!stateId(s)||!s)return null
  return canonical({projectId:s.projectId,desComponents:[...s.desComponents].sort((a,b)=>a.moleculeId.localeCompare(b.moleculeId)),soluteId:s.soluteId,temperatureK:s.temperatureK,pressureBar:s.pressureBar,forceField:s.forceField,chargeSource:s.chargeSource,molecularModel:s.molecularModel,parameterizationIdentity:s.parameterizationIdentity})
}
export function calculateActivity(results:ThermodynamicResult[],interpolation:ActivityResult["interpolation"],anchor:ActivityResult["anchor"],anchorSource:string,science:ScientificState,runs:RunRecord[],datasets:RDFDataset[]):ActivityResult {
  if(results.length<2||results.some(r=>!currentThermodynamic(r,science,runs,datasets)))throw new Error("At least two current, fully traceable thermodynamic factors are required.")
  if(new Set(results.map(r=>activitySeriesId(r.scientificState))).size!==1)throw new Error("Activity integration cannot mix DES ratios, solutes, temperature, pressure or molecular models.")
  if(anchor.type!=="none"&&!anchorSource.trim())throw new Error("Absolute γ requires a referenced external in-domain anchor and standard-state convention.")
  const rs=[...results].sort((a,b)=>a.moleFractions[0]-b.moleFractions[0]),s=rs[0].scientificState!,points=integrateActivity(rs.map(r=>({x:r.moleFractions[0],thermodynamicFactor:r.fixedDesRatioSoluteGamma})),interpolation,anchor)
  const result:ActivityResult={id:uuid(),stateId:activitySeriesId(s)!,projectId:s.projectId,desId:s.desId,soluteId:s.soluteId!,temperatureK:s.temperatureK,seriesIdentity:{desComponents:s.desComponents,soluteId:s.soluteId!,temperatureK:s.temperatureK,pressureBar:s.pressureBar,forceField:s.forceField,chargeSource:s.chargeSource},sourceThermodynamicIds:rs.map(r=>r.id),sourceSignature:canonical(rs),interpolation,anchor,anchorSource,points,accepted:false,softwareVersion:SOFTWARE_VERSION,createdAt:new Date().toISOString()}
  if(rs.every(r=>r.uncertainty?.samples?.length)){
    const random=seededRandom(rs[0].uncertainty!.seed??0)
    const n=Math.min(...rs.map(r=>r.uncertainty!.samples!.length)),draws=Array.from({length:n},(_,k)=>integrateActivity(rs.map((r,i)=>({x:r.moleFractions[0],thermodynamicFactor:r.uncertainty!.samples![Math.floor(random()*r.uncertainty!.samples!.length)]})),interpolation,anchor))
    result.uncertainty={samples:n,seed:rs[0].uncertainty!.seed??0,assumption:"Seeded independent resampling with replacement of stored Γ draws at each composition; composition errors, cross-composition correlations and anchor uncertainty are not included.",points:points.map((p,i)=>{const vals=draws.map(d=>d[i].gammaAbsolute??d[i].gammaRelative);return{x:p.x,sd:sampleSd(vals),ci95:[quantile(vals,.025),quantile(vals,.975)]}})}
  }
  return result
}
export function currentActivity(a:ActivityResult,science:ScientificState,runs:RunRecord[],datasets:RDFDataset[],requireAcceptance=true){
  const rs=a.sourceThermodynamicIds?.map(id=>science.thermodynamicResults.find(r=>r.id===id))
  if(!rs?.length||!rs.every(r=>r&&currentThermodynamic(r,science,runs,datasets))||canonical(rs)!==a.sourceSignature||(requireAcceptance&&(!a.accepted||!decisionMatches(a.decision,a.projectId,a.stateId,a.sourceThermodynamicIds!))))return false
  try{
    const fresh=calculateActivity(rs as ThermodynamicResult[],a.interpolation,a.anchor,a.anchorSource??"",science,runs,datasets)
    return (["stateId","projectId","desId","soluteId","temperatureK","seriesIdentity","sourceThermodynamicIds","sourceSignature","points","uncertainty"] as const).every(k=>canonical(a[k])===canonical(fresh[k]))
  }catch{return false}
}
export function currentInfiniteDilution(a:ActivityResult){
 const f=a.infiniteDilution
 if(!f||!decisionMatches(f.decision,a.projectId,a.stateId,[a.id]))return false
 try{const calculated=extrapolateInfiniteDilution(a.points.map(p=>({x:p.x,gamma:p.gammaAbsolute!})),f.model,f.maxX);return canonical({...f,decision:undefined})===canonical(calculated)}catch{return false}
}
export function fitInfiniteDilution(a:ActivityResult,model:"linear"|"quadratic",maxX:number,science:ScientificState,runs:RunRecord[],datasets:RDFDataset[]) {
  if(!currentActivity(a,science,runs,datasets)||a.anchor.type!=="composition")throw new Error("γ∞ extrapolation requires an accepted current absolute activity curve with a documented in-domain anchor.")
  return extrapolateInfiniteDilution(a.points.map(p=>({x:p.x,gamma:p.gammaAbsolute!})),model,maxX)
}
