/** Zero-dependency bundler for this project's small, named-import ES module graph.
 * It is deliberately not a general JavaScript bundler. Source modules remain the
 * canonical development artifacts; the output is a portable single-file app.
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.dirname(fileURLToPath(import.meta.url));
function bundle(entry){
  const done=new Set(),pieces=['const __asterModules=Object.create(null);'];
  function visit(file){
    if(done.has(file))return;done.add(file);
    let code=fs.readFileSync(path.join(root,file),'utf8');
    code=code.replace(/^import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"];?/gm,(_,names,relative)=>{
      const target=path.posix.normalize(path.posix.join(path.posix.dirname(file),relative));visit(target);
      return `const {${names}}=__asterModules[${JSON.stringify(target)}];`;
    });
    const exports=[...code.matchAll(/\bexport\s+(?:const|let|class|function)\s+(\w+)/g)].map(m=>m[1]);
    if(file.endsWith('ast.js'))exports.push('ONE','NEG');
    code=code.replace(/\bexport\s+(?=(?:const|let|class|function)\b)/g,'').replaceAll('import.meta.url',JSON.stringify('file:///aster/js/app.js'));
    pieces.push(`__asterModules[${JSON.stringify(file)}]=(()=>{\n${code}\nreturn {${[...new Set(exports)].join(',')}};\n})();`);
  }
  visit(entry);return '(()=>{\n'+pieces.join('\n')+'\n})();';
}
const worker=bundle('js/worker.js'),main=bundle('js/app.js');
let html=fs.readFileSync(path.join(root,'index.html'),'utf8');
html=html.replace('<link rel="stylesheet" href="styles.css">','<style>\n'+fs.readFileSync(path.join(root,'styles.css'),'utf8')+'\n</style>');
const script='globalThis.ASTER_WORKER_SOURCE='+JSON.stringify(worker)+';\n'+main;
html=html.replace('<script type="module" src="js/app.js"></script>',()=>'<script>\n'+script.replace(/<\/script/gi,'<\\/script')+'\n</script>');
fs.mkdirSync(path.join(root,'dist'),{recursive:true});fs.writeFileSync(path.join(root,'dist/index.html'),html);
console.log(`Built dist/index.html (${(Buffer.byteLength(html)/1024).toFixed(1)} KiB), no external assets.`);
