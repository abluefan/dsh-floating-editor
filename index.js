// dsh-floating-editor host half（静态插件，随 dsh web 常驻）
//
// 职责：给浏览器的浮窗提供一组同源 HTTP API。
//   GET  /floating-editor/api/read?path=…        读文本文件
//   POST /floating-editor/api/save                { path, text } 原子写回
//   GET  /floating-editor/api/list?dir=…          列目录
//   GET  /floating-editor/api/fonts               注册表枚举系统字体 + 安装时间排序
//   POST /floating-editor/api/pick                弹 Windows 原生选文件框
//   POST /floating-editor/api/open-external       用 Notepad++ 打开
//
// 文件读写走 ctx.fs 服务（不是 node:fs），所以仍然受 DSH 沙箱约束。
// ⚠ 写入时必须带上调用方 session 的策略：fs 后端在缺少 policy 时会退回
//   「DSH 进程的 cwd」当 workspace 根，于是工作区内的文件也会被判越界
//   （表现为 cannot write … file access denied under workspace-write mode）。
//   这里遍历活 session，挑出 workspace 根包含目标文件的那一个，用它的策略。
//
// 客户端半边：lib/client.js（window.__ModuleLoader__ 壳的 lazy-CJS）。

import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

/** 本插件包目录（由本文件位置推算）。 */
const PKG_DIR = dirname(fileURLToPath(import.meta.url))

export const name = 'dsh-floating-editor'

/** 只需要 webServer 来注册路由；fs / subprocess / sessions 都按可选服务取用。 */
export const inject = ['webServer', 'connection']

/** Notepad++ 的安装路径。 */
const NOTEPAD = 'C:\\Program Files\\Notepad++\\notepad++.exe'

/** 枚举字体用的 PowerShell。 */
const POWERSHELL = 'powershell.exe'

/** 字段分隔符：注册表值名与安装时间之间用它分隔，避开制表符在各种管道里的折叠。 */
const SEP = String.fromCharCode(1)

/**
 * 单个目录列出的条目上限。
 * ⚠ 目录可能是 node_modules / System32 这种几十万条目的东西 —— 不截断的话
 *   前端会渲染几万个节点直接卡死。超限时只给前 N 条并回报总数。
 */
const ENTRY_LIMIT = 2000

/** HTTP API 的路径前缀，用于从请求地址里切出方法名。 */
const API_PREFIX = '/floating-editor/api/'

/**
 * 注册路由用的前缀。
 * ⚠ 不能带尾斜杠：webServer 的 prefix 匹配看的是「请求路径是否以这个字符串开头」，
 *   写成 '/floating-editor/api/' 会让所有请求都落空（2026-09-26 实测过）。
 */
const API_ROUTE = '/floating-editor'

/**
 * 插件自己的设置文件。
 * ⚠ 绝对路径指向**源码目录**，不是 node_modules 里那份副本 ——
 *   副本会被 pnpm 重装清掉，源码目录才是能看见、能备份的地方。
 * 设置跟着插件走，不再受浏览器 origin／清缓存／换端口影响。
 */
const SETTINGS_PATH = join(PKG_DIR, 'settings.json')

/**
 * 静态资源目录（今天的用途：CM6 编辑器内核 bundle）。
 * ⚠ 同样指向【源码目录】—— 理由同 SETTINGS_PATH：node_modules 里那份副本
 *   会被 pnpm reinstall 清掉，源码目录才是能看见、能备份的地方。
 * 走 /floating-editor/api/vendor?name=… 同一条路由、同一道信任栅栏，
 * 只是响应体换成 JS 而不是 JSON（见下面的特判）。
 */
const VENDOR_DIR = join(PKG_DIR, 'lib', 'vendor')

/**
 * 把任意抛出物变成一句可读的错误文本。
 * @param error - 捕获到的异常。
 * @returns 错误消息，或异常本身的字符串形式。
 */
function messageOf(error) {
  return String(error && error.message ? error.message : error)
}

/**
 * 把路径统一成小写、正斜杠的形式，用于包含判断。
 * @param value - 待规范化的路径。
 * @returns 规范化结果。
 */
function normalizePath(value) {
  let text = String(value).split('\\').join('/').toLowerCase()
  while (text.length > 1 && text.charAt(text.length - 1) === '/') text = text.slice(0, -1)
  return text
}

