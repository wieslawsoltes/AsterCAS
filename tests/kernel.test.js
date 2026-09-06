import test from 'node:test';
import assert from 'node:assert/strict';
import {Kernel} from '../js/core/kernel.js';
import {parse,format,simplify,numeric,compile,makeEvaluator,MathError,substitute,num,mathML} from '../js/core/ast.js';
import {derivative,integrate,expand,adaptiveIntegral,rk4} from '../js/core/algebra.js';
const run=s=>new Kernel().run(s);
const exact=[
 ['1/3+1/6','1/2'],['0.1+0.2','3/10'],['2^100','1267650600228229401496703205376'],['-2^2','-4'],['(-2)^2','4'],['2^3^2','512'],['2x+3x','5*x'],['2e-3+0.001','3/1000'],['factorial(20)','2432902008176640000'],['sqrt(81/16)','9/4'],['sin(Pi)','0'],['cos(Pi)','-1'],['simplify(sin(x)^2+cos(x)^2)','1'],['expand((x+1)^4)','x^4 + 4*x^3 + 6*x^2 + 4*x + 1'],['factor(x^3-6*x^2+11*x-6)','(x - 1)*(x - 2)*(x - 3)'],['solve(x^2-5*x+6=0,x)','[2, 3]'],['solve(x^2-2*x+1=0,x)','[1]'],['solve(3*x+6=0,x)','[-2]'],['solve(x^3-6*x^2+11*x-6=0,x)','[1, 2, 3]'],['diff(x^5,x)','5*x^4'],['diff(x^5,x,3)','60*x^2'],['diff(exp(-x^2),x)','-2*x*exp(-x^2)'],['int(x^2,x=0..1)','1/3'],['int(x^2,x=1..0)','-1/3'],['int(sin(x),x=0..Pi)','2'],['limit(sin(x)/x,x=0)','1'],['limit((1-cos(x))/x^2,x=0)','1/2'],['subs(x=2,x^3+3*x+1)','15'],['subs([x=2,y=3],x*y+x)','8'],['sum(k^2,k=1..10)','385'],['sum(k,k=5..2)','0'],['product(k,k=1..10)','3628800'],['mean([1,2,3,4,5])','3'],['median([8,2,6,4,10])','6'],['det(Matrix([[2,1],[1,3]]))','5'],['inverse(Matrix([[2,1],[1,3]]))','Matrix([[3/5, -1/5], [-1/5, 2/5]])'],['rank(Matrix([[1,2],[2,4]]))','1'],['trace(Matrix([[2,1],[1,3]]))','5'],['transpose(Matrix([[1,2,3],[4,5,6]]))','Matrix([[1, 4], [2, 5], [3, 6]])'],['solve([2*x+y=5,x-y=1],[x,y])','[x = 2, y = 1]']
];
for(const [source,result] of exact)test(source,()=>assert.equal(run(source).plain,result));
test('exact decimal scientific literals and repeating rational division',()=>assert.equal(run('(0.000000000000001+1)/3').plain,'1000000000000001/3000000000000000'));
test('variable and user function definitions',()=>{const k=new Kernel();k.run('a:=3');k.run('f := x -> a*x^2+1');assert.equal(k.run('f(2)').plain,'13');k.run('g(x,y):=x^2+y^2');assert.equal(k.run('g(3,4)').plain,'25');});
test('symbolic derivative binds its variable despite session definitions',()=>{const k=new Kernel();k.run('x:=4');assert.equal(k.run('diff(x^2,x)').plain,'2*x');});
test('matrix product identity and powers',()=>{const k=new Kernel();k.run('A:=Matrix([[2,1],[1,3]])');assert.equal(k.run('A*inverse(A)').plain,'Matrix([[1, 0], [0, 1]])');assert.equal(k.run('A^0').plain,'Matrix([[1, 0], [0, 1]])');assert.equal(k.run('A^2').plain,'Matrix([[5, 5], [5, 10]])');});
test('reset removes variables and functions',()=>{const k=new Kernel();k.run('a:=1');k.run('f:=x->x+1');k.reset();assert.equal(k.environment().length,0);});
test('indefinite unsupported integration is honest',()=>{const r=run('int(exp(-x^2),x)');assert.match(r.plain,/int\(/);assert.ok(r.notes.some(n=>n.includes('Unevaluated')));});
test('numeric quadrature exp(-x²)',()=>{const r=run('int(exp(-x^2),x=0..1)');assert.ok(Math.abs(Number(r.plain)-0.746824132812427)<1e-10);assert.ok(r.notes.some(n=>n.includes('Numerical')));});
test('adaptive Simpson convergence and reversed interval',()=>{const a=adaptiveIntegral(Math.sin,0,Math.PI);assert.ok(Math.abs(a.value-2)<1e-10);assert.ok(Math.abs(adaptiveIntegral(Math.sin,Math.PI,0).value+2)<1e-10);});
test('bisection root scan checks the residual',()=>{const r=run('fsolve(cos(x)-x,x=0..2)');assert.ok(Math.abs(numeric(parse(r.plain).items[0])-0.73908513321516)<1e-10);assert.equal(run('fsolve(1/x,x=-1..1)').plain,'[]');});
test('scalar ODE integration agrees with the exponential solution',()=>{const p=rk4((t,y)=>-y,1,0,5,1024);assert.ok(Math.abs(p[p.length-1]-Math.exp(-5))<1e-12);});
test('ODE result is real sampled data',()=>{const r=run('ode(-y,y=1,t=0..5)');assert.equal(r.kind,'plot2d');assert.equal(r.curves[0].points.length,4098);assert.ok(Math.abs(r.curves[0].points.at(-1)-Math.exp(-5))<1e-12);});
test('plot bytecode handles a free parameter',()=>{const r=run('plot([sin(a*x),cos(x)],x=-6..6)');assert.equal(r.kind,'plot2d');assert.equal(r.parameters[0].name,'a');assert.equal(r.curves.length,2);const f=makeEvaluator(r.curves[0].program);assert.ok(Math.abs(f([Math.PI/4,2])-1)<1e-15);});
test('surface bytecode exposes both axes and parameter',()=>{const r=run('plot3d(sin(a*x)*cos(y),x=-5..5,y=-5..5)');assert.equal(r.kind,'plot3d');assert.equal(makeEvaluator(r.curves[0].program)([0,1,3]),0);});
test('branch-sensitive sqrt(x²) is not rewritten to x',()=>assert.equal(run('sqrt(x^2)').plain,'sqrt(x^2)'));
test('parser rejects JavaScript injection and non-math property access',()=>{for(const source of ['globalThis.alert(1)','x.constructor','Function("return 1")','<script>','x; y'])assert.throws(()=>parse(source),MathError);});
test('MathML escapes names',()=>{assert.ok(!mathML({k:'sym',name:'<img onerror=x>'}).includes('<img'));});
const errors=['1/0','0^0','factorial(-1)','factorial(1001)','2^5000','1e1001','diff(x,x,99)','int(1/x,x=-1..1)','inverse(Matrix([[1,2],[2,4]]))','Matrix([[1,2],[3]])','det(Matrix([[1,2,3]]))','solve([x+y=1,2*x+2*y=2],[x,y])','plot(sin(x),x=1..-1)','plot3d(sin(x),x=0..1,x=0..1)','ode(y,y=1,y=0..1)','Pi:=3','series(exp(x),x=0,50)','sum(k,k=1..20000)','limit(1/x,x=0)','dsolve(x,x)'];
for(const source of errors)test('guard: '+source,()=>assert.throws(()=>run(source)));
for(const source of ['x^4+2*x^3-3*x+2','sin(x^2)*exp(x)','sqrt(x+5)','log(x^2+2)','atan(3*x)','sin(x)/x'])test('derivative property: '+source,()=>{
  const a=simplify(parse(source)),d=derivative(a,'x'),f=makeEvaluator(compile(a,['x'])),df=makeEvaluator(compile(d,['x']));
  for(const x of [.2,.7,1.3,2.1]){const h=1e-5,finite=(f([x+h])-f([x-h]))/(2*h);assert.ok(Math.abs(df([x])-finite)<1e-5*(1+Math.abs(finite)));}
});
for(const source of ['x^3+3*x+1','sin(2*x)','x*exp(x)','x^2*cos(x)','1/x'])test('antiderivative property: '+source,()=>{
  const a=simplify(parse(source)),i=integrate(a,'x'),d=derivative(i,'x'),f=makeEvaluator(compile(a,['x'])),df=makeEvaluator(compile(d,['x']));for(const x of [.3,.8,1.7])assert.ok(Math.abs(f([x])-df([x]))<1e-8);
});
test('polynomial expansion property over deterministic sample points',()=>{for(let n=1;n<=8;n++){const a=simplify(parse(`(x+2)^${n}`)),b=expand(a);for(const x of [-3,-.2,.7,2])assert.ok(Math.abs(numeric(a,{x})-numeric(b,{x}))<1e-7);}});
test('imaginary-unit integer powers are exact',()=>{assert.equal(run('I^2').plain,'-1');assert.equal(run('I^3').plain,'-I');assert.equal(run('I^4').plain,'1');assert.equal(run('I^(-1)').plain,'-I');});
test('non-smooth two-sided limit is not falsely accepted',()=>assert.throws(()=>run('limit(abs(x)/x,x=0)')));
test('log singularity is not returned as a finite limit',()=>assert.throws(()=>run('limit(log(x),x=0)')));
test('an off-grid interior pole is rejected',()=>assert.throws(()=>run('int(1/(x-0.1234567),x=0..1)')));
test('a double pole is rejected even without a sign change',()=>assert.throws(()=>run('int(1/(x-0.1234567)^2,x=0..1)')));
test('quadratic denominator certification accepts positive quadratics',()=>assert.ok(Math.abs(Number(run('int(1/(x^2-x+1),x=0..1)').plain)-1.2091995761561452)<1e-9));
test('trigonometric poles are rejected',()=>assert.throws(()=>run('int(tan(x),x=0..2)')));

test('direct matrix products retain their noncommutative order',()=>{const k=new Kernel();k.run('A:=Matrix([[1,1],[0,1]])');k.run('B:=Matrix([[1,0],[1,1]])');assert.equal(k.run('A*B').plain,'Matrix([[2, 1], [1, 1]])');assert.equal(k.run('B*A').plain,'Matrix([[1, 1], [1, 2]])');});
test('matrix arguments retain their order through user-defined functions',()=>{const k=new Kernel();k.run('A:=Matrix([[1,1],[0,1]])');k.run('B:=Matrix([[1,0],[1,1]])');k.run('f(x,y):=x*y');assert.equal(k.run('f(A,B)').plain,k.run('A*B').plain);assert.equal(k.run('f(B,A)').plain,k.run('B*A').plain);});
test('nested function calls preserve matrix multiplication order',()=>{const k=new Kernel();k.run('A:=Matrix([[1,1],[0,1]])');k.run('B:=Matrix([[1,0],[1,1]])');k.run('f(x,y):=x*y');k.run('g(x,y):=f(y,x)+f(x,y)');assert.equal(k.run('g(A,B)').plain,'Matrix([[3, 2], [2, 3]])');});
