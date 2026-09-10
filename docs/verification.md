# Corrective implementation verification — SolvForge MD 1.0.2

Recorded 2026-09-10. Baseline: `ab3ebeab3dd7beb34327dae82b40b334eb4568be`.
This record distinguishes software behavior from validation of a physical simulation.
No physical DES trajectory was generated or accepted during these tests.

## Executed checks

| Check | Result | What it establishes |
|---|---|---|
| Sites/Vinext production build | PASS | All five build stages completed. A bundle-size warning remains; build success does not establish scientific validity. |
| TypeScript `tsc --noEmit` | PASS | The edited application type-checks. |
| `node --test tests/*.test.mjs` | 74 PASS, 0 FAIL, 0 skipped | Numerical, protocol, evidence, preparation, archive and rendering contracts. |
| Independent ZIP extraction | PASS: 1, 10, 50 MiB | Python `zipfile` independently extracts realistic ORCA-like text; file count, paths, byte sizes and SHA-256 match. |
| Topology preprocessor expansion | PASS | Independent `cpp` expansion retains each source parameter once and places parameters before all molecular definitions. This does not execute `grompp`. |
| Supported browser-client UI tests | 12 phases PASS | Normal UI and file-chooser actions on the Sites local preview; no injected storage or hidden application state. |

Browser phases and their exact results are in [browser-e2e-results.json](browser-e2e-results.json). The replay harness is [tests/browser-e2e.mjs](../tests/browser-e2e.mjs). It verifies complete fixture import, strict matrix gates, explicit override persistence, rejected-source invalidation, pair/replica separation, time-decision visibility, new-project isolation, reload, reopening a previous project, design-only import isolation, and the five visible numerical tests.

## Numerical tests versus research evidence

The five in-app implementation tests verify ideal RDF zero KBI, an analytic exponential RDF, known finite-size regression coefficients, matrix inversion/conditioning and analytic activity integration. They use explicit synthetic inputs. PASS proves agreement with those software references. It does not establish equilibration, replica independence, a physical plateau, validity of an SSM model or a reliable thermodynamic result for the current project.

Additional tests recompute stored results from their parents, reject changed raw numerical arrays, reject changed frozen files, enforce unknown-state blocking, and verify that source rejection invalidates descendants. A signature alone cannot establish scientific validity.

## Requested acceptance coverage

“Contract” below means an executed module/artifact test, not a browser interaction. Coverage is deliberately not represented as all-browser E2E.

| Requirement | Executed coverage | Remaining boundary |
|---|---|---|
| A. Project isolation | Browser + contracts | IndexedDB quota and browser-data deletion remain environmental limits. |
| B. Project import/export | Browser ZIP import and manifest-only import; archive contracts | Browser download transport was not verified. |
| C. Large ZIP creation/extraction | Independent 1/10/50 MiB tests | Not exercised through browser download capture. |
| D. Generated MDP validity | Directive/state/step contracts | Actual external `grompp` was not executed. |
| E. Protocol fields affect artifacts | 23 table-driven directive contracts AND 23 browser control → actual MDP checks; production/continuation contracts | Controls outside the protocol still have module rather than exhaustive DOM contracts. |
| F. Unsupported fields disabled | Browser asserts force-field and charge pipeline disabled; artifact mismatch contracts | Unsupported alternatives are not offered. |
| G. Unique replica seeds | Generated NVT and state-identity contracts | Actual independent external trajectories still require evidence. |
| H. Rejected KBI cannot propagate | Browser rejection → stale Γ; descendant contracts | Scientific rejection remains a researcher decision. |
| I. Block convergence cannot mix systems | Exact-state/window contracts; same-trajectory decision in browser | Negative mixed-system browser scenario is not a separate phase. |
| J. RDF pairs are not replicas | Browser six separate n=1 summaries; duplicate/seed contracts | Independence beyond recorded identifiers requires scientific review. |
| K. SSM uses distinct physical systems | Browser rejects one size, fits three linked sizes, invalidates edited preview; source contracts | Independent boxes must be simulated externally. |
| L. Matrix state matching | Exact-state contracts; browser missing-SSM/override gates | No unknown metadata wildcard; missing terms remain blocked. |
| M. COSMO ratio mismatch rejected | Ratio/T/P/x/quantity contracts | Browser rejects 1:1, then enables comparison at matching 5:1/T/P/x. |
| N. Report matches generated files | Frozen protocol/report and graph ancestry contracts | External artifacts referenced by hash remain external. |
| O. Complete project round trip | ZIP/JSON scientific state and raw-source contract round trip; browser restoration | Browser-visible JSON → file import restores analysis state; actual download transport remains unverified. |

