import { uuid } from "./crypto.ts"
import type { ProjectState, RDFDataset, RunRecord, ScientificState, SSMFit, SSMPoint } from "./types"
import { stateId, observableId, canonical, stateErrors } from "./identity.ts"
import { acceptedConvergence, plateauIssues, trajectoryKey, runMatchesDataset } from "./evidence.ts"
import { createRun } from "./runs.ts"
import { fitSsm, mean, sampleSd } from "./scientific.ts"
import { SOFTWARE_VERSION } from "./version.ts"
import {decisionMatches} from "./decisions.ts"

/** Independently packed/run boxes. Integer population multipliers preserve exact x and DES ratio.
 * A 1/L regression is an explicitly selected box-size scaling model, not a claim
 * that gmx trjconv cropping produces an open finite-volume SSM ensemble.
 */
export function designFiniteSizeRuns(project: ProjectState, base: RunRecord, multipliers: number[]) {
  if(base.projectId!==project.projectId||!base.scientificState||stateErrors(base.scientificState).length||!base.resolvedProtocol)throw new Error("A resolved base run with complete composition/protocol is required.")
  if(multipliers.length<3||new Set(multipliers).size!==multipliers.length||multipliers.some(m=>!Number.isSafeInteger(m)||m<1))throw new Error("Supply at least three distinct positive integer population multipliers.")
  return multipliers.map((m,index)=>{
    const p=structuredClone(project),s=base.scientificState!, scale=Math.cbrt(m)
    p.protocol=structuredClone(base.resolvedProtocol!.inputSettings)
    p.protocol.pressureBar=base.pressureBar
    p.protocol.box={x:s.boxDimensionsNm[0]*scale,y:s.boxDimensionsNm[1]*scale,z:s.boxDimensionsNm[2]*scale,geometry:"orthorhombic",unit:"nm"}
    p.protocol.randomSeedBase=base.randomSeed + index*1009-base.replica+1
    p.molecules=structuredClone(base.molecularSnapshot!)
    const original=p.desSystems.find(d=>d.id===base.desId)
    if(!original)throw new Error("Base DES definition is no longer available.")
    original.componentIds=base.components.map(c=>c.moleculeId);original.ratio=s.desComponents.map(c=>c.ratio);original.boxCounts=base.components.map(c=>c.count!*m)
    original.compositionSettings.mode="manual";original.compositionSettings.lockAcrossSeries=false
    const run=createRun(p,"finite-size",base.desId,base.systemKind==='pure-des'?null:base.soluteId,base.soluteCount*m,`Independent population ×${m}; base ${base.runId}`,base.temperatureK,base.replica)
    if(!run)throw new Error("Finite-size run could not be constructed.")
    return run
  })
}
export function pointFromDataset(d:RDFDataset,runs:RunRecord[],datasets:RDFDataset[],science:ScientificState):SSMPoint {
  const errors=plateauIssues(d),run=runs.find(r=>r.runId===d.metadata.runId&&r.projectId===d.projectId)
  if(!runMatchesDataset(d,run))errors.push("Source must reference its exact generated physical run and frozen molecular inputs.")
  if(!acceptedConvergence(d,datasets,science))errors.push("Time convergence must be researcher accepted with current source windows.")
  if(!d.replicaRepresentative)errors.push("Select one representative KBI per trajectory/replica.")
  if(d.observable?.observableType!=="molecular-com-rdf")errors.push("Molecular center-of-mass RDF is required for a molecular KB matrix.")
  if(!trajectoryKey(d))errors.push("Trajectory hash and measured volume provenance required.")
  if(errors.length)throw new Error(errors.join(" "))
  return {id:uuid(),projectId:d.projectId,runId:run!.runId,datasetId:d.id,analysisId:d.analysis!.id,scientificState:structuredClone(d.scientificState),observable:structuredClone(d.observable),estimator:"independent-box-running-kbi",uncertaintyKind:"not-estimated",stateKey:stateId(d.scientificState,{finiteSizeFamily:true})!,desId:run!.desId,soluteId:run!.soluteId,speciesA:d.observable!.speciesA,speciesB:d.observable!.speciesB,temperatureK:run!.temperatureK,soluteCount:run!.soluteCount,effectiveLengthNm:Math.cbrt(d.trajectory!.actualVolumeNm3),finiteKbiNm3:d.analysis!.estimateNm3,uncertaintyNm3:null,replica:run!.replica,source:d.sourceFilename,accepted:true}
}
export function validateSsmPoints(points:SSMPoint[],runs:RunRecord[],datasets:RDFDataset[],science:ScientificState) {
  const errors:string[]=[],families=new Set<string>(),pairs=new Set<string>(),sourceIds=new Set<string>(),runIds=new Set<string>(),hashes=new Set<string>()
  for(const p of points){
    const d=datasets.find(d=>d.id===p.datasetId)
    if(!d){errors.push(`${p.id}: source RDF is missing.`);continue}
    try{
      const current=pointFromDataset(d,runs,datasets,science)
      // Math.cbrt may differ by a few ulps across JS engines. Only the derived
      // length allows 1e-12 relative/absolute nm tolerance; source state stays exact.
      const changed=(Object.keys(current) as Array<keyof SSMPoint>).filter(key=>key!=="id"&&(key==="effectiveLengthNm" ? (!Number.isFinite(p.effectiveLengthNm)||Math.abs(current.effectiveLengthNm-p.effectiveLengthNm)>1e-12*Math.max(1,Math.abs(current.effectiveLengthNm))) : canonical(current[key])!==canonical(p[key])))
      if(changed.length)errors.push("SSM point differs from current source analysis, molecular state, acceptance or measured box size: "+changed.join(", ")+".")
      families.add(current.stateKey);pairs.add(observableId(d.observable)!)
      if(sourceIds.has(d.id)||runIds.has(current.runId!)||hashes.has(d.trajectory!.sha256))errors.push("SSM requires independently simulated trajectories; repeated source/run cannot create another size.")
      sourceIds.add(d.id);runIds.add(current.runId!);hashes.add(d.trajectory!.sha256)
    }catch(e){errors.push(String(e))}
  }
  if(families.size!==1)errors.push("Finite-size data must share molecular composition fractions, DES ratio, T, P and force-field/charge pipeline.")
  if(pairs.size!==1)errors.push("Finite-size points must represent the exact same observable pair and selections.")
  return [...new Set(errors)]
}
export function fitValidatedSsm(points:SSMPoint[],representation:SSMFit["representation"],minimum:number,runs:RunRecord[],datasets:RDFDataset[],science:ScientificState):SSMFit {
  if(!Number.isSafeInteger(minimum)||minimum<3)throw new Error("Minimum distinct sizes must be an integer ≥ 3.")
  const errors=validateSsmPoints(points,runs,datasets,science)
  if(errors.length)throw new Error(errors.join(" "))
  const groups=new Map<string,SSMPoint[]>()
  for(const p of points){const id=stateId(p.scientificState)!;groups.set(id,[...(groups.get(id)??[]),p])}
  if(groups.size<Math.max(3,minimum))throw new Error(`Insufficient genuinely distinct finite-size systems: ${groups.size}; at least ${Math.max(3,minimum)} required.`)
  const aggregated=[...groups.values()].map(g=>({...g[0],finiteKbiNm3:mean(g.map(p=>p.finiteKbiNm3)),effectiveLengthNm:mean(g.map(p=>p.effectiveLengthNm)),uncertaintyNm3:g.length>1?sampleSd(g.map(p=>p.finiteKbiNm3))/Math.sqrt(g.length):null}))
  const fit=fitSsm(aggregated,representation,minimum)
  return {...fit,fitInputs:{minimumDistinctSizes:minimum,aggregatedPoints:aggregated.map((p,i)=>({sourcePointIds:[...groups.values()][i].map(p=>p.id),effectiveLengthNm:p.effectiveLengthNm,finiteKbiNm3:p.finiteKbiNm3,uncertaintyNm3:p.uncertaintyNm3}))},pointIds:points.map(p=>p.id),projectId:points[0].projectId,familyId:stateId(points[0].scientificState,{finiteSizeFamily:true})!,observableId:observableId(points[0].observable)!,sourceDatasetIds:points.map(p=>p.datasetId!),softwareVersion:SOFTWARE_VERSION}
}
export function currentSsmFit(fit:SSMFit,science:ScientificState,runs:RunRecord[],datasets:RDFDataset[]) {
  if(!fit.accepted||!decisionMatches(fit.decision,fit.projectId,fit.familyId,fit.pointIds))return false
  const points=fit.pointIds.map(id=>science.ssmPoints.find(p=>p.id===id))
  if(points.some(p=>!p)||validateSsmPoints(points as SSMPoint[],runs,datasets,science).length)return false
  if(!fit.fitInputs)return false
  try{
    const calculated=fitValidatedSsm(points as SSMPoint[],fit.representation,fit.fitInputs.minimumDistinctSizes,runs,datasets,science)
    const fields=(f:SSMFit)=>({g:f.gInfinityNm3,surface:f.fInfinityNm4,se:f.gInfinitySe,fse:f.fInfinitySe,ci:f.gInfinityCi95,fci:f.fInfinityCi95,r2:f.r2,residuals:f.residuals,leverage:f.leverage,inputs:f.fitInputs})
    return canonical(fields(fit))===canonical(fields(calculated))&&(["projectId","familyId","observableId","pairKey","stateKey","sourceDatasetIds"] as const).every(k=>canonical(fit[k])===canonical(calculated[k]))
  }catch{return false}
}
export function finiteSizePreparationScript(runs:RunRecord[]) {
  return "#!/usr/bin/env bash\nset -euo pipefail\n# Independent systems: pack, equilibrate and simulate each listed run separately.\n# No trjconv cropping is used to fabricate finite-size ensembles.\n"+runs.map(r=>`# ${r.runId}: box ${canonical(r.scientificState?.boxDimensionsNm)} nm; composition ${canonical(r.scientificState?.composition)}\n(cd 'runs/${r.runId}' && bash commands.sh)`).join("\n")+"\n# Compute RDFs for each actual trajectory, retain hashes/mean volumes, and explicitly map each result.\n"
}
