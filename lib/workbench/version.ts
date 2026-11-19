export const SOFTWARE_VERSION = "2.0.0"
export const SCHEMA_VERSION = "3.0"

export const COMMON_FORCE_FIELDS = [
  { name: "OPLS-AA", include: "oplsaa.ff/forcefield.itp", defaults: "" },
  { name: "GAFF2 (self-contained)", include: "", defaults: "1 2 yes 0.5 0.83333333" },
  { name: "GAFF (self-contained)", include: "", defaults: "1 2 yes 0.5 0.83333333" },
  { name: "AMBER99SB-ILDN", include: "amber99sb-ildn.ff/forcefield.itp", defaults: "" },
  { name: "AMBER14SB", include: "amber14sb.ff/forcefield.itp", defaults: "" },
  { name: "CHARMM36", include: "charmm36.ff/forcefield.itp", defaults: "" },
  { name: "CGenFF (self-contained)", include: "", defaults: "1 2 yes 1.0 1.0" },
  { name: "GROMOS 54a7", include: "gromos54a7.ff/forcefield.itp", defaults: "" },
  { name: "OpenFF (self-contained)", include: "", defaults: "1 2 yes 0.5 0.83333333" },
  { name: "Custom / Self-contained", include: "", defaults: "" },
] as const

export const COMMON_CHARGE_SCHEMES = [
  "RESP",
  "CHELPG",
  "CM5",
  "Hirshfeld",
  "Mulliken",
  "Loewdin",
  "NPA / NBO",
  "MBIS",
  "APT",
  "AM1-BCC",
  "xTB",
  "Topology native",
  "Custom",
] as const
