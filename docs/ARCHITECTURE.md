# Architecture and execution contracts

## 1. Document and process model

The canonical document is a sequence of source-bearing cells: `code`, `text`, and `heading`, together with document title/subtitle and section-collapse state. Results are derived, not imported. `.aster` files have `{format:"aster-worksheet",version:1,document:...}`. Hydration validates limits, retains only known fields, assigns fresh identifiers, and discards all supplied result HTML.

Each UI computation starts a dedicated Worker and replays the nonempty code cells in document order through the requested endpoint. The worker has an environment map and a user-function map. It posts a result or a structured error for each cell, then a completion message and environment. **It continues after a per-cell error.** The next cell therefore sees successful preceding definitions, but not a successful value for the failed operation. This is deterministic prefix execution, not reactive dependency-graph evaluation.

The UI guards results with a monotonically increasing job ID and the active document ID. Stop, edit, undo/redo, and document switching terminate the worker and invalidate the prior job. Timeout is reset after each cell result and terminates a worker that fails to produce the next result within eight seconds. Old outputs are retained but explicitly marked stale after edits. Work already performed by cancelled workers cannot mutate the new document through late messages.

Undo/redo retains at most 80 source-document snapshots, with ordinary typing grouped using a time threshold. Results are recalculated after restoration. This is document history, not a separate native undo stack for every textarea. Local autosave is debounced by 350 ms, with a final best-effort save on page exit. Closing a tab removes that document from the saved workspace: export it first when it is needed later.

## 2. Parser and expression IR

The Unicode-aware tokenizer and bounded Pratt parser produce raw, ordered syntax nodes. Precedence is assignment/lambda, equation, range, sum, product, power, factorial. Power and assignment associate to the right. Unary minus binds below exponentiation. Basic implicit multiplication is accepted; a symbol followed by parentheses is a function call.

The expression node families are rational `num`, binary64 `real`, `sym`, `add`, `mul`, `pow`, `call`, `list`, `matrix`, `eq`, `range`, `assign`, and `lambda`. Integer and decimal literals become reduced BigInt rationals. Approximate evaluation is explicit through `evalf` or numerical algorithms.

Evaluation dispatches on runtime expression types before scalar canonicalization. Matrix multiplication preserves operand order. User-function argument binding uses a raw ordered substitution pass, specifically preventing scalar factor sorting from commuting matrix-valued arguments. Scalar canonical `add` collects coefficients; scalar canonical `mul` combines equal bases and sorts factors. Exact powers enforce an arithmetic growth limit. MathML, LaTeX, and plain source are separate serializers; generated HTML text is escaped.

Nodes are immutable by convention rather than deeply frozen. This is a small expression-tree engine, not a hash-consed DAG, e-graph, proof kernel, or term-rewriting system with a complete assumptions calculus. Variables without assigned values are treated as formal commuting scalars. Generic algebraic cancellation does not retain excluded-domain metadata. Matrix substitution into a previously canonicalized formal scalar expression is not a noncommutative algebra facility; use typed matrix expressions or function parameters instead.

## 3. Symbolic algorithms

Differentiation implements elementary chain/product/power rules and leaves unknown derivatives symbolic. Integration matches supported rules, linear arguments and selected polynomial-times-elementary cases. It is not a complete elementary integrator. Unknown indefinite integrals remain `int(...)`, with an explicit note. Additive integration constants are omitted.

Univariate polynomial extraction feeds bounded expansion, factorization and solving. Factorization searches bounded rational roots; a remaining polynomial may be irreducible only relative to the implemented search. Quadratics have exact symbolic roots; higher-degree equations are solved only when the rational factorization route succeeds. No claim of general algebraic completeness is made. Linear systems and matrix row operations use exact expression arithmetic with generic symbolic pivot assumptions. Parameter-dependent exceptional pivots are not classified; singular or underdetermined numeric systems fail explicitly.

The finite-limit implementation permits supported continuous substitution and a bounded removable-0/0 L'Hopital path. It rejects several nonsmooth cases rather than supplying an unjustified two-sided limit. It does not implement infinite limits, general one-sided limits, asymptotic analysis, or complex branches. Taylor output is a polynomial plus human-readable order metadata, not an order-term object participating in later algebra.

## 4. Numerical execution

Expression compilation emits a bounded stack program with numeric constants and variable slots. The VM uses Float64Array stack storage and a fixed whitelist of mathematical operations; it never passes worksheet expressions to `eval` or `Function`. Plot functions reuse compiled programs across samples. Sampling is CPU-side, not WGSL expression compilation.

Definite integration first checks a finite real interval. Conservative interval propagation detects zero-containing denominators, real-domain violations and tangent poles, with special handling of genuine quadratic extrema. Additional numerical samples check finiteness. These checks may conservatively reject an otherwise valid expression; they do not constitute a general interval-arithmetic library or domain proof system. Generic simplification may already have removed removable factors.

