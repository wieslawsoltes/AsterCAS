import {MathError,num,real,sym,call,list,matrix,ZERO,ONE,NEG,isNum,isZero,isOne,asNumber,key,add,mul,pow,neg,sub,div,simplify,simplifyCall,depends,substitute,numeric,compile,makeEvaluator,format} from './ast.js';

export function derivative(a,v) {
  if(!depends(a,v))return ZERO;
  if(a.k==='sym')return a.name===v?ONE:ZERO;
  if(a.k==='add')return add(...a.args.map(x=>derivative(x,v)));
  if(a.k==='mul')return add(...a.args.map((x,i)=>mul(derivative(x,v),...a.args.filter((_,j)=>j!==i))));
  if(a.k==='pow') {
    const b=a.base,e=a.exp;
    if(!depends(e,v))return mul(e,pow(b,sub(e,ONE)),derivative(b,v));
    return mul(a,add(mul(derivative(e,v),call('log',b)),div(mul(e,derivative(b,v)),b)));
  }
  if(a.k==='call'&&a.args.length===1) {
    const x=a.args[0],dx=derivative(x,v);let outer;
    switch(a.name) {
      case 'sin':outer=call('cos',x);break;case 'cos':outer=neg(call('sin',x));break;
      case 'tan':outer=pow(call('cos',x),num(-2));break;
      case 'exp':outer=a;break;case 'log':case 'ln':outer=pow(x,NEG);break;
      case 'sqrt':outer=div(ONE,mul(num(2),call('sqrt',x)));break;
      case 'sinh':outer=call('cosh',x);break;case 'cosh':outer=call('sinh',x);break;
      case 'tanh':outer=pow(call('cosh',x),num(-2));break;
      case 'asin':outer=div(ONE,call('sqrt',sub(ONE,pow(x,num(2)))));break;
      case 'acos':outer=neg(div(ONE,call('sqrt',sub(ONE,pow(x,num(2))))));break;
      case 'atan':outer=div(ONE,add(ONE,pow(x,num(2))));break;
      case 'abs':outer=call('sign',x);break;
      default:return call('diff',a,sym(v));
    }
    return simplify(mul(outer,dx));
  }
  return call('diff',a,sym(v));
}
export function expand(a,budget={steps:0}) {
  if(++budget.steps>12000)throw new MathError('Expansion exceeds the 12,000-operation budget.');
  if(a.k==='add')return add(...a.args.map(x=>expand(x,budget)));
  if(a.k==='mul') {
    let terms=[ONE];
    for(const f0 of a.args) {
      const f=expand(f0,budget),fs=f.k==='add'?f.args:[f];
      if(terms.length*fs.length>2048)throw new MathError('Expansion exceeds 2,048 intermediate terms.');
      terms=terms.flatMap(t=>fs.map(x=>mul(t,x)));
    }return add(...terms);
  }
  if(a.k==='pow'&&a.exp.k==='num'&&a.exp.d===1n&&a.exp.n>=0n&&a.exp.n<=24n) {
    const base=expand(a.base,budget);if(base.k!=='add')return pow(base,a.exp);
    let r=ONE;for(let j=0n;j<a.exp.n;j++)r=expand({k:'mul',args:[r,base]},budget);return r;
  }
  return a;
}
function trim(p) { while(p.length>1&&isZero(p[p.length-1]))p.pop();return p; }
const pAdd=(a,b)=>trim(Array.from({length:Math.max(a.length,b.length)},(_,i)=>add(a[i]||ZERO,b[i]||ZERO)));
const pMul=(a,b)=> {
  if(a.length+b.length>130)throw new MathError('Polynomial degree exceeds 128.');
  const p=Array(a.length+b.length-1).fill(ZERO);a.forEach((x,i)=>b.forEach((y,j)=>p[i+j]=add(p[i+j],mul(x,y))));return trim(p);
};
/** Coefficients in ascending power order. Returns null for non-polynomials. */
export function polynomial(a,v) {
  if(!depends(a,v))return [a];
  if(a.k==='sym'&&a.name===v)return [ZERO,ONE];
  if(a.k==='add'){let p=[ZERO];for(const x of a.args){const q=polynomial(x,v);if(!q)return null;p=pAdd(p,q);}return p;}
  if(a.k==='mul'){let p=[ONE];for(const x of a.args){const q=polynomial(x,v);if(!q)return null;p=pMul(p,q);}return p;}
  if(a.k==='pow'&&a.exp.k==='num'&&a.exp.d===1n&&a.exp.n>=0n&&a.exp.n<=64n) {
    const q=polynomial(a.base,v);if(!q)return null;let p=[ONE];for(let j=0n;j<a.exp.n;j++)p=pMul(p,q);return p;
  }return null;
}
export const fromPolynomial=(p,v)=>add(...p.map((c,i)=>mul(c,pow(sym(v),num(i)))));
function polyAt(p,x){let a=ZERO;for(let i=p.length-1;i>=0;i--)a=add(mul(a,x),p[i]);return a;}
function divideRoot(p,r){const q=Array(p.length-1);q[q.length-1]=p[p.length-1];for(let i=q.length-2;i>=0;i--)q[i]=add(p[i+1],mul(r,q[i+1]));return trim(q);}
function divisors(n) {
  n=n<0n?-n:n;if(n===0n)return [0n];if(n>10000000n)return [];
  const result=[];for(let i=1n;i*i<=n;i++){if(n%i===0n){result.push(i);if(i*i!==n)result.push(n/i);}if(result.length>256)break;}return result;
}
function rationalRoot(p) {
  if(isZero(p[0]))return ZERO;if(!p.every(c=>c.k==='num'))return null;
  // Clear denominators before applying the rational root theorem.
  const denom=p.reduce((a,c)=>a*c.d,1n),ints=p.map(c=>c.n*(denom/c.d));
  const ns=divisors(ints[0]),ds=divisors(ints[ints.length-1]);let tries=0;
  for(const n of ns)for(const d of ds)for(const s of [1n,-1n]){
    if(++tries>10000)return null;const r=num(n*s,d);if(isZero(polyAt(p,r)))return r;
  }return null;
}
export function factor(a,v) {
  let p=polynomial(expand(a),v);if(!p||p.length<2)return a;
  const factors=[];
  while(p.length>2){const r=rationalRoot(p);if(!r)break;factors.push(sub(sym(v),r));p=divideRoot(p,r);}
  if(p.length===3){const r=rationalRoot(p);if(r){factors.push(sub(sym(v),r));p=divideRoot(p,r);}}
  if(p.length===2){const r=div(neg(p[0]),p[1]);factors.push(sub(sym(v),r));p=[p[1]];}
  if(factors.length===0)return a;
  factors.push(fromPolynomial(p,v));return mul(...factors);
}
export function solve(a,v) {
  const expression=a.k==='eq'?sub(a.left,a.right):a;
  let p=polynomial(expand(expression),v);
  if(!p)throw new MathError('Exact solve currently accepts polynomial equations. Use fsolve(expr, x=a..b) for other real equations.');
  const roots=[];
  while(p.length>3){const r=rationalRoot(p);if(!r)throw new MathError('This polynomial is not reducible by the bounded rational-root solver. Use fsolve to search a real interval.');roots.push(r);p=divideRoot(p,r);}
  if(p.length===1){if(isZero(p[0])&&roots.length===0)throw new MathError('The equation is an identity: every value in its domain is a solution.');}
  else if(p.length===2)roots.push(div(neg(p[0]),p[1]));
  else {
    const [c,b,a0]=p,delta=sub(pow(b,num(2)),mul(num(4),a0,c));
    const sd=simplifyCall('sqrt',[delta]);roots.push(div(add(neg(b),sd),mul(num(2),a0)),div(sub(neg(b),sd),mul(num(2),a0)));
  }
  const unique=[...new Map(roots.map(r=>[key(simplify(r)),simplify(r)])).values()];
  unique.sort((a,b)=>{try{return numeric(a)-numeric(b);}catch{return key(a).localeCompare(key(b));}});
  return list(unique);
}
export function integrate(a,v,level=0) {
  if(level>16)return call('int',a,sym(v));
  if(!depends(a,v))return mul(a,sym(v));
  const p=polynomial(a,v);
  if(p)return add(...p.map((c,i)=>mul(div(c,num(i+1)),pow(sym(v),num(i+1)))));
  if(a.k==='add')return add(...a.args.map(x=>integrate(x,v,level+1)));
  if(a.k==='mul') {
    const cs=a.args.filter(x=>!depends(x,v)),vs=a.args.filter(x=>depends(x,v));
    if(cs.length)return mul(...cs,integrate(mul(...vs),v,level+1));
    // Integration by parts for a polynomial times exp/sin/cos of a linear argument.
    if(vs.length===2) {
      let f=vs[0],g=vs[1];if(f.k==='call')[f,g]=[g,f];
      const q=polynomial(f,v);
      if(q&&q.length<=9&&g.k==='call'&&['exp','sin','cos'].includes(g.name)) {
        const dg=derivative(g.args[0],v);
        if(!depends(dg,v)&&!isZero(dg)) {
          const ig=integrate(g,v,level+1),df=derivative(f,v);
          return sub(mul(f,ig),integrate(mul(df,ig),v,level+1));
        }
      }
    }
  }
  if(a.k==='pow'&&!depends(a.exp,v)) {
    const db=derivative(a.base,v);
    if(!depends(db,v)&&!isZero(db)) {
      if(key(a.exp)===key(NEG))return div(call('log',call('abs',a.base)),db);
      const n=add(a.exp,ONE);return div(pow(a.base,n),mul(db,n));
    }
  }
  if(a.k==='call'&&a.args.length===1) {
    const x=a.args[0],dx=derivative(x,v);
    if(!depends(dx,v)&&!isZero(dx)) {
      if(a.name==='sin')return div(neg(call('cos',x)),dx);
      if(a.name==='cos')return div(call('sin',x),dx);
      if(a.name==='exp')return div(a,dx);
      if(a.name==='sqrt')return div(mul(num(2,3),pow(x,num(3,2))),dx);
      if(a.name==='log')return div(sub(mul(x,a),x),dx);
      if(a.name==='sinh')return div(call('cosh',x),dx);
      if(a.name==='cosh')return div(call('sinh',x),dx);
    }
  }
  return call('int',a,sym(v));
}
export function hasCall(a,name) {return (a.k==='call'&&a.name===name)||(a.args?.some(x=>hasCall(x,name)))||(a.base&&(hasCall(a.base,name)||hasCall(a.exp,name)))||false;}
/** Conservative real-domain validation on a closed integration interval.
 * Interval overestimation can reject safe cases; it must not certify a pole.
 * Quadratic denominators use their exact extremum to reduce false positives.
 */
