/** Aster expression IR. Immutable-by-convention nodes, exact BigInt rationals,
 * a bounded Pratt parser, canonical algebra, MathML, and a safe numeric VM.
 * No source expression is ever passed to eval or Function.
 */
export class MathError extends Error {
  constructor(message, position = -1) { super(message); this.name = 'MathError'; this.position = position; }
}
const MAX_BITS = 65536;
const absB = n => n < 0n ? -n : n;
export function gcd(a, b) { a = absB(a); b = absB(b); while (b) [a,b] = [b,a%b]; return a; }
export function num(n, d = 1n) {
  n = BigInt(n); d = BigInt(d);
  if (!d) throw new MathError('Division by zero.');
  if (d < 0n) { n = -n; d = -d; }
  const g = gcd(n,d); return { k:'num', n:n/g, d:d/g };
}
export const ZERO = num(0), ONE = num(1), NEG = num(-1);
export const sym = name => ({ k:'sym', name });
export const real = v => { if (!Number.isFinite(v)) throw new MathError('The result is not a finite real number.'); return { k:'real', v }; };
export const call = (name, ...args) => ({ k:'call', name, args });
export const list = items => ({ k:'list', items });
export const matrix = rows => ({ k:'matrix', rows });
export const isNum = a => a?.k === 'num' || a?.k === 'real';
export const isZero = a => a?.k === 'num' ? a.n === 0n : a?.k === 'real' && a.v === 0;
export const isOne = a => a?.k === 'num' ? a.n === a.d : a?.k === 'real' && a.v === 1;
export const asNumber = a => a.k === 'num' ? Number(a.n)/Number(a.d) : a.v;
export function decimal(s) {
  if(s.length > 256) throw new MathError('Numeric literals are limited to 256 characters.');
  const [m,e0='0'] = s.toLowerCase().split('e'), e = Number(e0);
  if (Math.abs(e)>1000) throw new MathError('Literal exponent exceeds 1000.');
  const frac = (m.split('.')[1]||'').length;
  const n = BigInt(m.replace('.','')), shift = e-frac;
  return shift>=0 ? num(n*10n**BigInt(shift)) : num(n,10n**BigInt(-shift));
}
export function key(a) {
  switch(a.k) {
    case 'num':return `${a.n}/${a.d}`; case 'real':return `~${a.v}`; case 'sym':return a.name;
    case 'add':case 'mul': return a.k+'('+a.args.map(key).join(',')+')';
    case 'pow':return `^(${key(a.base)},${key(a.exp)})`;
    case 'call':return a.name+'('+a.args.map(key).join(',')+')';
    case 'list':return '['+a.items.map(key).join(',')+']';
    case 'matrix':return 'M'+a.rows.map(r=>r.map(key).join(',')).join(';');
    case 'eq':case 'range':return a.k+key(a.left)+','+key(a.right);
    default:return a.k;
  }
}
function nadd(a,b) { return a.k==='num'&&b.k==='num' ? num(a.n*b.d+b.n*a.d,a.d*b.d) : real(asNumber(a)+asNumber(b)); }
function nmul(a,b) { return a.k==='num'&&b.k==='num' ? num(a.n*b.n,a.d*b.d) : real(asNumber(a)*asNumber(b)); }
function degreeHint(a) { if(a.k==='sym')return 1; if(a.k==='pow'&&a.exp.k==='num')return asNumber(a.exp); if(a.k==='mul')return a.args.reduce((s,x)=>s+degreeHint(x),0); return 0; }
function factorSort(a,b) { if(isNum(a))return -1; if(isNum(b))return 1; const rank=x=>x.k==='sym'||(x.k==='pow'&&x.base.k==='sym')?1:x.k==='call'||(x.k==='pow'&&x.base.k==='call')?3:2; return rank(a)-rank(b)||key(a).localeCompare(key(b)); }
export function add(...xs) {
  const args = xs.flatMap(a=>a.k==='add'?a.args:[a]);
  let c=ZERO; const terms=new Map();
  for(const a of args) {
    if(isNum(a)) { c=nadd(c,a); continue; }
    let coef=ONE, base=a;
    if(a.k==='mul'&&isNum(a.args[0])) { coef=a.args[0]; base=a.args.length===2?a.args[1]:{k:'mul',args:a.args.slice(1)}; }
    const k=key(base), old=terms.get(k); terms.set(k,{base,coef:old?nadd(old.coef,coef):coef});
  }
  // Exact trigonometric Pythagorean identity, with matching arguments/coefficient.
  for (const [k,t] of [...terms]) {
    const b=t.base;
    if(b.k==='pow'&&key(b.exp)===key(num(2))&&b.base.k==='call'&&b.base.name==='sin') {
      const other=key(pow(call('cos',...b.base.args),num(2))), u=terms.get(other);
      if(u && key(t.coef)===key(u.coef)) { c=nadd(c,t.coef); terms.delete(k); terms.delete(other); }
    }
  }
  const result=[...terms.values()].filter(t=>!isZero(t.coef)).map(t=>isOne(t.coef)?t.base:mul(t.coef,t.base));
  result.sort((a,b)=>degreeHint(b)-degreeHint(a)||key(a).localeCompare(key(b)));
  if(!isZero(c))result.push(c);
  return result.length===0?ZERO:result.length===1?result[0]:{k:'add',args:result};
}
export function mul(...xs) {
  const args=xs.flatMap(a=>a.k==='mul'?a.args:[a]); let c=ONE; const factors=new Map();
  for(const a of args) {
    if(isNum(a)){c=nmul(c,a);continue;}
    const base=a.k==='pow'?a.base:a, exp=a.k==='pow'?a.exp:ONE;
    const k=key(base), old=factors.get(k); factors.set(k,{base,exp:old?add(old.exp,exp):exp});
  }
  if(isZero(c))return ZERO;
  const result=[...factors.values()].map(f=>pow(f.base,f.exp)).filter(a=>!isOne(a));
  result.sort(factorSort); if(!isOne(c))result.unshift(c);
  return result.length===0?ONE:result.length===1?result[0]:{k:'mul',args:result};
}
export function pow(base,exp) {
  if(isZero(exp)) { if(isZero(base))throw new MathError('0^0 is undefined.'); return ONE; }
  if(isOne(exp))return base;
  if(isOne(base))return ONE;
  if(base.k==='sym'&&base.name==='I'&&exp.k==='num'&&exp.d===1n){const m=Number((exp.n%4n+4n)%4n);return [ONE,sym('I'),NEG,{k:'mul',args:[NEG,sym('I')]}][m];}
  if(base.k==='num'&&exp.k==='num'&&exp.d===1n) {
    if(absB(exp.n)>4096n || BigInt(absB(base.n).toString(2).length + base.d.toString(2).length)*absB(exp.n)>BigInt(MAX_BITS))throw new MathError('Exact power exceeds the arithmetic budget.');
    return exp.n>=0n?num(base.n**exp.n,base.d**exp.n):num(base.d**(-exp.n),base.n**(-exp.n));
  }
  // Nested powers are only collapsed for an integer outer power. No sqrt(x^2)=x rule.
  if(base.k==='pow'&&exp.k==='num'&&exp.d===1n)return pow(base.base,mul(base.exp,exp));
  if(base.k==='real'&&isNum(exp))return real(Math.pow(base.v,asNumber(exp)));
  return {k:'pow',base,exp};
}
export const neg = a=>mul(NEG,a);
export const sub = (a,b)=>add(a,neg(b));
export const div = (a,b)=>mul(a,pow(b,NEG));
function isqrt(n) { if(n<0n)return null; if(n<2n)return n; let x=n,y=(x+1n)/2n; while(y<x){x=y;y=(x+n/x)/2n;} return x; }
export function simplifyCall(name,args) {
  const a=args[0]; name = ({ln:'log',arcsin:'asin',arccos:'acos',arctan:'atan'}[name]||name);
  if(name==='sqrt'&&a?.k==='num') {
    const an=absB(a.n),r=isqrt(an),d=isqrt(a.d);
    if(r*r===an&&d*d===a.d)return a.n<0n?mul(num(r,d),sym('I')):num(r,d);
    if(a.n<0n)return mul(sym('I'),call('sqrt',num(an,a.d)));
  }
  if(a&&isZero(a)) {
    if(['sin','tan','sinh','tanh','asin','atan','abs'].includes(name))return ZERO;
    if(['cos','cosh','exp'].includes(name))return ONE;
  }
  if(name==='log'&&isOne(a))return ZERO;
  if(name==='log'&&a?.k==='sym'&&a.name==='e')return ONE;
  if(name==='exp'&&a?.k==='call'&&a.name==='log')return a.args[0];
  if(name==='sin'&&a?.k==='sym'&&a.name==='Pi')return ZERO;
  if(name==='cos'&&a?.k==='sym'&&a.name==='Pi')return NEG;
  if(name==='abs'&&a?.k==='num')return num(absB(a.n),a.d);
  if(name==='factorial'&&a?.k==='num'&&a.d===1n) {
    if(a.n<0n||a.n>1000n)throw new MathError('factorial expects an integer from 0 to 1000.');
    let n=1n;for(let j=2n;j<=a.n;j++)n*=j;return num(n);
  }
  return call(name,...args);
}
export function simplify(a) {
  switch(a.k) {
    case 'add':return add(...a.args.map(simplify)); case 'mul':return mul(...a.args.map(simplify));
    case 'pow':return pow(simplify(a.base),simplify(a.exp)); case 'call':return simplifyCall(a.name,a.args.map(simplify));
    case 'list':return list(a.items.map(simplify)); case 'matrix':return matrix(a.rows.map(r=>r.map(simplify)));
    case 'eq':case 'range':return {...a,left:simplify(a.left),right:simplify(a.right)}; default:return a;
  }
}
export function depends(a,v) { return variables(a).has(v); }
export function variables(a,result=new Set()) {
  if(a.k==='sym'&&!['Pi','e','I','infinity'].includes(a.name))result.add(a.name);
  if(a.args)a.args.forEach(x=>variables(x,result));
  if(a.base){variables(a.base,result);variables(a.exp,result);}
  if(a.items)a.items.forEach(x=>variables(x,result));
  if(a.rows)a.rows.flat().forEach(x=>variables(x,result));
  if(a.left){variables(a.left,result);variables(a.right,result);}
  return result;
}
export function substitute(a,bindings) {
  if(a.k==='sym')return Object.hasOwn(bindings,a.name)?bindings[a.name]:a;
  if(a.k==='add')return add(...a.args.map(x=>substitute(x,bindings)));
  if(a.k==='mul')return mul(...a.args.map(x=>substitute(x,bindings)));
  if(a.k==='pow')return pow(substitute(a.base,bindings),substitute(a.exp,bindings));
  if(a.k==='call')return simplifyCall(a.name,a.args.map(x=>substitute(x,bindings)));
  if(a.k==='list')return list(a.items.map(x=>substitute(x,bindings)));
  if(a.k==='matrix')return matrix(a.rows.map(r=>r.map(x=>substitute(x,bindings))));
  if(a.left)return {...a,left:substitute(a.left,bindings),right:substitute(a.right,bindings)};
  return a;
}
/** Substitute function arguments without commuting operators before their types
 * are known. In particular, matrix-valued parameters must preserve A*B != B*A.
 * The kernel performs typed evaluation and scalar canonicalization afterwards.
 */
