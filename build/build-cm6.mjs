// 重新打包 CM6 bundle。
//
// 跑法（在插件根目录）：
//   node build/build-cm6.mjs
//
// 产出：lib/vendor/cm6.bundle.js（IIFE，window.CM6）
//
// ⚠ 只有改了 build/cm6-entry.js 或者升级了 @codemirror/* 才需要跑；
//   日常改 lib/client.js（浮窗 UI）完全不用重新打包。
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const outfile = path.join(root, 'lib', 'vendor', 'cm6.bundle.js')

await build({
  entryPoints: [path.join(here, 'cm6-entry.js')],
  bundle: true,
  format: 'iife',
  globalName: 'CM6',
  minify: true,
  target: ['chrome120'],
  legalComments: 'none',
  outfile: outfile,
})

const size = fs.statSync(outfile).size
console.log('built ' + outfile + '  (' + Math.round(size / 1024) + ' KB)')
