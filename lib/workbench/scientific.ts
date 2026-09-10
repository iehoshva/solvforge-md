import { uuid } from "./crypto.ts"
import type { ActivityResult, SSMFit, SSMPoint, ThermodynamicResult, ValidationResult } from "./types"
import { runningKbi } from "./integration.ts"

export const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length

export function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

export function sampleSd(values: number[]) {
  if (values.length < 2) return 0
  const center = mean(values)
  return Math.sqrt(values.reduce((sum, value) => sum + (value - center) ** 2, 0) / (values.length - 1))
}

export function quantile(values: number[], probability: number) {
  const sorted = [...values].sort((a, b) => a - b)
  if (!sorted.length) return Number.NaN
  const index = (sorted.length - 1) * Math.max(0, Math.min(1, probability))
  const lower = Math.floor(index)
  const fraction = index - lower
  return sorted[lower + 1] === undefined ? sorted[lower] : sorted[lower] + fraction * (sorted[lower + 1] - sorted[lower])
}

const T95 = [12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228, 2.201, 2.179, 2.16, 2.145, 2.131, 2.12, 2.11, 2.101, 2.093, 2.086, 2.08, 2.074, 2.069, 2.064, 2.06, 2.056, 2.052, 2.048, 2.045, 2.042]
export const tCritical95 = (degreesOfFreedom: number) => degreesOfFreedom <= 0 ? Number.NaN : T95[Math.min(30, Math.floor(degreesOfFreedom)) - 1] ?? 1.96

export function weightedLinearRegression(x: number[], y: number[], uncertainty?: Array<number | null>) {
  if (x.length !== y.length || x.length < 2) throw new Error("Regression requires at least two paired observations.")
  if (x.some(v=>!Number.isFinite(v)) || y.some(v=>!Number.isFinite(v))) throw new Error("Regression inputs must be finite.")
  const completeUncertainty = uncertainty?.length === x.length && uncertainty.every(v=>v!==null && Number.isFinite(v) && v>0)
  const weights = x.map((_, index) => {
    const value = uncertainty?.[index]
    return completeUncertainty && value ? 1 / value ** 2 : 1
  })
  const sw = weights.reduce((a, b) => a + b, 0)
  const sx = x.reduce((sum, value, i) => sum + weights[i] * value, 0)
  const sy = y.reduce((sum, value, i) => sum + weights[i] * value, 0)
  const sxx = x.reduce((sum, value, i) => sum + weights[i] * value * value, 0)
  const sxy = x.reduce((sum, value, i) => sum + weights[i] * value * y[i], 0)
  const determinant = sw * sxx - sx * sx
  if (Math.abs(determinant) < 1e-15) throw new Error("Regression design is singular: finite-size values must contain distinct sizes.")
  const intercept = (sxx * sy - sx * sxy) / determinant
  const slope = (sw * sxy - sx * sy) / determinant
  const fitted = x.map((value) => intercept + slope * value)
  const residuals = y.map((value, i) => value - fitted[i])
  const weightedSse = residuals.reduce((sum, value, i) => sum + weights[i] * value ** 2, 0)
  const weightedMean = sy / sw
  const weightedTotal = y.reduce((sum, value, i) => sum + weights[i] * (value - weightedMean) ** 2, 0)
  const r2 = weightedTotal > 0 ? 1 - weightedSse / weightedTotal : weightedSse < 1e-20 ? 1 : 0
  const degreesOfFreedom = Math.max(0, x.length - 2)
  const residualVariance = degreesOfFreedom ? weightedSse / degreesOfFreedom : 0
  const interceptSe = Math.sqrt(Math.max(0, residualVariance * sxx / determinant))
  const slopeSe = Math.sqrt(Math.max(0, residualVariance * sw / determinant))
  const xWeightedMean = sx / sw
  const centered = x.reduce((sum, value, i) => sum + weights[i] * (value - xWeightedMean) ** 2, 0)
  const leverage = x.map((value, i) => weights[i] * (1 / sw + (centered > 0 ? (value - xWeightedMean) ** 2 / centered : 0)))
  const critical = tCritical95(degreesOfFreedom)
  return { intercept, slope, interceptSe, slopeSe, r2, residuals, leverage, degreesOfFreedom, interceptCi95: [intercept - critical * interceptSe, intercept + critical * interceptSe] as [number, number], slopeCi95: [slope - critical * slopeSe, slope + critical * slopeSe] as [number, number] }
}

