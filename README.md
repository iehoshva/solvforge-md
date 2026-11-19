# SolvForge MD

Local-first, **force-field- and QM-agnostic bridge from quantum chemistry to GROMACS** (`v2.0.0`, schema `3.0`, **GPL-3.0-only**).

SolvForge MD focuses strictly on molecular simulation preparation — turning QM geometries/charges and force-field topologies into validated, reproducible GROMACS run packages. Downstream trajectory analysis (RDF, KBI, Green–Kubo viscosity, H-bond analysis, QM cluster extraction, etc.) is intentionally decoupled to [**MoDy Analyse**](https://github.com/iehoshva/mody-analyse).

## Key capabilities

- **Multi-QM & multi-charge parser** (no hardcoded method, basis, or charge scheme):
  - **ORCA** (`.out`): auto-detects any method/basis (`r2SCAN-3c`, `wB97X-D3`, `B3LYP`, `BP86`, `MP2`, etc.) and parses all present charge blocks (`Mulliken`, `Loewdin`, `Hirshfeld`, `CHELPG`, `RESP`, `ESP`, `MBIS`) plus final coordinates.
  - **Gaussian** (`.log` & `.fchk`): parses route lines, Standard/Input orientations (or Bohr-to-Å `.fchk`), and `Mulliken`, `APT`, `ESP`, `NPA`, `Hirshfeld`, and `CM5` charges.
  - **xTB** (`.out` & `charges`), **Multiwfn** (`.chg`, `.pqr`), **MOL2**, and **generic CSV/TSV** charge tables.
  - **Keep topology charges** or **manual per-atom overrides** when no QM file is needed.
- **Transparent charge processing**:
  - Configurable charge scale factor (e.g., `1.0` raw or `0.8` electronic polarization scaling).
  - Opt-in residual neutralization (`none`, `uniform-residual`, `heavy-atoms-residual`, `largest-abs-atom`) with full audit trails in `atom_mapping.csv` and `charges.csv`.
- **Any force field & topology convention**:
  - Editable force-field metadata, `#include` path (e.g., `oplsaa.ff/forcefield.itp`, `amber99sb-ildn.ff/forcefield.itp`, `charmm36.ff/forcefield.itp`, `gromos54a7.ff/forcefield.itp`), or **self-contained** `[ defaults ]` + hoisted `[ atomtypes ]` (GAFF2/ACPYPE, OpenFF, LigParGen, CGenFF, Sobtop, custom).
  - Preserves exact geometry atom ordering and hoists parameter-level directives cleanly above `[ moleculetype ]` in `topol.top`.
- **General N-component systems & flexible GROMACS MDPs**:
  - Define arbitrary 1-to-N component systems (neat liquids, binary/ternary mixtures, ionic liquids, DES, solute-solvent boxes) with manual counts or box + target-density calculation.
  - Single unified **Run Matrix Designer** (no gated thesis stages) with full GROMACS MDP flexibility (enable/disable EM/NVT/NPT/Prod, NPT or NVT production, arbitrary `tc-grps`, isotropic/semiisotropic/anisotropic barostats, all standard integrators/cutoffs/vdW modifiers, plus raw per-stage MDP overrides).
- **Packmol validation & MoDy Analyse handoff**:
  - Generates `packmol.inp`, validates imported `packed.pdb` counts and atom ordering, exports `packed.gro`, `topol.top`, `index.ndx`, and freezes **Run Input Packages** containing `metadata.json` compliant with `mody-analyse` (`run_metadata.schema.json`).

## Develop & test

Requires Node.js 22.13+ and npm:

```bash
npm ci
npm run dev
npx tsc --noEmit
npm test
```

## License

Copyright © 2026 Yehosyua Widiatmo Wyldanta and contributors. Licensed under **GNU GPL version 3 only**. See [LICENSE](LICENSE).
