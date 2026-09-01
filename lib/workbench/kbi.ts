import type { KBIAnalysis, RDFDataset } from "./types"
import { median, sampleSd, tCritical95 } from "./scientific"

export function parseXvg(text: string, filename: string): Omit<RDFDataset, "id" | "metadata">[] {
  const comments: string[] = []
  const legends: Record<number, string> = {}
  let xLabel = "r"
  let yLabel = "g(r)"
  const rows: number[][] = []
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue
    if (line.startsWith("#")) { comments.push(line.slice(1).trim()); continue }
    if (line.startsWith("@")) {
      const lm = line.match(/@\s+s(\d+)\s+legend\s+[\"'](.+)[\"']/i)
      if (lm) legends[Number(lm[1])] = lm[2]
      const xm = line.match(/xaxis\s+label\s+[\"'](.+)[\"']/i)
      const ym = line.match(/yaxis\s+label\s+[\"'](.+)[\"']/i)
      if (xm) xLabel = xm[1]
      if (ym) yLabel = ym[1]
      comments.push(line)
      continue
    }
    const nums = line.split(/[\s,;]+/).map(Number)
    if (nums.length >= 2 && nums.every(Number.isFinite)) rows.push(nums)
  }
  if (rows.length < 2) throw new Error("No numeric RDF rows were found.")
  const seriesCount = Math.max(...rows.map((r) => r.length)) - 1
  return Array.from({ length: seriesCount }, (_, series) => {
    const valid = rows.filter((r) => Number.isFinite(r[series + 1]))
    return { sourceFilename: filename, sourceFormat: "xvg" as const, radiusRaw: valid.map((r) => r[0]), radiusNm: [], g: valid.map((r) => r[series + 1]), comments, legend: legends[series] ?? `series ${series + 1}`, xLabel, yLabel }
  })
}

export function parseCsv(text: string, filename: string): Omit<RDFDataset, "id" | "metadata">[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  if (lines.length < 2) throw new Error("CSV needs a header or at least two numeric rows.")
  const split = (line: string) => line.split(/[,;\t]/).map((s) => s.trim())
  const first = split(lines[0])
  const hasHeader = first.some((v) => !Number.isFinite(Number(v)))
  const headers = hasHeader ? first : first.map((_, i) => i === 0 ? "r" : `g${i}`)
  const dataLines = hasHeader ? lines.slice(1) : lines
  const rows = dataLines.map(split).map((row) => row.map(Number)).filter((row) => row.length >= 2 && row.every(Number.isFinite))
  if (rows.length < 2) throw new Error("No usable numeric RDF rows were found in the CSV.")
  return headers.slice(1).map((header, series) => {
    const valid = rows.filter((r) => Number.isFinite(r[series + 1]))
    return { sourceFilename: filename, sourceFormat: "csv" as const, radiusRaw: valid.map((r) => r[0]), radiusNm: [], g: valid.map((r) => r[series + 1]), comments: [], legend: header, xLabel: headers[0] || "r", yLabel: header }
  })
}

export function movingAverage(values: number[], window: number) {
  const w = Math.max(1, Math.floor(window))
  return values.map((_, i) => {
    const start = Math.max(0, i - Math.floor(w / 2))
    const end = Math.min(values.length, i + Math.ceil(w / 2))
    const slice = values.slice(start, end)
    return slice.reduce((a, b) => a + b, 0) / slice.length
  })
}

export function rebin(radius: number[], g: number[], factor: number) {
  const f = Math.max(1, Math.floor(factor))
  if (f === 1) return { radius, g }
  const r: number[] = [], y: number[] = []
  for (let i = 0; i < radius.length; i += f) {
    const rs = radius.slice(i, i + f), gs = g.slice(i, i + f)
    r.push(rs.reduce((a, b) => a + b, 0) / rs.length)
    y.push(gs.reduce((a, b) => a + b, 0) / gs.length)
  }
  return { radius: r, g: y }
}

/** Running KBI: G(R)=4π∫0^R[g(r)-1]r²dr. With r in nm, G is in nm³. */
export function runningKbi(radiusNm: number[], g: number[], method: "trapezoidal" | "simpson" = "trapezoidal") {
  const out = [0]
  const f = radiusNm.map((r, i) => 4 * Math.PI * (g[i] - 1) * r * r)
  for (let i = 1; i < radiusNm.length; i++) {
    const trapezoid = 0.5 * (f[i - 1] + f[i]) * (radiusNm[i] - radiusNm[i - 1])
    if (method === "simpson" && i >= 2) {
      const h1 = radiusNm[i - 1] - radiusNm[i - 2], h2 = radiusNm[i] - radiusNm[i - 1]
      const uniform = Math.abs(h1 - h2) <= Math.max(1e-12, 1e-5 * Math.max(h1, h2))
      if (uniform && i % 2 === 0) out.push(out[i - 2] + (h1 + h2) * (f[i - 2] + 4 * f[i - 1] + f[i]) / 6)
      else out.push(out[i - 1] + trapezoid)
    } else out.push(out[i - 1] + trapezoid)
  }
  return out
}

export function linearStats(x: number[], y: number[]) {
  const n = x.length
  const mx = x.reduce((a, b) => a + b, 0) / n
  const my = y.reduce((a, b) => a + b, 0) / n
  const denom = x.reduce((s, v) => s + (v - mx) ** 2, 0)
  const slope = denom ? x.reduce((s, v, i) => s + (v - mx) * (y[i] - my), 0) / denom : 0
  const intercept = my - slope * mx
  const variance = y.reduce((s, v) => s + (v - my) ** 2, 0) / Math.max(1, n - 1)
  const residual = y.reduce((s, v, i) => s + (v - (slope * x[i] + intercept)) ** 2, 0)
  const total = y.reduce((s, v) => s + (v - my) ** 2, 0)
  return { slope, intercept, mean: my, variance, r2: total ? 1 - residual / total : 1 }
}

export function suggestPlateau(radius: number[], kbi: number[], minWidthNm: number, maxAbsSlope = Number.POSITIVE_INFINITY, maxVariance = Number.POSITIVE_INFINITY) {
  const candidates: Array<{ start: number; end: number; slope: number; variance: number; mean: number; score: number }> = []
  for (let i = 0; i < radius.length - 5; i++) for (let j = i + 4; j < radius.length; j++) {
    if (radius[j] - radius[i] < minWidthNm) continue
    const stats = linearStats(radius.slice(i, j + 1), kbi.slice(i, j + 1))
    const scale = Math.max(1e-9, Math.abs(stats.mean))
    const score = Math.abs(stats.slope) / scale + Math.sqrt(stats.variance) / scale - 0.02 * (radius[j] - radius[i])
    candidates.push({ start: radius[i], end: radius[j], slope: stats.slope, variance: stats.variance, mean: stats.mean, score })
  }
  if (!candidates.length) return null
  const passing = candidates.filter((candidate) => Math.abs(candidate.slope) <= maxAbsSlope && candidate.variance <= maxVariance)
  return (passing.length ? passing : candidates).sort((a, b) => a.score - b.score)[0]
}

export function analyzeDataset(dataset: RDFDataset, options: { startNm?: number; endNm?: number; smoothing: "none" | "moving-average"; smoothingWindow: number; rebinFactor: number; minWidthNm: number; maxAbsSlope?: number; maxVariance?: number; manual: boolean; integrationMethod?: "trapezoidal" | "simpson" }): KBIAnalysis {
  const factor = dataset.metadata.distanceUnit === "angstrom" ? 0.1 : 1
  const radiusNm = dataset.radiusRaw.map((r) => r * factor)
  if (!dataset.metadata.distanceUnit) throw new Error("Select the RDF distance unit before integration.")
  if (radiusNm.some((value, i) => i > 0 && value <= radiusNm[i - 1])) throw new Error("RDF radii must be strictly increasing.")
  const rebinned = rebin(radiusNm, dataset.g, options.rebinFactor)
  const processedG = options.smoothing === "moving-average" ? movingAverage(rebinned.g, options.smoothingWindow) : [...rebinned.g]
  const integrationMethod = options.integrationMethod ?? "trapezoidal"
  const rawRunning = runningKbi(radiusNm, dataset.g, integrationMethod)
  const running = runningKbi(rebinned.radius, processedG, integrationMethod)
  const suggested = suggestPlateau(rebinned.radius, running, options.minWidthNm, options.maxAbsSlope, options.maxVariance)
  const start = options.startNm ?? suggested?.start ?? rebinned.radius[Math.floor(rebinned.radius.length * 0.75)]
  const end = options.endNm ?? suggested?.end ?? rebinned.radius[rebinned.radius.length - 1]
  const idx = rebinned.radius.map((r, i) => ({ r, i })).filter((p) => p.r >= start && p.r <= end).map((p) => p.i)
  if (idx.length < 3) throw new Error("Plateau interval must contain at least three RDF points.")
  const plateauValues = idx.map((i) => running[i])
  const stats = linearStats(idx.map((i) => rebinned.radius[i]), plateauValues)
  const sd = sampleSd(plateauValues)
  const localVariation = Math.abs(stats.mean) > 1e-12 ? sd / Math.abs(stats.mean) : sd
  return { rawRunningKbiNm3: rawRunning, radiusNm: rebinned.radius, runningKbiNm3: running, processedG, plateauStartNm: start, plateauEndNm: end, estimateNm3: stats.mean, plateauMedianNm3: median(plateauValues), plateauSdNm3: sd, plateauSampleCount: plateauValues.length, plateauWidthNm: end - start, plateauLocalVariation: localVariation, plateauSlope: stats.slope, plateauVariance: stats.variance, plateauStatus: options.manual ? "manual" : suggested ? "candidate" : "unstable", integrationMethod, smoothing: options.smoothing, smoothingWindow: options.smoothingWindow, rebinFactor: options.rebinFactor, analyzedAt: new Date().toISOString() }
}

export function summarizeReplicas(datasets: RDFDataset[]) {
  const groups = new Map<string, RDFDataset[]>()
  for (const d of datasets.filter((x) => x.analysis)) {
    const m = d.metadata
    const key = [m.speciesA, m.speciesB, m.temperatureK, m.pressureBar, m.soluteCount, m.composition, m.boxDimensionsNm].join("|")
    groups.set(key, [...(groups.get(key) ?? []), d])
  }
  return [...groups.entries()].map(([key, ds]) => {
    const values = ds.map((d) => d.analysis!.estimateNm3)
    const mean = values.reduce((a, b) => a + b, 0) / values.length
    const sd = values.length > 1 ? Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / (values.length - 1)) : null
    const se = sd === null ? null : sd / Math.sqrt(values.length)
    const critical = se === null ? null : tCritical95(values.length - 1)
    const ci95 = critical === null ? null : [mean - critical * se!, mean + critical * se!] as [number, number]
    const cv = sd === null || Math.abs(mean) < 1e-12 ? null : sd / Math.abs(mean)
    return { key, n: values.length, mean, sd, se, ci95, cv, values }
  })
}