/** Small System Method: G^V(L)=G∞+F∞/L, or equivalently L G^V=G∞L+F∞. */
export function fitSsm(points: SSMPoint[], representation: SSMFit["representation"], minimumPoints = 3): SSMFit {
  minimumPoints = Math.max(3, minimumPoints)
  const accepted = points.filter((point) => point.accepted)
  if (accepted.some(p=>!Number.isFinite(p.effectiveLengthNm)||p.effectiveLengthNm<=0||!Number.isFinite(p.finiteKbiNm3))) throw new Error("Invalid finite-size input.")
  if (new Set(accepted.map(p=>p.stateKey)).size>1 || new Set(accepted.map(p=>[p.speciesA,p.speciesB].sort().join("|"))).size>1) throw new Error("Finite-size regression cannot mix state families or observables.")
  if (accepted.length < minimumPoints) throw new Error(`Insufficient finite-size data: ${accepted.length} accepted point(s); at least ${minimumPoints} required.`)
  if (new Set(accepted.map((point) => point.effectiveLengthNm)).size < minimumPoints) throw new Error("Insufficient distinct finite-size lengths for extrapolation.")
  let x: number[]
  let y: number[]
  let uncertainty: Array<number | null>
  if (representation === "g-vs-inverse-l") {
    x = accepted.map((point) => 1 / point.effectiveLengthNm)
    y = accepted.map((point) => point.finiteKbiNm3)
    uncertainty = accepted.every(p=>p.uncertaintyNm3!==null && p.uncertaintyNm3>0) ? accepted.map(p=>p.uncertaintyNm3) : accepted.map(()=>1)
  } else {
    x = accepted.map((point) => point.effectiveLengthNm)
    y = accepted.map((point) => point.effectiveLengthNm * point.finiteKbiNm3)
    uncertainty = accepted.every(p=>p.uncertaintyNm3!==null && p.uncertaintyNm3>0) ? accepted.map(p=>p.effectiveLengthNm*p.uncertaintyNm3!) : accepted.map(p=>p.effectiveLengthNm)
  }
  const regression = weightedLinearRegression(x, y, uncertainty)
  const gInfinityNm3 = representation === "g-vs-inverse-l" ? regression.intercept : regression.slope
  const fInfinityNm4 = representation === "g-vs-inverse-l" ? regression.slope : regression.intercept
  const gInfinitySe = representation === "g-vs-inverse-l" ? regression.interceptSe : regression.slopeSe
  const fInfinitySe = representation === "g-vs-inverse-l" ? regression.slopeSe : regression.interceptSe
  const gInfinityCi95 = representation === "g-vs-inverse-l" ? regression.interceptCi95 : regression.slopeCi95
  const fInfinityCi95 = representation === "g-vs-inverse-l" ? regression.slopeCi95 : regression.interceptCi95
  return { id: uuid(), stateKey: accepted[0].stateKey, pairKey: [accepted[0].speciesA, accepted[0].speciesB].sort().join("—"), representation, pointIds: accepted.map((point) => point.id), gInfinityNm3, fInfinityNm4, gInfinitySe, fInfinitySe, gInfinityCi95, fInfinityCi95, r2: regression.r2, residuals: regression.residuals, leverage: regression.leverage, accepted: false, createdAt: new Date().toISOString() }
}

export function determinant(matrix: number[][]): number {
  const n = matrix.length
  if (!n || matrix.some((row) => row.length !== n)) throw new Error("Determinant requires a square matrix.")
  const a = matrix.map((row) => [...row])
  let value = 1
  for (let column = 0; column < n; column++) {
    let pivot = column
    for (let row = column + 1; row < n; row++) if (Math.abs(a[row][column]) > Math.abs(a[pivot][column])) pivot = row
    if (Math.abs(a[pivot][column]) < 1e-15) return 0
    if (pivot !== column) { [a[pivot], a[column]] = [a[column], a[pivot]]; value *= -1 }
    const diagonal = a[column][column]
    value *= diagonal
    for (let row = column + 1; row < n; row++) {
      const factor = a[row][column] / diagonal
      for (let k = column + 1; k < n; k++) a[row][k] -= factor * a[column][k]
    }
  }
  return value
}

