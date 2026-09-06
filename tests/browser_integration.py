"""Browser integration tests for the standalone build.

The execution environment blocks all Chromium URL navigations. To test the actual
bundle without altering browser policy, this suite loads it into about:blank with
set_content. Storage and download endpoints are explicit in-memory fixtures.
The origin is insecure, so this validates the real Canvas 2D compatibility path,
not a live WebGPU adapter. Run tests/browser_live.py on a normal localhost origin
for native persistence, the module build, and WebGPU validation.
"""
import json
import os
import shutil
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
HTML=(ROOT/'dist/index.html').read_text()
checks=[]
def record(name,condition=True):
    if not condition: raise AssertionError(name)
    checks.append({'name':name,'passed':True})
    print('PASS',name,flush=True)
FIXTURE="""() => {
  const values=new Map();
  Object.defineProperty(window,'localStorage',{configurable:true,value:{getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,String(v)),removeItem:k=>values.delete(k),clear:()=>values.clear()}});
  window.__downloads=[];
  const click=HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click=function(){if(this.download){const item={name:this.download,text:null};window.__downloads.push(item);fetch(this.href).then(r=>r.text()).then(t=>item.text=t);return;}return click.call(this);};
}"""
with sync_playwright() as p:
    executable=os.environ.get('ASTER_CHROMIUM') or shutil.which('chromium') or shutil.which('chromium-browser')
    options={'headless':True}
    if executable:options['executable_path']=executable
    browser=p.chromium.launch(**options)
    page=browser.new_page(viewport={'width':1600,'height':1180},device_scale_factor=1)
    page.set_default_timeout(8000)
    errors=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.evaluate(FIXTURE)
    page.set_content(HTML,wait_until='load')
    page.wait_for_function('window.aster && !aster.state.running')
    page.wait_for_timeout(600)
    record('standalone boot executes all default code cells',page.evaluate('aster.state.docs[0].cells.filter(c=>c.result).length===5'))
    record('default worksheet has no computation errors',page.evaluate('!aster.state.docs[0].cells.some(c=>c.result?.kind==="error")'))
    record('fallback backend is reported truthfully',page.locator('.plot-backend').first.inner_text()=='Canvas 2D')
    record('2D plot has actual sample data and geometry',page.evaluate('[...aster.state.plotViews.values()][0].vertices.length>10000'))
    page.screenshot(path=str(ROOT/'docs/worksheet.png'))
    page.evaluate('window.cachedVertices=[...aster.state.plotViews.values()][0].vertices; window.cachedSamples=[...aster.state.plotViews.values()][0].samples')
    plot=page.locator('.labels-layer').first
    rect=plot.bounding_box();page.mouse.move(rect['x']+rect['width']/2,rect['y']+rect['height']/2);page.wait_for_timeout(100)
    record('pointer tracing preserves cached samples and geometry',page.evaluate('cachedVertices===[...aster.state.plotViews.values()][0].vertices && cachedSamples===[...aster.state.plotViews.values()][0].samples'))
    record('pointer tracing produces an actual numeric tooltip',page.locator('.plot-tooltip:not([hidden])').count()==1)
    before=page.evaluate('[...aster.state.plotViews.values()][0].xrange[1]')
    page.mouse.wheel(0,-150);page.wait_for_timeout(100)
    record('2D wheel zoom changes the mathematical domain',page.evaluate('[...aster.state.plotViews.values()][0].xrange[1]')!=before)
    page.locator('[data-plot-action="fit"]').click();page.wait_for_timeout(100)
    record('fit restores the original domain',page.evaluate('[...aster.state.plotViews.values()][0].xrange[0]===-6 && [...aster.state.plotViews.values()][0].xrange[1]===6'))
    # Edit an actual rendered source cell and execute with Enter.
    first=page.locator('.code-cell').first
    first.locator('.input-math').click()
    first.locator('textarea').fill('expand((x + 2)^3)')
    first.locator('textarea').press('Enter')
    page.wait_for_function('!aster.state.running')
    record('source editing and Enter evaluate a new symbolic result',page.evaluate('aster.state.docs[0].cells.find(c=>c.type==="code").result.plain==="x^3 + 6*x^2 + 12*x + 8"'))
    first.locator('textarea').fill('expand((x + 3)^2)')
    record('editing marks downstream results stale',page.evaluate('aster.state.docs[0].cells.filter(c=>c.type==="code"&&c.result).every(c=>c.stale)'))
    # New empty document, palette insertion, and structural undo/redo.
    page.locator('.tab-add').click()
    page.wait_for_timeout(150)
    page.get_by_role('button',name='Square root',exact=True).click()
    record('palette inserts a selected editable placeholder',page.locator('.code-cell textarea').input_value()=='sqrt(x)')
    page.locator('.code-cell textarea').fill('sqrt(81)')
    page.locator('.code-cell textarea').press('Enter')
    page.wait_for_function('!aster.state.running')
    record('palette-built expression evaluates',page.evaluate('aster.state.docs.find(d=>d.id===aster.state.active).cells[0].result.plain==="9"'))
    old=page.locator('.cell').count()
    page.locator('#ribbon [data-action="add-text"]').click()
    record('editable prose region is inserted',page.locator('.text-content').count()==1)
    page.locator('.quick-tools [data-action="undo"]').click()
    record('document undo restores the preceding structure',page.locator('.cell').count()==old)
    page.locator('.quick-tools [data-action="redo"]').click()
    record('document redo restores the inserted region',page.locator('.text-content').count()==1)
    # Matrix builder: insert into a fresh cell.
    page.locator('.bottom-insert').click()
    page.locator('[data-ribbon="insert"]').click()
    page.locator('#ribbon [data-action="matrix"]').click()
    page.locator('#matrix-rows').fill('2');page.locator('#matrix-rows').dispatch_event('change')
    page.locator('#matrix-cols').fill('2');page.locator('#matrix-cols').dispatch_event('change')
    page.locator('#matrix-identity').click()
    page.locator('#matrix-insert').click()
    active=page.locator('.code-cell.selected textarea')
    record('matrix builder emits parseable matrix source',active.input_value()=='Matrix([[1, 0], [0, 1]])')
    active.press('Enter');page.wait_for_function('!aster.state.running')
    record('matrix output uses native MathML table',page.locator('.code-cell.selected .cell-output mtable').count()==1)
    # Save/import and fixture-backed persistence.
    page.locator('.quick-tools [data-action="save"]').click()
    page.wait_for_function('__downloads.length && __downloads.at(-1).text!==null')
    saved=page.evaluate('__downloads.at(-1).text')
    payload=json.loads(saved)
    record('worksheet export is versioned, source-only JSON',payload['format']=='aster-worksheet' and all('result' not in c for c in payload['document']['cells']))
    payload['document']['title']='Imported verification'
    # Imported output HTML must not be trusted; the importer only reads known source fields.
    payload['document']['cells'][0]['result']={'math':'<img src=x onerror="window.pwned=true">'}
    page.locator('#open-file').set_input_files({'name':'import.aster','mimeType':'application/json','buffer':json.dumps(payload).encode()})
    page.wait_for_function('aster.state.docs.find(d=>d.id===aster.state.active).title==="Imported verification" && !aster.state.running')
    record('import rebuilds all outputs rather than trusting embedded HTML',page.evaluate('!window.pwned && aster.state.docs.find(d=>d.id===aster.state.active).cells[0].result.plain==="9"'))
    page.wait_for_timeout(500)
    storage=page.evaluate('JSON.parse(localStorage.getItem("aster.workspace.v1"))')
    record('autosave writes a versioned editable workspace to the Storage fixture',len(storage['docs'])>=5 and storage['version']==1)
    # Real context operation inserts and evaluates a new dependent expression.
    page.locator('.code-cell').first.locator('.input-math').click()
    page.locator('[data-op="diff"]').click();page.wait_for_function('!aster.state.running')
    record('context derivative creates and evaluates a new cell',page.evaluate('aster.state.docs.find(d=>d.id===aster.state.active).cells.find(c=>c.id===aster.state.selected).result.plain==="0"'))
    # Switch to the surface starter and exercise geometry, slider, orbit, wireframe.
    page.get_by_role('tab',name='Surface studio').click();page.wait_for_function('!aster.state.running');page.wait_for_timeout(700)
    record('surface has 25,088 real triangles',page.evaluate('[...aster.state.plotViews.values()][0].vertexCount/3===25088'))
    stage=page.locator('.labels-layer').first
    box=stage.bounding_box();theta=page.evaluate('[...aster.state.plotViews.values()][0].theta')
    page.mouse.move(box['x']+box['width']/2,box['y']+box['height']/2);page.mouse.down();page.mouse.move(box['x']+box['width']/2+80,box['y']+box['height']/2+30,steps=5);page.mouse.up();page.wait_for_timeout(100)
    record('dragging a 3D view changes its orbit camera',page.evaluate('[...aster.state.plotViews.values()][0].theta')!=theta)
    page.locator('[data-plot-action="wire"]').click();page.wait_for_timeout(250)
    record('wireframe adds independently rendered line geometry',page.evaluate('[...aster.state.plotViews.values()][0].wire && [...aster.state.plotViews.values()][0].lines.length>100000'))
    value=page.evaluate('[...aster.state.plotViews.values()][0].vertices[1]')
    slider=page.locator('input[data-param="0"]');slider.fill('1.8');slider.dispatch_event('input');page.wait_for_timeout(250)
    record('surface parameter changes regenerate real geometry',page.evaluate('[...aster.state.plotViews.values()][0].vertices[1]')!=value)
    page.locator('[data-plot-action="fit"]').click();page.locator('[data-plot-action="wire"]').click();slider.fill('1');slider.dispatch_event('input');page.wait_for_timeout(500)
    page.mouse.move(15,15);page.evaluate('document.querySelector("#toast").hidden=true');page.screenshot(path=str(ROOT/'docs/surface.png'))
    page.locator('[data-plot-action="full"]').click();page.wait_for_timeout(200)
    record('expand control creates a usable full-window plot',page.locator('.plot-fullscreen').count()==1)
    stage.press('Escape');page.wait_for_timeout(100)
    record('Escape exits expanded plot',page.locator('.plot-fullscreen').count()==0)
    # View changes.
    page.locator('.titlebar [data-action="theme"]').click()
    record('theme toggle applies dark design tokens',page.evaluate('document.documentElement.dataset.theme==="dark"'))
    page.wait_for_timeout(250);page.screenshot(path=str(ROOT/'docs/dark.png'))
    page.locator('.titlebar [data-action="theme"]').click()
    page.locator('[data-action="document-mode"]').first.click()
    record('document mode switches the worksheet presentation',page.locator('body.document-mode').count()==1)
    page.locator('[data-action="worksheet-mode"]').first.click()
    page.locator('#input-mode').select_option('source')
    record('source mode exposes real source editors',page.locator('body.source-mode').count()==1)
    page.locator('#input-mode').select_option('math')
    # Search generates and executes an actual command.
    page.keyboard.press('Control+k');page.locator('#command-filter').fill('arithmetic mean');page.locator('.command-item').click();page.wait_for_function('!aster.state.running')
    record('command search inserts and executes a matching command',page.evaluate('aster.state.docs.find(d=>d.id===aster.state.active).cells.find(c=>c.id===aster.state.selected).result.plain==="3"'))
    page.locator('[data-ribbon="view"]').click();page.locator('[data-action="export-html"]').click()
    page.wait_for_function('__downloads.at(-1).text?.includes("<!doctype html>")')
    record('HTML report exports math and rendered plot pixels',page.evaluate('__downloads.at(-1).text.includes("<math") && __downloads.at(-1).text.includes("data:image/png")'))
    page.locator('[data-action="export-latex"]').click();page.wait_for_function('__downloads.at(-1).name.endsWith(".tex") && __downloads.at(-1).text!==null')
    record('LaTeX report contains a complete document',page.evaluate('__downloads.at(-1).text.includes("\\\\documentclass")') or '\\documentclass' in page.evaluate('__downloads.at(-1).text'))
    # Narrow viewport rendering and real error output.
    page.set_viewport_size({'width':390,'height':844});page.wait_for_timeout(250)
    page.screenshot(path=str(ROOT/'docs/mobile.png'))
    record('mobile layout has no page-level horizontal overflow',page.evaluate('document.documentElement.scrollWidth<=innerWidth+1'))
    page.set_viewport_size({'width':1600,'height':1180});page.locator('[data-ribbon="home"]').click()
    page.locator('.bottom-insert').click();active=page.locator('.code-cell.selected textarea');active.fill('1 / 0');active.press('Enter');page.wait_for_function('!aster.state.running')
    record('invalid calculations produce visible recoverable errors',page.locator('.code-cell.selected .output-error').count()==1)
    # All example documents are real computations.
    for key in ['calculus','dynamics','linear']:
        page.evaluate('(key)=>aster.newExample(key)',key);page.wait_for_function('!aster.state.running');
        record('starter worksheet evaluates: '+key,page.evaluate('!aster.state.docs.find(d=>d.id===aster.state.active).cells.some(c=>c.result?.kind==="error")'))
    record('no unhandled browser JavaScript errors',not errors)
    result={'passed':len(checks),'failed':0,'checks':checks,'browser_errors':errors,'environment':{'browser':browser.version,'origin':'about:blank (navigation policy blocks all URLs)','render_backend':'Canvas 2D','storage':'explicit in-memory Storage fixture','downloads':'captured Blob fixture','webgpu_adapter_tested':False}}
    (ROOT/'docs/browser-test-results.json').write_text(json.dumps(result,indent=2))
    print(json.dumps({'passed':len(checks),'errors':errors}))
    browser.close()
