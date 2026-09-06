# Command contracts

A math cell contains one expression. A trailing `;` or `:` is accepted without Maple's output-suppression semantics. `#` introduces a source comment. Names support Unicode letters; `π` and `pi` normalize to `Pi`. Curly-brace input is accepted as a list, not as a distinct mathematical set type. List or matrix indexing syntax is not implemented.

## Values and definitions

| Input | Contract |
| --- | --- |
| `1/3 + 1/6` | Exact reduced rational result `1/2`. |
| `0.1 + 0.2` | Decimal literals are exact rationals; result `3/10`. |
| `evalf(Pi/3)` | Approximate binary64 result; display rounds to 12 significant digits. |
| `a := 3` | Define a value in the current prefix execution. |
| `f := x -> a*x^2 + 1` | Define a one-argument symbolic function. |
| `f(x,y) := x*y + y` | Define a multiple-argument symbolic function. |
| `unassign(a)` | Remove a variable or function definition. |
| `restart()` | Clear the current worker environment. Earlier worksheet cells are still replayed on later execution. |
| `subs([x=2,y=3], x*y+x)` | Simultaneous scalar symbol substitution. |
| `eval(x*y+x, [x=2,y=3])` | Expression-first substitution alias. |

Definitions are evaluated in document order. User-function bodies resolve nonparameter names using the environment at call time, not a captured immutable closure. The calculus/plotting commands bind their own independent variables even when those names also have assigned worksheet values. Builtin and mathematical constant names are protected against assignment.

## Algebra and calculus

| Command | Scope |
| --- | --- |
| `simplify(expr)` | Scalar canonicalization, like terms, exact special values, selected trig identity. |
| `expand(expr)` | Bounded distributive/polynomial expansion. |
| `factor(expr)` or `factor(expr,x)` | Univariate bounded rational-root factorization. |
| `solve(expr,x)` | Solve `expr=0`; also accepts `solve(lhs=rhs,x)`. Exact linear/quadratic and supported reducible higher polynomials. Returns a list of distinct roots. |
| `solve([e1,e2],[x,y])` | Square exact linear system, at most eight variables; returns a list of equations. |
| `diff(expr,x)` / `diff(expr,x,n)` | Symbolic derivative; optional order from 0 to 12. |
| `int(expr,x)` / `integrate(expr,x)` | Rule-based antiderivative without arbitrary constant; unsupported parts remain unevaluated. |
| `int(expr,x=a..b)` | Finite real definite integral; exact where recognized, adaptive numerical fallback otherwise. Reversed/equal bounds are accepted. |
| `limit(expr,x=a)` | Supported continuous substitution or removable 0/0 limit at a finite point. |
| `series(expr,x=a,n)` | Taylor polynomial of degrees 0 through n−1, n=1..12; remainder information is a note. |
| `sum(expr,k=a..b)` / `product(expr,k=a..b)` | Finite integer range of at most 10,001 terms. Empty ranges produce 0 / 1. |
| `fsolve(expr,x=a..b)` | Residual-checked real-root scan/bisection. Completeness is not guaranteed. |

Supported elementary function names include `sin`, `cos`, `tan`, `asin`, `acos`, `atan`, `sinh`, `cosh`, `tanh`, `exp`, `log`, `ln`, `sqrt`, `abs`, `floor`, `ceil`, `sign`, `factorial`, `min`, `max`, and `atan2`. Factorial has postfix syntax `n!`. `min`, `max`, and `atan2` take two arguments. Some calls remain symbolic until `evalf`; this does not imply that every named elementary function has all derivative/integration rules.

Constants: `Pi`, `e`, symbolic `I`; `infinity` is parseable but infinite numerical domains and general infinite limits are not supported. Approximate evaluation is real-valued; an expression involving `I` can remain symbolic but cannot generally be converted with `evalf`.

## Matrices and statistics

| Command | Contract |
| --- | --- |
| `Matrix([[a,b],[c,d]])` | Rectangular dense matrix up to 16×16. All rows must have equal length. |
| `Vector([a,b,c])` | Column matrix. |
| `A+B`, `A-B`, `A*B`, `2*A` | Matrix/scalar typed arithmetic. Matrix products retain operand order. |
| `A^n` | Square-matrix integer power, n=-1..16; -1 means inverse. |
| `det(A)` / `determinant(A)` | Determinant of a square matrix. |
| `inverse(A)` | Exact expression inverse; rejects singular numeric matrices. |
| `transpose(A)`, `trace(A)`, `rank(A)`, `rref(A)` | Dense elementary linear algebra. Symbolic pivots assume generic nonzero values. |
| `mean([a,b,c])` | Exact arithmetic mean when inputs permit it. |
| `median([a,b,c])` | Numeric median. |
| `variance([a,b,c])`, `stdev([a,b,c])` | Sample statistics with n−1 denominator; at least two observations. |

There are no sparse matrices, arbitrary-rank tensors, eigenvalue/SVD/QR algorithms, interval matrices, or parameter-conditional rank analysis in this version.

## Plotting

```text
plot(sin(x), x=-6..6)
plot([sin(a*x), cos(x)], x=-6..6)
plot3d(sin(a*x)*cos(y), x=-5..5, y=-5..5)
ode(-y+sin(t), y=1, t=0..10)
```

`plot` accepts one expression or a list of up to eight curves. `plot3d` accepts one height-field expression and two distinct independent variables. Numeric domains must be finite and increasing. Up to six unassigned free variables become sliders; their default range is 0.1..4 with step 0.05 and initial value 1. The UI does not yet expose editing those slider bounds. Assigned variables are substituted before plotting.

`ode(rhs,y=y0,t=a..b)` solves a scalar first-order initial-value equation `dy/dt=rhs(t,y)` over a finite increasing interval, with 2,048 fixed RK4 steps, then plots the sampled result. This is an Aster command, not an implementation of Maple's `dsolve` language.

The graph controls operate on actual geometry. Parameter changes resample; 3D orbit changes the camera without rebuilding the surface. The default mesh is 112×112 quads before invalid-region rejection. Sampled clipping, scale selection and discontinuity heuristics are not mathematical guarantees about arbitrary functions.

## Errors and unsupported commands

Syntax, dimension, protected-name, range, nonfinite-value and resource-limit violations produce visible cell errors. Errors do not crash the worksheet; later cells continue in the successful preceding environment. An unknown function normally remains a symbolic function and produces a note. Specifically unsupported package-style commands such as `dsolve`, `pdsolve`, `assume`, `with`, `proc` and `piecewise` produce explicit errors.

Maple packages, `.mw` / `.mws` / `.maple` compatibility, loops/procedures, units, complete assumptions, arbitrary-precision numerics, full branch analysis, and general symbolic solving are not present. Save editable Aster worksheets as `.aster` rather than renaming foreign worksheet files.