export function inverse(matrix: number[][]) {
  const n = matrix.length
  if (!n || matrix.some((row) => row.length !== n)) throw new Error("Inversion requires a square matrix.")
  const augmented = matrix.map((row, i) => [...row, ...Array.from({ length: n }, (_, j) => i === j ? 1 : 0)])
  for (let column = 0; column < n; column++) {
    let pivot = column
    for (let row = column + 1; row < n; row++) if (Math.abs(augmented[row][column]) > Math.abs(augmented[pivot][column])) pivot = row
    if (Math.abs(augmented[pivot][column]) < 1e-15) throw new Error("Matrix is singular or numerically indistinguishable from singular.")
    ;[augmented[pivot], augmented[column]] = [augmented[column], augmented[pivot]]
    const diagonal = augmented[column][column]
    augmented[column] = augmented[column].map((value) => value / diagonal)
    for (let row = 0; row < n; row++) if (row !== column) {
      const factor = augmented[row][column]
      augmented[row] = augmented[row].map((value, k) => value - factor * augmented[column][k])
    }
  }
  return augmented.map((row) => row.slice(n))
}

const infinityNorm = (matrix: number[][]) => Math.max(...matrix.map((row) => row.reduce((sum, value) => sum + Math.abs(value), 0)))
export const conditionNumber = (matrix: number[][], inverted = inverse(matrix)) => infinityNorm(matrix) * infinityNorm(inverted)

/**
 * Molecular, constant-T,p KB inversion (no DES pseudocomponent).
 * B_ij = rho_i delta_ij + rho_i rho_j G_ij; S=B/rho; A=S^-1.
 * D=A-(Ax)(x^T A)/(x^T A x); Gamma_ij=x_i(D_ij-D_i3), i,j=1,2.
 * Species 3 is dependent; fixed solvent ratio q=x2/(x2+x3):
 * Gamma_path=Gamma_11-q Gamma_12. This is x1 d(beta mu1)/dx1.
 * Literature: Kirkwood & Buff (1951), O'Connell & DeGance (1975);
 * matrix equations 8,13,17,19–21 at https://arxiv.org/html/2510.04636v1.
 * A direct Gibbs-Duhem projection avoids a potentially inconsistent hard-coded ternary polynomial.
 */
export function ternaryThermodynamicFactor(kbi: number[][], densities: number[]) {
  if(kbi.length!==3||kbi.some(r=>r.length!==3)||densities.length!==3)throw new Error("Exactly three molecular species and a complete 3×3 matrix are required.")
  if(densities.some(v=>!Number.isFinite(v)||v<=0)||kbi.some(r=>r.some(v=>!Number.isFinite(v))))throw new Error("Finite KB values and positive molecular number densities are required.")
  for(let i=0;i<3;i++)for(let j=0;j<3;j++)if(Math.abs(kbi[i][j]-kbi[j][i])>1e-12*Math.max(1,Math.abs(kbi[i][j])))throw new Error("KB matrix must be symmetric; asymmetric terms cannot be silently averaged.")
  const total=densities.reduce((a,b)=>a+b,0),x=densities.map(v=>v/total)
  const transformedB=kbi.map((row,i)=>row.map((g,j)=>densities[i]*densities[j]*g+(i===j?densities[i]:0)))
  const S=transformedB.map(r=>r.map(v=>v/total))
  cholesky(S) // Stable equilibrium fluctuation matrix must be positive definite.
  const inverseB=inverse(transformedB),A=inverse(S),Ax=A.map(row=>row.reduce((sum,v,i)=>sum+v*x[i],0)),denom=x.reduce((s,v,i)=>s+v*Ax[i],0)
  if(!(denom>0))throw new Error("Fluctuation matrix violates stability/compressibility positivity.")
  const D=A.map((r,i)=>r.map((v,j)=>v-Ax[i]*Ax[j]/denom))
  const gammaMatrix=[0,1].map(i=>[0,1].map(j=>x[i]*(D[i][j]-D[i][2])))
  const fixedDesRatioSoluteGamma=gammaMatrix[0][0]-x[1]/(x[1]+x[2])*gammaMatrix[0][1]
  return {eta:denom,gammaMatrix,transformedB,inverseB,determinantB:determinant(transformedB),conditionNumber:conditionNumber(S,A),fixedDesRatioSoluteGamma,structureFactor:S,inverseStructureFactor:A,gibbsProjection:D}
}
export function cholesky(a:number[][]) {
  const n=a.length,L=Array.from({length:n},()=>Array(n).fill(0))
  if(!n||a.some(r=>r.length!==n||r.some(v=>!Number.isFinite(v))))throw new Error("Covariance/fluctuation matrix must be finite and square.")
  for(let i=0;i<n;i++)for(let j=0;j<n;j++)if(Math.abs(a[i][j]-a[j][i])>1e-12*Math.max(1,Math.abs(a[i][j])))throw new Error("Covariance/fluctuation matrix must be symmetric.")
  for(let i=0;i<n;i++)for(let j=0;j<=i;j++){
    let s=a[i][j];for(let k=0;k<j;k++)s-=L[i][k]*L[j][k]
    if(i===j){if(!(s>0)||!Number.isFinite(s))throw new Error("Matrix is not positive definite: stable fluctuation/covariance matrix required.");L[i][j]=Math.sqrt(s)}
    else L[i][j]=s/L[j][j]
  }
  return L
}

