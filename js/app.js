import {parse,format,mathML,escapeHTML} from './core/ast.js';
import {PlotView,gpuService} from './render/plots.js';
import {icon,PALETTES,COMMANDS,EXAMPLES} from './ui-data.js';
const $=(s,root=document)=>root.querySelector(s),$$=(s,root=document)=>[...root.querySelectorAll(s)],esc=escapeHTML;
const uid=()=>globalThis.crypto?.randomUUID?.()||'a'+Date.now().toString(36)+Math.random().toString(36).slice(2);
const STORE='aster.workspace.v1',MAX_FILE=2*1024*1024;
const state={docs:[],active:'',selected:'',inspector:'context',ribbon:'home',environment:[],worker:null,job:0,running:false,timeout:null,plotViews:new Map(),mode:'worksheet',input:'math',zoom:1,operationVar:'x',lastEdit:0,saveTimer:null};
const doc=()=>state.docs.find(d=>d.id===state.active),cell=()=>doc()?.cells.find(c=>c.id===state.selected);
function makeDoc(example){return {id:uid(),title:example.title,subtitle:example.subtitle,created:new Date().toISOString(),cells:example.cells.map(([type,text])=>({id:uid(),type,...(type==='code'?{source:text}:{text})})),past:[],future:[]};}
function serializable(d){return {id:d.id,title:d.title,subtitle:d.subtitle,created:d.created,cells:d.cells.map(c=>({id:c.id,type:c.type,...(c.type==='code'?{source:c.source}:{text:c.text}),collapsed:!!c.collapsed}))};}
function hydrate(input){
  if(!input||!Array.isArray(input.cells)||input.cells.length>500)throw new Error('A worksheet must contain at most 500 cells.');
  const text=(s,max)=>{if(typeof s!=='string'||s.length>max)throw new Error('Invalid or oversized worksheet text.');return s;};
  return {id:uid(),title:text(input.title||'Untitled worksheet',200),subtitle:text(input.subtitle||'',2000),created:typeof input.created==='string'?input.created:new Date().toISOString(),past:[],future:[],cells:input.cells.map(c=>{if(!['code','text','heading'].includes(c.type))throw new Error('Unknown cell type.');return {id:uid(),type:c.type,...(c.type==='code'?{source:text(c.source||'',16000)}:{text:text(c.text||'',16000)}),collapsed:!!c.collapsed};})};
}
function load(){
  try {const raw=localStorage.getItem(STORE);if(raw&&raw.length<MAX_FILE*3){const saved=JSON.parse(raw);if(!Array.isArray(saved.docs)||saved.docs.length>20)throw new Error('Invalid workspace.');state.docs=saved.docs.map(hydrate);state.active=state.docs[Math.min(saved.active||0,state.docs.length-1)]?.id;state.mode=saved.mode==='document'?'document':'worksheet';state.input=saved.input==='source'?'source':'math';if(saved.theme==='dark')document.documentElement.dataset.theme='dark';}}
  catch(e){console.warn('Workspace recovery:',e.message);toast('The saved workspace could not be restored. A fresh workspace was opened.');}
  if(!state.docs.length){state.docs=EXAMPLES.slice(0,3).map(makeDoc);state.active=state.docs[0].id;}
  state.selected=doc().cells.find(c=>c.type==='code')?.id||'';
}
function persist(){
  $('#save-indicator').textContent='Saving…';clearTimeout(state.saveTimer);state.saveTimer=setTimeout(()=>{
    try {localStorage.setItem(STORE,JSON.stringify({version:1,docs:state.docs.map(serializable),active:state.docs.indexOf(doc()),mode:state.mode,input:state.input,theme:document.documentElement.dataset.theme||'light'}));$('#save-indicator').textContent='Saved locally';}
    catch {$('#save-indicator').textContent='Not saved';toast('Browser storage is unavailable or full. Use File → Save to keep a copy.');}
  },350);
}
function snapshot(){return JSON.stringify(serializable(doc()));}
function checkpoint(force=true){
  if(state.running)stop(false);
  if(!force&&performance.now()-state.lastEdit<700)return;
  const d=doc(),s=snapshot();if(d.past[d.past.length-1]!==s)d.past.push(s);if(d.past.length>80)d.past.shift();d.future=[];state.lastEdit=performance.now();updateHistoryButtons();
}
function history(direction){
  stop(false);const d=doc(),from=direction==='undo'?d.past:d.future,to=direction==='undo'?d.future:d.past;if(!from.length){toast(`Nothing to ${direction}.`);return;}
  to.push(snapshot());const data=JSON.parse(from.pop());d.title=data.title;d.subtitle=data.subtitle;d.cells=data.cells;state.selected=d.cells.find(c=>c.type==='code')?.id||'';renderDocument();renderTabs();persist();evaluate(true);updateHistoryButtons();
}
function updateHistoryButtons(){for(const a of ['undo','redo'])$$(`[data-action="${a}"]`).forEach(b=>b.disabled=!(doc()?.[a==='undo'?'past':'future']?.length));}
let toastTimer;
function toast(message){const el=$('#toast');el.textContent=message;el.hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.hidden=true,4200);}
function destroyPlots(){for(const p of state.plotViews.values())p.destroy();state.plotViews.clear();}
function makeCell(type,text=''){return {id:uid(),type,...(type==='code'?{source:text}:{text})};}
function tools(c){return `<div class="cell-tools"><button data-cell-action="up" title="Move up" aria-label="Move cell up">↑</button><button data-cell-action="down" title="Move down" aria-label="Move cell down">↓</button><button data-cell-action="duplicate" title="Duplicate cell" aria-label="Duplicate cell">⧉</button><button data-cell-action="delete" title="Delete cell" aria-label="Delete cell">×</button></div>`;}
function sourcePreview(source){try{return source.trim()?mathML(parse(source),false):'';}catch{return `<span style="font:11px var(--mono);color:var(--muted)">${esc(source)}</span>`;}}
function renderDocument(){
  destroyPlots();const d=doc();$('#window-title').textContent=d.title+' — Aster CAS';document.title=d.title+' · Aster CAS';
  let section=0,collapsed=false;
  $('#worksheet').innerHTML=`<header class="document-heading"><div class="document-overline">✦ &nbsp; ASTER WORKSHEET <span class="overline-spacer">LOCAL WORKSPACE &nbsp; / &nbsp; 01</span></div><h1 contenteditable="plaintext-only" data-doc-field="title" role="textbox" aria-label="Worksheet title" spellcheck="false">${esc(d.title)}</h1><p class="subtitle" contenteditable="plaintext-only" data-doc-field="subtitle" role="textbox" aria-label="Worksheet subtitle">${esc(d.subtitle)}</p></header>`+d.cells.map(c=>{
    if(c.type==='heading'){section++;collapsed=!!c.collapsed;return `<section class="cell heading-cell" data-cell-id="${c.id}">${tools(c)}<div class="section-content"><button data-cell-action="fold" class="section-arrow" title="Collapse/expand section" aria-label="Collapse or expand section">${collapsed?'▸':'▾'}</button><span class="section-number">${String(section).padStart(2,'0')}</span><div class="section-title" contenteditable="plaintext-only" role="textbox" aria-label="Section heading">${esc(c.text)}</div></div></section>`;}
    if(c.type==='text')return `<section class="cell text-cell" data-cell-id="${c.id}" ${collapsed?'hidden':''}>${tools(c)}<div class="text-content" contenteditable="plaintext-only" role="textbox" aria-label="Worksheet text">${esc(c.text)}</div></section>`;
    return `<section class="cell code-cell ${c.id===state.selected?'selected':''}" data-cell-id="${c.id}" ${collapsed?'hidden':''}>${tools(c)}<div class="input-line"><span class="input-prompt">&gt;</span><div class="input-editor ${c.source.trim()?'':'empty'}"><textarea rows="1" class="source-input" aria-label="Math input" spellcheck="false" autocomplete="off" autocapitalize="off" placeholder="Enter a mathematical expression…">${esc(c.source)}</textarea><div class="input-math" tabindex="0" role="button" aria-label="Edit mathematical expression">${sourcePreview(c.source)}</div></div><button class="input-evaluate" data-cell-action="run" title="Evaluate (Enter)" aria-label="Evaluate this cell">▷</button></div><div class="cell-output"></div></section>`;
  }).join('');
  for(const c of d.cells)if(c.result)renderOutput(c);applyModes();updateCount();renderInspector();updateHistoryButtons();
}
function renderOutput(c){
  const el=$(`[data-cell-id="${c.id}"] .cell-output`);if(!el)return;
  state.plotViews.get(c.id)?.destroy();state.plotViews.delete(c.id);el.classList.remove('plot-output');
  const r=c.result;if(!r){el.innerHTML='';return;}
  if(r.kind==='error')el.innerHTML=`<div class="output-error"><strong>Error</strong><span>${esc(r.plain)}${r.position>=0?` <small>(column ${r.position+1})</small>`:''}</span></div>`;
  else if(r.kind==='plot2d'||r.kind==='plot3d'){
    el.classList.add('plot-output');el.innerHTML='<div class="plot-host"></div>';const p=new PlotView($('.plot-host',el),r,()=>updateRenderer());state.plotViews.set(c.id,p);
  } else if(r.kind==='message')el.innerHTML=`<div class="output-note">${esc(r.plain)}</div>`;
  else {const n=doc().cells.filter(x=>x.type==='code').indexOf(c)+1;el.innerHTML=r.math+`<button class="output-index" data-cell-action="copy-output" title="Copy output">(${n})</button>`;}
  if(r.notes?.length)el.insertAdjacentHTML('beforeend',`<div class="output-note">${r.notes.map(esc).join('<br>')}</div>`);
  if(c.stale)el.insertAdjacentHTML('beforeend','<div class="stale-note">Input changed — evaluate to refresh.</div>');
}
function renderTabs(){
  $('#document-tabs').innerHTML=state.docs.map(d=>`<button class="document-tab ${d.id===state.active?'selected':''}" role="tab" aria-selected="${d.id===state.active}" data-doc="${d.id}">${icon(d.title.toLowerCase().includes('surface')?'surface':'sheet')}<span>${esc(d.title)}</span><span class="tab-close" data-close-doc="${d.id}" title="Close worksheet">×</span></button>`).join('')+'<button class="tab-add" data-action="new" aria-label="New worksheet" title="New worksheet">＋</button>';
}
function activate(id){if(id===state.active)return;stop(false);state.active=id;state.environment=[];state.selected=doc().cells.find(c=>c.type==='code')?.id||'';renderTabs();renderDocument();$('#document-scroll').scrollTop=0;persist();evaluate(true);}
function selectCell(id,focus=false){
  state.selected=id;$$('.cell.selected').forEach(e=>e.classList.remove('selected'));const el=$(`[data-cell-id="${id}"]`);el?.classList.add('selected');renderInspector();if(focus){const input=$('.source-input',el);if(input){input.parentElement.classList.add('editing');input.focus();resizeInput(input);input.setSelectionRange(input.value.length,input.value.length);el.scrollIntoView({block:'nearest',behavior:'smooth'});}}
}
function resizeInput(input){input.style.height='auto';input.style.height=Math.max(28,input.scrollHeight)+'px';}
function markStale(id){
  if(state.running)stop(false);state.environment=[];
  const d=doc(),i=d.cells.findIndex(c=>c.id===id);for(let j=i;j<d.cells.length;j++){const c=d.cells[j];if(c.type==='code'&&c.result){c.stale=true;const out=$(`[data-cell-id="${c.id}"] .cell-output`);if(out&&!$('.stale-note',out))out.insertAdjacentHTML('beforeend','<div class="stale-note">Input changed — evaluate to refresh.</div>');}}
}
function insertCell(type='code',text='',after=true){
  checkpoint();const d=doc(),c=makeCell(type,text),idx=d.cells.findIndex(c=>c.id===state.selected);d.cells.splice(idx<0?d.cells.length:idx+(after?1:0),0,c);state.selected=c.id;renderDocument();persist();if(type==='code')selectCell(c.id,true);else {$(`[data-cell-id="${c.id}"] [contenteditable]`)?.focus();}return c;
}
function insertTemplate(template){
  if(template==='@matrix'){showMatrix();return;}
  let c=cell();if(!c||c.type!=='code')c=insertCell('code','');
  const input=$(`[data-cell-id="${c.id}"] .source-input`),selection=input.value.substring(input.selectionStart,input.selectionEnd);
  checkpoint();let pos=template.indexOf('□'),text=template.replace('□',selection||'x').replaceAll('□','x');const start=input.selectionStart||0,end=input.selectionEnd||start;
  input.value=input.value.slice(0,start)+text+input.value.slice(end);c.source=input.value;input.parentElement.classList.add('editing');input.focus();if(pos>=0)input.setSelectionRange(start+pos,start+pos+(selection||'x').length);else input.setSelectionRange(start+text.length,start+text.length);
  $('.input-math',input.parentElement).innerHTML=sourcePreview(c.source);input.parentElement.classList.remove('empty');resizeInput(input);markStale(c.id);persist();renderInspector();
}
function newExample(key){const example=EXAMPLES.find(e=>e.key===key)||EXAMPLES[5];if(state.docs.length>=20){toast('The workspace supports 20 open documents. Close a tab before creating another.');return;}const d=makeDoc(example);state.docs.push(d);closeDialog();activate(d.id);if(key==='blank')selectCell(d.cells[0].id,true);}
function setBusy(value){state.running=value;$('#kernel-status').textContent=value?'Evaluating…':'Kernel ready';$('#status-dot').classList.toggle('busy',value);$$('[data-action="stop"]').forEach(b=>b.disabled=!value);$('.kernel-ready').textContent=value?'Busy':'Ready';}
function stop(notify=true){
  clearTimeout(state.timeout);state.worker?.terminate();state.worker=null;state.job++;setBusy(false);$$('.cell.running').forEach(e=>e.classList.remove('running'));if(notify)toast('Evaluation stopped. Definitions will be rebuilt on the next evaluation.');
}
function evaluate(all=false,advance=false){
  const d=doc();let selected=cell();if(!all&&selected?.type!=='code'){selected=d.cells.find(c=>c.type==='code');if(selected)state.selected=selected.id;}
  if(!all&&!selected)return;const last=all?d.cells.length-1:d.cells.indexOf(selected),cells=d.cells.slice(0,last+1).filter(c=>c.type==='code'&&c.source.trim()).map(c=>({id:c.id,source:c.source}));
  if(!cells.length){toast('Enter an expression before evaluating.');return;}
  stop(false);const id=++state.job,docId=d.id;setBusy(true);state.environment=[];let elapsed=0;
  for(const {id} of cells){const el=$(`[data-cell-id="${id}"]`);el?.classList.add('running');const c=d.cells.find(c=>c.id===id);if(!c.result){const out=$('.cell-output',el);if(out)out.innerHTML='<span class="loading-output">Evaluating expression</span>';}}
  let blobURL;
  try {
    if(globalThis.ASTER_WORKER_SOURCE){blobURL=URL.createObjectURL(new Blob([globalThis.ASTER_WORKER_SOURCE],{type:'text/javascript'}));state.worker=new Worker(blobURL);}else state.worker=new Worker(new URL('./worker.js',import.meta.url),{type:'module'});
  }catch(e){stop(false);toast('Could not start the worker. Use the standalone HTML, or serve the source folder over localhost.');return;}
  if(blobURL)URL.revokeObjectURL(blobURL);
  const resetTimeout=()=>{clearTimeout(state.timeout);state.timeout=setTimeout(()=>{stop(false);toast('The calculation exceeded the 8-second per-cell time budget and was terminated.');for(const {id} of cells){const c=d.cells.find(c=>c.id===id);if(!c.result){c.result={kind:'error',plain:'Computation timed out. Simplify the expression or reduce its range.'};renderOutput(c);}}},8000);};
  resetTimeout();
  state.worker.onmessage=e=>{
    const m=e.data;if(m.id!==state.job||state.active!==docId)return;resetTimeout();
    if(m.cellId){const c=d.cells.find(c=>c.id===m.cellId);if(!c)return;c.result=m.result;c.stale=false;state.environment=m.result.environment||state.environment;elapsed+=m.result.elapsed||0;renderOutput(c);$(`[data-cell-id="${c.id}"]`)?.classList.remove('running');$('#timing').textContent=elapsed.toFixed(1)+' ms';renderInspector();}
    if(m.done){clearTimeout(state.timeout);state.worker?.terminate();state.worker=null;setBusy(false);$$('.cell.running').forEach(e=>e.classList.remove('running'));state.environment=m.environment||[];renderInspector();updateRenderer();if(advance&&!all){const at=d.cells.findIndex(c=>c.id===selected.id),next=d.cells.slice(at+1).find(c=>c.type==='code');if(next)selectCell(next.id,true);else insertCell('code');}persist();}
  };
  state.worker.onerror=e=>{stop(false);toast('Worker error: '+e.message);};
  state.worker.postMessage({id,cells,reset:true});
}
function updateCount(){$('#cell-count').textContent=doc().cells.filter(c=>c.type==='code').length+' execution groups';}
function updateRenderer(){const views=[...state.plotViews.values()];$('#renderer-status').textContent=views.some(v=>v.backends==='WebGPU')?'WebGPU renderer':views.length?'Canvas 2D fallback':(navigator.gpu?'WebGPU available':'Canvas 2D available');}
function applyModes(){document.body.classList.toggle('document-mode',state.mode==='document');document.body.classList.toggle('source-mode',state.input==='source');$('#input-mode').value=state.input;$$('.mode-toggle button').forEach(b=>b.classList.toggle('selected',b.dataset.action===state.mode+'-mode'));document.documentElement.style.setProperty('--document-zoom',state.zoom);$('#zoom-label').textContent=Math.round(state.zoom*100)+'%';}
function renderPalettes(){
  $('#palettes').innerHTML=PALETTES.map(p=>`<details class="palette-group" ${p.open?'open':''}><summary>${esc(p.title)}</summary><div class="palette-grid">${p.items.map(([label,text,title])=>`<button data-insert="${esc(text)}" title="${esc(title)}" aria-label="${esc(title)}">${label}</button>`).join('')}</div></details>`).join('');
}
const rb=(action,label,i,cls='')=>`<button class="ribbon-button ${cls}" data-action="${action}" title="${esc(label)}">${i.startsWith('math:')?`<span class="math-icon">${i.slice(5)}</span>`:icon(i)}<span>${label}</span></button>`;
const rs=(buttons)=>`<div class="ribbon-stack">${buttons.map(([a,t,i])=>`<button data-action="${a}">${i.startsWith('math:')?`<span class="mini-symbol">${i.slice(5)}</span>`:icon(i)}${t}</button>`).join('')}</div>`;
const group=(label,content)=>`<div class="ribbon-group"><div class="ribbon-group-content">${content}</div><div class="ribbon-group-label">${label}</div></div>`;
function renderRibbon(){
  const run=group('Evaluation',rb('evaluate','Evaluate','run','primary')+rb('run-all','Run all','runall','primary')+rb('stop','Stop','stop','danger'));
  const algebra=group('Algebra',rb('op-simplify','Simplify','math:x')+rb('op-expand','Expand','math:(a+b)²','small-math')+rb('op-factor','Factor','math:ab')+rb('op-solve','Solve','math:x =','small-math'));
  const calculus=group('Calculus',rb('op-diff','Differentiate','math:∂')+rb('op-int','Integrate','math:∫')+rs([['insert-limit','Limit','math:lim'],['insert-series','Series','math:Σ']]));
  const plots=group('Visualization',rb('insert-plot','2D plot','plot')+rb('insert-surface','3D plot','surface'));
  const content={
    home:group('Clipboard',rb('paste','Paste','paste')+rs([['copy-input','Copy','copy'],['cut-input','Cut','cut']]))+run+algebra+calculus+plots+group('Insert',rs([['add-code','Math input','code'],['add-text','Text region','text']]))+group('Document',rb('save','Save','save')),
    math:run+algebra+calculus+group('Linear algebra',rb('matrix','Matrix','matrix')+rs([['op-det','Determinant','math:|A|'],['op-inverse','Inverse','math:A⁻¹']]))+group('Evaluate',rb('op-evalf','Numeric','math:≈')+rs([['insert-subs','Substitute','math:↦'],['insert-sum','Sum','math:Σ']]))+group('Commands',rb('help','Reference','help')),
    insert:group('Worksheet regions',rb('add-code','Math input','code')+rb('add-text','Text region','text')+rb('add-heading','Section','heading'))+group('Structures',rb('matrix','Matrix','matrix')+rb('insert-function','Function','math:ƒ'))+plots+group('Analysis',rb('insert-ode','ODE solution','plot')+rb('insert-series','Taylor series','math:Σ'))+group('Templates',rb('examples','Examples','sheet')),
    plots:plots+group('Numerical analysis',rb('insert-ode','ODE solution','plot')+rb('insert-fsolve','Find roots','math:x₀'))+group('Plot controls',rb('plot-fit','Fit view','math:⌖')+rb('plot-grid','Grid','matrix')+rb('plot-wire','Wireframe','surface')+rb('plot-spin','Rotate','refresh'))+group('Export',rb('plot-image','Plot PNG','export')),
    view:group('Workspace',rb('left-panel','Palettes','sidebar')+rb('right-panel','Context','sidebar-right')+rb('theme','Appearance','sun'))+group('Document mode',rb('worksheet-mode','Worksheet','code')+rb('document-mode','Document','sheet'))+group('Zoom',rb('zoom-out','Zoom out','math:−')+rb('zoom-reset','100%','math:1:1','small-math')+rb('zoom-in','Zoom in','math:+'))+group('Publish',rb('print','Print','print')+rb('export-html','HTML report','export')+rb('export-latex','LaTeX','math:TᴇX','small-math'))
  };
  $('#ribbon').innerHTML=content[state.ribbon];$$('[data-ribbon]').forEach(b=>{const s=b.dataset.ribbon===state.ribbon;b.classList.toggle('selected',s);b.setAttribute('aria-selected',String(s));});$$('[data-action="stop"]').forEach(b=>b.disabled=!state.running);updateHistoryButtons();
}
function subject(){const c=cell();if(c?.type==='code'){const input=$(`[data-cell-id="${c.id}"] .source-input`);if(document.activeElement===input&&input.selectionStart!==input.selectionEnd)return input.value.slice(input.selectionStart,input.selectionEnd);if(c.result?.kind==='math'&&!c.stale)return c.result.plain;try{const a=parse(c.source);return a.k==='assign'?format(a.value):c.source.replace(/[;:]\s*$/,'');}catch{return c.source;}}return 'x^2';}
function operation(op){
  const v=state.operationVar||'x',s=subject()||'x^2';const templates={diff:`diff(${s}, ${v})`,int:`int(${s}, ${v})`,solve:`solve(${s}, ${v})`,simplify:`simplify(${s})`,expand:`expand(${s})`,factor:`factor(${s}, ${v})`,evalf:`evalf(${s})`,det:`det(${s})`,inverse:`inverse(${s})`,transpose:`transpose(${s})`,plot:`plot(${s}, ${v}=-5..5)`};
  if(!templates[op])return;insertCell('code',templates[op]);evaluate();
}
function renderInspector(){
  const el=$('#inspector');$$('[data-inspector]').forEach(b=>b.classList.toggle('selected',b.dataset.inspector===state.inspector));
  if(state.inspector==='variables'){
    el.innerHTML='<div class="inspector-section"><div class="inspector-label">Session definitions <span>'+state.environment.length+'</span></div>'+(!state.environment.length?'<p class="context-tip">Define a variable or function with <code>:=</code>, then evaluate its cell.<br><br>For example:<br><code>A := Matrix([[2,1],[1,3]])</code></p>':state.environment.map(v=>`<div class="variable-row"><header><strong>${esc(v.name)}</strong><span>${esc(v.type)}</span></header><code>${esc(v.value)}</code></div>`).join(''))+'</div>';return;
  }
  if(state.inspector==='outline'){
    let i=0;el.innerHTML='<div class="inspector-section"><div class="inspector-label">Document outline</div>'+doc().cells.filter(c=>c.type==='heading').map(c=>`<button class="outline-item" data-scroll-cell="${c.id}"><span>${String(++i).padStart(2,'0')}</span>${esc(c.text)}</button>`).join('')+'</div>';return;
  }
  const c=cell(),r=c?.result;
  let preview='<span style="font-size:12px;color:var(--muted)">Select an expression</span>';
  if(c?.type==='code'){preview=r?.kind==='math'&&!c.stale?r.math:sourcePreview(c.source)||'<span style="font-size:12px">Enter an expression</span>';}
  const actions=[['simplify','Simplify','≡'],['expand','Expand','( )'],['factor','Factor','ab'],['solve','Solve for variable','x ='],['diff','Differentiate','∂'],['int','Integrate','∫'],['evalf','Approximate','≈'],['plot','Plot expression','⌁']];
  el.innerHTML=`<section class="inspector-section"><div class="inspector-label">Selected expression <span>⌁</span></div><div class="selection-preview">${preview}</div><div class="selection-info"><span>${r?.kind==='math'?'Symbolic expression':r?.kind?.startsWith('plot')?'Interactive plot':'Math input'}</span><span>${c?.stale?'Modified':r?.kind==='error'?'Error':r?'Evaluated':'Not evaluated'}</span></div></section><section class="inspector-section"><div class="inspector-label">Context operations</div><label class="operation-variable">With respect to <input id="operation-variable" value="${esc(state.operationVar)}" aria-label="Operation variable" maxlength="16"></label>${actions.map(([op,label,symbol])=>`<button class="context-operation" data-op="${op}"><span class="op-symbol">${symbol}</span><span>${label}</span><span class="op-arrow">›</span></button>`).join('')}</section><section class="inspector-section"><div class="inspector-label">Computation</div><dl class="properties"><dt>Arithmetic</dt><dd>Exact / Float64</dd><dt>Free variables</dt><dd>${esc(r?.variables?.join(', ')||'—')}</dd><dt>Kernel time</dt><dd>${r?.elapsed!==undefined?r.elapsed.toFixed(2)+' ms':'—'}</dd><dt>Node operations</dt><dd>${r?.operations??'—'}</dd></dl></section><section class="inspector-section"><div class="inspector-label">Make it flow</div><div class="shortcut-line"><span>Evaluate</span><kbd>Enter</kbd></div><div class="shortcut-line"><span>Evaluate & move on</span><kbd>⇧ Enter</kbd></div><div class="shortcut-line"><span>Find a command</span><kbd>⌘ / Ctrl K</kbd></div><p class="context-tip">Click any formula to edit its source. Use a palette to insert a template at the caret.</p></section>`;
}
function download(content,name,type='application/octet-stream'){const url=URL.createObjectURL(new Blob([content],{type})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function filename(ext){return doc().title.replace(/[^\p{L}\p{N}_ -]/gu,'').trim().replace(/\s+/g,'-').toLowerCase()+ext;}
function saveDocument(){download(JSON.stringify({format:'aster-worksheet',version:1,document:serializable(doc())},null,2),filename('.aster'),'application/json');toast('Worksheet saved. The .aster file contains editable source, not executable JavaScript.');}
async function copy(text){try{await navigator.clipboard.writeText(text);toast('Copied to clipboard.');}catch{const t=document.createElement('textarea');t.value=text;document.body.append(t);t.select();const ok=document.execCommand('copy');t.remove();toast(ok?'Copied to clipboard.':'Clipboard access was blocked by the browser.');}}
function selectedPlot(){return state.plotViews.get(state.selected)||[...state.plotViews.values()][0];}
function exportHTML(){
  const d=doc(),blocks=[];for(const c of d.cells){if(c.type==='heading')blocks.push('<h2>'+esc(c.text)+'</h2>');else if(c.type==='text')blocks.push('<p>'+esc(c.text).replace(/\n/g,'<br>')+'</p>');else{blocks.push('<pre>&gt; '+esc(c.source)+'</pre>');if(c.result?.math)blocks.push('<div class="math-output">'+c.result.math+'</div>');const p=state.plotViews.get(c.id);if(p){const was=p.visible;p.visible=true;p.baseDirty=true;p.render();p.visible=was;const canvas=document.createElement('canvas');canvas.width=p.overlay.width;canvas.height=p.overlay.height;const ctx=canvas.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(p.gpu?p.gpuCanvas:p.fallback,0,0);ctx.drawImage(p.overlay,0,0);blocks.push('<img alt="'+esc(c.source)+'" src="'+canvas.toDataURL('image/png')+'">');}if(c.result?.kind==='error')blocks.push('<p class="error">'+esc(c.result.plain)+'</p>');if(c.stale)blocks.push('<p class="error">This output is stale: the source was edited after evaluation.</p>');}}
  const html=`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${esc(d.title)}</title><style>body{max-width:900px;margin:50px auto;padding:0 25px;font-family:system-ui;color:#263448;font-size:14px;line-height:1.8}h1{font-family:Georgia;font-weight:400;font-size:34px}h2{font-size:17px;margin-top:35px}pre{white-space:pre-wrap;padding:12px;background:#f5f7fa;border-left:2px solid #a34d3f;font-size:12px}.math-output{padding:18px;font-size:23px;color:#295494}img{display:block;max-width:100%;margin:20px auto}small{color:#8490a2}.error{color:#a34d3f}@media print{body{margin:0}img,.math-output{break-inside:avoid}}</style><body><small>ASTER CAS · WORKSHEET REPORT</small><h1>${esc(d.title)}</h1><p>${esc(d.subtitle)}</p>${blocks.join('\n')}<hr><small>Exported from Aster CAS. Static report; editable calculations are in the .aster source file.</small></body></html>`;
  download(html,filename('.html'),'text/html');
}
function exportLatex(){const safe=s=>s.replace(/[\\{}_$%&#^~]/g,x=>'\\'+x);const rows=doc().cells.map(c=>c.type==='heading'?'\\section{'+safe(c.text)+'}':c.type==='text'?safe(c.text):`\\begin{verbatim}\n${c.source.replace(/\\end\{verbatim\}/g,'end-verbatim')}\n\\end{verbatim}\n${c.result?.latex?'\\[\n'+c.result.latex+'\n\\]':''}`);download('\\documentclass{article}\n\\usepackage{amsmath,amssymb}\n\\usepackage[margin=25mm]{geometry}\n\\title{'+safe(doc().title)+'}\n\\begin{document}\n\\maketitle\n'+rows.join('\n\n')+'\n\\end{document}\n',filename('.tex'),'text/plain');}
function openDialog(title,html){$('#dialog-title').textContent=title;$('#dialog-body').innerHTML=html;if(!$('#dialog').open)$('#dialog').showModal();}
function closeDialog(){$('#dialog').close();}
function showExamples(){openDialog('Every idea starts somewhere.',`<p style="margin-top:0;margin-bottom:20px">Choose a working worksheet. Every formula, result, and visualization is editable.</p><div class="example-grid">${EXAMPLES.map(e=>`<button class="example-card" data-example="${e.key}"><span class="example-icon">${e.icon}</span><strong>${esc(e.title)}</strong><p>${esc(e.description)}</p></button>`).join('')}</div>`);}
function showHelp(){openDialog('Command reference',`<p style="margin-top:0">Enter expressions in a math cell. Press <kbd>Enter</kbd> to evaluate or <kbd>Shift + Enter</kbd> to evaluate and advance. Click an example below to insert it.</p><div class="help-notice">Aster is an independent, Maple-inspired workbench, not the Maple engine. It implements a documented symbolic subset. Editing uses source with a typeset preview, not a full structural 2-D editor. Numerics use IEEE 754 binary64; symbolic rationals are exact.</div><table class="help-table"><thead><tr><th>Operation</th><th>Working example</th></tr></thead><tbody>${COMMANDS.map(([label,s])=>`<tr><td>${esc(label)}</td><td><button data-command-source="${esc(s)}"><code>${esc(s)}</code></button></td></tr>`).join('')}</tbody></table><p>Function arguments are separated by commas. <code>^</code> means power, <code>:=</code> defines a value, and <code>x=a..b</code> specifies a range. Basic implicit multiplication such as <code>2x</code> is accepted. Write <code>x*(x+1)</code> explicitly; <code>x(x+1)</code> denotes a function call.</p><p>Limit rules cover continuous substitution and removable 0/0 singularities. Exact equation solving covers quadratics and higher polynomials reducible by bounded rational-root search. Matrix operations are limited to 16 × 16. General Maple packages, assumptions, branch analysis, arbitrary-precision numerics, PDEs, units, and Maple file compatibility are not implemented.</p>`);}
function showCommands(){
  openDialog('What would you like to do?',`<input id="command-filter" class="command-input" placeholder="Search commands, calculus, plots, matrices…" autocomplete="off" aria-label="Search commands"><div id="command-results"></div>`);
  const commands=[['Evaluate current cell','action:evaluate','Enter'],['Evaluate worksheet','action:run-all','Ctrl + Shift + Enter'],['New worksheet','action:new','Ctrl + N'],['Save worksheet','action:save','Ctrl + S'],['Insert matrix','action:matrix','Matrix builder'],['Switch light / dark','action:theme','View'],...COMMANDS.map(([l,s,c])=>[l,s,c])];
  const render=q=>{$('#command-results').innerHTML=commands.filter(c=>c.join(' ').toLowerCase().includes(q.toLowerCase())).slice(0,18).map(([l,s,c])=>`<button class="command-item" data-command-source="${esc(s)}"><span>${esc(l)}</span><small>${esc(c)}</small></button>`).join('')||'<p>No matching commands.</p>';};render('');$('#command-filter').addEventListener('input',e=>render(e.target.value));$('#command-filter').addEventListener('keydown',e=>{if(e.key==='Enter')$('.command-item')?.click();});setTimeout(()=>$('#command-filter').focus(),20);
}
function showMatrix(){
  openDialog('Insert a matrix',`<div class="matrix-dimensions"><label>Rows <input id="matrix-rows" type="number" min="1" max="8" value="3"></label><label>Columns <input id="matrix-cols" type="number" min="1" max="8" value="3"></label><button class="button-secondary" id="matrix-identity">Identity</button></div><div class="matrix-editor" id="matrix-editor"></div><div class="dialog-footer"><button class="button-secondary" data-action="close-dialog">Cancel</button><button class="button-primary" id="matrix-insert">Insert matrix</button></div>`);
  const redraw=(identity=false)=>{const rows=Math.min(8,Math.max(1,+$('#matrix-rows').value||1)),cols=Math.min(8,Math.max(1,+$('#matrix-cols').value||1));$('#matrix-rows').value=rows;$('#matrix-cols').value=cols;$('#matrix-editor').style.gridTemplateColumns=`repeat(${cols},1fr)`;$('#matrix-editor').innerHTML=Array.from({length:rows*cols},(_,i)=>`<input class="matrix-entry" aria-label="Row ${Math.floor(i/cols)+1}, column ${i%cols+1}" value="${identity&&Math.floor(i/cols)===i%cols?1:0}">`).join('');};
  $('#matrix-rows').onchange=()=>redraw();$('#matrix-cols').onchange=()=>redraw();$('#matrix-identity').onclick=()=>redraw(true);redraw(true);
  $('#matrix-insert').onclick=()=>{const cols=+$('#matrix-cols').value,values=$$('.matrix-entry').map(e=>e.value.trim()||'0'),rows=[];try{values.forEach(parse);}catch(e){toast('Invalid matrix entry: '+e.message);return;}for(let i=0;i<values.length;i+=cols)rows.push('['+values.slice(i,i+cols).join(', ')+']');closeDialog();insertTemplate('Matrix(['+rows.join(', ')+'])');};
}
function fileMenu(anchor){const menu=$('#menu');if(!menu.hidden){menu.hidden=true;return;}menu.innerHTML=[['new','New worksheet','Ctrl N'],['open','Open worksheet…','Ctrl O'],['save','Save worksheet…','Ctrl S'],['-'],['export-html','Export HTML report',''],['export-latex','Export LaTeX',''],['export-source','Export calculation source',''],['print','Print worksheet','Ctrl P'],['-'],['examples','Example worksheets',''],['help','Command reference','F1']].map(([a,l,k])=>a==='-'?'<hr>':`<button data-action="${a}">${l}<kbd>${k}</kbd></button>`).join('');const r=anchor.getBoundingClientRect();menu.style.left=r.left+'px';menu.style.top=r.bottom+'px';menu.hidden=false;}
const ACTIONS={
 new:()=>newExample('blank'),open:()=>$('#open-file').click(),save:saveDocument,undo:()=>history('undo'),redo:()=>history('redo'),evaluate:()=>evaluate(), 'run-all':()=>evaluate(true),stop:()=>stop(),'add-code':()=>insertCell('code'),'add-text':()=>insertCell('text','Write a note…'),'add-heading':()=>insertCell('heading','New section'),matrix:showMatrix,examples:showExamples,help:showHelp,commands:showCommands,'close-dialog':closeDialog,
 theme:()=>{document.documentElement.dataset.theme=document.documentElement.dataset.theme==='dark'?'light':'dark';persist();},'left-panel':()=>document.body.classList.toggle('no-left'),'right-panel':()=>document.body.classList.toggle('no-right'),
 'worksheet-mode':()=>{state.mode='worksheet';applyModes();persist();},'document-mode':()=>{state.mode='document';applyModes();persist();},'zoom-in':()=>{state.zoom=Math.min(1.6,+(state.zoom+.1).toFixed(1));applyModes();},'zoom-out':()=>{state.zoom=Math.max(.6,+(state.zoom-.1).toFixed(1));applyModes();},'zoom-reset':()=>{state.zoom=1;applyModes();},
 print:()=>{for(const p of state.plotViews.values()){p.visible=true;p.render();}window.print();},'export-html':exportHTML,'export-latex':exportLatex,'export-source':()=>download(doc().cells.map(c=>c.type==='code'?c.source:'# '+c.text.replace(/\n/g,'\n# ')).join('\n\n'),filename('.txt'),'text/plain'),
 restart:()=>{stop(false);state.environment=[];for(const c of doc().cells){delete c.result;delete c.stale;}renderDocument();toast('Kernel restarted. Evaluate the worksheet to rebuild its definitions.');},
 paste:async()=>{try{const s=await navigator.clipboard.readText();if(s.length>16000)throw new Error('too long');insertTemplate(s);}catch{toast('Use Ctrl/Cmd+V inside a math input. Clipboard read permission was not granted.');}},
 'copy-input':()=>copy(cell()?.source||''),'cut-input':()=>{const c=cell();if(c?.type==='code'){copy(c.source);checkpoint();c.source='';markStale(c.id);renderDocument();selectCell(c.id,true);persist();}},
 'insert-plot':()=>{insertCell('code','plot([sin(a*x), cos(x)], x=-6..6)');evaluate();},'insert-surface':()=>{insertCell('code','plot3d(sin(a*x)*cos(y), x=-5..5, y=-5..5)');evaluate();},'insert-ode':()=>{insertCell('code','ode(-0.3*y + sin(t), y=1, t=0..20)');evaluate();},'insert-limit':()=>insertCell('code','limit(sin(x)/x, x=0)'), 'insert-series':()=>insertCell('code','series(exp(x), x=0, 7)'), 'insert-function':()=>insertCell('code','f := x -> exp(-x^2)'), 'insert-sum':()=>insertCell('code','sum(k^2, k=1..100)'), 'insert-subs':()=>insertCell('code','subs(x=2, x^3+3*x+1)'), 'insert-fsolve':()=>insertCell('code','fsolve(cos(x)-x, x=0..2)')
};
function perform(action,anchor){if(action==='file-menu'){fileMenu(anchor);return;}$('#menu').hidden=true;if(action.startsWith('op-'))operation(action.slice(3));else if(action.startsWith('plot-')){const p=selectedPlot();if(p)p.action(action.slice(5));else toast('Insert a plot first.');}else ACTIONS[action]?.();}
function cellAction(action,id){
  selectCell(id);const d=doc(),c=cell(),i=d.cells.indexOf(c);
  if(action==='run'){evaluate();return;}if(action==='copy-output'){copy(c.result?.plain||c.source);return;}
  checkpoint();if(action==='delete'){d.cells.splice(i,1);state.selected=d.cells[Math.min(i,d.cells.length-1)]?.id||'';if(!d.cells.length){d.cells.push(makeCell('code'));state.selected=d.cells[0].id;}}
  if(action==='duplicate'){const n={...c,id:uid()};delete n.result;d.cells.splice(i+1,0,n);state.selected=n.id;}
  if(action==='up'&&i>0)[d.cells[i-1],d.cells[i]]=[d.cells[i],d.cells[i-1]];
  if(action==='down'&&i<d.cells.length-1)[d.cells[i+1],d.cells[i]]=[d.cells[i],d.cells[i+1]];
  if(action==='fold')c.collapsed=!c.collapsed;else for(const c of d.cells)if(c.result)c.stale=true;
  renderDocument();persist();
}
function bindEvents(){
  document.addEventListener('click',e=>{
    const close=e.target.closest('[data-close-doc]');if(close){e.stopPropagation();const id=close.dataset.closeDoc;if(state.docs.length===1){toast('Keep one worksheet open, or create a new one first.');return;}stop(false);const i=state.docs.findIndex(d=>d.id===id);state.docs.splice(i,1);if(id===state.active){state.active='';activate(state.docs[Math.min(i,state.docs.length-1)].id);}else renderTabs();persist();return;}
    const tab=e.target.closest('[data-doc]');if(tab){activate(tab.dataset.doc);return;}
    const ca=e.target.closest('[data-cell-action]');if(ca){cellAction(ca.dataset.cellAction,ca.closest('[data-cell-id]').dataset.cellId);return;}
    const a=e.target.closest('[data-action]');if(a){e.preventDefault();perform(a.dataset.action,a);return;}
    const r=e.target.closest('[data-ribbon]');if(r){state.ribbon=r.dataset.ribbon;renderRibbon();return;}
    const ins=e.target.closest('[data-inspector]');if(ins){state.inspector=ins.dataset.inspector;renderInspector();return;}
    const pal=e.target.closest('[data-insert]');if(pal){insertTemplate(pal.dataset.insert);return;}
    const op=e.target.closest('[data-op]');if(op){operation(op.dataset.op);return;}
    const example=e.target.closest('[data-example]');if(example){newExample(example.dataset.example);return;}
    const command=e.target.closest('[data-command-source]');if(command){const s=command.dataset.commandSource;closeDialog();if(s.startsWith('action:'))perform(s.slice(7));else {insertCell('code',s);evaluate();}return;}
    const scroll=e.target.closest('[data-scroll-cell]');if(scroll){$(`[data-cell-id="${scroll.dataset.scrollCell}"]`)?.scrollIntoView({block:'start',behavior:'smooth'});return;}
    const c=e.target.closest('[data-cell-id]');if(c){if(c.dataset.cellId!==state.selected)selectCell(c.dataset.cellId);if(e.target.closest('.input-math'))selectCell(c.dataset.cellId,true);}
    if(!e.target.closest('#menu'))$('#menu').hidden=true;
  });
  // Prevent palette and operation clicks from discarding the source caret/selection.
  document.addEventListener('pointerdown',e=>{if(e.target.closest('[data-insert],[data-op],.ribbon-button,.ribbon-stack button'))e.preventDefault();});
  $('#worksheet').addEventListener('focusin',e=>{const c=e.target.closest('[data-cell-id]');if(c&&c.dataset.cellId!==state.selected)selectCell(c.dataset.cellId);if(e.target.matches('.source-input')){e.target.parentElement.classList.add('editing');resizeInput(e.target);}});
  $('#worksheet').addEventListener('focusout',e=>{const editor=e.target.closest('.input-editor');if(editor)requestAnimationFrame(()=>{if(!editor.contains(document.activeElement))editor.classList.remove('editing');});});
  $('#worksheet').addEventListener('beforeinput',()=>checkpoint(false));
  $('#worksheet').addEventListener('input',e=>{
    const field=e.target.dataset.docField;if(field){doc()[field]=e.target.textContent.slice(0,field==='title'?200:2000);if(field==='title'){renderTabs();$('#window-title').textContent=doc().title+' — Aster CAS';}persist();return;}
    const node=e.target.closest('[data-cell-id]'),c=doc().cells.find(c=>c.id===node?.dataset.cellId);if(!c)return;
    if(e.target.matches('.source-input')){c.source=e.target.value.slice(0,16000);if(e.target.value.length>16000)e.target.value=c.source;const parent=e.target.parentElement;$('.input-math',parent).innerHTML=sourcePreview(c.source);parent.classList.toggle('empty',!c.source.trim());resizeInput(e.target);markStale(c.id);$('#caret-status').textContent='Column '+(e.target.selectionStart+1);}else c.text=e.target.textContent.slice(0,16000);persist();
  });
  $('#worksheet').addEventListener('keydown',e=>{
    if(e.target.closest('.input-math')&&(e.key==='Enter'||e.key===' ')){e.preventDefault();selectCell(e.target.closest('[data-cell-id]').dataset.cellId,true);return;}
    if(!e.target.matches('.source-input'))return;
    if(e.key==='Enter'&&!e.altKey&&!e.ctrlKey&&!e.metaKey){e.preventDefault();evaluate(false,e.shiftKey);}
    if(e.key==='Tab'&&!e.shiftKey){e.preventDefault();const input=e.target,start=input.selectionStart,prefix=input.value.slice(0,start).match(/[a-zA-Z]+$/)?.[0],names=['simplify','expand','factor','diff','int','integrate','limit','series','solve','subs','evalf','plot','plot3d','Matrix','inverse','det','transpose','sum','product','sin','cos','exp','sqrt'];const match=prefix&&names.find(n=>n.startsWith(prefix)&&n!==prefix);if(match){input.setSelectionRange(start-prefix.length,start);insertTemplate(match+'(□)');}else insertTemplate('  ');}
  });
  $('#palette-filter').addEventListener('input',e=>{const q=e.target.value.toLowerCase();$$('.palette-group').forEach(g=>{let count=0;$$('[data-insert]',g).forEach(b=>{b.hidden=!((b.title+' '+b.dataset.insert).toLowerCase().includes(q));if(!b.hidden)count++;});g.hidden=!count;if(q&&count)g.open=true;});});
  $('#input-mode').addEventListener('change',e=>{state.input=e.target.value;applyModes();persist();});
  $('#inspector').addEventListener('input',e=>{if(e.target.id==='operation-variable')state.operationVar=e.target.value.replace(/[^\p{L}\p{N}_]/gu,'')||'x';});
  $('#open-file').addEventListener('change',async e=>{const file=e.target.files?.[0];if(!file)return;try{if(file.size>MAX_FILE)throw new Error('The maximum file size is 2 MB.');const data=JSON.parse(await file.text());if(state.docs.length>=20)throw new Error('Close a worksheet before opening another (20-tab limit).');if(data.format!=='aster-worksheet'||data.version!==1)throw new Error('Unsupported file format. Open an Aster .aster worksheet, version 1.');const d=hydrate(data.document);state.docs.push(d);activate(d.id);toast('Worksheet opened and recalculated.');}catch(err){toast('Could not open worksheet: '+err.message);}finally{e.target.value='';}});
  document.addEventListener('keydown',e=>{
    const mod=e.metaKey||e.ctrlKey,key=e.key.toLowerCase();
    if(key==='escape'){if(state.running)stop();$('#menu').hidden=true;$$('.plot-fullscreen').forEach(p=>p.classList.remove('plot-fullscreen'));}
    if(mod&&key==='k'){e.preventDefault();showCommands();return;}
    if($('#dialog').open)return;
    if(mod&&key==='s'){e.preventDefault();saveDocument();}else if(mod&&key==='o'){e.preventDefault();$('#open-file').click();}else if(mod&&key==='n'){e.preventDefault();newExample('blank');}else if(mod&&key==='z'){e.preventDefault();history(e.shiftKey?'redo':'undo');}else if(mod&&key==='y'){e.preventDefault();history('redo');}else if(mod&&key==='enter'){e.preventDefault();e.shiftKey?evaluate(true):insertCell('code');}else if(key==='f1'){e.preventDefault();showHelp();}
  });
  $('#dialog').addEventListener('click',e=>{if(e.target===$('#dialog'))closeDialog();});
  window.addEventListener('beforeunload',()=>{try{clearTimeout(state.saveTimer);localStorage.setItem(STORE,JSON.stringify({version:1,docs:state.docs.map(serializable),active:state.docs.indexOf(doc()),mode:state.mode,input:state.input,theme:document.documentElement.dataset.theme||'light'}));}catch{}});
}
load();$$('[data-icon]').forEach(el=>el.innerHTML=icon(el.dataset.icon));renderPalettes();renderTabs();renderRibbon();renderDocument();bindEvents();evaluate(true);updateRenderer();
// Explicit inspection hook used by automated integration tests; no user data is sent anywhere.
globalThis.aster={version:'0.1.0',state,parse,runAll:()=>evaluate(true),serialize:()=>serializable(doc()),newExample,perform};
