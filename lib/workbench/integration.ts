/** Cumulative 4π∫[g(r)−1]r²dr from the first supplied radius, nm → nm³.
 * No unobserved origin contribution is assumed. The caller must prepend an
 * explicit researcher-selected origin, or report the positive lower bound.
 * Simpson is applied to uniform adjacent pairs; unmatched/nonuniform steps use trapezoids.
 */
export function runningKbi(radius: number[], g: number[], method: "trapezoidal" | "simpson" = "trapezoidal") {
  if (radius.length !== g.length || radius.length < 2 || radius.some((r, i) => !Number.isFinite(r) || r < 0 || (i > 0 && r <= radius[i - 1])) || g.some((v) => !Number.isFinite(v) || v < 0)) throw new Error("RDF requires paired finite g(r)≥0 and strictly increasing nonnegative radii.")
  const f = radius.map((r, i) => 4 * Math.PI * (g[i] - 1) * r * r), result = [0]
  for (let i = 1; i < radius.length; i++) {
    const trapezoid = (f[i-1]+f[i])*(radius[i]-radius[i-1])/2
    const h1 = i > 1 ? radius[i-1]-radius[i-2] : 0, h2 = radius[i]-radius[i-1]
    if (method === "simpson" && i % 2 === 0 && Math.abs(h1-h2) <= Math.max(1e-12,1e-8*Math.max(h1,h2))) result.push(result[i-2]+(h1+h2)*(f[i-2]+4*f[i-1]+f[i])/6)
    else result.push(result[i-1]+trapezoid)
  }
  return result
}