export function seededRandom(seed: number) {
  let state = seed >>> 0
  return () => { state += 0x6D2B79F5; let value = state; value = Math.imul(value ^ value >>> 15, value | 1); value ^= value + Math.imul(value ^ value >>> 7, value | 61); return ((value ^ value >>> 14) >>> 0) / 4294967296 }
}

function normalSample(random: () => number) {
  const u = Math.max(Number.EPSILON, random())
  const v = random()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}

export function propagateTernaryUncertainty(kbi: number[][], uncertainty: number[][], densities: number[], samples: number, seed: number, conditionLimit = 1e8, covariance?: number[][]) {
  if (!Number.isInteger(samples)||samples<2||samples>100000||!Number.isSafeInteger(seed)) throw new Error("Use 2–100000 samples and an integer seed.")
  if (uncertainty.length!==3||uncertainty.some(r=>r.length!==3||r.some(v=>!Number.isFinite(v)||v<0))) throw new Error("All propagated uncertainties must be explicitly known and nonnegative.")
  const pairs=[[0,0],[0,1],[0,2],[1,1],[1,2],[2,2]]
  const L=covariance ? cholesky(covariance) : null
  if(L&&L.length!==6)throw new Error("KBI covariance requires a 6×6 matrix in 11,12,13,22,23,33 order.")
  const random = seededRandom(seed)
  const results: number[] = []
  for (let sample = 0; sample < samples; sample++) {
    const drawn = kbi.map((row) => [...row])
    const z=pairs.map(()=>normalSample(random))
    pairs.forEach(([i,j],index)=>{ const delta=L?L[index].reduce((s,v,k)=>s+v*z[k],0):uncertainty[i][j]*z[index];drawn[i][j]=drawn[j][i]=kbi[i][j]+delta })
    try { const calc=ternaryThermodynamicFactor(drawn,densities);if(calc.conditionNumber<=conditionLimit&&Number.isFinite(calc.fixedDesRatioSoluteGamma))results.push(calc.fixedDesRatioSoluteGamma) } catch { /* Count rejected draws explicitly. */ }
  }
  if (results.length < 2) throw new Error("Fewer than two valid uncertainty draws; no statistical interval is available.")
  return { samples: results, seed, assumption: covariance ? "Supplied joint covariance of KBI estimates" : "Independent normal KBI estimates; correlations neglected", sd: sampleSd(results), ci95: [quantile(results, 0.025), quantile(results, 0.975)] as [number, number], validSamples: results.length, requestedSamples: samples }
}