A recognized primitive is evaluated at the endpoints; otherwise composite seeded adaptive Simpson quadrature uses a 1e-9 target tolerance, bounded recursion and bounded samples. Its error is an algorithmic estimate, not a certified enclosure. Highly oscillatory or poorly resolved functions can defeat ordinary adaptive quadrature. Improper integrals and endpoint singularities are not supported.

`fsolve` samples an interval, locates sign-change brackets, bisects and checks the residual. It can miss even-multiplicity, closely spaced, or unresolved roots and does not prove that its returned list is complete. `ode` is a fixed-step scalar fourth-order Runge–Kutta IVP integrator: no stiffness detection, adaptive error control, events, systems, or boundary-value problems.

## 5. Plot rendering and lifecycle

One GPUService lazily requests an adapter/device and creates the shader module, binding layout and shared triangle/line pipelines. Each PlotView owns its uniform buffer, MSAA/depth textures, geometrically growing vertex/line buffers, resize observer, intersection observer, input listeners and animation frame. Disposal destroys its resources and detaches every observer/listener. GPU loss, adapter absence, compilation errors and uncaptured validation errors switch views to their separate Canvas 2D surfaces.

Vertices use a 40-byte interleaved layout: position float32x3 at offset 0, normal float32x3 at 12, color float32x4 at 24. The 80-byte scene uniform holds a column-major 4×4 view-projection matrix and a vec4 of options. WebGPU uses 0..1 clip-space depth, `depth24plus`, four samples, a triangle-list pipeline and a line-list pipeline with no depth writes. Normals are in world/object coordinates because mesh geometry has no additional model transform.

A default surface samples a 113×113 vertex lattice and emits up to 25,088 unindexed triangles plus a sparser independent wireframe. Invalid samples omit affected quads. Vertical coordinates and the color scale use a robust sampled height range, so the display uses normalized aspect scaling rather than claiming equal units on all axes. Pole/discontinuity rejection is heuristic; a sampled mesh is not a certified topological representation.

2D curves are sampled at a viewport-dependent density, capped at 4096 segments per curve. Geometry is generated as pixel-width triangle strips with rectangular clipping; large adjacent jumps are skipped. Samples are cached until their domain, parameters or width change. Triangle buffers are cached until view ranges, dimensions, grid or parameters change. Pointer tracing redraws only the labels/crosshair overlay. GPU mesh uploads happen only when geometry changes; camera changes update uniforms and guide lines.

Frames are requested on demand. Offscreen PlotViews stop painting via IntersectionObserver; rotation alone continuously schedules frames while visible. Resize limits backing-store device-pixel ratio to two. Full-window plots use CSS expansion rather than requiring the browser Fullscreen API.

The Canvas 2D fallback renders 2D triangles and depth-sorted projected 3D triangles. Its surface lines are not depth-clipped like the GPU path; intersecting surfaces may sort imperfectly and dense surfaces are slower. Plot status timing is CPU-side preparation/draw-submission wall time, **not GPU completion time or a hardware benchmark**. No timestamp-query instrumentation is implemented.

## 6. Safety limits and trust boundaries

| Boundary | Limit |
| --- | --- |
| Source text per cell | 16,000 characters |
| Tokens per expression | 2,048 |
| Parser/evaluator nesting | 96 levels |
| Kernel evaluation budget | 80,000 visited nodes |
| Numeric literal text / decimal exponent | 256 characters / magnitude 1,000 |
| Integer exact power | exponent magnitude 4,096 plus estimated 65,536-bit budget |
| Factorial input | integer 0..1,000 |
| Derivative order | 0..12 |
| Taylor order | 1..12 |
| Dense matrices | at most 16×16 |
| Matrix powers | integer -1..16 |
| Exact linear systems | at most 8 variables |
| Finite sum/product | at most 10,001 terms |
| Curves / automatic sliders per plot | 8 / 6 |
| Worksheet import | 2 MiB; 500 cells |
| Open documents / undo snapshots | 20 / 80 per document |
| UI worker deadline | 8 seconds without the next cell result |

The kernel limits address accidental or moderately adversarial input; this is not a security audit or a formal denial-of-service guarantee. BigInt arithmetic and UI rendering still consume finite host resources. Native MathML parsing/formatting previews run on the UI thread, while symbolic evaluation runs in the worker. Plot sampling also currently runs on the UI thread and remains a potential extension point for worker-generated/transferred geometry.

For a hardened hosted deployment, prefer the source ES-module build, review a strict Content Security Policy appropriate to its inline style attributes, allow only required worker/script sources, and independently audit import, resource bounds, browser compatibility and arithmetic behavior. The single-file build necessarily embeds script/style and a Blob worker.

## 7. Deliberate extension seams

The kernel protocol returns serialized strings and numeric plot programs rather than DOM or GPU objects. A different symbolic engine could implement that same result protocol. The IR, numerical VM, algebra algorithms, worksheet execution policy and renderer are separate modules. Improvements can therefore add a proper structural math editor, assumption-aware rewriting, worker-side adaptive tessellation, indexed meshes, sparse linear algebra or a different backend without making user documents executable JavaScript.

These are architectural seams, not claims that those missing features are already implemented.
