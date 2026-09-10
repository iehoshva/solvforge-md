"use client"

import type { MouseEvent, ReactNode } from "react"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"

export function ViewHeader({ eyebrow, title, description, actions }: { eyebrow: string; title: string; description: string; actions?: ReactNode }) {
  return <header className="view-header">
    <div>
      <p className="eyebrow">{eyebrow}</p>
      <h1>{title}</h1>
      <p className="view-description">{description}</p>
    </div>
    {actions && <div className="view-actions">{actions}</div>}
  </header>
}

export function Section({ title, kicker, actions, children, className = "" }: { title: string; kicker?: string; actions?: ReactNode; children: ReactNode; className?: string }) {
  return <section className={`instrument-section ${className}`}>
    <div className="section-heading">
      <div>{kicker && <span>{kicker}</span>}<h2>{title}</h2></div>
      {actions && <div className="section-actions">{actions}</div>}
    </div>
    {children}
  </section>
}

export function Field({ label, value, onChange, type = "text", step, min, max, placeholder, note, disabled }: { label: string; value: string | number; onChange: (value: string) => void; type?: string; step?: string; min?: string | number; max?: string | number; placeholder?: string; note?: string; disabled?: boolean }) {
  return <div className="field-stack">
    <Label>{label}</Label>
    <Input aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} type={type} step={step} min={min} max={max} placeholder={placeholder} disabled={disabled} />
    {note && <small>{note}</small>}
  </div>
}

export function TextField({ label, value, onChange, placeholder, rows = 3, note }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string; rows?: number; note?: string }) {
  return <div className="field-stack">
    <Label>{label}</Label>
    <Textarea aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} rows={rows} />
    {note && <small>{note}</small>}
  </div>
}

export function Metric({ label, value, detail, tone = "neutral" }: { label: string; value: ReactNode; detail?: string; tone?: "neutral" | "good" | "warning" | "accent" }) {
  return <div className={`metric metric-${tone}`}><span>{label}</span><strong>{value}</strong>{detail && <small>{detail}</small>}</div>
}

export function StatusBadge({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "good" | "warning" | "danger" | "accent" }) {
  return <Badge variant="outline" className={`status-badge status-${tone}`}>{children}</Badge>
}

export function EmptyEvidence({ text = "Insufficient evidence" }: { text?: string }) {
  return <div className="empty-evidence"><span>∅</span><div><strong>{text}</strong><p>Import and validate analysis data before scientific interpretation.</p></div></div>
}

export function InlineWarning({ title, children }: { title: string; children: ReactNode }) {
  return <div className="inline-warning"><strong>{title}</strong><p>{children}</p></div>
}

export function formatNumber(value: number | null | undefined, digits = 4) {
  return value === null || value === undefined || !Number.isFinite(value) ? "—" : value.toFixed(digits)
}

export function SvgPlot({ x, y, secondary, xLabel, yLabel, plateau, title, onSelectX }: { x: number[]; y: number[]; secondary?: number[]; xLabel: string; yLabel: string; plateau?: [number, number]; title?: string; onSelectX?: (value: number) => void }) {
  if (x.length < 2 || y.length < 2) return <div className="plot-empty">No plottable data</div>
  if(x.length!==y.length||secondary&&secondary.length!==x.length||[...x,...y,...(secondary??[])].some(v=>!Number.isFinite(v))) return <div className="plot-empty">Plot unavailable: missing, non-finite or mismatched series values.</div>
  const w = 760, h = 300, m = { l: 58, r: 18, t: 24, b: 46 }
  const allY = secondary ? [...y, ...secondary] : y
  const xmin = x.reduce((a, b) => Math.min(a, b), Infinity), xmax = x.reduce((a, b) => Math.max(a, b), -Infinity), ymin = allY.reduce((a, b) => Math.min(a, b), Infinity), ymax = allY.reduce((a, b) => Math.max(a, b), -Infinity)
  const sx = (v: number) => m.l + ((v - xmin) / (xmax - xmin || 1)) * (w - m.l - m.r)
  const sy = (v: number) => h - m.b - ((v - ymin) / (ymax - ymin || 1)) * (h - m.t - m.b)
  const path = (values: number[]) => values.map((v, i) => `${i ? "L" : "M"}${sx(x[i]).toFixed(1)},${sy(v).toFixed(1)}`).join(" ")
  const ticks = Array.from({ length: 5 }, (_, i) => i / 4)
  return <div className="plot-wrap">
    <svg viewBox={`0 0 ${w} ${h}`} role="img" aria-label={title ?? `${yLabel} against ${xLabel}`} className={onSelectX ? "plot-interactive" : undefined} onClick={onSelectX ? (event: MouseEvent<SVGSVGElement>) => { const bounds = event.currentTarget.getBoundingClientRect(); const pixel = (event.clientX - bounds.left) * w / bounds.width; const clamped = Math.max(m.l, Math.min(w - m.r, pixel)); onSelectX(xmin + (clamped - m.l) / (w - m.l - m.r) * (xmax - xmin)) } : undefined}>
      <style>{`.grid-line{stroke:#d9dfdb;stroke-width:1}.axis-line{stroke:#6e7d73;stroke-width:1}.plot-line{fill:none;stroke:#286144;stroke-width:2}.plot-line-secondary{stroke:#a66e32;stroke-dasharray:5 3}.plateau-zone{fill:#d8eadb;opacity:.7}text{fill:#27362e;font:11px system-ui}.axis-label{font-size:12px}`}</style>
      {plateau && <rect x={sx(plateau[0])} y={m.t} width={Math.max(0, sx(plateau[1]) - sx(plateau[0]))} height={h - m.t - m.b} className="plateau-zone" />}
      {ticks.map((t) => <g key={`y${t}`}><line x1={m.l} x2={w - m.r} y1={m.t + t * (h - m.t - m.b)} y2={m.t + t * (h - m.t - m.b)} className="grid-line"/><text x={m.l - 8} y={m.t + t * (h - m.t - m.b) + 4} textAnchor="end">{(ymax - t * (ymax - ymin)).toPrecision(3)}</text></g>)}
      {ticks.map((t) => <text key={`x${t}`} x={m.l + t * (w - m.l - m.r)} y={h - 19} textAnchor="middle">{(xmin + t * (xmax - xmin)).toPrecision(3)}</text>)}
      <line x1={m.l} x2={m.l} y1={m.t} y2={h - m.b} className="axis-line"/><line x1={m.l} x2={w - m.r} y1={h - m.b} y2={h - m.b} className="axis-line"/>
      <path d={path(y)} className="plot-line"/>
      {secondary && <path d={path(secondary)} className="plot-line plot-line-secondary"/>}
      <text x={(m.l + w - m.r) / 2} y={h - 2} textAnchor="middle" className="axis-label">{xLabel}</text>
      <text transform={`translate(14 ${(m.t + h - m.b) / 2}) rotate(-90)`} textAnchor="middle" className="axis-label">{yLabel}</text>
    </svg>
  </div>
}