export function buildThermodynamicResult(input: Omit<ThermodynamicResult, "id" | "transformedB" | "inverseB" | "determinantB" | "conditionNumber" | "gammaMatrix" | "fixedDesRatioSoluteGamma" | "uncertainty" | "createdAt">, bootstrapSamples: number, seed: number): ThermodynamicResult {
  const calculation = ternaryThermodynamicFactor(input.kbiMatrixNm3, input.numberDensitiesNm3)
  const hasUncertainty = input.uncertaintyProvenance?.length === 6 && input.uncertaintyProvenance.every(term=>term.kind!=="unknown")
  return { ...input, id: uuid(), structureFactor:calculation.structureFactor,inverseStructureFactor:calculation.inverseStructureFactor,gibbsProjection:calculation.gibbsProjection, transformedB: calculation.transformedB, inverseB: calculation.inverseB, determinantB: calculation.determinantB, conditionNumber: calculation.conditionNumber, gammaMatrix: calculation.gammaMatrix, fixedDesRatioSoluteGamma: calculation.fixedDesRatioSoluteGamma, uncertainty: hasUncertainty ? propagateTernaryUncertainty(input.kbiMatrixNm3, input.kbiUncertaintyNm3, input.numberDensitiesNm3, bootstrapSamples, seed) : undefined, createdAt: new Date().toISOString() }
}

function interpolateLinear(points: Array<{ x: number; y: number }>, value: number) {
  if (value <= points[0].x) return points[0].y
  if (value >= points.at(-1)!.x) return points.at(-1)!.y
  const upper = points.findIndex((point) => point.x >= value)
  const left = points[upper - 1], right = points[upper]
  return left.y + (right.y - left.y) * (value - left.x) / (right.x - left.x)
}

function monotoneSlopes(points: Array<{ x: number; y: number }>) {
  const secants = points.slice(1).map((point, i) => (point.y - points[i].y) / (point.x - points[i].x))
  const h=points.slice(1).map((p,i)=>p.x-points[i].x)
  const endpoint=(h0:number,h1:number,d0:number,d1:number)=>{let d=((2*h0+h1)*d0-h0*d1)/(h0+h1);if(d*d0<=0)d=0;else if(d0*d1<=0&&Math.abs(d)>3*Math.abs(d0))d=3*d0;return d}
  return points.map((_, i) => {
    if(points.length===2)return secants[0]
    if (i === 0) return endpoint(h[0],h[1],secants[0],secants[1])
    if (i === points.length - 1) return endpoint(h.at(-1)!,h.at(-2)!,secants.at(-1)!,secants.at(-2)!)
    if (secants[i - 1] * secants[i] <= 0) return 0
    const w1=2*h[i]+h[i-1],w2=h[i]+2*h[i-1]
    return (w1+w2)/(w1/secants[i-1]+w2/secants[i])
  })
}

function interpolateMonotone(points: Array<{ x: number; y: number }>, value: number) {
  if (value <= points[0].x || value >= points.at(-1)!.x) return interpolateLinear(points, value)
  const upper = points.findIndex((point) => point.x >= value)
  const left = points[upper - 1], right = points[upper]
  const slopes = monotoneSlopes(points)
  const width = right.x - left.x
  const t = (value - left.x) / width
  const h00 = (2 * t ** 3 - 3 * t ** 2 + 1), h10 = (t ** 3 - 2 * t ** 2 + t), h01 = (-2 * t ** 3 + 3 * t ** 2), h11 = (t ** 3 - t ** 2)
  return h00 * left.y + h10 * width * slopes[upper - 1] + h01 * right.y + h11 * width * slopes[upper]
}

/**
 * Integrates d ln(gamma_i)/d ln(x_i)=Gamma_i-1 over the sampled domain.
 * Returns gamma/gamma(x_min) unless an explicit absolute thermodynamic anchor is supplied;
 * KB derivatives alone do not determine the additive constant in ln(gamma).
 */
