import {MathError,parse,num,real,sym,call,list,matrix,ZERO,ONE,NEG,isNum,isZero,asNumber,add,mul,pow,neg,sub,div,simplify,simplifyCall,substitute,bindArguments,variables,numeric,compile,makeEvaluator,format,mathML,latex} from './ast.js';
import {derivative,expand,factor,solve,integrate,hasCall,adaptiveIntegral,validateRealInterval,limit,taylor,requireMatrix,matrixOp,linearSolve,findRoots,rk4} from './algebra.js';

const BUILTIN = new Set('sin cos tan exp log ln sqrt abs sinh cosh tanh asin acos atan floor ceil sign min max atan2 factorial diff int integrate simplify expand factor solve subs eval evalf limit series sum product Matrix matrix Vector vector determinant det inverse transpose trace rank rref mean median variance stdev plot plot3d fsolve ode restart unassign'.split(' '));
const RESERVED = new Set([...BUILTIN,'Pi','pi','e','I','infinity']);
const assert=(ok,message)=>{if(!ok)throw new MathError(message);};
const nameOf=a=>{assert(a?.k==='sym','Expected a variable name.');return a.name;};
export class Kernel {
  constructor(){this.reset();}
  reset(){this.env=new Map();this.functions=new Map();this.notes=[];this.operations=0;}
  tick(){if(++this.operations>80000)throw new MathError('Evaluation exceeded the 80,000-node budget.');}
  environment(){return [...this.env].map(([name,value])=>({name,value:format(value),math:mathML(value,false),type:value.k==='matrix'?'Matrix':'Expression'})).concat([...this.functions].map(([name,f])=>({name,value:format(f),type:'Function'})));}
  run(source) {
    this.notes=[];this.operations=0;const start=performance.now();
    const ast=parse(source),value=this.evaluate(ast,new Set());
    let result;
    if(value.kind)result=value;
    else {
      result={kind:'math',plain:format(value),math:mathML(value),latex:latex(value),variables:[...variables(value)]};
      if(hasCall(value,'int'))this.notes.push('Unevaluated integral: no matching symbolic rule. Definite integrals can use numerical quadrature.');
      if(hasCall(value,'diff'))this.notes.push('A derivative remains unevaluated.');
      if(ast.k==='assign'){result.assignment=ast.name;result.lhs=ast.name;}
    }
    return {...result,notes:[...this.notes],elapsed:performance.now()-start,operations:this.operations,environment:this.environment()};
  }
  evaluate(a,blocked=new Set(),depth=0) {
    this.tick();if(depth>96)throw new MathError('Evaluation recursion exceeds 96 levels.');
    const ev=x=>this.evaluate(x,blocked,depth+1);
    if(a.k==='sym')return !blocked.has(a.name)&&this.env.has(a.name)?this.env.get(a.name):a;
    if(['num','real','matrix','lambda'].includes(a.k))return a;
    if(a.k==='assign') {
      assert(!RESERVED.has(a.name),`“${a.name}” is a protected name.`);
      if(a.value.k==='lambda'){this.functions.set(a.name,a.value);this.env.delete(a.name);return a.value;}
      const value=ev(a.value);assert(!value.kind,'A plot cannot be assigned to a scalar variable.');
      this.env.set(a.name,value);this.functions.delete(a.name);return value;
    }
    if(a.k==='list')return list(a.items.map(ev));
    if(a.k==='eq'||a.k==='range')return {...a,left:ev(a.left),right:ev(a.right)};
    if(a.k==='add') {
      const xs=a.args.map(ev);return xs.reduce((r,x)=>r.k==='matrix'||x.k==='matrix'?matrixOp('add',r,x):add(r,x));
    }
    if(a.k==='mul') {
      const xs=a.args.map(ev);return xs.reduce((r,x)=>r.k==='matrix'?(x.k==='matrix'?matrixOp('mul',r,x):matrixOp('scale',r,x)):x.k==='matrix'?matrixOp('scale',x,r):mul(r,x));
    }
    if(a.k==='pow') {
      const b=ev(a.base),e=ev(a.exp);
      if(b.k==='matrix') {
        assert(e.k==='num'&&e.d===1n&&e.n>=-1n&&e.n<=16n,'Matrix powers accept integers from -1 to 16.');
        if(e.n===-1n)return matrixOp('inverse',b);assert(b.rows.length===b.rows[0].length,'Matrix powers require a square matrix.');
        let r=matrix(b.rows.map((row,i)=>row.map((_,j)=>num(i===j?1:0))));for(let i=0n;i<e.n;i++)r=matrixOp('mul',r,b);return r;
      }return pow(b,e);
    }
    if(a.k!=='call')throw new MathError(`Unsupported expression node: ${a.k}.`);
    const args=a.args,n=a.name;
    const arity=(lo,hi=lo)=>assert(args.length>=lo&&args.length<=hi,`${n} expects ${lo===hi?lo:`${lo}–${hi}`} argument${hi===1?'':'s'}.`);
    const withVar=(x,v)=>this.evaluate(x,new Set([...blocked,v]),depth+1);
    const range=(arg)=>{
      assert(arg?.k==='eq'&&arg.right.k==='range','Expected a range such as x=-5..5.');
      const v=nameOf(arg.left),lo=numeric(ev(arg.right.left)),hi=numeric(ev(arg.right.right));
      assert(Number.isFinite(lo)&&Number.isFinite(hi)&&lo<hi,'A range must have finite, increasing endpoints.');return {v,lo,hi};
    };
    if(this.functions.has(n)) {
      const fn=this.functions.get(n);arity(fn.params.length);
      const bindings=Object.fromEntries(fn.params.map((p,i)=>[p,ev(args[i])]));
      return this.evaluate(bindArguments(fn.body,bindings),blocked,depth+1);
    }
    if(n==='restart'){arity(0);this.reset();return {kind:'message',plain:'Kernel restarted. All definitions have been cleared.'};}
    if(n==='unassign'){arity(1);const v=nameOf(args[0]);this.env.delete(v);this.functions.delete(v);return sym(v);}
    if(['diff','int','integrate'].includes(n)) {
      arity(2,n==='diff'?3:2);
      if(n==='diff') {
        const v=nameOf(args[1]),order=args[2]?numeric(ev(args[2])):1;assert(Number.isInteger(order)&&order>=0&&order<=12,'Derivative order must be an integer from 0 to 12.');
        let r=withVar(args[0],v);for(let i=0;i<order;i++)r=derivative(r,v);return simplify(r);
      }
      if(args[1].k==='eq'&&args[1].right.k==='range') {
        // Definite integration permits reversed and equal bounds.
        const v=nameOf(args[1].left),loAST=ev(args[1].right.left),hiAST=ev(args[1].right.right);
        const lo=numeric(loAST),hi=numeric(hiAST),expr=withVar(args[0],v),primitive=integrate(expr,v);
        // Check the integrand numerically over the interval before using an antiderivative.
        const fn=makeEvaluator(compile(expr,[v]));
        if(lo===hi)return ZERO;
        validateRealInterval(expr,v,lo,hi);
        for(let i=0;i<=128;i++){const y=fn([lo+(hi-lo)*i/128]);if(!Number.isFinite(y))throw new MathError('The interval includes a singularity. Improper integrals are not implemented.');}
        if(!hasCall(primitive,'int')) {
          try {return simplify(sub(substitute(primitive,{[v]:hiAST}),substitute(primitive,{[v]:loAST})));}catch{/* Fall back to numerical quadrature. */}
        }
        const r=adaptiveIntegral(x=>fn([x]),lo,hi);this.notes.push(`Numerical quadrature; estimated error ${r.error.toExponential(2)}; ${r.evaluations} samples.`);return real(r.value);
      }
      const v=nameOf(args[1]);this.notes.push('An arbitrary integration constant is omitted.');return simplify(integrate(withVar(args[0],v),v));
    }
    if(['simplify','expand','factor'].includes(n)) {
      arity(1,2);const x=ev(args[0]);if(n==='simplify')return simplify(x);if(n==='expand')return expand(x);
      const v=args[1]?nameOf(args[1]):[...variables(x)][0]||'x';return factor(x,v);
    }
    if(n==='solve') {
      arity(1,2);
      if(args[0].k==='list') {
        const vs=args[1]?.k==='list'?args[1].items.map(nameOf):[...new Set(args[0].items.flatMap(a=>[...variables(a)]))].sort();
        const es=args[0].items.map(a=>this.evaluate(a,new Set([...blocked,...vs]),depth+1));return linearSolve(es,vs);
      }
      const v=args[1]?nameOf(args[1]):[...variables(args[0])][0]||'x';return solve(withVar(args[0],v),v);
    }
    if(n==='subs'||n==='eval') {
      arity(2);const assignments=n==='subs'?args[0]:args[1],expr=n==='subs'?args[1]:args[0];
      const pairs=assignments.k==='list'?assignments.items:[assignments];
      const bindings=Object.create(null);for(const p of pairs){assert(p.k==='eq','Use substitutions such as subs(x=2, expression).');bindings[nameOf(p.left)]=ev(p.right);}
      const x=this.evaluate(expr,new Set([...blocked,...Object.keys(bindings)]),depth+1);return simplify(substitute(x,bindings));
    }
    if(n==='evalf'){arity(1);const x=ev(args[0]);if(x.k==='matrix')return matrix(x.rows.map(r=>r.map(a=>real(numeric(a)))));if(x.k==='list')return list(x.items.map(a=>real(numeric(a))));return real(numeric(x));}
    if(n==='limit') {
      arity(2);assert(args[1].k==='eq','Use limit(expression, x=value).');const v=nameOf(args[1].left);return limit(withVar(args[0],v),v,ev(args[1].right));
    }
    if(n==='series') {
      arity(2,3);const spec=args[1],v=nameOf(spec.k==='eq'?spec.left:spec),at=spec.k==='eq'?ev(spec.right):ZERO,order=args[2]?numeric(ev(args[2])):6;
      this.notes.push(`Taylor polynomial through degree ${order-1}; remainder O((${v} − ${format(at)})^${order}).`);return simplify(taylor(withVar(args[0],v),v,at,order));
    }
    if(n==='sum'||n==='product') {
      arity(2);const spec=args[1];assert(spec.k==='eq'&&spec.right.k==='range','Use an index range such as k=1..10.');
      const v=nameOf(spec.left),lo=numeric(ev(spec.right.left)),hi=numeric(ev(spec.right.right));
      assert(Number.isInteger(lo)&&Number.isInteger(hi)&&Math.abs(lo)<=1e6&&Math.abs(hi)<=1e6&&hi-lo<=10000,'Summation/product bounds must be integers with at most 10,001 terms.');
      const x=withVar(args[0],v);let r=n==='sum'?ZERO:ONE;
      for(let i=lo;i<=hi;i++){this.tick();const value=simplify(substitute(x,{[v]:num(i)}));r=n==='sum'?add(r,value):mul(r,value);}return r;
    }
    if(['Matrix','matrix'].includes(n)){arity(1);return requireMatrix(ev(args[0]));}
    if(['Vector','vector'].includes(n)){arity(1);const x=ev(args[0]);assert(x.k==='list','Vector expects a list.');return matrix(x.items.map(a=>[a]));}
    if(['determinant','det','inverse','transpose','trace','rank','rref'].includes(n)){arity(1);return matrixOp(n==='determinant'?'det':n,ev(args[0]));}
    if(['mean','median','variance','stdev'].includes(n)) {
      arity(1);const x=ev(args[0]);assert(x.k==='list'&&x.items.length>0,'Statistics expects a nonempty numeric list.');
      if(n==='mean')return div(add(...x.items),num(x.items.length));
      const values=x.items.map(a=>numeric(a)).sort((a,b)=>a-b),len=values.length;
      if(n==='median')return real(len%2?values[(len-1)/2]:(values[len/2-1]+values[len/2])/2);
      assert(len>=2,'Sample variance needs at least two observations.');const mean=values.reduce((a,b)=>a+b,0)/len,v=values.reduce((s,x)=>s+(x-mean)**2,0)/(len-1);
      this.notes.push('Sample statistic (n − 1 denominator).');return real(n==='stdev'?Math.sqrt(v):v);
    }
    if(n==='fsolve') {
      arity(2);const r=range(args[1]),a=withVar(args[0],r.v),x=a.k==='eq'?sub(a.left,a.right):a,fn=makeEvaluator(compile(x,[r.v]));
      this.notes.push('Bounded real-root scan with bisection. Even-multiplicity and tightly clustered roots can be missed.');return list(findRoots(x=>fn([x]),r.lo,r.hi).map(real));
    }
    if(n==='ode') {
      arity(3);assert(args[1].k==='eq','Use ode(rhs, y=initial, t=start..end).');const y=nameOf(args[1].left),initial=numeric(ev(args[1].right)),r=range(args[2]);assert(y!==r.v,'The state and independent variables must be different.');
      const expr=this.evaluate(args[0],new Set([...blocked,y,r.v]),depth+1),fn=makeEvaluator(compile(expr,[r.v,y]));
      this.notes.push('Explicit scalar initial-value ODE; fixed-step RK4, 2,048 steps. Not a stiff solver.');
      return {kind:'plot2d',xvar:r.v,domain:[r.lo,r.hi],curves:[{label:`${y}(${r.v})`,points:Array.from(rk4((t,y)=>fn([t,y]),initial,r.lo,r.hi))}],parameters:[],title:'Initial-value solution'};
    }
    if(n==='plot'||n==='plot3d') {
      arity(n==='plot'?2:3);const xr=range(args[1]),yr=n==='plot3d'?range(args[2]):null;
      assert(!yr||xr.v!==yr.v,'The two plot axes must use different variables.');
      const block=new Set([...blocked,xr.v,...(yr?[yr.v]:[])]),expr=this.evaluate(args[0],block,depth+1);
      const expressions=expr.k==='list'?expr.items:[expr];assert(expressions.length>0&&expressions.length<=8,'A plot supports one to eight curves.');assert(!yr||expressions.length===1,'A surface plot accepts one expression.');
      const axes=[xr.v,...(yr?[yr.v]:[])],params=[...new Set(expressions.flatMap(a=>[...variables(a)]))].filter(v=>!axes.includes(v));
      assert(params.length<=6,'A plot supports at most six free parameters.');
      const result={kind:yr?'plot3d':'plot2d',xvar:xr.v,yvar:yr?.v,domain:[xr.lo,xr.hi],ydomain:yr?[yr.lo,yr.hi]:undefined,parameters:params.map(name=>({name,value:1,min:0.1,max:4,step:0.05})),curves:expressions.map(a=>({label:format(a),program:compile(a,[...axes,...params])})),title:yr?'Surface exploration':'Function exploration'};
      return result;
    }
    if(['dsolve','pdsolve','assume','with','proc','piecewise'].includes(n))throw new MathError(`“${n}” is not implemented in this kernel. Open the command reference for supported operations.`);
    const xs=args.map(ev);
    if(!BUILTIN.has(n)){this.notes.push(`“${n}” is an undefined symbolic function; no evaluation rule was applied.`);return call(n,...xs);}
    if(['min','max','atan2'].includes(n)){arity(2);if(xs.every(isNum))return real(n==='min'?Math.min(...xs.map(asNumber)):n==='max'?Math.max(...xs.map(asNumber)):Math.atan2(...xs.map(asNumber)));return call(n,...xs);}
    arity(1);return simplifyCall(n,xs);
  }
}