export function validateRealInterval(a,v,lo,hi) {
  if(hi<lo)[lo,hi]=[hi,lo];
  const containsZero=r=>r[0]<=0&&r[1]>=0;
  const finite=r=>{if(r.some(x=>!Number.isFinite(x)))throw new MathError('Cannot certify a finite real integrand over this interval. Split the interval or change the expression.');return r;};
  function bounds(a) {
    if(isNum(a))return [asNumber(a),asNumber(a)];
    if(a.k==='sym'){if(a.name===v)return [lo,hi];const x=numeric(a);return [x,x];}
    if(a.k==='add'){let out=[0,0];for(const x of a.args){const r=bounds(x);out=[out[0]+r[0],out[1]+r[1]];}return finite(out);}
    if(a.k==='mul'){let out=[1,1];for(const x of a.args){const r=bounds(x),p=[out[0]*r[0],out[0]*r[1],out[1]*r[0],out[1]*r[1]];out=[Math.min(...p),Math.max(...p)];}return finite(out);}
    if(a.k==='pow') {
      let b=bounds(a.base);const e=numeric(a.exp);
      if(e<0){
        const p=polynomial(a.base,v);
        if(p&&p.length<=3&&p.every(x=>isNum(x))){const coeff=p.map(asNumber),f=x=>(coeff[0]||0)+(coeff[1]||0)*x+(coeff[2]||0)*x*x,values=[f(lo),f(hi)];if(coeff[2]){const t=-coeff[1]/(2*coeff[2]);if(t>lo&&t<hi)values.push(f(t));}b=[Math.min(...values),Math.max(...values)];}
        if(containsZero(b))throw new MathError('The interval contains, or may contain, a denominator zero. Improper integrals require branch/singularity analysis, which is not implemented.');
      }
      if(!Number.isInteger(e)&&b[0]<0)throw new MathError('A fractional power may leave the real domain over this interval.');
      const values=[Math.pow(b[0],e),Math.pow(b[1],e)];if(e>0&&Number.isInteger(e)&&e%2===0&&containsZero(b))values.push(0);return finite([Math.min(...values),Math.max(...values)]);
    }
    if(a.k==='call'&&a.args.length===1){
      const b=bounds(a.args[0]),[l,h]=b,n=a.name;
      if(n==='log'||n==='ln'){if(l<=0)throw new MathError('The logarithm is not real and finite over the closed interval.');return [Math.log(l),Math.log(h)];}
      if(n==='sqrt'){if(l<0)throw new MathError('The square root may leave the real domain on this interval.');return [Math.sqrt(l),Math.sqrt(h)];}
      if(n==='exp')return finite([Math.exp(l),Math.exp(h)]);
      if(n==='abs')return containsZero(b)?[0,Math.max(-l,h)]:[Math.min(Math.abs(l),Math.abs(h)),Math.max(Math.abs(l),Math.abs(h))];
      if(n==='sin'||n==='cos'){
        const f=n==='sin'?Math.sin:Math.cos;if(h-l>=2*Math.PI)return [-1,1];const values=[f(l),f(h)],offset=n==='sin'?Math.PI/2:0;
        for(let k=Math.ceil((l-offset)/Math.PI);k<=Math.floor((h-offset)/Math.PI);k++)values.push(k%2===0?1:-1);return [Math.min(...values),Math.max(...values)];
      }
      if(n==='tan'){if(Math.ceil((l-Math.PI/2)/Math.PI)<=Math.floor((h-Math.PI/2)/Math.PI))throw new MathError('The interval crosses a tangent pole.');return [Math.tan(l),Math.tan(h)];}
      if(n==='atan')return [Math.atan(l),Math.atan(h)];
      if(n==='sinh')return finite([Math.sinh(l),Math.sinh(h)]);
      if(n==='cosh'){const xs=[Math.cosh(l),Math.cosh(h)];if(containsZero(b))xs.push(1);return finite([Math.min(...xs),Math.max(...xs)]);}
      if(n==='tanh')return [Math.tanh(l),Math.tanh(h)];
      if(n==='asin'||n==='acos'){if(l< -1||h>1)throw new MathError('The inverse trigonometric argument leaves [-1,1].');return n==='asin'?[Math.asin(l),Math.asin(h)]:[Math.acos(h),Math.acos(l)];}
      throw new MathError('The integrand contains a function without a certified continuous real-domain rule.');
    }
    throw new MathError('Cannot certify this expression over the integration interval.');
  }
  return bounds(a);
}
export function adaptiveIntegral(f,a,b,tol=1e-9) {
  if(a===b)return {value:0,error:0,evaluations:0};if(b<a){const r=adaptiveIntegral(f,b,a,tol);r.value=-r.value;return r;}
  let evaluations=0;
  const sample=x=>{if(++evaluations>100000)throw new MathError('Numerical integration exceeded 100,000 function evaluations.');const y=f(x);if(!Number.isFinite(y))throw new MathError('The integration interval includes a singularity or non-real value.');return y;};
  const simpson=(a,b,fa,fm,fb)=>(b-a)*(fa+4*fm+fb)/6;
  function rec(a,b,fa,fm,fb,S,eps,depth) {
    const m=(a+b)/2,l=(a+m)/2,r=(m+b)/2,fl=sample(l),fr=sample(r);
    const L=simpson(a,m,fa,fl,fm),R=simpson(m,b,fm,fr,fb),delta=L+R-S;
    if(Math.abs(delta)<=15*eps)return {value:L+R+delta/15,error:Math.abs(delta)/15};
    if(depth<=0)throw new MathError('Numerical integration did not converge at the requested tolerance.');
    const x=rec(a,m,fa,fl,fm,L,eps/2,depth-1),y=rec(m,b,fm,fr,fb,R,eps/2,depth-1);
    return {value:x.value+y.value,error:x.error+y.error};
  }
  // Composite seed reduces accidental aliasing of oscillatory integrands.
  let value=0,error=0;
  for(let i=0;i<16;i++){const l=a+(b-a)*i/16,r=a+(b-a)*(i+1)/16,m=(l+r)/2,fl=sample(l),fm=sample(m),fr=sample(r);const z=rec(l,r,fl,fm,fr,simpson(l,r,fl,fm,fr),tol/16,20);value+=z.value;error+=z.error;}
  return {value,error,evaluations};
}
function fraction(a) {
  if(a.k==='mul'){const n=[],d=[];for(const f of a.args){if(f.k==='pow'&&f.exp.k==='num'&&f.exp.n<0n)d.push(pow(f.base,neg(f.exp)));else n.push(f);}return [mul(...n),mul(...d)];}
  if(a.k==='pow'&&a.exp.k==='num'&&a.exp.n<0n)return [ONE,pow(a.base,neg(a.exp))];
  return [a,ONE];
}
export function limit(a,v,at) {
  if(['abs','sign','floor','ceil'].some(f=>hasCall(a,f)))throw new MathError('Limits of non-smooth or discontinuous functions require branch analysis, which is not implemented.');
  let [n,d]=fraction(a);
  // Only continuity substitution and removable 0/0 forms are claimed here.
  for(let j=0;j<9;j++) {
    let nv,dv;try{nv=simplify(substitute(n,{[v]:at}));dv=simplify(substitute(d,{[v]:at}));}catch{break;}
    if(!isZero(dv)){const result=simplify(div(nv,dv));try{numeric(result);}catch{throw new MathError('The limit is not a finite, evaluable real value under the implemented continuity rules.');}return result;}
    if(!isZero(nv))break;n=derivative(n,v);d=derivative(d,v);
  }
  throw new MathError('This limit is outside the continuity/removable-singularity rules currently implemented.');
}
export function taylor(a,v,at,order) {
  if(!Number.isInteger(order)||order<1||order>12)throw new MathError('Series order must be an integer from 1 to 12.');
  let d=a,fact=1n;const terms=[];
  for(let i=0;i<order;i++){if(i)fact*=BigInt(i);const c=simplify(substitute(d,{[v]:at}));terms.push(mul(div(c,num(fact)),pow(sub(sym(v),at),num(i))));d=derivative(d,v);}
  return add(...terms);
}
export function requireMatrix(a) {
  if(a.k==='list'&&a.items.every(r=>r.k==='list'))a=matrix(a.items.map(r=>r.items));
  if(a.k!=='matrix')throw new MathError('Expected a matrix, for example Matrix([[1,2],[3,4]]).');
  const rows=a.rows.length,cols=a.rows[0]?.length||0;
  if(!rows||!cols||rows>16||cols>16||a.rows.some(r=>r.length!==cols))throw new MathError('Matrices must be rectangular, non-empty, and no larger than 16 × 16.');
  return a;
}
export function matrixOp(op,a,b) {
  a=requireMatrix(a);
  if(op==='transpose')return matrix(a.rows[0].map((_,i)=>a.rows.map(r=>r[i])));
  if(op==='add') {b=requireMatrix(b);if(a.rows.length!==b.rows.length||a.rows[0].length!==b.rows[0].length)throw new MathError('Matrix dimensions must match.');return matrix(a.rows.map((r,i)=>r.map((x,j)=>add(x,b.rows[i][j]))));}
  if(op==='scale')return matrix(a.rows.map(r=>r.map(x=>mul(x,b))));
  if(op==='mul') {
    b=requireMatrix(b);if(a.rows[0].length!==b.rows.length)throw new MathError('Inner matrix dimensions must agree.');
    return matrix(a.rows.map(r=>b.rows[0].map((_,j)=>add(...r.map((x,k)=>mul(x,b.rows[k][j]))))));
  }
  const n=a.rows.length;if(['det','inverse','trace'].includes(op)&&a.rows[0].length!==n)throw new MathError('This operation requires a square matrix.');
  if(op==='trace')return add(...a.rows.map((r,i)=>r[i]));
  const cols=a.rows[0].length,rows=a.rows.map((r,i)=>op==='inverse'?[...r,...Array.from({length:n},(_,j)=>num(i===j?1:0))]:[...r]);
  let pivotRow=0,det=ONE;
  for(let col=0;col<cols&&pivotRow<n;col++) {
    let p=pivotRow;while(p<n&&isZero(simplify(rows[p][col])))p++;
    if(p===n){if(op==='det')return ZERO;continue;}
    if(p!==pivotRow){[rows[p],rows[pivotRow]]=[rows[pivotRow],rows[p]];det=neg(det);}
    const pivot=rows[pivotRow][col];det=mul(det,pivot);
    rows[pivotRow]=rows[pivotRow].map(x=>div(x,pivot));
    for(let r=0;r<n;r++)if(r!==pivotRow){const f=rows[r][col];rows[r]=rows[r].map((x,j)=>simplify(sub(x,mul(f,rows[pivotRow][j]))));}
    pivotRow++;
  }
  if(op==='det')return simplify(det);
  if(op==='inverse') {if(pivotRow<n)throw new MathError('The matrix is singular and has no inverse.');return matrix(rows.map(r=>r.slice(n)));}
  if(op==='rank')return num(pivotRow);
  return matrix(rows);
}
export function linearSolve(eqs,vars) {
  if(eqs.length!==vars.length||vars.length>8)throw new MathError('Use a square linear system with at most eight unknowns.');
  const rows=eqs.map(eq=>{
    let expr=eq.k==='eq'?sub(eq.left,eq.right):eq;
    const zero=Object.fromEntries(vars.map(v=>[v,ZERO]));const c=substitute(expr,zero);
    const coefficients=vars.map(v=>{const d=derivative(expr,v);if(vars.some(w=>depends(d,w)))throw new MathError('The system solver accepts linear equations only.');return d;});
    return [...coefficients,neg(c)];
  });
  const r=matrixOp('rref',matrix(rows));
  for(let i=0;i<vars.length;i++)for(let j=0;j<vars.length;j++)if(!isZero(sub(r.rows[i][j],num(i===j?1:0))))throw new MathError('The system is singular, underdetermined, or inconsistent.');
  return list(vars.map((v,i)=>({k:'eq',left:sym(v),right:r.rows[i][vars.length]})));
}
export function findRoots(f,a,b) {
  if(!(Number.isFinite(a)&&Number.isFinite(b)&&a<b))throw new MathError('Root search needs finite increasing bounds.');
  const roots=[],N=2048;
  const save=x=>{if(!roots.some(y=>Math.abs(x-y)<1e-6*(1+Math.abs(x))))roots.push(x);};
  let x=a,y=f(a);
  for(let i=1;i<=N;i++) {
    const xx=a+(b-a)*i/N,yy=f(xx);
    if(Number.isFinite(y)&&Math.abs(y)<1e-10)save(x);
    if(Number.isFinite(y)&&Number.isFinite(yy)&&Math.sign(y)!==Math.sign(yy)){
      let lo=x,hi=xx,fl=y;
      for(let j=0;j<64;j++){const m=(lo+hi)/2,fm=f(m);if(!Number.isFinite(fm))break;if(Math.sign(fl)===Math.sign(fm)){lo=m;fl=fm;}else hi=m;}
      const r=(lo+hi)/2;if(Number.isFinite(f(r))&&Math.abs(f(r))<1e-7)save(r);
    }
    x=xx;y=yy;
  }
  if(Number.isFinite(y)&&Math.abs(y)<1e-10)save(b);
  return roots;
}
export function rk4(f,y0,a,b,steps=2048) {
  const points=new Float64Array((steps+1)*2),h=(b-a)/steps;let y=y0;
  for(let i=0;i<=steps;i++){
    const t=a+i*h;points[i*2]=t;points[i*2+1]=y;
    if(i===steps)break;
    const k1=f(t,y),k2=f(t+h/2,y+h*k1/2),k3=f(t+h/2,y+h*k2/2),k4=f(t+h,y+h*k3);
    y+=h*(k1+2*k2+2*k3+k4)/6;
    if(!Number.isFinite(y)||Math.abs(y)>1e100)throw new MathError('ODE trajectory diverged. Reduce the interval or check the equation.');
  }return points;
}