export function integrateActivity(input: Array<{ x: number; thermodynamicFactor: number }>, interpolation: ActivityResult["interpolation"], anchor: ActivityResult["anchor"] = { type: "none", x: null, gamma: null }) {
  if(input.some(p=>!Number.isFinite(p.x)||p.x<=0||p.x>=1||!Number.isFinite(p.thermodynamicFactor)))throw new Error("Activity integration requires finite Γ and 0 < x < 1 for every input; invalid rows are not silently removed.")
  if(anchor.type==="infinite-dilution")throw new Error("An infinite-dilution anchor needs an explicit model between zero and the sampled domain. Supply an in-domain composition anchor instead.")
  const points = [...input].sort((a, b) => a.x - b.x)
  if (points.length < 2) throw new Error("Activity integration requires at least two validated positive-composition Γ points.")
  if (new Set(points.map((point) => point.x)).size !== points.length) throw new Error("Activity integration requires unique composition points.")
  const curve = points.map((point) => ({ x: point.x, y: (point.thermodynamicFactor - 1) / point.x }))
  const interpolate = interpolation === "monotone-cubic" && points.length >= 3 ? interpolateMonotone : interpolateLinear
  const integrated: number[] = [0]
  for (let i = 1; i < points.length; i++) {
    const left = points[i - 1].x, right = points[i].x
    const subdivisions = 100
    const step = (right - left) / subdivisions
    let area = 0
    for (let j = 0; j < subdivisions; j++) {
      const a = left + j * step, b = a + step
      area += 0.5 * (interpolate(curve, a) + interpolate(curve, b)) * step
    }
    integrated.push(integrated[i - 1] + area)
  }
  let shift: number | null = null
  if(anchor.type==="composition"){
    if(anchor.x===null||!Number.isFinite(anchor.x)||anchor.gamma===null||!Number.isFinite(anchor.gamma)||anchor.gamma<=0||anchor.x<points[0].x||anchor.x>points.at(-1)!.x)throw new Error("Absolute anchor requires gamma > 0 at an exact x within the simulated composition domain.")
    let area=0
    for(let i=1;i<points.length;i++){
      const left=points[i-1].x,right=Math.min(points[i].x,anchor.x)
      if(right<=left)break
      const step=(right-left)/100
      for(let j=0;j<100;j++)area+=(interpolate(curve,left+j*step)+interpolate(curve,left+(j+1)*step))*step/2
      if(right===anchor.x)break
    }
    shift=Math.log(anchor.gamma)-area
  }
  if(integrated.some(v=>!Number.isFinite(Math.exp(v))||(shift!==null&&!Number.isFinite(Math.exp(v+shift)))))throw new Error("Activity integration overflow: inspect Gamma, composition range and anchor.")
  return points.map((point, i) => ({ x: point.x, thermodynamicFactor: point.thermodynamicFactor, lnGammaRelative: integrated[i], gammaRelative: Math.exp(integrated[i]), gammaAbsolute: shift === null ? null : Math.exp(integrated[i] + shift) }))
}

export function polynomialRegression(x: number[], y: number[], degree: 1 | 2) {
  if(x.length!==y.length||new Set(x).size!==x.length||x.some(v=>!Number.isFinite(v))||y.some(v=>!Number.isFinite(v)))throw new Error("Unique finite x values and a finite response for every point are required.")
  const scale=x.reduce((m,v)=>Math.max(m,Math.abs(v)),0)
  if(!(scale>0))throw new Error("Fit domain has no variation.")
  x=x.map(v=>v/scale)
  if (x.length < degree + 2) throw new Error(`A degree-${degree} fit requires at least ${degree + 2} points.`)
  if (degree === 1) {
    const fit = weightedLinearRegression(x, y)
    return { coefficients: [fit.intercept, fit.slope/scale], r2: fit.r2, residuals: fit.residuals, interceptSe: fit.interceptSe, interceptCi95: fit.interceptCi95 }
  }
  const sums = Array.from({ length: 5 }, (_, power) => x.reduce((sum, value) => sum + value ** power, 0))
  const rhs = Array.from({ length: 3 }, (_, power) => x.reduce((sum, value, i) => sum + y[i] * value ** power, 0))
  const design = [[sums[0], sums[1], sums[2]], [sums[1], sums[2], sums[3]], [sums[2], sums[3], sums[4]]]
  const coefficients = inverse(design).map((row) => row.reduce((sum, value, i) => sum + value * rhs[i], 0))
  const fitted = x.map((value) => coefficients[0] + coefficients[1] * value + coefficients[2] * value ** 2)
  const residuals = y.map((value, i) => value - fitted[i])
  const center = mean(y), total = y.reduce((sum, value) => sum + (value - center) ** 2, 0), sse = residuals.reduce((sum, value) => sum + value ** 2, 0)
  const variance = sse / Math.max(1, x.length - 3)
  const interceptSe = Math.sqrt(Math.max(0, variance * inverse(design)[0][0]))
  const critical = tCritical95(x.length - 3)
  return { coefficients:coefficients.map((c,i)=>c/scale**i), r2: total ? 1 - sse / total : 1, residuals, interceptSe, interceptCi95: [coefficients[0] - critical * interceptSe, coefficients[0] + critical * interceptSe] as [number, number] }
}

