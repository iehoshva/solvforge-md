# SolvForge MD

Local-first GROMACS preparation and molecular Kirkwood–Buff analysis for reproducible solvent research. Version **1.0.2**, project archive schema **2.0**, **GPL-3.0-only**.

The application generates files and analyzes imported numerical observations. ORCA, Packmol and GROMACS execute externally. Every accepted scientific result keeps its source IDs, actual generated protocol, physical state, numerical settings and researcher decisions. Missing or rejected evidence blocks downstream calculations.

## Start with the thesis preset

**Andaliman Thesis MD/KBI** retains the hierarchical design:

1. Stage A: four DES candidates × three solutes at 323.15 K, before replicas.
2. Explicit researcher champion selection.
3. Stage B: champion DES × three solutes × loadings 1, 2, 3, 6, 12, 18, 24.
4. Explicit researcher optimum selection.
5. Stage C: champion and selected nominal loading × three solutes × five temperatures.

A full factorial matrix is a separate, explicit custom design. Thesis/custom are preset labels. Supported parameters, molecule definitions, state points and analysis settings remain editable in both presets. Unsupported force-field and charge alternatives are disabled.

The implemented parameterization is **OPLS-AA + unnormalized ORCA BP86/def2-TZVP Mulliken charges**. ORCA geometry and charges do not contain the OPLS-AA mechanical parameter framework. Import and review the independent topology/atom mapping before preparing a runnable system.

## Preparation and simulation

1. Review molecular identities, formal charges, residue names and molecular weights.
2. Supply manual component counts or calculate integer counts from box volume, a researched density and molecular masses. A molar ratio alone never supplies absolute counts. Review density temperature, mass policy, integer rounding and optional locked DES populations.
3. Review the protocol, including a researched compressibility. There is no assumed water compressibility. The generator uses validated GROMACS enumerations for integrators, coupling, constraints and electrostatics.
4. Generate the chosen run matrix. Each run stores an immutable resolved protocol and molecular system snapshot. Separate pure-DES runs have no fictitious solute.
5. Import original `.xyz`/`.out` files in **ORCA → GROMACS**. Verify atom ordering, charge sum, geometry, connectivity and the imported OPLS-AA topology. The final atom charges are the mapped, unmodified Mulliken values.
6. Generate molecular PDB/GRO/ITP and Packmol input. Run Packmol externally, then import `packed.pdb`. The system checks counts and molecular/atom ordering against `topol.top` and `index.ndx`.
7. Export a **Run Input Package** from **Data / Export**. Its exact files and SHA-256 checksums become a frozen input snapshot. Existing snapshots can be downloaded without regenerating them from current forms.
8. Execute and inspect EM → NVT → NPT → production using the English tutorial. NVT generates velocities with the run's unique replica seed; later stages consume checkpoints.
9. For convergence-controlled production, use **Manual production continuation**. Enter the completed time, checkpoint checksum, log reference and rationale. The generated `convert-tpr`/`mdrun -cpi -append` commands respect the stored maximum. SolvForge does not autonomously extend simulations.

Protocol overrides are merged into the exact MDP maps used by the files, run manifest and report. Duplicate/malformed directives, invalid steps, state mismatches and incompatible velocity/coupling policies block runnable export. Unusual but supported settings remain researcher choices. GROMACS `grompp` is the final external parameter-resolution check; a manually checked execution state is labelled researcher-reported.

## RDF → KBI → thermodynamics

- Import XVG or CSV, preserve the source text/hash and explicitly choose nm or Å. Grace comments, legends, scientific notation and multiple series are parsed. Reimporting identical source bytes cannot create another independent replica.
- Map each series to a generated run, frozen input snapshot, molecular pair, actual selection, trajectory checksum, time window and measured equilibrated mean volume. Unmapped data remain viewable but cannot establish thermodynamic evidence.
- Calculate `G(R) = 4π ∫ [g(r)−1]r² dr` with trapezoidal or supported Simpson integration. Raw, rebinned and optionally smoothed data remain separate. An unmeasured origin contribution is unresolved unless explicitly supplied by the researcher.
- Inspect/select a plateau and record its acceptance rationale. Automatic suggestions are candidates. Radial SD is descriptive plateau variation, never substituted for replica SEM.
- Use one explicit representative for each independent replica and pair. Distinct pair observables remain separate. Time convergence uses at least three windows of the same trajectory, state and pair; no project-wide mixing or silent outlier removal occurs.
- Design independent finite-size systems with proportionally scaled particle counts and boxes. Execute them externally and link each measurement to its actual run and measured volume. Regression fits `G(L)=G∞+F∞/L` or `LG(L)=LG∞+F∞` using at least three distinct sizes. This is an explicitly selected independent-box scaling model, not an open-subvolume estimator obtained by cropping a trajectory.
- Build the six independent terms of the ternary solute + two molecular DES component matrix. Exact state matching, accepted plateaus, current time decisions and finite-size evidence are required. An explicit finite-size/conditioning override must retain its rationale, failed criteria and source IDs. Missing matrix terms cannot be invented.
- Calculate the constant-pressure ternary thermodynamic factor using the documented structure-factor/Gibbs–Duhem projection. Inspect the full matrices, density vector, determinant, condition number and uncertainty inputs. No automatic binary DES pseudocomponent approximation is used.
- Integrate `(Γ−1)/x` between sampled compositions with linear or monotone-cubic interpolation. This determines a relative activity coefficient. Absolute γ requires a referenced in-domain anchor and standard-state convention; the software does not manufacture the integration constant.
- Explicit low-x fits can extrapolate accepted absolute γ toward infinite dilution. One molecule per box is not automatically infinite dilution. A one-solute system also cannot provide a molecular solute–solute RDF, so a complete matrix may be unavailable there.
- Import openCOSMO-RSpy CSV using column mapping. Reviewed molecular identity, ratio, T, P, quantity and actual composition must match exactly. Compare finite γ(x) only with γ(x), and γ∞ only with accepted MD extrapolation. Standard-state compatibility and anchor independence must be reviewed before cross-validation.

