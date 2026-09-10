/** RFC-4180 quoting, including embedded delimiters/newlines and escaped quotes. */
export function parseTable(text: string, separator?: string): string[][] {
  const first = text.replace(/^\uFEFF/, "").split(/\r?\n/)[0]
  const delimiter = separator ?? (first.includes(",") ? "," : first.includes("\t") ? "\t" : ";")
  const rows: string[][] = [], row: string[] = []; let cell = "", quoted = false
  const input = text.replace(/^\uFEFF/, "")
  for (let i=0;i<input.length;i++) {
    const c=input[i]
    if(c === '"') { if(quoted && input[i+1] === '"'){cell+='"'; i++} else quoted=!quoted }
    else if(c===delimiter && !quoted){ row.push(cell.trim());cell="" }
    else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&input[i+1]==='\n')i++;row.push(cell.trim());if(row.some(v=>v!==""))rows.push([...row]);row.length=0;cell=""}
    else cell+=c
  }
  if(quoted) throw new Error("Unterminated quoted CSV field.")
  row.push(cell.trim());if(row.some(v=>v!==""))rows.push(row)
  return rows
}
export function toCsv(rows: unknown[][]) { return rows.map(row=>row.map(v=>'"'+String(v ?? "").replaceAll('"','""')+'"').join(",")).join("\n") }
