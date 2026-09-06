import {makeEvaluator,escapeHTML} from '../core/ast.js';

const COLORS=[[.12,.40,.73,1],[.88,.35,.24,1],[.12,.58,.48,1],[.58,.35,.74,1],[.88,.62,.13,1],[.20,.63,.74,1]];
const CSSCOLORS=COLORS.map(c=>`rgb(${c.slice(0,3).map(x=>Math.round(x*255)).join(',')})`);
const identity=()=>new Float32Array([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]);
const dot=(a,b)=>a.reduce((s,x,i)=>s+x*b[i],0), cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const norm=a=>{const d=Math.hypot(...a);return !Number.isFinite(d)||d<1e-14?[0,1,0]:a.map(x=>x/d);};
function multiply(a,b){const o=new Float32Array(16);for(let c=0;c<4;c++)for(let r=0;r<4;r++)for(let k=0;k<4;k++)o[c*4+r]+=a[k*4+r]*b[c*4+k];return o;}
function perspective(fov,aspect,near,far){const f=1/Math.tan(fov/2);return new Float32Array([f/aspect,0,0,0,0,f,0,0,0,0,far/(near-far),-1,0,0,near*far/(near-far),0]);}
function lookAt(eye,target){const z=norm(eye.map((x,i)=>x-target[i])),x=norm(cross([0,1,0],z)),y=cross(z,x);return new Float32Array([x[0],y[0],z[0],0,x[1],y[1],z[1],0,x[2],y[2],z[2],0,-dot(x,eye),-dot(y,eye),-dot(z,eye),1]);}
function project(m,p,w,h){const v=[...p,1],r=[0,0,0,0];for(let row=0;row<4;row++)for(let k=0;k<4;k++)r[row]+=m[k*4+row]*v[k];return [(r[0]/r[3]*.5+.5)*w,(.5-r[1]/r[3]*.5)*h,r[2]/r[3]];}
function colorMap(t){const stops=[[.12,.24,.58],[.08,.57,.73],[.17,.73,.60],[.85,.79,.29],[.90,.32,.24]],x=Math.max(0,Math.min(.9999,t))*4,i=Math.floor(x),u=x-i;return [...stops[i].map((c,j)=>c*(1-u)+stops[i+1][j]*u),1];}
function save(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function niceStep(range){const raw=range/8,p=10**Math.floor(Math.log10(raw)),v=raw/p;return (v<=1?1:v<=2?2:v<=5?5:10)*p;}
function numberLabel(n){return Math.abs(n)<1e-10?'0':Math.abs(n)>=1e5||Math.abs(n)<.001?n.toExponential(1):Number(n.toPrecision(5)).toString();}
const SHADER=`
struct Scene { matrix: mat4x4<f32>, options: vec4<f32> };
@group(0) @binding(0) var<uniform> scene: Scene;
struct In { @location(0) p:vec3<f32>, @location(1) n:vec3<f32>, @location(2) color:vec4<f32> };
struct Out { @builtin(position) p:vec4<f32>, @location(0) n:vec3<f32>, @location(1) color:vec4<f32> };
@vertex fn vs(v:In)->Out { var o:Out; o.p=scene.matrix*vec4<f32>(v.p,1.0);o.n=v.n;o.color=v.color;return o; }
@fragment fn fs(v:Out)->@location(0) vec4<f32> { let d=0.46+0.54*max(dot(normalize(v.n),normalize(vec3<f32>(0.35,0.85,0.4))),0.0);return vec4<f32>(v.color.rgb*mix(1.0,d,scene.options.x),v.color.a); }
`;
class GPUService {
  constructor(){this.promise=null;this.listeners=new Set();this.reason='';}
  async get(){
    if(this.promise)return this.promise;
    this.promise=(async()=>{
      if(!navigator.gpu)throw new Error('WebGPU is not available in this browser/context.');
      const adapter=await navigator.gpu.requestAdapter({powerPreference:'high-performance'});if(!adapter)throw new Error('No WebGPU adapter was returned.');
      const device=await adapter.requestDevice(),format=navigator.gpu.getPreferredCanvasFormat();
      device.lost.then(info=>{this.reason=info.message||'GPU device lost.';for(const f of this.listeners)f(this.reason);this.promise=null;});
      device.addEventListener('uncapturederror',e=>{this.reason=e.error.message;for(const f of this.listeners)f(this.reason);});
      const module=device.createShaderModule({code:SHADER});
      const messages=await module.getCompilationInfo();const errors=messages.messages.filter(m=>m.type==='error');if(errors.length)throw new Error(errors.map(e=>e.message).join('\n'));
      const layout=device.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.VERTEX|GPUShaderStage.FRAGMENT,buffer:{type:'uniform'}}]});
      const pipelineLayout=device.createPipelineLayout({bindGroupLayouts:[layout]});
      const desc={layout:pipelineLayout,vertex:{module,entryPoint:'vs',buffers:[{arrayStride:40,attributes:[{shaderLocation:0,offset:0,format:'float32x3'},{shaderLocation:1,offset:12,format:'float32x3'},{shaderLocation:2,offset:24,format:'float32x4'}]}]},fragment:{module,entryPoint:'fs',targets:[{format,blend:{color:{srcFactor:'src-alpha',dstFactor:'one-minus-src-alpha',operation:'add'},alpha:{srcFactor:'one',dstFactor:'one-minus-src-alpha',operation:'add'}}}]},primitive:{topology:'triangle-list',cullMode:'none'},depthStencil:{format:'depth24plus',depthWriteEnabled:true,depthCompare:'less-equal'},multisample:{count:4}};
      const pipeline=await device.createRenderPipelineAsync(desc);
      const linePipeline=await device.createRenderPipelineAsync({...desc,primitive:{topology:'line-list'},depthStencil:{format:'depth24plus',depthWriteEnabled:false,depthCompare:'less-equal'}});
      return {device,format,layout,pipeline,linePipeline,adapter:adapter.info?.description||'WebGPU adapter'};
    })().catch(e=>{this.reason=e.message;return null;});return this.promise;
  }
}
export const gpuService=new GPUService();
/** Retained plot with a demand-driven frame scheduler and a shared GPU device.
 * Surface data and VM programs are cached; buffers grow geometrically and are reused.
 */