The in-app **Method / Equations** panel describes the equations actually implemented. Uncertainty types and parents are explicit: replica SEM, finite-size regression SE, or unknown. Monte Carlo supports independent normal KBI errors or a supplied joint covariance. Activity propagation resamples stored Γ draws with a reproducible seed. Density/composition/anchor errors and cross-composition correlations are not inferred.

Stage dashboards display pair-specific evidence and imported observables. The explicit Pareto comparison exposes its objectives and directions, excludes missing evidence, and does not select a champion or collapse values into a hidden score.

## Ownership, archives and reports

One IndexedDB workspace per `projectId` contains runs, RDFs, preparation state, scientific results, custom presets, decisions and the provenance graph. New projects and recovered presets start clean. Importing a design manifest alone does not inherit previous evidence. Complete bundles restore all slices atomically. Deliberate evidence duplication creates a new project identity and requires renewed acceptance.

The packages have distinct meanings:

| Export | Contents / purpose |
|---|---|
| MDP Planning Package | Design, run manifests and MDPs; requires molecular and packed inputs before execution. |
| Run Input Package | Frozen MDPs, resolved protocol, molecular topology/sources/mapping, packing inputs, coordinates, index and commands. |
| Complete Project Archive | Entire workspace, raw imported sources, frozen packages, calculations, decisions, overrides, provenance and SHA-256 inventory. |

Complete ZIP imports verify CRC, inventory, SHA-256, frozen MDP agreement and raw RDF numerical arrays before restoration. The safe typed-array ZIP implementation supports tested 1, 10 and 50 MB text sources. It uses STORE entries; ZIP64 and archives above its 4 GiB/65,535-entry limits are unsupported. Browser memory and storage quotas still apply.

**Generate Analysis Report** exports JSON or printable HTML (browser Print / Save PDF). Each result links backwards through decisions, calculations, exact source terms, RDFs, external trajectory references, frozen inputs and original molecular sources. Missing or stale ancestors are labelled; historical creation software and migrations are preserved. Full trajectories, execution logs and installed force-field distributions remain external and must be retained with their recorded checksums.

## Develop and test

Use Node.js 22.13+ (Node 24 tested) and npm:

```bash
npm install
npm run dev
npm test
npx tsc --noEmit
```

`npm test` builds and runs numerical, scientific contract, independent ZIP extraction and rendering tests. Python 3 is used by independent ZIP-extraction checks; `cpp` checks generated topology preprocessor ordering. Test fixtures are explicitly synthetic and are never imported by application code. Neither check substitutes for external GROMACS validation.

Browser E2E phases are in `tests/browser-e2e.mjs`; fixture creation is in `scripts/create-e2e-fixtures.mjs`. The harness accepts an existing supported browser-client Tab, performs normal UI/file chooser actions and does not inject browser storage or hidden application state. See [verification record](docs/verification.md) for executed checks and unverified boundaries; passing unit tests is not physical MD validation.

Architecture and control trace: [implementation audit](docs/implementation-trace.md).

## Scope and limitations

- **Requires external execution:** ORCA, OPLS-AA parameter resolution, Packmol, GROMACS, checkpoints and physical equilibration diagnostics.
- **Scientific limitation:** independent-box 1/L regression is a model to assess, not proof that a thermodynamic-limit estimate is valid. Absolute γ requires external reference information; extrapolation remains model dependent.
- **Not implemented:** automatic GROMACS execution/log validation, arbitrary N-component thermodynamic inversion, and open-subvolume fluctuation estimators. Unsupported alternatives are not exposed as functioning controls.
- **Engineering limitation:** browser storage quotas, ZIP32 limits and externally retained trajectories. Keep complete backups; browser storage alone is not a research archive.

## License

Copyright © 2026 Yehosyua Widiatmo Wyldanta and contributors. Licensed under **GNU GPL version 3 only**. See [LICENSE](LICENSE). Third-party scientific programs and force-field distributions retain their own licenses.