## Reproduction

```sh
npm test
npx tsc --noEmit
node scripts/create-e2e-fixtures.mjs /absolute/temporary/fixture-directory
```

Node 24, Python 3 and `cpp` were available for this run. The browser harness exports bounded phases which accept an already-open supported Tab and paths to the two generated fixtures visible to that browser. Test fixtures must never be represented as research measurements or bundled as product defaults. Worker types can be regenerated with `npx wrangler types --config wrangler.types.json`.

## Known limitations by category

- **Engineering limitation — verification:** the preview browser did not return a download event/file for the export controls. The app exposes a persistent prepared download link, and archive bytes/extraction are independently tested, but browser download transport remains unverified. The JSON review/copy fallback and normal file import restore the scientific state; archive contracts independently verify raw file bytes. This checkpoint does not claim every requested A–O test is a browser E2E test.
- **Engineering limitation — storage:** STORE/ZIP32, maximum 65,535 entries and less than 4 GiB; browser memory and IndexedDB quotas apply. No ZIP64 or streaming multi-gigabyte trajectory archive is implemented.
- **Requires external execution:** ORCA, independent OPLS-AA parameter assignment/resolution, Packmol, `grompp`, MD, restarts and equilibrated volume/temperature/density diagnostics. Execution state records are researcher-reported; source/checkpoint hashes do not establish successful execution by themselves. Retain the actual force-field distribution, trajectory and execution logs separately.
- **Scientific limitation:** independent-box `1/L` extrapolation requires a defensible finite-size ensemble and researcher-selected model. It is not an open-subvolume fluctuation estimator. Density/composition uncertainty, cross-composition correlations and activity-anchor uncertainty are not inferred or silently filled in.
- **Scientific limitation:** absolute activity coefficients require a compatible external anchor. Infinite dilution is an explicit fit outside the simulated composition domain. One solute cannot supply a molecular solute–solute pair correlation.
- **Not yet implemented:** automatic GROMACS execution/log verification, arbitrary N-component thermodynamic inversion, open-subvolume fluctuation analysis, exhaustive browser interaction contracts for every non-protocol scientific control and browser A–O coverage beyond the phases listed above.
- **Not yet implemented:** evaluation of imported topology preprocessor branches/macros. Supply an unconditional reviewed molecular topology; unresolved branches block the merge and original source files remain preserved.

These boundaries are not silently counted as supported or automatically validated. The [implementation trace](implementation-trace.md), source contracts and recorded browser phases describe the implemented corrective work.

## Release follow-up corrections

- Activity, infinite-dilution and SSM acceptance now bind exact project/state/source IDs. Result relabelling, altered uncertainty summaries, changed source parents or mismatched override reasons invalidate downstream use.
- Stored thermodynamic matrices recheck pair order, density-derived fractions, parent analysis/decision IDs and statistical propagation settings. Scientific uncertainty is recalculated; unknown uncertainty remains unknown.
- SSM compares every source-derived point field. Only derived `cbrt(volume)` length has a 1e-12 absolute/relative nm tolerance for engine rounding; physical state metadata still matches exactly. A browser test exposed this issue; module tests cover harmless rounding and material size changes.
- SSM/activity rejection records a rationale and decision history. Changed finite-size design controls invalidate old previews before adding runs.
- Complete JSON export and import share integrity validation; original file-input selection resets permit repeated import. A readonly JSON review plus pasted restoration provides a local fallback when download transport is unavailable.
- Frozen run artifacts and actual report JSON are inspectable. Opening an IndexedDB project updates opening/migration history without rewriting historical result versions.
- Repeated plateau checks reuse results only during one synchronous evaluation. References are discarded on completion or exception; edits and imports always begin a new evaluation. The cache has a dedicated mutation/exception test.

Two bounded advanced browser phases are replayable with `tests/browser-release-e2e.mjs`; the remaining SSM-fit and COSMO import/matching actions were executed through the same supported UI and their outcomes are recorded in `browser-e2e-results.json`. The protocol phase contains all 23 actual UI → MDP assertions. No physical trajectories were simulated during release verification.
