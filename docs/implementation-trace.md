# Scientific implementation trace

Baseline inspected before architecture changes: `ab3ebeab3dd7beb34327dae82b40b334eb4568be`.
The trace follows control/claim → state → consumer → artifact/calculation → downstream → export → behavioral contract.

| Feature | Baseline classification | Observed failure and correction contract |
|---|---|---|
| Project/new/import/preset | SCIENTIFICALLY_UNSAFE | Five global stores survive project changes; complete workspace must change atomically, unknown legacy records quarantined. |
| Migration | SCIENTIFICALLY_UNSAFE | Overwrites historical software version; preserve creation/schema/migration history. |
| Pure DES/production range | DEAD_CONTROL | Always uses solute maximum; real pure run discriminator, initial run and manual checkpoint extensions. |
| EM/constraints/PME | PARTIAL | EM forced steep, invalid constraint string, PME absent from equilibration; one resolved stage directive map. |
| FF/charges | SCIENTIFICALLY_UNSAFE | Editable metadata disagrees with OPLS/Mulliken topology; supported method read-only and validated. |
| Replica seeds | DEAD_CONTROL | Run seed never used by MDP; gen-vel/gen-seed in NVT, checkpoint continuation thereafter. |
| MDP preview edits | PARTIAL | Local text edits absent from ZIP and report; remove independent editor, persist protocol overrides. |
| Naming | PARTIAL | Rounded temperatures and optional state dimensions collide; deterministic suffix and collision rejection. |
| Composition | PARTIAL | MW override fallback and stale candidate selection; validate all inputs and physical selection key. |
| Molecular fields | PARTIAL | Roles/count/file names/residue inconsistent with consumers; operational selections and explicit metadata labels. |
| ORCA mapping | PARTIAL | Re-import retains invalid acceptance/type state; invalidate dependent reviews. |
| Molecular ITP | SCIENTIFICALLY_UNSAFE | Duplicate dihedral sections dropped; preserve all, reject unresolved parameters. |
| Packed topology | PARTIAL | Counts verified without complete atom/species order; enforce ordering contract. |
| RDF source/import | SCIENTIFICALLY_UNSAFE | Current project method imputed, source text/hash absent; unknown until explicit run/source mapping. |
| KBI integration | PARTIAL | Implicit unmeasured origin contribution; explicit lower bound/origin assumption. |
| Plateau | PARTIAL | Manual interval treated accepted, edits retain decisions; explicit versioned acceptance. |
| Replica statistics | SCIENTIFICALLY_UNSAFE | Dataset count becomes replica count; require exact state/observable and distinct replicas, reject duplicate hashes. |
| Block convergence | SCIENTIFICALLY_UNSAFE | Entire project mixed; exact trajectory/pair windows and decision parents. |
| Stage evidence | SCIENTIFICALLY_UNSAFE | Unlike pairs averaged and rejected data included; pair-specific structured evidence. |
| SSM | SCIENTIFICALLY_UNSAFE | Renamed/cropped trajectories and manually typed sizes; physically independent run design and linked input evidence. |
| Matrix | SCIENTIFICALLY_UNSAFE | Substring joins, missing metadata wildcards; exact state and explicit evidence gates. |
| Γ/uncertainty | PARTIAL | Plateau SD masquerades as replica uncertainty; explicit type/source and covariance assumption. |
| Activity coefficient | SCIENTIFICALLY_UNSAFE | Anchor snaps to sampled x, implicit dilution shift; exact in-domain integration and external anchor. |
| COSMO matching | SCIENTIFICALLY_UNSAFE | Ratio ignored, unknown T/x wildcard; exact quantity/composition/ratio matching. |
| Reports/provenance | PARTIAL | Current form instead of actual generated snapshot, static coverage; graph ancestry and reconciliation. |
| ZIP | SCIENTIFICALLY_UNSAFE | Array spread fails at realistic sizes; chunked typed arrays/Blob, verified 1/10/50 MB extraction. |
| Tests | PARTIAL | Synthetic tests alone; separate numerical implementation tests from project scientific validation, add browser/control contracts. |

