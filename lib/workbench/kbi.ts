import { uuid } from "./crypto.ts"
import type { KBIAnalysis, RDFDataset } from "./types"
import { median, sampleSd } from "./scientific.ts"
import { runningKbi } from "./integration.ts"
export { runningKbi } from "./integration.ts"
import { parseTable } from "./csv.ts"
import { analysisInputSignature, replicaGroups } from "./evidence.ts"
import { SOFTWARE_VERSION } from "./version.ts"

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
    if (nums.length < 2 || !nums.every(Number.isFinite)) throw new Error(`Malformed RDF row: ${line.slice(0, 120)}`)
    if (rows.length && nums.length !== rows[0].length) throw new Error("Inconsistent RDF column counts. Multi-set XVG (& separators) requires separate files.")
    rows.push(nums)
  }
  if (rows.length < 2) throw new Error("No numeric RDF rows were found.")
  const seriesCount = rows[0].length - 1
  return Array.from({ length: seriesCount }, (_, series) => {
    const valid = rows.filter((r) => Number.isFinite(r[series + 1]))
    return { sourceText: text, seriesIndex: series, sourceFilename: filename, sourceFormat: "xvg" as const, radiusRaw: valid.map((r) => r[0]), radiusNm: [], g: valid.map((r) => r[series + 1]), comments, legend: legends[series] ?? `series ${series + 1}`, xLabel, yLabel }
  })
}

