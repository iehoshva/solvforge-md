"use client"

import { Section, ViewHeader } from "./shared"

export function MethodsView() {
  return (
    <>
      <ViewHeader
        eyebrow="Technical reference"
        title="Methods & Conventions"
        description="How SolvForge MD bridges quantum-chemistry outputs and force-field topologies into reproducible GROMACS inputs without hardcoded method or force-field restrictions."
      />

      <Section title="Multi-QM & Multi-Charge Parsing" kicker="ORCA · GAUSSIAN · xTB · MULTIWFN · MOL2 · CSV">
        <p>
          SolvForge MD parses Cartesian coordinates and partial atomic charges from major quantum-chemistry formats without restricting method, functional, or basis set:
        </p>
        <ul className="list-disc pl-5 text-sm space-y-1 mt-2">
          <li>
            <strong>ORCA (<code>.out</code>)</strong>: dynamically reads the <code>! ...</code> input line and extracts all present charge blocks (<code>Mulliken</code>, <code>Loewdin</code>, <code>Hirshfeld</code>, <code>CHELPG</code>, <code>RESP</code>, <code>ESP</code>, <code>MBIS</code>) plus final coordinates.
          </li>
          <li>
            <strong>Gaussian (<code>.log</code> / <code>.fchk</code>)</strong>: reads route lines, Standard/Input orientation (or Bohr-to-Å fchk coordinates), and <code>Mulliken</code>, <code>APT</code>, <code>ESP</code>, <code>NPA</code>, <code>Hirshfeld</code>, and <code>CM5</code> charges.
          </li>
          <li>
            <strong>xTB (<code>.out</code> / <code>charges</code>)</strong>: extracts <code>GFN0/1/2-xTB</code> Mulliken/CM5-like atomic charges.
          </li>
          <li>
            <strong>Multiwfn (<code>.chg</code>, <code>.pqr</code>) &amp; MOL2</strong>: extracts coordinates, partial charges (e.g. RESP, RESP2, ADCH, Bader/AIM, CM5), and MOL2 connectivity.
          </li>
          <li>
            <strong>Generic CSV / TSV / TXT</strong>: imports any researcher-supplied charge table, or lets you retain native topology charges with zero QM files.
          </li>
        </ul>
      </Section>

      <Section title="Transparent Charge Scaling & Residual Neutralization" kicker="EXPLICIT · OPT-IN · AUDITED">
        <p>
          By default, partial charges are preserved untouched (scale factor <code>1.0</code>, neutralization <code>none</code>). Researchers may explicitly apply a positive charge scale factor (e.g. <code>0.8</code> for electronic polarization scaling in ionic liquids or deep eutectic solvents) and/or an explicit residual-neutralization rule (<code>uniform-residual</code>, <code>heavy-atoms-residual</code>, or <code>largest-abs-atom</code>) so PME electrostatics receive an exact integer net charge. Every transformation is logged in <code>charges.csv</code> and <code>atom_mapping.csv</code>.
        </p>
      </Section>

      <Section title="Force-Field-Agnostic Topology Merging" kicker="OPLS-AA · GAFF2 · CHARMM36 · AMBER · GROMOS · OPENFF · CUSTOM">
        <p>
          Quantum chemistry provides geometry and electrostatics, while bonded and Lennard–Jones terms come from a force-field topology (<code>.top</code> / <code>.itp</code> generated via ACPYPE, <code>gmx x2top</code>, Antechamber/ParmEd, Sobtop, LigParGen, CGenFF, or hand-authored). SolvForge preserves geometry atom ordering, hoists parameter-level directives (<code>[ atomtypes ]</code>, <code>[ bondtypes ]</code>, etc.) above all <code>[ moleculetype ]</code> includes in <code>topol.top</code> using <code>#define SOLVFORGE_SYSTEM_PARAMETERS</code>, and supports both external <code>#include &quot;...ff/forcefield.itp&quot;</code> and self-contained <code>[ defaults ]</code> topologies.
        </p>
      </Section>

      <Section title="Packing, MDPs & Handoff to MoDy Analyse" kicker="PACKMOL → GROMACS → MODY ANALYSE">
        <p>
          Packmol inputs convert configured box dimensions to Å and write exact integer counts from the run manifest. Imported <code>packed.pdb</code> files are validated for exact atom count, residue order, and per-molecule atom sequence before generating <code>packed.gro</code>, <code>topol.top</code>, and <code>index.ndx</code>. All GROMACS MDP parameters (stages enabled, ensemble, integrators, thermostats, barostats, coupling groups, cutoffs, dispersion corrections, and raw overrides) are freely configurable.
        </p>
        <p className="mt-2">
          Trajectory analysis (KBI, SSM finite-size scaling, RDFs, viscosity, H-bond networks, QM cluster extraction) is intentionally decoupled to <strong>MoDy Analyse</strong>. Every exported Run Input Package contains a <code>metadata.json</code> matching MoDy Analyse&apos;s bridge schema so finished GROMACS runs drop directly into your analysis pipeline.
        </p>
      </Section>
    </>
  )
}