Legacy evidence whose identity cannot be established must remain exportable as unresolved evidence and must not enter scientific joins.

## Implemented consumers and verification

All paths below are repository relative. The source audit above records failures in the baseline, not the current behavior.

| Control / claim | State and consuming module | Output and downstream provenance | Behavioral verification |
|---|---|---|---|
| Workspace isolation | `Workspace.projectId`; `workspace.ts`, `storage.ts`, `workbench.tsx` | One atomic IndexedDB transaction; complete import or clean design-only import | `correctness-contracts`, `evidence-integrity`; browser new/reload/reopen/manifest phases |
| Protocol scientific controls | `ProjectState.protocol`; `protocol.resolveProtocol` | Frozen stage maps/MDPs, `RunRecord.resolvedProtocol`, report node | `protocol-controls`: each implemented protocol parameter changes its actual directive/duration; unsupported methods fail |
| Pure solvent, fixed/adaptive duration | production discriminator and `continuation.ts` | Solvent-only populations; initial production; bounded manual continuation with recorded checkpoint | `correctness-contracts`, `protocol-controls`, `evidence-integrity` |
| Box and molecular controls | composition settings, molecule registry, `composition.ts`, `runs.ts` | Integer counts, physical units, mass/mole fractions, packing, preparation notes | `scientific-numerics`, `correctness-contracts` |
| ORCA mapping, names, charge tolerance | `MoleculePreparation`; `orca-gromacs.ts` | Raw originals, explicit maps, PDB/GRO/ITP, packed count/order checks | `orca-gromacs.test.mjs`; frozen snapshot source reconciliation |
| Force-field and charge pipeline | Read-only supported method constants; `protocol.ts`, `packages.ts` | OPLS include, x2top, unnormalized mapped Mulliken, matching report metadata | Method/artifact mismatch blocks runnable package; protocol and preparation tests |
| RDF units, source, series, window | `RDFDataset`; `kbi.ts`, `evidence.ts` | Original source/hash; canonical radius; structured run/pair/trajectory identity | Parser/integration tests, hash and raw-array verification at import/export |
| Rebin/smoothing/integration/plateau | `KBIAnalysis`; `analyzeDataset` | Raw and processed curves, exact interval statistics, immutable historical decisions | Synthetic references; recalculation detects altered numbers even with copied signatures |
| Replica and time controls | Explicit representative/replica ID, trajectory windows, thresholds | One same-pair summary per physical state; separately scoped convergence decision | Contract tests and browser 18 blocks → six n=1 summaries |
| Independent finite-size design | Run population multipliers and frozen protocol | Distinct counts/boxes/seeds; linked source sizes and measured volume | `scientific-contracts`: distinct-system gate, fake L rejected, regression only with enough sizes |
| KB/Γ and MC controls | Exact source selections, actual mean volume, covariance, seed/sample count | B, S, inverses, pressure projection, Γ, typed uncertainties and explicit overrides | Ternary/ideal tests; missing pair and rejected ancestor tests; browser strict/override/stale gates |
| γ/γ∞ | Current Γ source IDs, interpolation, explicit reference, selected fit range | Relative/absolute distinction, seeded uncertainty propagation, accepted fit ancestry | Analytic integration, low-x fit conditioning, parent rejection contracts |
| COSMO mapping/comparison | Raw CSV/hash, explicit components/ratio/T/P/x/quantity review | Exact matching, residual/rank statistics; snapshots invalidated when matching evidence changes | Ratio/unknown T/P/x/quantity mismatch contract tests |
| Champion/optimum/Pareto | Explicit researcher rationales and dimension-wise objectives | Decision source IDs, downstream hierarchy, no automatic selection/hidden score | Hierarchy contracts; Pareto directions/ties/missing-evidence tests |
| RDF and block command controls | `OrcaGromacsState.rdf`; strict generator diagnostics | Single-line quoted custom selections, ps conversions, deterministic six-pair/block scripts | `evidence-integrity`: every RDF setting changes commands; malformed windows never disappear silently |
| Archive/report values | `packages.ts`, `provenance.ts`, frozen snapshots | Source-to-result graph, actual coverage, parent IDs, SHA-256/CRC | Independent extraction at 1/10/50 MB; raw sources and archive roundtrip; report ignores subsequent form edits |

