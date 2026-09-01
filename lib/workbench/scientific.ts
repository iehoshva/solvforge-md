import type { ActivityResult, SSMFit, SSMPoint, ThermodynamicResult, ValidationResult } from "./types"

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
  const weights = x.map((_, index) => {
    const value = uncertainty?.[index]
    return value && value > 0 ? 1 / value ** 2 : 1
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
  const accepted = points.filter((point) => point.accepted)
  if (accepted.length < minimumPoints) throw new Error(`Insufficient finite-size data: ${accepted.length} accepted point(s); at least ${minimumPoints} required.`)
  if (new Set(accepted.map((point) => point.effectiveLengthNm)).size < minimumPoints) throw new Error("Insufficient distinct finite-size lengths for extrapolation.")
  let x: number[]
  let y: number[]
  let uncertainty: Array<number | null>
  if (representation === "g-vs-inverse-l") {
    x = accepted.map((point) => 1 / point.effectiveLengthNm)
    y = accepted.map((point) => point.finiteKbiNm3)
    uncertainty = accepted.map((point) => point.uncertaintyNm3)
  } else {
    x = accepted.map((point) => point.effectiveLengthNm)
    y = accepted.map((point) => point.effectiveLengthNm * point.finiteKbiNm3)
    uncertainty = accepted.map((point) => point.uncertaintyNm3 === null ? null : point.effectiveLengthNm * point.uncertaintyNm3)
  }
  const regression = weightedLinearRegression(x, y, uncertainty)
  const gInfinityNm3 = representation === "g-vs-inverse-l" ? regression.intercept : regression.slope
  const fInfinityNm4 = representation === "g-vs-inverse-l" ? regression.slope : regression.intercept
  const gInfinitySe = representation === "g-vs-inverse-l" ? regression.interceptSe : regression.slopeSe
  const fInfinitySe = representation === "g-vs-inverse-l" ? regression.slopeSe : regression.interceptSe
  const gInfinityCi95 = representation === "g-vs-inverse-l" ? regression.interceptCi95 : regression.slopeCi95
  const fInfinityCi95 = representation === "g-vs-inverse-l" ? regression.slopeCi95 : regression.interceptCi95
  return { id: crypto.randomUUID(), stateKey: accepted[0].stateKey, pairKey: [accepted[0].speciesA, accepted[0].speciesB].sort().join("—"), representation, pointIds: accepted.map((point) => point.id), gInfinityNm3, fInfinityNm4, gInfinitySe, fInfinitySe, gInfinityCi95, fInfinityCi95, r2: regression.r2, residuals: regression.residuals, leverage: regression.leverage, accepted: false, createdAt: new Date().toISOString() }
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
 * Ternary Kirkwood–Buff thermodynamic factors at constant T,p.
 * Species 3 is the dependent composition coordinate. Equations are the explicit
 * ternary form reported by Fingerhut et al. (Mol. Phys. 2020, DOI 10.1080/00268976.2019.1643046).
 * G is in volume units and rho in inverse-volume units, so every Gamma is dimensionless.
 */
export function ternaryThermodynamicFactor(kbi: number[][], densities: number[]) {
  if (kbi.length !== 3 || kbi.some((row) => row.length !== 3) || densities.length !== 3) throw new Error("The implemented ternary formalism requires a complete 3 × 3 KB matrix and three densities.")
  if (densities.some((value) => !Number.isFinite(value) || value <= 0)) throw new Error("All three molecular number densities must be positive and finite.")
  const [r1, r2, r3] = densities
  const [g11, g12, g13, g22, g23, g33] = [kbi[0][0], kbi[0][1], kbi[0][2], kbi[1][1], kbi[1][2], kbi[2][2]]
  const d12 = g11 + g22 - 2 * g12
  const d13 = g11 + g33 - 2 * g13
  const d23 = g22 + g33 - 2 * g23
  const eta = r1 + r2 + r3 + r1 * r2 * d12 + r1 * r3 * d13 + r2 * r3 * d23 - 0.25 * r1 * r2 * r3 * (d12 ** 2 + d13 ** 2 + d23 ** 2 - 2 * (d13 * d23 + d12 * d13 + d12 * d23))
  if (!Number.isFinite(eta) || Math.abs(eta) < 1e-14) throw new Error("The ternary thermodynamic-factor denominator η is singular or numerically unstable.")
  const gamma11 = (r1 + r2 + r3 + r1 * r2 * (g22 - g12 + g13 - g23) + r2 * r3 * d23) / eta
  const gamma12 = r1 * (r2 * (g22 - g12 + g13 - g23) - r3 * (g33 - g13 + g12 - g23)) / eta
  const gamma21 = r2 * (r1 * (g11 - g12 + g23 - g13) - r3 * (g33 - g13 + g12 - g23)) / eta
  const gamma22 = (r1 + r2 + r3 + r1 * r2 * (g11 - g12 - g13 + g23) + r1 * r3 * d13) / eta
  const transformedB = kbi.map((row, i) => row.map((gij, j) => densities[i] * densities[j] * gij + (i === j ? densities[i] : 0)))
  const inverseB = inverse(transformedB)
  const desFractionComponent2 = r2 / (r2 + r3)
  // Along a fixed component-2:component-3 DES ratio, dx2/dx1 = -q.
  const fixedDesRatioSoluteGamma = gamma11 - desFractionComponent2 * gamma12
  return { eta, gammaMatrix: [[gamma11, gamma12], [gamma21, gamma22]], transformedB, inverseB, determinantB: determinant(transformedB), conditionNumber: conditionNumber(transformedB, inverseB), fixedDesRatioSoluteGamma }
}

function seededRandom(seed: number) {
  let state = seed >>> 0
  return () => { state += 0x6D2B79F5; let value = state; value = Math.imul(value ^ value >>> 15, value | 1); value ^= value + Math.imul(value ^ value >>> 7, value | 61); return ((value ^ value >>> 14) >>> 0) / 4294967296 }
}

function normalSample(random: () => number) {
  const u = Math.max(Number.EPSILON, random())
  const v = random()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}

export function propagateTernaryUncertainty(kbi: number[][], uncertainty: number[][], densities: number[], samples: number, seed: number) {
  const random = seededRandom(seed)
  const results: number[] = []
  for (let sample = 0; sample < samples; sample++) {
    const drawn = kbi.map((row) => [...row])
    for (let i = 0; i < 3; i++) for (let j = i; j < 3; j++) {
      const sigma = uncertainty[i]?.[j] ?? uncertainty[j]?.[i] ?? 0
      const value = kbi[i][j] + (sigma > 0 ? sigma * normalSample(random) : 0)
      drawn[i][j] = value
      drawn[j][i] = value
    }
    try { results.push(ternaryThermodynamicFactor(drawn, densities).fixedDesRatioSoluteGamma) } catch { /* invalid draw is reported through validSamples */ }
  }
  if (!results.length) throw new Error("Every uncertainty draw produced an invalid thermodynamic matrix.")
  return { sd: sampleSd(results), ci95: [quantile(results, 0.025), quantile(results, 0.975)] as [number, number], validSamples: results.length, requestedSamples: samples }
}

export function buildThermodynamicResult(input: Omit<ThermodynamicResult, "id" | "transformedB" | "inverseB" | "determinantB" | "conditionNumber" | "gammaMatrix" | "fixedDesRatioSoluteGamma" | "uncertainty" | "createdAt">, bootstrapSamples: number, seed: number): ThermodynamicResult {
  const calculation = ternaryThermodynamicFactor(input.kbiMatrixNm3, input.numberDensitiesNm3)
  const hasUncertainty = input.kbiUncertaintyNm3.some((row) => row.some((value) => value > 0))
  return { ...input, id: crypto.randomUUID(), transformedB: calculation.transformedB, inverseB: calculation.inverseB, determinantB: calculation.determinantB, conditionNumber: calculation.conditionNumber, gammaMatrix: calculation.gammaMatrix, fixedDesRatioSoluteGamma: calculation.fixedDesRatioSoluteGamma, uncertainty: hasUncertainty ? propagateTernaryUncertainty(input.kbiMatrixNm3, input.kbiUncertaintyNm3, input.numberDensitiesNm3, bootstrapSamples, seed) : undefined, createdAt: new Date().toISOString() }
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
  return points.map((_, i) => {
    if (i === 0) return secants[0]
    if (i === points.length - 1) return secants.at(-1)!
    if (secants[i - 1] * secants[i] <= 0) return 0
    return 2 / (1 / secants[i - 1] + 1 / secants[i])
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
  const points = [...input].filter((point) => point.x > 0 && Number.isFinite(point.thermodynamicFactor)).sort((a, b) => a.x - b.x)
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
  if (anchor.gamma !== null && anchor.gamma > 0) {
    if (anchor.type === "infinite-dilution") shift = Math.log(anchor.gamma)
    else if (anchor.type === "composition" && anchor.x !== null) {
      const anchorIndex = points.reduce((best, point, index) => Math.abs(point.x - anchor.x!) < Math.abs(points[best].x - anchor.x!) ? index : best, 0)
      shift = Math.log(anchor.gamma) - integrated[anchorIndex]
    }
  }
  return points.map((point, i) => ({ x: point.x, thermodynamicFactor: point.thermodynamicFactor, lnGammaRelative: integrated[i], gammaRelative: Math.exp(integrated[i]), gammaAbsolute: shift === null ? null : Math.exp(integrated[i] + shift) }))
}

export function polynomialRegression(x: number[], y: number[], degree: 1 | 2) {
  if (x.length < degree + 2) throw new Error(`A degree-${degree} fit requires at least ${degree + 2} points.`)
  if (degree === 1) {
    const fit = weightedLinearRegression(x, y)
    return { coefficients: [fit.intercept, fit.slope], r2: fit.r2, residuals: fit.residuals, interceptSe: fit.interceptSe, interceptCi95: fit.interceptCi95 }
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
  return { coefficients, r2: total ? 1 - sse / total : 1, residuals, interceptSe, interceptCi95: [coefficients[0] - critical * interceptSe, coefficients[0] + critical * interceptSe] as [number, number] }
}

export function extrapolateInfiniteDilution(points: Array<{ x: number; gamma: number }>, model: "linear" | "quadratic", maxX: number) {
  const selected = points.filter((point) => point.x > 0 && point.x <= maxX && point.gamma > 0).sort((a, b) => a.x - b.x)
  const degree = model === "linear" ? 1 : 2
  const fit = polynomialRegression(selected.map((point) => point.x), selected.map((point) => Math.log(point.gamma)), degree)
  const sensitivityPoints = selected.slice(0, -1)
  let sensitivity: number | null = null
  if (sensitivityPoints.length >= degree + 2) sensitivity = Math.abs(Math.exp(polynomialRegression(sensitivityPoints.map((point) => point.x), sensitivityPoints.map((point) => Math.log(point.gamma)), degree).coefficients[0]) - Math.exp(fit.coefficients[0]))
  return { model, gammaInfinity: Math.exp(fit.coefficients[0]), lnGammaInfinity: fit.coefficients[0], r2: fit.r2, ci95: [Math.exp(fit.interceptCi95[0]), Math.exp(fit.interceptCi95[1])] as [number, number], maxX, sensitivity }
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
  const integrate = (g: number[]) => {
    let total = 0
    for (let i = 1; i < radius.length; i++) {
      const a = 4 * Math.PI * (g[i - 1] - 1) * radius[i - 1] ** 2, b = 4 * Math.PI * (g[i] - 1) * radius[i] ** 2
      total += 0.5 * (a + b) * (radius[i] - radius[i - 1])
    }
    return total
  }
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