export function bindArguments(a, bindings) {
  if(a.k==='sym')return Object.hasOwn(bindings,a.name)?bindings[a.name]:a;
  const walk=x=>bindArguments(x,bindings);
  if(a.args)return {...a,args:a.args.map(walk)};
  if(a.base)return {...a,base:walk(a.base),exp:walk(a.exp)};
  if(a.items)return {...a,items:a.items.map(walk)};
  if(a.rows)return {...a,rows:a.rows.map(r=>r.map(walk))};
  if(a.left)return {...a,left:walk(a.left),right:walk(a.right)};
  return a;
}
export function tokenize(source) {
  source=source.replace(/π/g,'Pi').replace(/∞/g,'infinity').replace(/[−–]/g,'-').replace(/[×·]/g,'*').replace(/÷/g,'/').replace(/²/g,'^2').replace(/³/g,'^3').replace(/√/g,'sqrt');
  if(source.length>16000)throw new MathError('A cell is limited to 16,000 characters.');
  const re=/\s+|#[^\n]*|(?:\d+\.(?!\.)\d*|\.\d+|\d+)(?:[eE][+-]?\d+)?|[\p{L}_][\p{L}\p{N}_]*|:=|->|\.\.|[+\-*/^!=()[\]{},;:]/uy;
  const tokens=[];let pos=0;
  while(pos<source.length) {
    re.lastIndex=pos;const m=re.exec(source);if(!m)throw new MathError(`Unexpected character “${source[pos]}”.`,pos);
    pos=re.lastIndex; if(/^\s|^#/.test(m[0]))continue;
    tokens.push({v:m[0],p:m.index}); if(tokens.length>2048)throw new MathError('Expression exceeds the 2,048-token budget.');
  }
  tokens.push({v:'<end>',p:source.length});return tokens;
}
export function parse(source) {
  const ts=tokenize(source);let i=0,depth=0;
  const peek=()=>ts[i].v, take=()=>ts[i++], expect=v=>{if(peek()!==v)throw new MathError(`Expected “${v}”, found “${peek()}”.`,ts[i].p);return take();};
  const atomStart=t=>/^(?:\d|\.\d|[\p{L}_]|\()/u.test(t)&&t!=='<end>';
  function expr(bp=0) {
    if(++depth>96)throw new MathError('Expression nesting exceeds 96 levels.');
    const t=take();let lhs;
    if(/^\d|^\.\d/.test(t.v))lhs=decimal(t.v);
    else if(/^[\p{L}_]/u.test(t.v))lhs=sym(t.v==='pi'?'Pi':t.v);
    else if(t.v==='-')lhs={k:'mul',args:[NEG,expr(29)]};
    else if(t.v==='+')lhs=expr(29);
    else if(t.v==='('){lhs=expr(0);expect(')');}
    else if(t.v==='['||t.v==='{'){
      const end=t.v==='['?']':'}',items=[];
      if(peek()!==end){do{items.push(expr(0));if(peek()!==',')break;take();}while(true);}
      expect(end);lhs=list(items);
    } else throw new MathError(`Expected an expression, found “${t.v}”.`,t.p);
    while(true) {
      const p=peek();
      if(p==='('&&lhs.k==='sym') {
        take();const args=[];if(peek()!==')'){do{args.push(expr(0));if(peek()!==',')break;take();}while(true);}expect(')');lhs=call(lhs.name,...args);continue;
      }
      if(p==='!'&&40>bp){take();lhs=call('factorial',lhs);continue;}
      const prec={':=':1,'->':2,'=':3,'..':4,'+':10,'-':10,'*':20,'/':20,'^':30}[p];
      const implicit=prec===undefined&&atomStart(p);const lb=implicit?20:(prec??-1);
      if(lb<=bp)break;
      if(!implicit)take();const rhs=expr((p==='^'||p===':='||p==='->')?lb-1:lb);
      const op=implicit?'*':p;
      if(op==='+')lhs={k:'add',args:[lhs,rhs]};
      else if(op==='-')lhs={k:'add',args:[lhs,{k:'mul',args:[NEG,rhs]}]};
      else if(op==='*')lhs={k:'mul',args:[lhs,rhs]};
      else if(op==='/')lhs={k:'mul',args:[lhs,{k:'pow',base:rhs,exp:NEG}]};
      else if(op==='^')lhs={k:'pow',base:lhs,exp:rhs};
      else if(op==='=')lhs={k:'eq',left:lhs,right:rhs};
      else if(op==='..')lhs={k:'range',left:lhs,right:rhs};
      else if(op==='->') {
        if(lhs.k!=='sym')throw new MathError('Use x -> expression for a one-argument function.');
        lhs={k:'lambda',params:[lhs.name],body:rhs};
      } else if(op===':=') {
        if(lhs.k==='sym')lhs={k:'assign',name:lhs.name,value:rhs};
        else if(lhs.k==='call'&&lhs.args.every(a=>a.k==='sym'))lhs={k:'assign',name:lhs.name,value:{k:'lambda',params:lhs.args.map(a=>a.name),body:rhs}};
        else throw new MathError('The left side of := must be a name or a function signature.');
      }
    }
    depth--;return lhs;
  }
  const result=expr();if(peek()===';'||peek()===':')take();if(peek()!=='<end>')throw new MathError(`Unexpected “${peek()}”.`,ts[i].p);return result;
}
const precOf=a=>({add:1,mul:2,pow:3}[a.k]||9);
export function format(a,parent=0) {
  let s;
  switch(a.k) {
    case 'num':s=a.d===1n?String(a.n):`${a.n}/${a.d}`;break;
    case 'real':s=Number(a.v.toPrecision(12)).toString();break;
    case 'sym':s=a.name;break;
    case 'add':s=a.args.map(x=>format(x,1)).join(' + ').replace(/\+ -/g,'- ');break;
    case 'mul': {
      const negFirst=a.args[0]?.k==='num'&&a.args[0].n===-a.args[0].d;
      s=(negFirst?'-':'')+(negFirst?a.args.slice(1):a.args).map(x=>format(x,2)).join('*');break;
    }
    case 'pow':s=`${format(a.base,4)}^${format(a.exp,4)}`;break;
    case 'call':s=`${a.name}(${a.args.map(x=>format(x)).join(', ')})`;break;
    case 'list':s='['+a.items.map(x=>format(x)).join(', ')+']';break;
    case 'matrix':s='Matrix(['+a.rows.map(r=>'['+r.map(x=>format(x)).join(', ')+']').join(', ')+'])';break;
    case 'eq':s=format(a.left)+' = '+format(a.right);break;
    case 'range':s=format(a.left)+'..'+format(a.right);break;
    case 'assign':s=a.name+' := '+format(a.value);break;
    case 'lambda':s='('+a.params.join(',')+') -> '+format(a.body);break;
    default:s='?';
  }
  const fraction=a.k==='num'&&a.d!==1n;
  return precOf(a)<parent||(fraction&&parent>2)||((a.k==='num'&&a.n<0n)&&parent>2)?'('+s+')':s;
}
export const escapeHTML=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const MO=s=>'<mo>'+escapeHTML(s)+'</mo>', ROW=s=>'<mrow>'+s+'</mrow>';
const symbols={Pi:'π',I:'i',infinity:'∞',alpha:'α',beta:'β',gamma:'γ',theta:'θ',lambda:'λ',omega:'ω',phi:'φ'};
function negativePart(a) {
  if(a.k==='num'&&a.n<0n)return num(-a.n,a.d);
  if(a.k==='real'&&a.v<0)return real(-a.v);
  if(a.k==='mul'&&isNum(a.args[0])&&asNumber(a.args[0])<0)return mul(neg(a.args[0]),...a.args.slice(1));
  return null;
}
function mml(a,parent=0) {
  let s='';
  if(a.k==='num') {
    const n=absB(a.n);s=a.d===1n?`<mn>${n}</mn>`:`<mfrac><mn>${n}</mn><mn>${a.d}</mn></mfrac>`;if(a.n<0n)s=MO('−')+s;
  } else if(a.k==='real')s=`<mn>${format(a)}</mn>`;
  else if(a.k==='sym')s='<mi>'+escapeHTML(symbols[a.name]||a.name)+'</mi>';
  else if(a.k==='add')s=a.args.map((x,i)=>{const n=negativePart(x);return i?(n?MO('−')+mml(n,1):MO('+')+mml(x,1)):mml(x,1);}).join('');
  else if(a.k==='mul') {
    const numerator=[],denominator=[];
    for(const f of a.args){if(f.k==='pow'&&f.exp.k==='num'&&f.exp.n<0n)denominator.push(pow(f.base,neg(f.exp)));else numerator.push(f);}
    if(denominator.length)s='<mfrac>'+mml(mul(...numerator)) + mml(mul(...denominator))+'</mfrac>';
    else {
      const n=negativePart(a);if(n)s=MO('−')+mml(n,2);
      else s=a.args.map((x,i)=>(i?MO('⁢'):'')+mml(x,2)).join('');
    }
  } else if(a.k==='pow') {
    if(a.exp.k==='num'&&a.exp.n<0n)s='<mfrac><mn>1</mn>'+mml(pow(a.base,neg(a.exp)))+'</mfrac>';
    else s='<msup>'+mml(a.base,4)+mml(a.exp)+'</msup>';
  } else if(a.k==='call') {
    const ar=a.args;
    if(a.name==='sqrt')s='<msqrt>'+mml(ar[0])+'</msqrt>';
    else if(a.name==='exp')s='<msup><mi>e</mi>'+mml(ar[0])+'</msup>';
    else if(a.name==='abs')s=MO('|')+mml(ar[0])+MO('|');
    else if(a.name==='factorial')s=mml(ar[0],4)+MO('!');
    else if(['int','integrate'].includes(a.name)&&ar.length>=2)s=MO('∫')+mml(ar[0])+MO('⁢')+'<mi>d</mi>'+mml(ar[1]);
    else if(a.name==='diff'&&ar.length>=2)s='<mfrac><mi>d</mi>'+ROW('<mi>d</mi>'+mml(ar[1]))+'</mfrac>'+ROW(MO('(')+mml(ar[0])+MO(')'));
    else s='<mi mathvariant="normal">'+escapeHTML(a.name==='log'?'ln':a.name)+'</mi>'+MO('⁡')+MO('(')+ar.map(x=>mml(x)).join(MO(','))+MO(')');
  } else if(a.k==='matrix')s=MO('[')+'<mtable>'+a.rows.map(r=>'<mtr>'+r.map(x=>'<mtd>'+mml(x)+'</mtd>').join('')+'</mtr>').join('')+'</mtable>'+MO(']');
  else if(a.k==='list')s=MO('[')+a.items.map(x=>mml(x)).join(MO(','))+MO(']');
  else if(a.k==='eq'||a.k==='range')s=mml(a.left)+MO(a.k==='eq'?'=':'..')+mml(a.right);
  else if(a.k==='assign')s='<mi>'+escapeHTML(a.name)+'</mi>'+MO('≔')+mml(a.value);
  else if(a.k==='lambda')s=a.params.map(p=>'<mi>'+escapeHTML(p)+'</mi>').join(MO(','))+MO('↦')+mml(a.body);
  else s='<mtext>?</mtext>';
  if(precOf(a)<parent)s=MO('(')+s+MO(')');
  return ROW(s);
}
export function mathML(a,display=true) { return `<math xmlns="http://www.w3.org/1998/Math/MathML" display="${display?'block':'inline'}">${mml(a)}</math>`; }
export function latex(a,parent=0) {
  let s;
  if(a.k==='num')s=a.d===1n?String(a.n):`\\frac{${a.n}}{${a.d}}`;
  else if(a.k==='real')s=format(a);
  else if(a.k==='sym')s=({Pi:'\\pi',infinity:'\\infty'}[a.name]||a.name.replace(/_/g,'\\_'));
  else if(a.k==='add')s=a.args.map(x=>latex(x,1)).join('+').replace(/\+-/g,'-');
  else if(a.k==='mul')s=a.args.map(x=>latex(x,2)).join('\\,');
  else if(a.k==='pow')s=`{${latex(a.base,4)}}^{${latex(a.exp)}}`;
  else if(a.k==='call')s=a.name==='sqrt'?`\\sqrt{${latex(a.args[0])}}`:`\\operatorname{${a.name}}\\left(${a.args.map(x=>latex(x)).join(',')}\\right)`;
  else if(a.k==='list')s=`\\left[${a.items.map(x=>latex(x)).join(',')}\\right]`;
  else if(a.k==='matrix')s='\\begin{bmatrix}'+a.rows.map(r=>r.map(x=>latex(x)).join('&')).join('\\\\')+'\\end{bmatrix}';
  else if(a.k==='eq')s=latex(a.left)+'='+latex(a.right);
  else s='\\text{'+format(a).replace(/[{}\\]/g,'')+'}';
  return precOf(a)<parent?'\\left('+s+'\\right)':s;
}
const NUMERIC_FUNCTIONS={10:Math.sin,11:Math.cos,12:Math.tan,13:Math.exp,14:Math.log,15:Math.sqrt,16:Math.abs,17:Math.sinh,18:Math.cosh,19:Math.tanh,20:Math.asin,21:Math.acos,22:Math.atan,23:Math.floor,24:Math.ceil,25:Math.sign};
const FUNCS={sin:10,cos:11,tan:12,exp:13,log:14,sqrt:15,abs:16,sinh:17,cosh:18,tanh:19,asin:20,acos:21,atan:22,floor:23,ceil:24,sign:25};
/** Flat, structured-cloneable stack bytecode. An instruction always uses two slots. */
export function compile(a,vars=['x']) {
  const code=[];let count=0;
  function emit(n) {
    if(++count>8192)throw new MathError('Numeric program exceeds 8,192 nodes.');
    if(isNum(n)){code.push(0,asNumber(n));return;}
    if(n.k==='sym') {
      const constants={Pi:Math.PI,e:Math.E};
      if(Object.hasOwn(constants,n.name))code.push(0,constants[n.name]);
      else {const j=vars.indexOf(n.name);if(j<0)throw new MathError(`No real value for “${n.name}”.`);code.push(1,j);}return;
    }
    if(n.k==='add'||n.k==='mul') {emit(n.args[0]);for(let j=1;j<n.args.length;j++){emit(n.args[j]);code.push(n.k==='add'?2:3,0);}return;}
    if(n.k==='pow'){emit(n.base);emit(n.exp);code.push(4,0);return;}
    if(n.k==='call'&&Object.hasOwn(FUNCS,n.name)&&n.args.length===1){emit(n.args[0]);code.push(FUNCS[n.name],0);return;}
    if(n.k==='call'&&['min','max','atan2'].includes(n.name)&&n.args.length===2){n.args.forEach(emit);code.push({min:26,max:27,atan2:28}[n.name],0);return;}
    throw new MathError(`“${n.name||n.k}” cannot be evaluated as a real-valued numeric function.`);
  }
  emit(a);return code;
}
export function makeEvaluator(code) {
  const stack=new Float64Array(code.length/2+1);
  return values=>{
    let sp=0;
    for(let i=0;i<code.length;i+=2) {
      const op=code[i],v=code[i+1];
      if(op===0)stack[sp++]=v;else if(op===1)stack[sp++]=values[v];
      else if(op===2){stack[sp-2]+=stack[sp-1];sp--;}
      else if(op===3){stack[sp-2]*=stack[sp-1];sp--;}
      else if(op===4){stack[sp-2]=Math.pow(stack[sp-2],stack[sp-1]);sp--;}
      else if(op>=26){const b=stack[--sp],a=stack[sp-1];stack[sp-1]=op===26?Math.min(a,b):op===27?Math.max(a,b):Math.atan2(a,b);}
      else {const a=stack[sp-1];stack[sp-1]=NUMERIC_FUNCTIONS[op](a);}
    }return stack[0];
  };
}
export function numeric(a,bindings={}) { const vs=Object.keys(bindings);const v=makeEvaluator(compile(a,vs))(vs.map(k=>bindings[k]));if(!Number.isFinite(v))throw new MathError('Expression is undefined or non-real at these values.');return v; }