export function extrapolateInfiniteDilution(points: Array<{ x: number; gamma: number }>, model: "linear" | "quadratic", maxX: number) {
  if(!Number.isFinite(maxX)||maxX<=0||maxX>=1||points.some(p=>!Number.isFinite(p.x)||!Number.isFinite(p.gamma)||p.x<=0||p.x>=1||p.gamma<=0))throw new Error("Finite positive gamma and 0 < x, maxX < 1 are required.")
  const selected = points.filter((point) => point.x > 0 && point.x <= maxX && point.gamma > 0).sort((a, b) => a.x - b.x)
  const degree = model === "linear" ? 1 : 2
  const fit = polynomialRegression(selected.map((point) => point.x), selected.map((point) => Math.log(point.gamma)), degree)
  const sensitivityPoints = selected.slice(0, -1)
  let sensitivity: number | null = null
  if (sensitivityPoints.length >= degree + 2) sensitivity = Math.abs(Math.exp(polynomialRegression(sensitivityPoints.map((point) => point.x), sensitivityPoints.map((point) => Math.log(point.gamma)), degree).coefficients[0]) - Math.exp(fit.coefficients[0]))
  if(!Number.isFinite(Math.exp(fit.coefficients[0])))throw new Error("Extrapolation overflows; inspect fit domain and model.")
  return { model, gammaInfinity: Math.exp(fit.coefficients[0]), lnGammaInfinity: fit.coefficients[0], r2: fit.r2, ci95: [Math.exp(fit.interceptCi95[0]), Math.exp(fit.interceptCi95[1])] as [number, number], maxX, sensitivity, coefficients:fit.coefficients,residuals:fit.residuals,sampledX:selected.map(p=>p.x) }
}

function ranks(values: number[]) {
  const ordered = values.map((value, index) => ({ value, index })).sort((a, b) => a.value - b.value)
  const output = Array(values.length).fill(0)
  for (let start = 0; start < ordered.length;) {
    let end = start
    while (end + 1 < ordered.length && ordered[end + 1].value === ordered[start].value) end++
    const rank = (start + end + 2) / 2
    for (let i = start; i <= end; i++) output[ordered[i].index] = rank
    start = end + 1
  }
  return output
}

export function pearson(left: number[], right: number[]) {
  if (left.length !== right.length || left.length < 2) return Number.NaN
  const lm = mean(left), rm = mean(right)
  const numerator = left.reduce((sum, value, i) => sum + (value - lm) * (right[i] - rm), 0)
  const denominator = Math.sqrt(left.reduce((sum, value) => sum + (value - lm) ** 2, 0) * right.reduce((sum, value) => sum + (value - rm) ** 2, 0))
  return denominator ? numerator / denominator : Number.NaN
}

export const spearman = (left: number[], right: number[]) => pearson(ranks(left), ranks(right))

export function comparisonStatistics(left: number[], right: number[]) {
  if (left.length !== right.length || !left.length) throw new Error("Comparison metrics require equally sized, non-empty paired arrays.")
  const differences = left.map((value, i) => right[i] - value)
  const sign = (value: number) => value < 0 ? -1 : value > 0 ? 1 : 0
  let comparable = 0, agreement = 0, reversals = 0
  for (let i = 0; i < left.length; i++) for (let j = i + 1; j < left.length; j++) {
    const a = sign(left[i] - left[j]), b = sign(right[i] - right[j])
    if (a === 0 || b === 0) continue
    comparable++
    if (a === b) agreement++; else reversals++
  }
  return { pearson: pearson(left, right), spearman: spearman(left, right), rmse: Math.sqrt(mean(differences.map((value) => value ** 2))), mae: mean(differences.map(Math.abs)), mape: left.some((value) => value === 0) ? null : 100 * mean(differences.map((value, i) => Math.abs(value / left[i]))), rankingAgreement: comparable ? agreement / comparable : null, rankReversals: reversals, comparablePairs: comparable }
}