/**
 * 安装插件。
 * @param ctx - host cordis context。
 */
export function apply(ctx) {
  console.log('[dsh-floating-editor] host half: apply() 开始')

  /**
   * 跑一段 PowerShell 并收集输出。
   * @param script - 单行脚本（用 '; ' 串联语句）。
   * @param maxBytes - stdout 上限。
   * @returns 退出码、stdout 文本与前 300 字符的 stderr。
   */
  async function runPowerShell(script, maxBytes) {
    const subprocess = ctx.get('subprocess')
    if (subprocess === undefined) throw new Error('subprocess 服务不可用')
    const handle = subprocess.spawn({
      argv: [POWERSHELL, '-STA', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script],
      cwd: 'C:\\',
      stdio: {
        stdin: 'ignore',
        stdout: { maxBytes: maxBytes },
        stderr: { maxBytes: 4096 },
      },
      graceMs: 180000,
    })
    const outcome = await handle.done
    const reader = handle.collected.stdout
    const errorReader = handle.collected.stderr
    return {
      exitCode: outcome.exitCode,
      text: reader === undefined ? '' : reader.readFrom(0).text,
      error: errorReader === undefined ? '' : errorReader.readFrom(0).text.slice(0, 300),
    }
  }

  /**
   * 挑一个「workspace 根包含目标文件」的活 session 策略。
   * 找不到就返回 undefined —— 那时写入会退回后端默认策略并被沙箱拒绝，这是预期行为。
   * 另外，若传了 extraRoots（客户端「根目录可写」开关打开时给的根列表），
   * 目标落在其中某个根之下时，就用「该根 + session 原本的模式」放行 ——
   * 这仍然走 workspace-write，只是把边界换成用户主动加的那个目录（不是绕过沙箱）。
   * @param targetPath - 已被 fs 解析过的目标显示路径。
   * @param extraRoots - 可选的额外可写根（用户在浮窗里主动加的）。
   * @returns 该 session 的沙箱策略，或 undefined。
   */
  function policyForPath(targetPath, extraRoots) {
    const sessions = ctx.get('sessions')
    const policyService = ctx.get('sandboxPolicy')
    if (sessions === undefined || policyService === undefined) return undefined
    let list = []
    try {
      list = sessions.list()
    } catch (error) {
      return undefined
    }
    const wanted = normalizePath(targetPath)
    for (const session of list) {
      let policy = undefined
      try {
        policy = policyService.resolve({ session: session })
      } catch (error) {
        continue
      }
      if (policy === undefined || typeof policy.workspaceRoot !== 'string') continue
      const root = normalizePath(policy.workspaceRoot)
      if (wanted === root || wanted.indexOf(root + '/') === 0) return policy
    }
    // 额外可写根：沿用 session 原本的模式（read-only 依旧 read-only），只把 workspaceRoot 换成该根。
    if (Array.isArray(extraRoots) && extraRoots.length > 0) {
      let mode = undefined
      for (const session of list) {
        try {
          const p = policyService.resolve({ session: session })
          if (p !== undefined && typeof p.mode === 'string') {
            mode = p.mode
            break
          }
        } catch (error) {
          continue
        }
      }
      if (mode !== undefined && mode !== 'read-only') {
        for (const raw of extraRoots) {
          const candidate = normalizePath(raw)
          if (candidate.length === 0) continue
          if (wanted === candidate || wanted.indexOf(candidate + '/') === 0) {
            return { mode: mode, workspaceRoot: String(raw) }
          }
        }
      }
    }
    return undefined
  }

  /** 每个 API 名的实现；统一返回可 JSON 化的对象。 */
  const handlers = {
    /**
     * 读一个文本文件。
     * @param args - { path }。
     * @returns { ok, text, display, size } 或 { ok:false, error }。
     */
    async read(args) {
      const fs = ctx.get('fs')
      if (fs === undefined) return { ok: false, error: 'fs 服务不可用' }
      try {
        const target = await fs.resolve(args.path)
        const info = await fs.stat(target)
        if (info === undefined) return { ok: false, error: '文件不存在：' + args.path }
        if (info.type !== 'file') return { ok: false, error: '不是普通文件：' + args.path }
        const text = await fs.readText(target)
        return { ok: true, text: text, display: target.displayPath, size: text.length, version: String(info.version) }
      } catch (error) {
        return { ok: false, error: messageOf(error) }
      }
    },

    /**
     * 原子写回一个文本文件。
     * @param args - { path, text }。
     * @returns { ok, operation, display, policy } 或 { ok:false, error }。
     */
    async save(args) {
      const fs = ctx.get('fs')
      if (fs === undefined) return { ok: false, error: 'fs 服务不可用' }
      try {
        const target = await fs.resolve(args.path)
        const policy = policyForPath(target.displayPath, args.roots)
        const outcome = await fs.writeText(target, args.text, undefined, undefined, policy)
        return {
          ok: true,
          operation: outcome.operation,
          display: target.displayPath,
          policy: policy === undefined ? '默认' : policy.mode,
          version: String(outcome.version),
        }
      } catch (error) {
        return { ok: false, error: messageOf(error) }
      }
    },

    /**
     * 只看文件版本（轻量轮询用）。
     * 外部程序改了文件内容，version 就会变 —— 客户端靠它发现「文件被外部修改」。
     * @param args - { path }。
     * @returns { ok, version, size } 或 { ok:false, error }。
     */
    async stat(args) {
      const fs = ctx.get('fs')
      if (fs === undefined) return { ok: false, error: 'fs 服务不可用' }
      try {
        const target = await fs.resolve(args.path)
        const info = await fs.stat(target)
        if (info === undefined) return { ok: false, error: '文件不存在：' + args.path }
        return {
          ok: true,
          version: String(info.version),
          size: info.size === undefined ? null : info.size,
        }
      } catch (error) {
        return { ok: false, error: messageOf(error) }
      }
    },

    /**
     * 列一个目录的直接子项。
     * @param args - { dir }。
     * @returns { ok, dir, entries } 或 { ok:false, error }。
     */
    async list(args) {
      const fs = ctx.get('fs')
      if (fs === undefined) return { ok: false, error: 'fs 服务不可用' }
      try {
        const target = await fs.resolve(args.dir)
        const info = await fs.stat(target)
        if (info === undefined) return { ok: false, error: '目录不存在：' + args.dir }
        if (info.type !== 'directory') return { ok: false, error: '不是目录：' + args.dir }
        const listing = await fs.listDir(target)
        const total = listing.length
        // 目录优先、再按名字排序，然后截断。
        const sorted = listing.slice().sort((left, right) => {
          const da = left.type === 'directory' ? 0 : 1
          const db = right.type === 'directory' ? 0 : 1
          if (da !== db) return da - db
          return left.name.localeCompare(right.name)
        })
        const limited = sorted.length > ENTRY_LIMIT ? sorted.slice(0, ENTRY_LIMIT) : sorted
        const entries = limited.map((entry) => ({ name: entry.name, type: entry.type }))
        return {
          ok: true,
          dir: target.displayPath,
          entries: entries,
          total: total,
          truncated: total > ENTRY_LIMIT,
        }
      } catch (error) {
        return { ok: false, error: messageOf(error) }
      }
    },

    /**
     * 枚举系统字体：读注册表拿本地化名，按字体文件创建时间新→旧排序。
     * 清洗规则：去掉 "(TrueType)" 一类后缀；"A & B" 取主名。
     * @returns { ok, fonts } 或 { ok:false, error }。
     */
    async fonts() {
      const script = [
        "$dir = 'C:\\Windows\\Fonts'",
        '$times = @{}',
        'Get-ChildItem $dir -File -ErrorAction SilentlyContinue | ForEach-Object { $times[$_.Name] = $_.CreationTimeUtc.Ticks }',
        "$key = 'HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts'",
        '(Get-ItemProperty $key).PSObject.Properties | Where-Object { $_.Name -notlike "PS*" } | ForEach-Object { $n = [string]$_.Name; $f = [string]$_.Value; $leaf = Split-Path $f -Leaf; $t = 0; if ($times.ContainsKey($leaf)) { $t = $times[$leaf] }; $n + [char]1 + $t }',
      ].join('; ')
      try {
        const result = await runPowerShell(script, 262144)
        const items = []
        const seen = {}
        const lines = result.text.split('\n')
        for (const line of lines) {
          const raw = line.split('\r').join('')
          if (raw.trim().length === 0) continue
          const parts = raw.split(SEP)
          let label = parts[0].trim()
          const ticks = parts.length >= 2 ? Number(parts[1].trim()) : 0
          label = label.replace(/\s*\((TrueType|OpenType|All res|VGA res|Type 1|Bitmap)\)\s*$/i, '').trim()
          if (label.indexOf('&') >= 0) label = label.slice(0, label.indexOf('&')).trim()
          if (label.length === 0) continue
          if (seen[label] === true) continue
          seen[label] = true
          items.push({ name: label, at: Number.isFinite(ticks) ? ticks : 0 })
        }
        items.sort((left, right) => right.at - left.at || left.name.localeCompare(right.name))
        if (items.length === 0) return { ok: false, error: '未枚举到字体（exit ' + result.exitCode + '）' + result.error }
        return { ok: true, fonts: items.map((item) => item.name) }
      } catch (error) {
        return { ok: false, error: messageOf(error) }
      }
    },

    /**
     * 弹 Windows 原生选目录对话框（给「＋ 添加文件夹」用）。
     * @returns { ok, path } / { ok:false, cancelled:true } / { ok:false, error }。
     */
    async 'pick-dir'() {
      const script = [
        '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
        'Add-Type -AssemblyName System.Windows.Forms | Out-Null',
        '$dialog = New-Object System.Windows.Forms.FolderBrowserDialog',
        "$dialog.Description = '选择要加入工作区的文件夹'",
        '$dialog.ShowNewFolderButton = $true',
        'if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { Write-Output $dialog.SelectedPath }',
      ].join('; ')
      try {
        const result = await runPowerShell(script, 65536)
        const picked = result.text.split('\r').join('').split('\n').join('').trim()
        if (picked.length === 0) {
          if (result.exitCode === 0) return { ok: false, cancelled: true }
          return { ok: false, error: '目录对话框退出码 ' + result.exitCode + ' ' + result.error }
        }
        return { ok: true, path: picked }
      } catch (error) {
        return { ok: false, error: messageOf(error) }
      }
    },

    /**
     * 弹 Windows 原生选文件对话框（阻塞到用户选完）。
     * @returns { ok, path } / { ok:false, cancelled:true } / { ok:false, error }。
     */
    async pick() {
      const script = [
        '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
        'Add-Type -AssemblyName System.Windows.Forms | Out-Null',
        '$dialog = New-Object System.Windows.Forms.OpenFileDialog',
        "$dialog.Filter = '所有文件 (*.*)|*.*'",
        '$dialog.Title = 选择要编辑的文件',
        'if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { Write-Output $dialog.FileName }',
      ].join('; ')
      try {
        const result = await runPowerShell(script, 65536)
        const picked = result.text.split('\r').join('').split('\n').join('').trim()
        if (picked.length === 0) {
          if (result.exitCode === 0) return { ok: false, cancelled: true }
          return { ok: false, error: '对话框进程退出码 ' + result.exitCode + ' ' + result.error }
        }
        return { ok: true, path: picked }
      } catch (error) {
        return { ok: false, error: messageOf(error) }
      }
    },

    /**
     * 用 Notepad++ 打开文件（外部进程自己读写，不受本插件沙箱约束）。
     * @param args - { path }。
     * @returns { ok, path } 或 { ok:false, error }。
     */
    async 'open-external'(args) {
      const fs = ctx.get('fs')
      const subprocess = ctx.get('subprocess')
      if (fs === undefined) return { ok: false, error: 'fs 服务不可用' }
      if (subprocess === undefined) return { ok: false, error: 'subprocess 服务不可用' }
      try {
        const target = await fs.resolve(args.path)
        const processPath = fs.processPath(target)
        const cut = Math.max(processPath.lastIndexOf('\\'), processPath.lastIndexOf('/'))
        const cwd = cut > 0 ? processPath.slice(0, cut) : processPath
        subprocess.spawn({
          argv: [NOTEPAD, processPath],
          cwd: cwd,
          stdio: { stdin: 'ignore', stdout: 'inherit', stderr: 'inherit' },
          graceMs: 5000,
        })
        return { ok: true, path: processPath }
      } catch (error) {
        return { ok: false, error: messageOf(error) }
      }
    },

    /**
     * 在文件管理器里定位一个路径（Windows 的 explorer /select）。
     * @param args - { path }。
     * @returns { ok, path } 或 { ok:false, error }。
     */
    async reveal(args) {
      const fs = ctx.get('fs')
      const subprocess = ctx.get('subprocess')
      if (fs === undefined) return { ok: false, error: 'fs 服务不可用' }
      if (subprocess === undefined) return { ok: false, error: 'subprocess 服务不可用' }
      try {
        const target = await fs.resolve(args.path)
        const processPath = fs.processPath(target)
        const cut = Math.max(processPath.lastIndexOf('\\'), processPath.lastIndexOf('/'))
        const cwd = cut > 0 ? processPath.slice(0, cut) : processPath
        // explorer /select,<path> —— 路径含空格时靠 Node 的 argv 数组形式加引号
        subprocess.spawn({
          argv: ['explorer.exe', '/select,' + processPath],
          cwd: cwd,
          stdio: { stdin: 'ignore', stdout: 'ignore', stderr: 'ignore' },
          graceMs: 5000,
        })
        return { ok: true, path: processPath }
      } catch (error) {
        return { ok: false, error: messageOf(error) }
      }
    },

    /**
     * 在命令行里打开一个目录（独立 cmd 窗口跑 cd /d）。
     * @param args - { dir }。
     * @returns { ok, path } 或 { ok:false, error }。
     */
    async 'open-terminal'(args) {
      const fs = ctx.get('fs')
      const subprocess = ctx.get('subprocess')
      if (fs === undefined) return { ok: false, error: 'fs 服务不可用' }
      if (subprocess === undefined) return { ok: false, error: 'subprocess 服务不可用' }
      try {
        const target = await fs.resolve(args.dir)
        const processPath = fs.processPath(target)
        if (processPath === undefined || processPath === null || String(processPath).length === 0) {
          return { ok: false, error: '取不到真实路径' }
        }
        // ⚠ 不要写成 `cmd /c start <窗口标题> cmd …`：`start` 只把【带引号】的
        //   第一个参数当窗口标题；不带引号时它会拿那个词当**程序名**去找，
        //   于是报「Windows 找不到文件 '<窗口标题>'」。
        //   这里改走 PowerShell 的 Start-Process：没有标题这回事，
        //   而且能确实开出一个新窗口（直接 spawn cmd 会继承父进程控制台，
        //   不一定弹窗）。
        const dirLiteral = "'" + String(processPath).replace(/'/g, "''") + "'"
        subprocess.spawn({
          argv: ['powershell.exe', '-NoProfile', '-NonInteractive', '-Command',
            'Start-Process cmd.exe -WorkingDirectory ' + dirLiteral],
          cwd: processPath,
          stdio: { stdin: 'ignore', stdout: 'inherit', stderr: 'inherit' },
          graceMs: 8000,
        })
        return { ok: true, path: processPath }
      } catch (error) {
        return { ok: false, error: messageOf(error) }
      }
    },

    /**
     * 读插件设置文件。文件还没建立时返回 settings:null，前端照默认值走。
     * @returns { ok, settings } 或 { ok:false, error }。
     */
    async 'get-settings'() {
      const fs = ctx.get('fs')
      if (fs === undefined) return { ok: false, error: 'fs 服务不可用' }
      try {
        const target = await fs.resolve(SETTINGS_PATH)
        const info = await fs.stat(target)
        if (info === undefined) return { ok: true, settings: null }
        const text = await fs.readText(target)
        let parsed = null
        try { parsed = JSON.parse(text) } catch (error) { parsed = null }
        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
          return { ok: true, settings: null, note: '设置文件内容唔係对象，已忽略' }
        }
        return { ok: true, settings: parsed }
      } catch (error) {
        return { ok: false, error: messageOf(error) }
      }
    },

    /**
     * 写插件设置文件（整份覆盖，缩进 2 空格 —— 方便用户直接打开手改）。
     * @param args - { settings, extraRoots }。
     * @returns { ok, path } 或 { ok:false, error }。
     */
    async 'set-settings'(args) {
      const fs = ctx.get('fs')
      if (fs === undefined) return { ok: false, error: 'fs 服务不可用' }
      try {
        const target = await fs.resolve(SETTINGS_PATH)
        const policy = policyForPath(target.displayPath, args.extraRoots)
        const raw = args.settings === undefined || args.settings === null ? {} : args.settings
        const text = JSON.stringify(raw, null, 2) + '\n'
        await fs.writeText(target, text, undefined, undefined, policy)
        return { ok: true, path: target.displayPath }
      } catch (error) {
        return { ok: false, error: messageOf(error) }
      }
    },
  }

  /**
   * 读出请求体并解析成 JSON 对象；解析不出就当空对象。
   * @param req - 进来的 HTTP 请求。
   * @returns 解析后的参数对象。
   */
  async function readBody(req) {
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    const text = Buffer.concat(chunks).toString('utf8').trim()
    if (text.length === 0) return {}
    try {
      const parsed = JSON.parse(text)
      return parsed !== null && typeof parsed === 'object' ? parsed : {}
    } catch (error) {
      return {}
    }
  }

  /**
   * 把查询串摊平成参数对象（GET 用）。
   * @param url - 含查询串的请求地址。
   * @returns 参数对象。
   */
  function readQuery(url) {
    const args = {}
    const cut = url.indexOf('?')
    if (cut < 0) return args
    const params = new URLSearchParams(url.slice(cut + 1))
    for (const pair of params) args[pair[0]] = pair[1]
    return args
  }

  ctx.effect(() => {
    console.log('[dsh-floating-editor] 正在注册 HTTP 路由 ' + API_ROUTE
      + '（注册路径【不带】尾斜杠；API_PREFIX ' + API_PREFIX + ' 只用于切方法名）')
    // —— 浏览器信任栅栏 ——
    // 本机上的任何网页都能 fetch 到 127.0.0.1:<端口> 的自定义路由。若不校验，
    // 一个恶意页面就能借 /floating-editor/api/* 读写你的文件。
    // connection.requestRejection(req) 会拒掉 Host/Origin 伪造（DNS 重绑定）
    // 和未认证的请求 —— 官方插件在自定义路由里都会先过一遍这道栅栏。
    // 做法与 dsh-whale-widget 一致（它注释里标了「对应 issue #92」）。
    const rejected = (req, res) => {
      try {
        const conn = ctx.get('connection')
        if (conn === undefined || typeof conn.requestRejection !== 'function') {
          // fail-open：栅栏不可用时放行，但记一条 warn，免得静默失效。
          if (rejected.warned !== true) {
            rejected.warned = true
            console.warn('[dsh-floating-editor] 信任栅栏不可用：connection 服务缺失，自定义路由将放行')
          }
          return false
        }
        const code = conn.requestRejection(req)
        if (code === undefined || code === null || code === false) return false
        res.statusCode = typeof code === 'number' ? code : 403
        res.end()
        return true
      } catch (error) {
        return false
      }
    }

    const disposer = ctx.webServer.register({
      kind: 'prefix',
      path: API_ROUTE,
      handler: async (req, res) => {
        if (rejected(req, res)) return
        const url = String(req.url === undefined ? '' : req.url)
        const bare = url.split('?')[0]
        const method = bare.slice(API_PREFIX.length)
        // ── 静态资源：编辑器内核 bundle ──────────────────────────────
        // 复用同一条路由 + 同一道信任栅栏，只把响应体换成 JS。
        // ⚠ 文件名白名单只放行 [A-Za-z0-9._-]，从物理上堵死 ../ 目录穿越。
        if (method === 'vendor') {
          const query = readQuery(url)
          const name = query.name === undefined ? '' : String(query.name)
          if (!/^[A-Za-z0-9._-]+$/.test(name)) {
            res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' })
            res.end('bad vendor name')
            return
          }
          try {
            const nodeFs = await import('node:fs/promises')
            const data = await nodeFs.readFile(VENDOR_DIR + '\\' + name)
            res.writeHead(200, {
              'content-type': name.slice(-4) === '.css'
                ? 'text/css; charset=utf-8'
                : 'text/javascript; charset=utf-8',
              'cache-control': 'no-cache',
            })
            res.end(data)
          } catch (error) {
            res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
            res.end('vendor not found: ' + name)
          }
          return
        }

        const fn = handlers[method]
        const send = (payload) => {
          res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify(payload))
        }
        if (fn === undefined) {
          res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
          res.end('unknown api: ' + method)
          return
        }
        const args = req.method === 'POST' ? await readBody(req) : readQuery(url)
        let result
        try {
          result = await fn(args)
        } catch (error) {
          result = { ok: false, error: messageOf(error) }
        }
        send(result)
      },
    })
    console.log('[dsh-floating-editor] HTTP 路由注册成功，disposer=' + typeof disposer)
    return disposer
  }, 'dsh-floating-editor: http api')

  console.log('[dsh-floating-editor] host half: apply() 结束')
}