export class PlotView {
  constructor(host,descriptor,onChange=()=>{}){
    this.host=host;this.data=descriptor;this.onChange=onChange;this.is3d=descriptor.kind==='plot3d';this.dead=false;this.visible=true;this.dirty=true;this.meshDirty=true;this.baseDirty=true;this.grid=true;this.wire=false;this.spinning=false;
    this.theta=-.85;this.phi=.66;this.distance=4.65;this.pan=[0,0,0];this.params=descriptor.parameters.map(p=>p.value);this.originalX=[...descriptor.domain];this.xrange=[...descriptor.domain];this.yrange=null;this.frame=0;this.buffers=new Map();this.capacity=new Map();this.backends='Canvas 2D';
    this.functions=descriptor.curves.map(c=>c.program?makeEvaluator(c.program):null);
    host.classList.add('plot-card');
    host.innerHTML=`<div class="plot-heading"><div><span class="plot-symbol">${this.is3d?'◈':'⌁'}</span><strong>${this.is3d?'3D surface':'2D function plot'}</strong><span class="plot-backend">Initializing</span></div><div class="plot-actions"><button data-plot-action="fit" title="Fit plot" aria-label="Fit plot">⌖</button><button data-plot-action="grid" title="Toggle grid" class="active" aria-label="Toggle grid">▦</button>${this.is3d?'<button data-plot-action="wire" title="Toggle wireframe" aria-label="Toggle wireframe">◇</button><button data-plot-action="spin" title="Auto rotate" aria-label="Auto rotate">▷</button>':''}<button data-plot-action="image" title="Export PNG" aria-label="Export plot PNG">↓</button><button data-plot-action="full" title="Expand plot" aria-label="Expand plot">⛶</button></div></div><div class="plot-stage ${this.is3d?'surface-stage':''}"><canvas class="gpu-layer" aria-hidden="true"></canvas><canvas class="fallback-layer" aria-hidden="true"></canvas><canvas class="labels-layer" tabindex="0" role="img" aria-label="${this.is3d?'Interactive 3D mathematical surface. Drag to orbit; scroll to zoom.':'Interactive function plot. Drag to pan; scroll to zoom.'}"></canvas><div class="plot-tooltip" hidden></div></div><div class="plot-legend">${descriptor.curves.map((c,i)=>`<span><i style="background:${CSSCOLORS[i%COLORS.length]}"></i>${escapeHTML(c.label)}</span>`).join('')}</div>${descriptor.parameters.length?`<div class="plot-parameters">${descriptor.parameters.map((p,i)=>`<label><span>${escapeHTML(p.name)}</span><input type="range" data-param="${i}" min="${p.min}" max="${p.max}" step="${p.step}" value="${p.value}" aria-label="Parameter ${escapeHTML(p.name)}"><output>${p.value.toFixed(2)}</output></label>`).join('')}</div>`:''}<div class="plot-footer"><span>${this.is3d?'Drag to orbit · scroll to zoom':'Drag to pan · scroll to zoom · hover to trace'}</span><span class="plot-stats">Preparing plot</span></div>`;
    this.stage=host.querySelector('.plot-stage');this.gpuCanvas=host.querySelector('.gpu-layer');this.fallback=host.querySelector('.fallback-layer');this.overlay=host.querySelector('.labels-layer');this.ctx=this.overlay.getContext('2d');this.fctx=this.fallback.getContext('2d');this.tooltip=host.querySelector('.plot-tooltip');this.badge=host.querySelector('.plot-backend');
    this.resizeObserver=new ResizeObserver(()=>this.resize());this.resizeObserver.observe(this.stage);
    this.intersection=new IntersectionObserver(es=>{this.visible=es[0].isIntersecting;if(this.visible)this.invalidate();},{rootMargin:'150px'});this.intersection.observe(host);
    this.abort=new AbortController();const signal=this.abort.signal;
    host.addEventListener('click',e=>{const b=e.target.closest('[data-plot-action]');if(!b)return;this.action(b.dataset.plotAction);}, {signal});
    host.addEventListener('input',e=>{if(e.target.dataset.param!==undefined){const i=+e.target.dataset.param;this.params[i]=+e.target.value;e.target.nextElementSibling.value=this.params[i].toFixed(2);this.meshDirty=true;this.invalidate();this.onChange(this);}}, {signal});
    this.overlay.addEventListener('pointerdown',e=>{if(e.button!==0)return;e.preventDefault();this.overlay.setPointerCapture(e.pointerId);this.drag={x:e.clientX,y:e.clientY,theta:this.theta,phi:this.phi,xrange:[...this.xrange],yrange:[...this.yrange||[-1,1]],pan:[...this.pan],shift:e.shiftKey};}, {signal});
    this.overlay.addEventListener('pointermove',e=>this.pointerMove(e),{signal});
    this.overlay.addEventListener('pointerup',()=>{this.drag=null;},{signal});this.overlay.addEventListener('pointercancel',()=>{this.drag=null;},{signal});this.overlay.addEventListener('pointerleave',()=>{if(!this.drag){this.hover=null;this.tooltip.hidden=true;this.invalidate();}},{signal});
    this.overlay.addEventListener('dblclick',()=>this.action('fit'),{signal});
    this.overlay.addEventListener('wheel',e=>{
      e.preventDefault();const z=Math.exp(Math.max(-200,Math.min(200,e.deltaY))*.0015);
      if(this.is3d)this.distance=Math.max(2.2,Math.min(12,this.distance*z));
      else {const r=this.overlay.getBoundingClientRect(),p=this.fromScreen(e.clientX-r.left,e.clientY-r.top);this.xrange=this.xrange.map(x=>p[0]+(x-p[0])*z);this.yrange=this.yrange.map(y=>p[1]+(y-p[1])*z);if(this.xrange[1]-this.xrange[0]<1e-8)this.xrange=[p[0]-5e-9,p[0]+5e-9];}
      this.invalidate();
    },{signal,passive:false});
    this.overlay.addEventListener('keydown',e=>{if(e.key==='0'||e.key==='Home'){e.preventDefault();this.action('fit');}if(e.key==='Escape')host.classList.remove('plot-fullscreen');},{signal});
    this.loss=reason=>this.useFallback(reason);gpuService.listeners.add(this.loss);this.resize();this.initGPU();
  }
  async initGPU(){
    const gpu=await gpuService.get();if(this.dead)return;
    if(!gpu){this.useFallback(gpuService.reason);return;}
    try {
      this.gpu=gpu;this.context=this.gpuCanvas.getContext('webgpu');if(!this.context)throw new Error('Canvas WebGPU context was unavailable.');
      this.context.configure({device:gpu.device,format:gpu.format,alphaMode:'opaque'});
      this.uniform=gpu.device.createBuffer({size:80,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
      this.bindGroup=gpu.device.createBindGroup({layout:gpu.layout,entries:[{binding:0,resource:{buffer:this.uniform}}]});
      this.baseDirty=true;this.meshUpload=true;this.backends='WebGPU';this.gpuCanvas.hidden=false;this.fallback.hidden=true;this.badge.textContent='WebGPU';this.badge.classList.add('gpu-ready');this.badge.title=gpu.adapter;this.textures();this.invalidate();this.onChange(this);
    } catch(e){this.useFallback(e.message);}
  }
  useFallback(reason){if(this.dead)return;this.baseDirty=true;this.backends='Canvas 2D';this.gpuCanvas.hidden=true;this.fallback.hidden=false;this.badge.textContent='Canvas 2D';this.badge.classList.remove('gpu-ready');this.badge.title=reason||'CPU fallback renderer';this.gpu=null;this.invalidate();this.onChange(this);}
  resize(){
    const r=this.stage.getBoundingClientRect();if(r.width<1||r.height<1)return;
    this.baseDirty=true;this.w=r.width;this.h=r.height;this.dpr=Math.min(devicePixelRatio||1,2);
    for(const c of [this.gpuCanvas,this.fallback,this.overlay]){c.width=Math.max(1,Math.round(this.w*this.dpr));c.height=Math.max(1,Math.round(this.h*this.dpr));}
    this.ctx.setTransform(this.dpr,0,0,this.dpr,0,0);this.fctx.setTransform(this.dpr,0,0,this.dpr,0,0);this.textures();this.invalidate();
  }
  textures(){if(!this.gpu)return;this.depth?.destroy();this.msaa?.destroy();const size=[this.gpuCanvas.width,this.gpuCanvas.height];this.depth=this.gpu.device.createTexture({size,format:'depth24plus',sampleCount:4,usage:GPUTextureUsage.RENDER_ATTACHMENT});this.msaa=this.gpu.device.createTexture({size,format:this.gpu.format,sampleCount:4,usage:GPUTextureUsage.RENDER_ATTACHMENT});}
  invalidate(){if(this.dead)return;this.dirty=true;if(!this.frame&&this.visible)this.frame=requestAnimationFrame(()=>{this.frame=0;this.render();});}
  action(a){
    if(a==='fit'){this.xrange=[...this.originalX];this.yrange=null;this.theta=-.85;this.phi=.66;this.distance=4.65;this.pan=[0,0,0];}
    if(a==='grid'){this.grid=!this.grid;this.host.querySelector('[data-plot-action="grid"]').classList.toggle('active',this.grid);}
    if(a==='wire'){this.wire=!this.wire;this.host.querySelector('[data-plot-action="wire"]').classList.toggle('active',this.wire);}
    if(a==='spin'){this.spinning=!this.spinning;this.host.querySelector('[data-plot-action="spin"]').classList.toggle('active',this.spinning);}
    if(a==='full'){this.host.classList.toggle('plot-fullscreen');this.overlay.focus();setTimeout(()=>this.resize(),0);}
    if(a==='image'){this.baseDirty=true;this.render();const c=document.createElement('canvas');c.width=this.overlay.width;c.height=this.overlay.height;const ctx=c.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,c.width,c.height);ctx.drawImage(this.gpu?this.gpuCanvas:this.fallback,0,0);ctx.drawImage(this.overlay,0,0);c.toBlob(b=>{if(b)save(b,'aster-plot.png');});}
    this.invalidate();
  }
  pointerMove(e){
    const r=this.overlay.getBoundingClientRect(),x=e.clientX-r.left,y=e.clientY-r.top;
    if(this.drag){const dx=e.clientX-this.drag.x,dy=e.clientY-this.drag.y;
      if(this.is3d){if(this.drag.shift){this.pan[0]=this.drag.pan[0]-dx*.004;this.pan[1]=this.drag.pan[1]+dy*.004;}else{this.theta=this.drag.theta-dx*.008;this.phi=Math.max(-1.35,Math.min(1.35,this.drag.phi+dy*.008));}}
      else {const px=-dx/(this.w-64)*(this.drag.xrange[1]-this.drag.xrange[0]),py=dy/(this.h-55)*(this.drag.yrange[1]-this.drag.yrange[0]);this.xrange=this.drag.xrange.map(v=>v+px);this.yrange=this.drag.yrange.map(v=>v+py);}
      this.tooltip.hidden=true;
    } else if(!this.is3d){this.hover=[x,y];}
    this.invalidate();
  }
  fromScreen(x,y){return [this.xrange[0]+(x-48)/(this.w-64)*(this.xrange[1]-this.xrange[0]),this.yrange[1]-(y-18)/(this.h-55)*(this.yrange[1]-this.yrange[0])];}
  toScreen(x,y){return [48+(x-this.xrange[0])/(this.xrange[1]-this.xrange[0])*(this.w-64),18+(this.yrange[1]-y)/(this.yrange[1]-this.yrange[0])*(this.h-55)];}
  sample2d(){
    const key=[...this.xrange,this.w,...this.params].join(',');
    if(this.sampleKey===key&&this.samples&&this.yrange)return;
    this.sampleKey=key;
    const count=Math.min(4096,Math.max(768,Math.round(this.w*1.8))),values=[];
    this.samples=this.data.curves.map((curve,i)=>{
      if(curve.points){for(let j=1;j<curve.points.length;j+=2)if(Number.isFinite(curve.points[j]))values.push(curve.points[j]);return curve.points;}
      const p=new Float64Array((count+1)*2),vars=[0,...this.params],f=this.functions[i];
      for(let j=0;j<=count;j++){const x=this.xrange[0]+j/count*(this.xrange[1]-this.xrange[0]);vars[0]=x;const y=f(vars);p[j*2]=x;p[j*2+1]=y;if(Number.isFinite(y))values.push(y);}return p;
    });
    if(!this.yrange){values.sort((a,b)=>a-b);let lo=values[Math.floor(values.length*.02)]??-1,hi=values[Math.floor(values.length*.98)]??1;if(Math.abs(hi-lo)<1e-9){lo-=1;hi+=1;}const d=(hi-lo)*.15;this.yrange=[lo-d,hi+d];}
  }
  line2d(vertices,x1,y1,x2,y2,width,color){
    if(!vertices)return;
    const dx=x2-x1,dy=y2-y1,len=Math.hypot(dx,dy);if(len<.0001)return;const nx=-dy/len*width/2,ny=dx/len*width/2;
    const ps=[[x1+nx,y1+ny],[x1-nx,y1-ny],[x2+nx,y2+ny],[x2+nx,y2+ny],[x1-nx,y1-ny],[x2-nx,y2-ny]];
    for(const [x,y] of ps)vertices.push(x/this.w*2-1,1-y/this.h*2,0,0,1,0,...color);
  }
  clip(x1,y1,x2,y2){
    const left=48,right=this.w-16,top=18,bottom=this.h-37,dx=x2-x1,dy=y2-y1;let a=0,b=1;
    const p=[-dx,dx,-dy,dy],q=[x1-left,right-x1,y1-top,bottom-y1];
    for(let i=0;i<4;i++){if(Math.abs(p[i])<1e-15){if(q[i]<0)return null;}else{const t=q[i]/p[i];if(p[i]<0)a=Math.max(a,t);else b=Math.min(b,t);if(a>b)return null;}}
    return [x1+a*dx,y1+a*dy,x1+b*dx,y1+b*dy];
  }
  draw2d(){
    this.sample2d();const key=[...this.xrange,...this.yrange,...this.params,this.w,this.h,this.grid].join(',');
    const ctx=this.ctx,verts=this.plotKey===key?null:[];ctx.clearRect(0,0,this.w,this.h);ctx.font='11px ui-sans-serif, system-ui';ctx.fillStyle='#7c8595';ctx.textAlign='center';
    const xs=niceStep(this.xrange[1]-this.xrange[0]),ys=niceStep(this.yrange[1]-this.yrange[0]);
    if(this.grid){
      for(let x=Math.ceil(this.xrange[0]/xs)*xs,n=0;x<=this.xrange[1]&&n<40;x+=xs,n++){
        const [px]=this.toScreen(x,0);this.line2d(verts,px,18,px,this.h-37,.7,[.90,.92,.94,1]);ctx.fillText(numberLabel(x),px,this.h-18);
      }
      ctx.textAlign='right';for(let y=Math.ceil(this.yrange[0]/ys)*ys,n=0;y<=this.yrange[1]&&n<40;y+=ys,n++){
        const [,py]=this.toScreen(0,y);this.line2d(verts,48,py,this.w-16,py,.7,[.90,.92,.94,1]);ctx.fillText(numberLabel(y),40,py+4);
      }
    }
    const [zx,zy]=this.toScreen(0,0);if(zx>=48&&zx<=this.w-16)this.line2d(verts,zx,18,zx,this.h-37,1.1,[.62,.67,.74,1]);if(zy>=18&&zy<=this.h-37)this.line2d(verts,48,zy,this.w-16,zy,1.1,[.62,.67,.74,1]);
    this.line2d(verts,48,this.h-37,this.w-16,this.h-37,1,[.79,.82,.87,1]);this.line2d(verts,48,18,48,this.h-37,1,[.79,.82,.87,1]);
    let segments=0;
    if(verts)this.samples.forEach((ps,i)=>{
      for(let j=2;j<ps.length;j+=2){const x1=ps[j-2],y1=ps[j-1],x2=ps[j],y2=ps[j+1];if(!Number.isFinite(y1)||!Number.isFinite(y2))continue;
        if(Math.abs(y2-y1)>(this.yrange[1]-this.yrange[0])*.7)continue;
        const p=this.clip(...this.toScreen(x1,y1),...this.toScreen(x2,y2));if(p){this.line2d(verts,...p,2.1,COLORS[i%COLORS.length]);segments++;}
      }
    });
    ctx.textAlign='right';ctx.font='italic 13px Georgia';ctx.fillStyle='#6b7688';ctx.fillText(this.data.xvar||'x',this.w-18,this.h-3);ctx.fillText('y',38,13);
    if(this.hover&&!this.drag){
      const [px,py]=this.hover;if(px>=48&&px<this.w-16&&py>=18&&py<this.h-37){
        const [x]=this.fromScreen(px,py);let best=null;
        this.data.curves.forEach((c,i)=>{let y;if(this.functions[i])y=this.functions[i]([x,...this.params]);else {const ps=c.points,j=Math.min(ps.length/2-1,Math.max(0,Math.round((x-this.originalX[0])/(this.originalX[1]-this.originalX[0])*(ps.length/2-1))));y=ps[j*2+1];}const [,sy]=this.toScreen(x,y),d=Math.abs(py-sy);if(Number.isFinite(y)&&(!best||d<best.d))best={y,sy,d,i};});
        if(best){ctx.save();ctx.setLineDash([3,4]);ctx.strokeStyle='#929cad';ctx.lineWidth=.8;ctx.beginPath();ctx.moveTo(px,18);ctx.lineTo(px,this.h-37);ctx.stroke();ctx.restore();ctx.fillStyle=CSSCOLORS[best.i%COLORS.length];ctx.beginPath();ctx.arc(px,best.sy,4,0,Math.PI*2);ctx.fill();this.tooltip.hidden=false;this.tooltip.style.left=Math.min(this.w-150,px+12)+'px';this.tooltip.style.top=Math.max(5,Math.min(this.h-35,best.sy-32))+'px';this.tooltip.textContent=`${this.data.xvar} ${numberLabel(x)}  ·  y ${numberLabel(best.y)}`;}
      }else this.tooltip.hidden=true;
    }
    if(verts){this.vertices=new Float32Array(verts);this.lines=new Float32Array();this.matrix=identity();this.vertexCount=this.vertices.length/10;this.stats=`${segments.toLocaleString()} segments`;this.plotKey=key;this.baseDirty=true;this.meshUpload=true;}
    // Pointer tracing repaints only the text/crosshair overlay; cached geometry and
    // curve samples survive. Pan/zoom, resize, grid and parameters invalidate it.
    if(this.baseDirty){if(this.gpu)this.drawGPU();if(!this.gpu)this.drawFallback2d(this.vertices);this.baseDirty=false;}
  }
  drawFallback2d(v){const ctx=this.fctx;ctx.clearRect(0,0,this.w,this.h);ctx.fillStyle='white';ctx.fillRect(0,0,this.w,this.h);for(let i=0;i<v.length;i+=30){ctx.fillStyle=`rgba(${Math.round(v[i+6]*255)},${Math.round(v[i+7]*255)},${Math.round(v[i+8]*255)},${v[i+9]})`;ctx.beginPath();for(let j=0;j<3;j++){const o=i+j*10,x=(v[o]*.5+.5)*this.w,y=(.5-v[o+1]*.5)*this.h;j?ctx.lineTo(x,y):ctx.moveTo(x,y);}ctx.closePath();ctx.fill();}}
  buildSurface(){
    const N=112,points=[],zs=[],normal=[],fn=this.functions[0],xr=this.data.domain,yr=this.data.ydomain,vars=[0,0,...this.params];
    for(let j=0;j<=N;j++)for(let i=0;i<=N;i++){vars[0]=xr[0]+i/N*(xr[1]-xr[0]);vars[1]=yr[0]+j/N*(yr[1]-yr[0]);const z=fn(vars);points.push([i/N*2-1,z,j/N*2-1]);if(Number.isFinite(z))zs.push(z);}
    zs.sort((a,b)=>a-b);const lo=zs[Math.floor(zs.length*.005)]??-1,hi=zs[Math.floor(zs.length*.995)]??1,scale=Math.max(hi-lo,1e-9),middle=(lo+hi)/2;this.zrange=[lo,hi];
    for(const p of points)p[1]=(p[1]-middle)/scale*1.5;
    const at=(i,j)=>points[Math.max(0,Math.min(N,j))*(N+1)+Math.max(0,Math.min(N,i))];
    for(let j=0;j<=N;j++)for(let i=0;i<=N;i++){const l=at(i-1,j),r=at(i+1,j),d=at(i,j-1),u=at(i,j+1);normal.push(norm([-(r[1]-l[1])/(r[0]-l[0]),1,-(u[1]-d[1])/(u[2]-d[2])]));}
    const verts=[],wire=[],addVertex=(buffer,index,lift=0)=>{const p=points[index];buffer.push(p[0],p[1]+lift,p[2],...normal[index],...(lift?[.15,.22,.34,.36]:colorMap(p[1]/1.5+.5)));};
    for(let j=0;j<N;j++)for(let i=0;i<N;i++){
      const a=j*(N+1)+i,b=a+1,c=a+N+1,d=c+1;
      if([a,b,c,d].some(k=>!Number.isFinite(points[k][1])||Math.abs(points[k][1])>8))continue;
      for(const k of [a,c,b,b,c,d])addVertex(verts,k);
      if(i%4===0){addVertex(wire,a,.002);addVertex(wire,c,.002);}if(j%4===0){addVertex(wire,a,.002);addVertex(wire,b,.002);}
    }
    this.vertices=new Float32Array(verts);this.wireVertices=new Float32Array(wire);this.vertexCount=verts.length/10;this.meshDirty=false;this.meshUpload=true;this.stats=`${(this.vertexCount/3).toLocaleString()} triangles`;
  }
  draw3d(){
    if(this.meshDirty)this.buildSurface();
    const eye=[Math.sin(this.theta)*Math.cos(this.phi)*this.distance,Math.sin(this.phi)*this.distance,Math.cos(this.theta)*Math.cos(this.phi)*this.distance].map((v,i)=>v+this.pan[i]);
    this.matrix=multiply(perspective(.70,this.w/this.h,.05,100),lookAt(eye,this.pan));
    const lines=[];const line=(a,b,color)=>{for(const p of [a,b])lines.push(...p,0,1,0,...color);};
    if(this.grid){for(let i=0;i<=8;i++){const t=i/4-1;line([t,-.86,-1],[t,-.86,1],[.75,.79,.84,1]);line([-1,-.86,t],[1,-.86,t],[.75,.79,.84,1]);}line([-1,-.86,-1],[-1,.90,-1],[.66,.71,.79,1]);line([-1,-.86,-1],[1,-.86,-1],[.66,.71,.79,1]);line([-1,-.86,-1],[-1,-.86,1],[.66,.71,.79,1]);}
    this.lines=new Float32Array(lines.length+(this.wire?this.wireVertices.length:0));this.lines.set(lines);if(this.wire)this.lines.set(this.wireVertices,lines.length);
    if(this.gpu)this.drawGPU();else this.drawFallback3d();
    const ctx=this.ctx;ctx.clearRect(0,0,this.w,this.h);ctx.font='italic 14px Georgia';ctx.fillStyle='#647088';ctx.textAlign='center';
    if(this.grid){for(const [label,p] of [[this.data.xvar,[1.15,-.86,-1]],[this.data.yvar,[-1,-.86,1.15]],['z',[-1,1.05,-1]]]){const [x,y]=project(this.matrix,p,this.w,this.h);ctx.fillText(label,x,y);}ctx.font='10px system-ui';for(const [label,p] of [[numberLabel(this.data.domain[0]),[-1,-.86,-1.08]],[numberLabel(this.data.domain[1]),[1,-.86,-1.08]],[numberLabel(this.data.ydomain[1]),[-1.1,-.86,1]],[numberLabel(this.zrange[1]),[-1.12,.75,-1]]]){const [x,y]=project(this.matrix,p,this.w,this.h);ctx.fillText(label,x,y);}}
    // A compact, truthful height legend is drawn in the same overlay as the axes.
    const gx=this.w-25,gy=32,gh=95;for(let i=0;i<gh;i++){const c=colorMap(1-i/gh);ctx.fillStyle=`rgb(${c.slice(0,3).map(x=>Math.round(x*255)).join(',')})`;ctx.fillRect(gx,gy+i,6,1.2);}ctx.fillStyle='#7c8595';ctx.font='9px system-ui';ctx.textAlign='right';ctx.fillText(numberLabel(this.zrange[1]),gx-5,gy+4);ctx.fillText(numberLabel(this.zrange[0]),gx-5,gy+gh);
  }
  upload(name,data){
    const device=this.gpu.device,needed=Math.max(4,data.byteLength);let b=this.buffers.get(name);
    if(!b||(this.capacity.get(name)||0)<needed){b?.destroy();const size=2**Math.ceil(Math.log2(needed));b=device.createBuffer({size,usage:GPUBufferUsage.VERTEX|GPUBufferUsage.COPY_DST});this.buffers.set(name,b);this.capacity.set(name,size);}
    if(data.length)device.queue.writeBuffer(b,0,data);return b;
  }
  drawGPU(){
    try{
      const d=this.gpu.device;
      // A static 3D mesh is uploaded only when its expression/parameters change.
      let vb=this.buffers.get('vertices');if(this.meshUpload||!vb){vb=this.upload('vertices',this.vertices);this.meshUpload=false;}
      const lb=this.upload('lines',this.lines),u=new Float32Array(20);u.set(this.matrix);u[16]=this.is3d?1:0;d.queue.writeBuffer(this.uniform,0,u);
      const encoder=d.createCommandEncoder(),pass=encoder.beginRenderPass({colorAttachments:[{view:this.msaa.createView(),resolveTarget:this.context.getCurrentTexture().createView(),clearValue:{r:1,g:1,b:1,a:1},loadOp:'clear',storeOp:'store'}],depthStencilAttachment:{view:this.depth.createView(),depthClearValue:1,depthLoadOp:'clear',depthStoreOp:'store'}});
      pass.setBindGroup(0,this.bindGroup);pass.setPipeline(this.gpu.pipeline);pass.setVertexBuffer(0,vb);pass.draw(this.vertices.length/10);
      if(this.lines.length){pass.setPipeline(this.gpu.linePipeline);pass.setVertexBuffer(0,lb);pass.draw(this.lines.length/10);}pass.end();d.queue.submit([encoder.finish()]);
    }catch(e){this.useFallback(e.message);}
  }
  drawFallback3d(){
    const ctx=this.fctx;ctx.fillStyle='white';ctx.fillRect(0,0,this.w,this.h);const triangles=[],v=this.vertices;
    // Painter's algorithm is a compatibility path, not a GPU-equivalent depth buffer.
    for(let i=0;i<v.length;i+=30){const ps=[0,10,20].map(j=>project(this.matrix,[v[i+j],v[i+j+1],v[i+j+2]],this.w,this.h));triangles.push({i,ps,z:(ps[0][2]+ps[1][2]+ps[2][2])/3});}
    triangles.sort((a,b)=>b.z-a.z);
    for(const {i,ps} of triangles){const light=.46+.54*Math.max(0,v[i+3]*.36+v[i+4]*.85+v[i+5]*.40);ctx.fillStyle=`rgb(${[6,7,8].map(j=>Math.round(v[i+j]*light*255)).join(',')})`;ctx.beginPath();ps.forEach(([x,y],j)=>j?ctx.lineTo(x,y):ctx.moveTo(x,y));ctx.closePath();ctx.fill();}
    const l=this.lines;ctx.lineWidth=.6;ctx.strokeStyle='#aab4c1';ctx.beginPath();for(let i=0;i<l.length;i+=20){const p=project(this.matrix,[l[i],l[i+1],l[i+2]],this.w,this.h),q=project(this.matrix,[l[i+10],l[i+11],l[i+12]],this.w,this.h);ctx.moveTo(p[0],p[1]);ctx.lineTo(q[0],q[1]);}ctx.stroke();
  }
  render(){
    if(this.dead||!this.w||!this.visible)return;const start=performance.now();if(this.spinning)this.theta+=.009;
    try{this.is3d?this.draw3d():this.draw2d();this.host.querySelector('.plot-stats').textContent=`${this.stats} · ${(performance.now()-start).toFixed(1)} ms`;}catch(e){this.host.querySelector('.plot-stats').textContent=e.message;}
    this.dirty=false;if(this.spinning)this.invalidate();
  }
  destroy(){this.dead=true;cancelAnimationFrame(this.frame);this.abort.abort();this.resizeObserver.disconnect();this.intersection.disconnect();gpuService.listeners.delete(this.loss);for(const b of this.buffers.values())b.destroy();this.uniform?.destroy();this.depth?.destroy();this.msaa?.destroy();try{this.context?.unconfigure();}catch{}this.host.classList.remove('plot-fullscreen');}
}
