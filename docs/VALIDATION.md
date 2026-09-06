# Validation report — Aster CAS 0.1.0

Date: 2026-09-06. This report distinguishes executed tests from implemented paths that still need validation on a normal browser origin and actual GPU hardware.

## Executed tests

| Suite / inspection | Result | Environment |
| --- | --- | --- |
| Symbolic/numerical kernel | **98 passed, 0 failed** | Node 22.16.0; built-in test runner |
| Standalone browser integration | **39 passed, 0 failed** | Chromium 144.0.7559.96; Playwright 1.57.0 |
| Unhandled browser JavaScript errors | **0 observed** | During the 39-check suite |
| Standalone build | Passed | `node build.mjs`; no third-party build packages |
| JS module syntax | Passed | `node --check` on source and test modules |
| Python browser-harness syntax | Passed | Python `py_compile` |
| Visual inspection | Worksheet, 3D surface, dark appearance, mobile | Actual browser PNG captures in this directory |

The kernel suite covers exact fractions/decimals/large integers, parser precedence, special values, simplification/expansion/factorization, polynomial and linear-system solving, derivatives, selected antiderivatives/limits, substitution, definitions, matrix arithmetic and order preservation, quadrature, roots, scalar ODE data, VM programs, and input/resource guards. Deterministic numerical property checks compare derivatives against finite differences and differentiate supported antiderivatives. These are regression tests, not a proof of general mathematical correctness.

In particular, noncommuting matrix products are tested both directly and through user-defined and nested functions. This exposed and corrected a premature scalar-canonicalization problem during parameter substitution. Browser tests exposed and corrected a preview/source focus problem. Cached 2D hover tracing is checked by actual sample-array and vertex-buffer object identity before and after pointer movement.

## Browser coverage

The actual built HTML and its real Blob worker were loaded into a Chromium `about:blank` page using Playwright `set_content`. No simulated CAS or plot results were used. The suite covers:

- Default computations, actual curve samples/geometry, pointer tracing, wheel zoom and fit, and truthful fallback reporting.
- Clicking a typeset expression to edit source, Enter execution, downstream stale flags, palette insertion, prose regions, document undo/redo, and matrix construction/typesetting.
- Versioned source-only export, file import and untrusted result-field rejection, autosave serialization, context differentiation, command search, HTML reports with actual PNG pixels, and complete LaTeX document text.
- A real 25,088-triangle surface, camera orbit, wireframe buffers, live-parameter geometry changes, full-window expansion and Escape, dark appearance, source/document modes, and 390-pixel responsive layout.
- Recoverable calculation errors and evaluated calculus, dynamics and linear-algebra starter documents, with no unhandled browser errors.

The exact named check list and environment metadata are in `browser-test-results.json`. Kernel output is in `kernel-test-results.tap`.

## Important environment qualifications

The available Chromium installation enforced a managed policy blocking URL navigation, including localhost and local files. That policy was not modified. An `about:blank` page could execute explicitly supplied test content, but it was not a secure WebGPU origin.

**Only the Canvas 2D renderer was exercised with actual browser rendering here. No live WebGPU adapter, WGSL shader compilation, native GPU draw submission, or GPU-loss behavior was validated.** There are no GPU FPS, GPU latency, or cross-device performance claims in this report. The UI timing is CPU wall-clock preparation/submission time, not a GPU timestamp measurement.

Storage and download behavior in the integration suite uses explicitly installed test fixtures: an in-memory Storage-compatible object and captured Blob links. The real application code invokes its ordinary save/import/export paths, but native persistent storage durability and OS download integration were not tested by that suite. File input uses Playwright's actual file-input support.

The HTTP ES-module application and double-click local-file launch path were not browser-validated because of the same navigation restriction. They have valid syntax and share the tested source modules, but that is not equivalent to testing their browser origin/worker-loading behavior.

## Additional harness, not executed here

`tests/browser_live.py` starts an ordinary localhost static server and exercises both `/` (ES modules) and `/dist/index.html` (standalone). It checks initial execution, a native localStorage round trip across reload, a real downloaded `.aster` file, actual surface geometry and wireframe, backend stability, and browser errors. It saves its separate results under `test-results/`.

```sh
python3 tests/browser_live.py
python3 tests/browser_live.py --require-webgpu --headed
```

`--require-webgpu` fails unless an actual GPU device is active and the plot remains on the WebGPU backend. This harness does not override browser policies. In this delivery it was syntax-checked, not executed successfully. The included CI workflow is configuration for subsequent repository runs, not evidence that CI has already run remotely.

Before a production release, run that harness on supported browsers/operating systems, check shader validation and GPU pixel output, exercise GPU-loss/recovery and sustained interactions, measure real input-to-frame latency, test accessibility with assistive technologies, audit resource/security boundaries, and expand numerical/CAS correctness coverage against independent references. The present test counts must not be read as full Maple compatibility or scientific certification.
