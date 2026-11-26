/** Build lib/client.js: inline WEAVE_HTML + mapping + definitions into the ModuleLoader bundle. */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = here
const htmlPath = path.resolve(root, '..', 'weave-embed', 'dist', 'weave-runtime.mjs')
const FALLBACK_HTML = '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><style>html,body{margin:0;height:100%;background:#f1ead9;color:#1c1914;font:13px/1.6 system-ui,sans-serif;display:flex;align-items:center;justify-content:center}body[data-theme=dark]{background:#14110d;color:#efe6d6}</style></head><body><div>Weave runtime 尚未构建：运行 <code>node weave-embed/build.mjs</code>。</div><script>window.addEventListener("message",function(e){var m=e.data||{};if(m.type==="weave:theme")document.body.dataset.theme=m.theme;if(m.type==="weave:init"||m.type==="weave:update")window.__last=m.data;});parent.postMessage({type:"weave:ready",version:"fallback"},"*");</script></body></html>'

let html = FALLBACK_HTML
try {
  const mod = await import(pathToFileURL(htmlPath).href)
  if (typeof mod.WEAVE_HTML === 'string' && mod.WEAVE_HTML.length > 0) html = mod.WEAVE_HTML
  console.log('weave build: using', htmlPath, '(', html.length, 'chars )')
} catch (error) {
  console.warn('weave build: fallback runtime (embed not built yet):', error.message)
}

const readSource = (file) => fs.readFileSync(path.join(root, 'src', file), 'utf8').replace(/^export\s+/gm, '')
const mapping = readSource('mapping.mjs')
const definitions = readSource('definitions.mjs')
const template = fs.readFileSync(path.join(root, 'src', 'client.template.js'), 'utf8')
const body = template.split('__WEAVE_HTML__').join(JSON.stringify(html))
const wrapper = 'window.__ModuleLoader__.load({id:"dsh-client-ui-weave",factory:require=>{var module={exports:{}};var exports=module.exports;Object.defineProperty(exports,Symbol.toStringTag,{value:"Module"});\n'
const wrapped = wrapper + mapping + '\n' + definitions + '\n' + body + '\nreturn module.exports;}});\n'
fs.mkdirSync(path.join(root, 'lib'), { recursive: true })
fs.writeFileSync(path.join(root, 'lib', 'client.js'), wrapped)
console.log('weave build: wrote lib/client.js (', wrapped.length, 'chars )')