## Deliberate metadata / disabled controls

Molecule roles classify the registry; the separate design-solute selector controls inclusion. Topology/coordinate reference filenames are explicitly metadata; imported topology text and frozen source files are authoritative. Notes, objectives and protocol names remain metadata. Canonical units are read-only, with explicit boundary conversions. Thesis/custom are preset labels. Unsupported force-field/charge alternatives are disabled. Calculator-only solute/temperature inputs are labelled previews. Command edits are drafts; unresolved drafts cannot silently replace canonical executable package commands.

## Additional issues found during implementation

- UI persistence originally added ownership keys to nested trajectories after an analysis signature had been calculated. This invalidated accepted results during saving. Constructors now assign ownership before signatures; persistence clones without changing inputs.
- Source text hashes alone did not prove that stored numerical arrays or derived numbers matched those sources. Import/export reconciles raw arrays, and downstream KBI/SSM/Γ/activity gates recompute their transformations.
- A browser without `crypto.subtle` could fail exports. Portable SHA-256 is verified against the platform implementation at padding boundaries and realistic source sizes.
- RDF time parsing silently dropped malformed windows, and custom selections could fall back to another representation. Both now produce explicit diagnostics.
- Previously frozen run artifacts could become inaccessible after unrelated current-form edits. A separate frozen-package export preserves the exact historical files.
- Non-finite values and mismatched lengths produced misleading plots. These now show an explicit plot diagnostic; exported SVG styles are self-contained.
- Manual execution/checklist entries resembled automatic validation. Researcher acceptance now has explicit labels, references, timestamps and provenance records; only actual parsed structural checks use automatic-verification labels.
- Imported per-molecule parameter sections could appear after an earlier molecule definition in the assembled system. The system generator now places all atom types and other parameter definitions before molecular includes; guarded molecular ITPs preserve standalone parameter sources. Cross-molecule duplicate atom definitions block the shared UI/package gate. Three additional topology-package contracts check independent preprocessor expansion, unresolved imported conditionals, and duplicate definitions.
- Requiring successful external `grompp` before exporting the topology needed by `grompp` created a circular dependency. Complete reviewed inputs now export as READY FOR GROMPP VALIDATION; external execution is neither fabricated nor labelled automatically verified. Incomplete parameter mapping still blocks the package.

The topology hierarchy and supported macro syntax follow the [GROMACS topology-file reference](https://manual.gromacs.org/documentation/current/reference-manual/topologies/topology-file-formats.html) and [grompp reference](https://manual.gromacs.org/documentation/current/onlinehelp/gmx-grompp.html). Imported conditional branches must first be resolved into an unconditional reviewed molecular topology; originals remain archived.

Scope and unresolved verification boundaries are recorded in `verification.md`. Synthetic software tests never establish that a physical DES simulation is valid.

## 1.0.2 continued trace

| Finding | Classification before this follow-up | Correction / behavioral check |
|---|---|---|
| Accepted activity may be relabelled | SCIENTIFICALLY_UNSAFE | Recompute exact series identity, results and uncertainty; source-bound acceptance; tamper tests. |
| SSM point metadata only partly reconciled | PARTIAL | Compare source-derived state, pair, replica, analysis and size; missing provenance blocks. Browser recovery preserves engine rounding only for derived length. |
| Finite-size preview outlives edited inputs | DEAD_CONTROL | Design signature invalidates stale preview; browser verifies Add disabled after edit. |
| Stored matrix uncertainty/parents | PARTIAL | Recompute fractions, pair order, source pointers, override gates and propagation; changed result metadata blocks descendants. |
| Browser backup fallback | PARTIAL | Shared validated JSON serializer/importer, readable export, pasted restore and frozen/report inspection. |
| IndexedDB reopening history | PARTIAL | Reopen complete workspace through migration and source validation; preserve creation versions. |
| Repeated graph checks stall larger evidence views | PARTIAL | Per-evaluation-only reuse, cleared after success/error; no cross-edit cache. |

See verification.md for executed coverage and explicit remaining limitations.
