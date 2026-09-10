/** Explicit, dimension-wise Pareto dominance. No weighting or hidden scalar score.
 * Values must refer to researcher-selected comparable quantities and units.
 * Unknown dimensions are ineligible, never imputed; uncertainty is not collapsed. */
export function paretoFront(rows:Array<{id:string;values:Array<number|null>;sourceIds:string[]}>,directions:Array<'minimize'|'maximize'>){
 if(directions.length<2)throw new Error('Select at least two explicit Pareto objectives.')
 const usable=rows.filter(r=>r.values.length===directions.length&&r.values.every(v=>v!==null&&Number.isFinite(v)))
 return rows.map(row=>{
  if(!usable.includes(row))return{...row,status:'INSUFFICIENT EVIDENCE',dominatedBy:[] as string[]}
  const dominatedBy=usable.filter(other=>other.id!==row.id&&other.values.every((v,i)=>directions[i]==='minimize'?v!<=row.values[i]!:v!>=row.values[i]!)&&other.values.some((v,i)=>directions[i]==='minimize'?v!<row.values[i]!:v!>row.values[i]!)).map(r=>r.id)
  return{...row,status:dominatedBy.length?'DOMINATED':'PARETO FRONT',dominatedBy}
 })
}