export function runValidationSuite(): ValidationResult[] {
  const timestamp = new Date().toISOString()
  const create = (id: string, name: string, tolerance: number, expected: number | string, calculated: number | string, absoluteError: number | null, relativeError: number | null, detail: string): ValidationResult => ({ id, name, passed: absoluteError === null ? expected === calculated : absoluteError <= tolerance, tolerance, expected, calculated, absoluteError, relativeError, detail, runAt: timestamp })
  const radius = Array.from({ length: 2001 }, (_, i) => i * 0.005)
  const integrate = (g: number[]) => runningKbi(radius,g,"trapezoidal").at(-1)!

  const ideal = integrate(radius.map(() => 1))
  const amplitude = 0.7, lambda = 0.35
  const exponential = integrate(radius.map((r) => 1 + amplitude * Math.exp(-r / lambda)))
  const analytic = 8 * Math.PI * amplitude * lambda ** 3
  const ssmPoints: SSMPoint[] = [1.5, 2, 2.5, 3, 4].map((length, i) => ({ id: `synthetic-${i}`, stateKey: "validation", desId: "", soluteId: "", speciesA: "A", speciesB: "B", temperatureK: 300, soluteCount: 1, effectiveLengthNm: length, finiteKbiNm3: 2.4 - 0.8 / length, uncertaintyNm3: null, replica: 1, source: "synthetic", accepted: true }))
  const ssm = fitSsm(ssmPoints, "g-vs-inverse-l", 3)
  const matrix = [[2, 0.2, 0.1], [0.2, 1.5, 0.05], [0.1, 0.05, 1.2]]
  const inverted = inverse(matrix)
  const product = matrix.map((row) => inverted[0].map((_, column) => row.reduce((sum, value, k) => sum + value * inverted[k][column], 0)))
  const matrixError = Math.max(...product.flatMap((row, i) => row.map((value, j) => Math.abs(value - (i === j ? 1 : 0)))))
  const x = [0.01, 0.03, 0.06, 0.1, 0.15], coefficient = 1.8
  const activity = integrateActivity(x.map((value) => ({ x: value, thermodynamicFactor: 1 + coefficient * value })), "linear")
  const gammaError = Math.max(...activity.map((point) => Math.abs(point.lnGammaRelative - coefficient * (point.x - x[0]))))
  return [
    create("ideal-rdf", "Ideal RDF g(r)=1", 1e-12, 0, ideal, Math.abs(ideal), Math.abs(ideal), "Trapezoidal running KBI must remain zero."),
    create("exponential-rdf", "Analytic exponential RDF", 2e-5, analytic, exponential, Math.abs(exponential - analytic), Math.abs(exponential - analytic) / Math.abs(analytic), "Long-domain numerical integral compared with 8πAλ³."),
    create("ssm-synthetic", "Constant finite-size SSM", 1e-10, "G∞=2.4; F∞=-0.8", `G∞=${ssm.gInfinityNm3}; F∞=${ssm.fInfinityNm4}`, Math.max(Math.abs(ssm.gInfinityNm3 - 2.4), Math.abs(ssm.fInfinityNm4 + 0.8)), null, "Exact synthetic G(L)=G∞+F∞/L."),
    create("matrix-inverse", "Matrix inversion", 1e-12, "I", `max diagonal error ${matrixError}`, matrixError, null, `Condition number ${conditionNumber(matrix).toPrecision(6)}.`),
    create("gamma-integral", "Activity integration consistency", 2e-6, "ln γ relative = a(x-xmin)", `maximum error ${gammaError}`, gammaError, null, "Synthetic Γ(x)=1+ax has an analytic relative integral."),
  ]
}

export const defaultScientificState = () => ({ schemaVersion: "0.2" as const, ssmPoints: [], ssmFits: [], thermodynamicResults: [], activityResults: [], cosmoRecords: [], observables: [], validationResults: [], matrixOverrides: [], convergenceDecisions: [], commandProvenance: [] })
