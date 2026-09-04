import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'dist');
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

const special = {
  'react': path.join(root,'node_modules/react/index.js'),
  'react/jsx-runtime': path.join(root,'node_modules/react/jsx-runtime.js'),
  'react/jsx-dev-runtime': path.join(root,'node_modules/react/jsx-dev-runtime.js'),
  'react-dom': path.join(root,'node_modules/react-dom/index.js'),
  'react-dom/client': path.join(root,'node_modules/react-dom/client.js'),
  'lucide-react': path.join(root,'node_modules/lucide-react/dist/umd/lucide-react.js'),
  'qrcode': path.join(root,'node_modules/qrcode/lib/browser.js'),
  'dijkstrajs': path.join(root,'node_modules/dijkstrajs/dijkstra.js')
};
const extensions = ['','.ts','.tsx','.js','.jsx','.mjs','.cjs','.json','/index.ts','/index.tsx','/index.js','/index.jsx'];
const modules=[]; const ids=new Map();

function tryFile(base){
  for(const ext of extensions){const f=base+ext;try{if(fs.statSync(f).isFile())return fs.realpathSync(f)}catch{}}
  return null;
}
function resolveRequest(req, from){
  if(req.endsWith('.css')) return tryFile(path.resolve(path.dirname(from),req));
  if(req.startsWith('.')||req.startsWith('/')){
    const f=tryFile(path.resolve(path.dirname(from),req)); if(!f)throw new Error(`Cannot resolve ${req} from ${from}`); return f;
  }
  if(special[req]) return fs.realpathSync(special[req]);
  const parts=req.split('/'); const pkg=req.startsWith('@')?parts.slice(0,2).join('/'):parts[0]; const sub=req.slice(pkg.length).replace(/^\//,'');
  const dir=path.join(root,'node_modules',pkg);
  if(sub){const f=tryFile(path.join(dir,sub));if(f)return f;}
  let meta={};try{meta=JSON.parse(fs.readFileSync(path.join(dir,'package.json'),'utf8'))}catch{}
  let entry=meta.browser&&typeof meta.browser==='string'?meta.browser:(meta.main||meta.module||'index.js');
  if(meta.browser&&typeof meta.browser==='object'&&meta.browser['./'+entry])entry=meta.browser['./'+entry];
  const f=tryFile(path.join(dir,entry)); if(f)return f;
  const fallback=tryFile(path.join(dir,'index')); if(fallback)return fallback;
  throw new Error(`Cannot resolve package ${req} from ${from}`);
}
function addModule(file){
  file=fs.realpathSync(file); if(ids.has(file))return ids.get(file);
  const id=modules.length; ids.set(file,id); modules.push({id,file,code:''});
  let code='';
  if(file.endsWith('.json')) code='module.exports = '+fs.readFileSync(file,'utf8')+';';
  else if(file.endsWith('.css')) code='module.exports = {};';
  else {
    code=fs.readFileSync(file,'utf8').replace(/^\uFEFF/,'');
    if(/\.(ts|tsx|jsx|mjs)$/.test(file)){
      code=ts.transpileModule(code,{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true,allowSyntheticDefaultImports:true,resolveJsonModule:true},fileName:file}).outputText;
    }
  }
  const requires=[]; const re=/require\(\s*['"]([^'"]+)['"]\s*\)/g; let m;
  while((m=re.exec(code)))requires.push(m[1]);
  const mapping=new Map();
  for(const req of [...new Set(requires)]) mapping.set(req,addModule(resolveRequest(req,file)));
  code=code.replace(re,(all,req)=>`__require(${mapping.get(req)})`);
  modules[id].code=code; return id;
}
const entry=addModule(path.join(root,'src/main.tsx'));
const bundle=`(function(){\n'use strict';\nvar process={env:{NODE_ENV:'production'}};\nvar global=globalThis;\nvar __modules={\n${modules.map(m=>`${m.id}:function(module,exports,__require){\n${m.code}\n}`).join(',\n')}\n};\nvar __cache={};\nfunction __require(id){if(__cache[id])return __cache[id].exports;var module=__cache[id]={exports:{}};__modules[id](module,module.exports,__require);return module.exports;}\n__require(${entry});\n})();\n`;
fs.writeFileSync(path.join(outDir,'app.js'),bundle);
fs.copyFileSync(path.join(root,'src/styles.css'),path.join(outDir,'styles.css'));
const buildVersion = Date.now().toString(36);
fs.writeFileSync(path.join(outDir,'index.html'),`<!doctype html><html lang="th"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#0f1f3d"><title>Factory Asset Management</title><link rel="stylesheet" href="/styles.css?v=${buildVersion}"></head><body><div id="root"></div><script src="/app.js?v=${buildVersion}"></script></body></html>`);
console.log(`Built ${modules.length} modules -> dist/app.js (${Math.round(bundle.length/1024)} KB)`);