export function parseCsv(text: string, filename: string): Omit<RDFDataset, "id" | "metadata">[] {
  const table = parseTable(text)
  if (table.length < 2) throw new Error("CSV needs at least two numeric rows.")
  const hasHeader = table[0].some(v => v.trim() === "" || !Number.isFinite(Number(v)))
  const headers = hasHeader ? table[0] : table[0].map((_, i) => i === 0 ? "r" : "g" + i)
  const rows = (hasHeader ? table.slice(1) : table).map((row, i) => {
    if (row.length !== headers.length || row.length < 2 || row.some(v => v.trim() === "" || !Number.isFinite(Number(v)))) throw new Error("Missing, malformed or inconsistent CSV data at row " + (i + (hasHeader ? 2 : 1)))
    return row.map(Number)
  })
  if (rows.length < 2) throw new Error("At least two numeric RDF rows are required.")
  return headers.slice(1).map((header, series) => ({ sourceText: text, seriesIndex: series, sourceFilename: filename, sourceFormat: "csv", radiusRaw: rows.map(r => r[0]), radiusNm: [], g: rows.map(r => r[series+1]), comments: [], legend: header, xLabel: headers[0], yLabel: header }))
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

export function suggestPlateau(radius: number[], kbi: number[], minWidthNm: number, maxAbsSlope = Infinity, maxVariance = Infinity) {
  if (!(minWidthNm > 0) || maxAbsSlope < 0 || maxVariance < 0) throw new Error("Invalid plateau thresholds.")
  // Prefix sums permit O(1) diagnostics per interval. Bound candidate endpoints for large files.
  const sums = [radius, kbi, radius.map(v=>v*v), kbi.map(v=>v*v), radius.map((v,i)=>v*kbi[i])].map(a=>{const s=[0];for(const v of a)s.push(s.at(-1)!+v);return s})
  const stride=Math.max(1,Math.ceil(radius.length/500))
  let best: {start:number;end:number;slope:number;variance:number;mean:number;score:number} | null=null
  for(let i=0;i<radius.length-4;i+=stride)for(let j=i+4;j<radius.length;j+=stride){
    if(radius[j]-radius[i]<minWidthNm)continue
    const n=j-i+1,[sx,sy,sxx,syy,sxy]=sums.map(s=>s[j+1]-s[i]),denom=sxx-sx*sx/n
    if(denom<=0)continue
    const slope=(sxy-sx*sy/n)/denom,variance=Math.max(0,(syy-sy*sy/n)/(n-1))
    if(Math.abs(slope)>maxAbsSlope||variance>maxVariance)continue
    // Longest passing interval, then smallest absolute slope; no hidden aggregate scientific score.
    const width=radius[j]-radius[i]
    if(!best||width>best.end-best.start||(width===best.end-best.start&&Math.abs(slope)<Math.abs(best.slope)))best={start:radius[i],end:radius[j],slope,variance,mean:sy/n,score:width}
  }
  return best
}

export function analyzeDataset(dataset: RDFDataset, options: { startNm?: number; endNm?: number; smoothing: "none" | "moving-average"; smoothingWindow: number; rebinFactor: number; minWidthNm: number; maxAbsSlope?: number; maxVariance?: number; manual: boolean; originG?: number; integrationMethod?: "trapezoidal" | "simpson" }): KBIAnalysis {
  const factor = dataset.metadata.distanceUnit === "angstrom" ? 0.1 : 1
  const radiusNm = dataset.radiusRaw.map((r) => r * factor)
  if (!["nm", "angstrom"].includes(dataset.metadata.distanceUnit)) throw new Error("Select nm or angstrom explicitly before integration.")
  if (!["none", "moving-average"].includes(options.smoothing)) throw new Error("Unsupported smoothing method.")
  if (radiusNm.some((value, i) => i > 0 && value <= radiusNm[i - 1])) throw new Error("RDF radii must be strictly increasing.")
  if (!Number.isInteger(options.rebinFactor) || options.rebinFactor < 1 || !Number.isInteger(options.smoothingWindow) || options.smoothingWindow < 1) throw new Error("Rebin factor and smoothing window must be positive integers.")
  const rawRadius = [...radiusNm], rawG = [...dataset.g]
  const gap = radiusNm[0] > 0
  const originTreatment = !gap ? "measured-zero" : options.originG === undefined ? "unmeasured-gap" : "researcher-g0"
  if (gap && options.originG !== undefined) {
    if (!Number.isFinite(options.originG) || options.originG < 0) throw new Error("Researcher g(0) must be finite and nonnegative.")
    rawRadius.unshift(0); rawG.unshift(options.originG)
  }
  const rebinned = rebin(rawRadius, rawG, options.rebinFactor)
  if (rebinned.radius[0] !== rawRadius[0]) { rebinned.radius.unshift(rawRadius[0]); rebinned.g.unshift(rawG[0]) }
  if (rebinned.radius.at(-1) !== rawRadius.at(-1)) { rebinned.radius.push(rawRadius.at(-1)!); rebinned.g.push(rawG.at(-1)!) }
  const processedG = options.smoothing === "moving-average" ? movingAverage(rebinned.g, options.smoothingWindow) : [...rebinned.g]
  const integrationMethod = options.integrationMethod ?? "trapezoidal"
  const allRawRunning = runningKbi(rawRadius, rawG, integrationMethod)
  const rawRunning = rawRadius.length > radiusNm.length ? allRawRunning.slice(1) : allRawRunning
  const running = runningKbi(rebinned.radius, processedG, integrationMethod)
  const suggested = options.manual ? null : suggestPlateau(rebinned.radius, running, options.minWidthNm, options.maxAbsSlope, options.maxVariance)
  if (!options.manual && !suggested) throw new Error("No candidate plateau meets the configured width, slope and variance criteria. Inspect the running integral and select an interval explicitly.")
  const start = options.startNm ?? suggested?.start ?? rebinned.radius[Math.floor(rebinned.radius.length * 0.75)]
  const end = options.endNm ?? suggested?.end ?? rebinned.radius[rebinned.radius.length - 1]
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < rebinned.radius[0] || end > rebinned.radius.at(-1)! || end <= start) throw new Error("Plateau interval must lie inside the integrated radial domain with end > start.")
  const idx = rebinned.radius.map((r, i) => ({ r, i })).filter((p) => p.r >= start && p.r <= end).map((p) => p.i)
  if (idx.length < 3) throw new Error("Plateau interval must contain at least three RDF points.")
  const plateauValues = idx.map((i) => running[i])
  const stats = linearStats(idx.map((i) => rebinned.radius[i]), plateauValues)
  const sd = sampleSd(plateauValues)
  const localVariation = Math.abs(stats.mean) > 1e-12 ? sd / Math.abs(stats.mean) : sd
  return { id: uuid(), projectId: dataset.projectId, sourceDatasetId: dataset.id, sourceHash: dataset.sourceHash, inputSignature: analysisInputSignature(dataset), createdWithVersion: SOFTWARE_VERSION, lowerBoundNm: rawRadius[0], originTreatment, originG: options.originG, rawRunningKbiNm3: rawRunning, radiusNm: rebinned.radius, runningKbiNm3: running, processedG, plateauStartNm: start, plateauEndNm: end, estimateNm3: stats.mean, plateauMedianNm3: median(plateauValues), plateauSdNm3: sd, plateauSampleCount: plateauValues.length, plateauWidthNm: end - start, plateauLocalVariation: localVariation, plateauSlope: stats.slope, plateauVariance: stats.variance, plateauStatus: options.manual ? "manual" : suggested ? "candidate" : "unstable", integrationMethod, smoothing: options.smoothing, smoothingWindow: options.smoothingWindow, rebinFactor: options.rebinFactor, analyzedAt: new Date().toISOString() }
}

export function summarizeReplicas(datasets: RDFDataset[]) { return replicaGroups(datasets) }
