// dsh-floating-editor client half（静态插件，随 dsh web 常驻）
//
// 在 shell.overlay 注册一个可拖动、可调透明度/字体的浮窗文本编辑器。
//   · 同源 HTTP API：/floating-editor/api/{read,save,list,fonts,pick,open-external}
//   · 样式：静态插件没有动态插件的 styles.insert 服务，自己维护一个 <style> 元素
//   · 计时：静态插件直接用 setTimeout
//
// 格式说明：这就是 tsdown 产出的 lazy-CJS 约定 —— 外层 window.__ModuleLoader__ 壳，
// factory 里普通模块代码；require('react') 拿的是 baseline external
// （React / Cordis / client-store / ui-primitives / ui-slots / ui-dockkit），
// 不需要声明 dsh.client.external。
//
// ⚠ shell.overlay 这一层本身是 click-through（pointer-events: none），
//   所以浮窗容器必须自己声明 pointer-events: auto，否则整个浮窗点不到。

window.__ModuleLoader__.load({
  id: 'dsh-floating-editor',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    const React = require('react')
    const h = React.createElement

    /** HTTP API 前缀，与 host 半边保持一致。 */
    const API = '/floating-editor/api/'

    /** 自己维护的 <style> 元素 id。 */
    const STYLE_ID = 'dsh-floating-editor-style'

    const CSS = [
      '.fe-editor-win{position:fixed;display:flex;flex-direction:column;border-radius:10px 0 10px 10px;',
      'overflow:hidden;box-shadow:0 0 0 1px rgba(150,150,160,.28),0 14px 44px rgba(0,0,0,.5);',
      'color:var(--fe-fg,#e9e9ec);z-index:2147482000;pointer-events:auto;',
      'font-family:var(--fe-font,ui-monospace,Consolas,monospace);}',
      '.fe-editor-win.is-anim{transition:left .2s ease,top .2s ease,width .2s ease,height .2s ease,',
      'opacity .2s ease;}',
      '.fe-editor-win.is-min{opacity:.12;}',
      '.fe-editor-win::before{content:"";position:absolute;inset:0;background:var(--fe-bg,#1b1d23);',
      'opacity:var(--fe-alpha,.88);pointer-events:none;z-index:0;}',
      '.fe-editor-win>*{position:relative;z-index:1;}',
      '.fe-editor-win button,.fe-editor-win input,.fe-editor-win select,.fe-editor-win textarea,',
      '.fe-editor-win pre,.fe-editor-win span,.fe-editor-win div,.fe-editor-mini *{font-family:inherit;}',
      '.fe-editor-head{display:flex;align-items:center;gap:6px;padding:0 0 0 8px;cursor:move;',
      'border-bottom:1px solid rgba(150,150,160,.22);user-select:none;flex:0 0 auto;}',
      '.fe-editor-title{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;',
      'white-space:nowrap;font-size:12px;opacity:.85;}',
      '.fe-editor-btn{border:1px solid rgba(150,150,160,.32);background:transparent;color:inherit;',
      'border-radius:6px;padding:2px 8px;font-size:12px;cursor:pointer;line-height:1.5;}',
      '.fe-editor-btn:hover{background:rgba(150,150,160,.18);}',
      '.fe-editor-btn[disabled]{opacity:.4;cursor:default;}',
      '.fe-editor-btn.is-on{border-color:#8ab4f8;background:rgba(138,180,248,.18);}',
      '.fe-editor-head-btn{width:32px;height:28px;flex:0 0 auto;padding:0;border:0;',
      'border-left:1px solid rgba(150,150,160,.25);border-radius:0;background:transparent;',
      'color:inherit;font-size:14px;line-height:1;cursor:pointer;outline:none;}',
      '.fe-editor-head-btn:focus-visible{outline:1px solid #8ab4f8;}',
      '.fe-editor-head-btn:hover{background:rgba(150,150,160,.22);}',
      '.fe-editor-tag{font-size:11px;opacity:.65;white-space:nowrap;}',
      '.fe-editor-check{display:flex;align-items:center;gap:5px;cursor:pointer;font-size:11px;',
      'opacity:.8;white-space:nowrap;user-select:none;flex:0 0 auto;}',
      '.fe-editor-switch{position:relative;display:inline-block;width:24px;height:13px;border-radius:7px;',
      'background:rgba(150,150,160,.35);flex:0 0 auto;transition:background .12s ease;}',
      '.fe-editor-switch.is-on{background:#8ab4f8;}',
      '.fe-editor-switch-knob{position:absolute;top:2px;left:2px;width:9px;height:9px;border-radius:50%;',
      'background:#fff;transition:left .12s ease;}',
      '.fe-editor-switch.is-on .fe-editor-switch-knob{left:13px;}',
      '.fe-editor-swatch{width:24px;height:20px;padding:0;border:1px solid rgba(150,150,160,.32);',
      'border-radius:4px;background:transparent;cursor:pointer;}',
      '.fe-editor-slider{-webkit-appearance:none;appearance:none;width:64px;height:12px;',
      'background:transparent;outline:none;cursor:pointer;flex:0 0 auto;}',
      '.fe-editor-slider::-webkit-slider-runnable-track{height:3px;border-radius:2px;',
      'background:rgba(150,150,160,.35);}',
      '.fe-editor-slider::-webkit-slider-thumb{-webkit-appearance:none;width:10px;height:10px;',
      'border-radius:50%;background:#8ab4f8;margin-top:-3.5px;}',
      '.fe-editor-alpha{display:flex;align-items:center;gap:5px;flex:0 0 auto;padding:0 8px;',
      'cursor:default;user-select:none;}',
      '.fe-editor-alpha-icon{font-size:12px;opacity:.75;}',
      '.fe-editor-alpha-val{font-size:10px;opacity:.7;min-width:32px;text-align:right;}',
      '.fe-editor-select{background:var(--fe-bg,#22242b);',
      'background:color-mix(in srgb, var(--fe-bg,#22242b) calc(var(--fe-alpha,.88) * 100%), transparent);',
      'color:var(--fe-fg,#e9e9ec);',
      'border:1px solid rgba(150,150,160,.32);',
      'border-radius:6px;padding:2px 4px;font-size:11px;outline:none;max-width:180px;}',
      '.fe-editor-select option{background:var(--fe-bg,#22242b);color:var(--fe-fg,#e9e9ec);}',
      '.fe-editor-tools{display:flex;align-items:center;gap:6px;padding:6px 8px;flex-wrap:wrap;',
      'border-bottom:1px solid rgba(150,150,160,.22);flex:0 0 auto;}',
      '.fe-editor-path{flex:1 1 80px;min-width:0;background:rgba(150,150,160,.12);color:inherit;',
      'border:1px solid rgba(150,150,160,.28);border-radius:6px;padding:3px 7px;font-size:12px;',
      'outline:none;}',
      '.fe-editor-body{flex:1 1 auto;min-height:0;display:flex;}',
      '.fe-editor-files{flex:0 0 auto;overflow:auto;font-size:12px;padding:4px 0;}',
      '.fe-editor-entry{padding:3px 8px;cursor:pointer;white-space:nowrap;overflow:hidden;',
      'text-overflow:ellipsis;}',
      '.fe-editor-entry:hover{background:rgba(150,150,160,.18);}',
      '.fe-editor-entry.is-up{opacity:.6;}',
      '.fe-editor-entry.is-root-head{opacity:.5;font-size:10px;padding:2px 8px;cursor:default;}',
      '.fe-editor-entry.is-root{font-weight:600;}',
      '.fe-editor-entry.is-cur{background:rgba(138,180,248,.16);}',
      '.fe-editor-menu{position:fixed;z-index:2147483600;min-width:160px;padding:4px 0;',
      'background:var(--fe-bg,#1b1d23);border:1px solid rgba(150,150,160,.35);border-radius:6px;',
      'box-shadow:0 8px 24px rgba(0,0,0,.5);color:var(--fe-fg,#e9e9ec);font-size:12px;',
      'pointer-events:auto;}',
      '.fe-editor-menu-item{padding:4px 12px;cursor:pointer;white-space:nowrap;}',
      '.fe-editor-menu-item:hover{background:rgba(150,150,160,.22);}',
      '.fe-editor-menu-sep{height:1px;background:rgba(150,150,160,.25);margin:4px 0;}',
      '.fe-editor-split{position:relative;z-index:5;flex:0 0 auto;width:5px;cursor:col-resize;',
      'background:rgba(150,150,160,.14);}',
      '.fe-editor-split::after{content:"";position:absolute;top:0;bottom:0;left:-4px;right:-4px;}',
      '.fe-editor-split:hover{background:rgba(138,180,248,.45);}',
      '.fe-editor-code{flex:1 1 auto;min-width:0;display:flex;min-height:0;}',
      '.fe-editor-gutter-box{flex:0 0 auto;overflow:hidden;box-sizing:border-box;',
      'width:var(--fe-numw,40px);padding:8px 8px 8px 0;}',
      '.fe-editor-gutter{margin:0;white-space:pre;text-align:right;',
      'font-size:var(--fe-size,12.5px);line-height:1.55;opacity:.45;user-select:none;}',
      // z-index:0 ⇒ 自己建一个层叠上下文，把 CM6 的内部层叠关在里面，
      // 免得编辑器的滚动条/装饰层爬上去盖住浮窗边的拖拽热区。
      '.fe-editor-stack{position:relative;flex:1 1 auto;min-width:0;min-height:0;z-index:0;}',
      // ⚠ 叠加层只负责裁剪 + 跟 textarea 同步位移，不显示自己的滚动条。
      //   但 overflow-y 必须留 scroll（不能 hidden）：要跟 textarea 一样预留
      //   出滚动条宽度，两边的可用宽度才会一致、折行点才会一致。
      //   再用 scrollbar-width/::-webkit-scrollbar 把它藏掉，避免出现两条滚动条。
      '.fe-editor-visual-clip{position:absolute;inset:0;overflow-y:scroll;overflow-x:hidden;',
      'scrollbar-width:none;pointer-events:none;}',
      '.fe-editor-visual-clip::-webkit-scrollbar{width:0;height:0;}',
      '.fe-editor-visual{margin:0;padding:8px 10px;box-sizing:border-box;white-space:pre;tab-size:8;',
      'overflow-wrap:break-word;color:transparent;',
      'font-size:var(--fe-size,12.5px);line-height:1.55;will-change:transform;}',
      // ⚠ 可视化标记模式下 Tab 会被换成单个「→」，宽度只剩 1 列 ——
      //   所以这时两层都要把 tab-size 调成 1，才能继续对齐 textarea。
      '.fe-editor-visual.is-marks{color:inherit;tab-size:1;}',
      '.fe-editor-visual.is-wrap{white-space:pre-wrap;}',
      // 每个逻辑行 = 一个 flex 行：行号一列、文本一列。
      // 折行只可能发生在文本列内部，续行自动跟文本列左边缘对齐，
      // 行号在结构上就不可能跑到别的逻辑行去。
      // min-height 用 1.55em 顶住空行（line-height 是 1.55），否则空行塌成 0 高。
      '.fe-editor-row{display:flex;align-items:flex-start;white-space:inherit;min-height:1.55em;}',
      '.fe-editor-text{flex:1 1 auto;min-width:0;white-space:inherit;}',
      // ⚠ 带行号时 padding-left 必须是 0：行号列自己就占掉 --fe-numw 的宽度，
      //   而 textarea 那边的 padding-left 正好也是 --fe-numw —— 两边文本起点才对得上。
      '.fe-editor-visual.has-numcol{padding-left:0;}',
      '.fe-editor-num{flex:0 0 auto;box-sizing:border-box;',
      'width:var(--fe-numw,40px);padding-right:8px;',
      'text-align:right;color:var(--fe-fg,#e9e9ec);opacity:.45;}',
      '.fe-editor-area{position:relative;z-index:1;width:100%;height:100%;resize:none;border:0;',
      'outline:none;background:transparent;color:inherit;padding:8px 10px;box-sizing:border-box;',
      // ⚠ overflow-y 用 scroll（不是 auto）：要跟 .fe-editor-visual-clip 一样
      //   「永远」预留滚动条宽度，两边的可用宽度才会恒等、折行点才会一致。
      //   横向仍用 auto —— 换行关闭时长行本来就需要能横向滚。
      'font-size:var(--fe-size,12.5px);line-height:1.55;white-space:pre;',
      'overflow-y:scroll;overflow-x:auto;tab-size:8;',
      'overflow-wrap:break-word;caret-color:var(--fe-fg,#e9e9ec);}',
      '.fe-editor-area.is-wrap{white-space:pre-wrap;}',
      '.fe-editor-area.has-numcol{padding-left:var(--fe-numw,40px);}',
      '.fe-editor-area.is-veiled{color:transparent;tab-size:1;}',
      '.fe-editor-mark{opacity:.32;}',
      '.fe-editor-status{font-size:11px;opacity:.78;padding:4px 9px;',
      'border-top:1px solid rgba(150,150,160,.22);overflow:hidden;text-overflow:ellipsis;',
      'white-space:nowrap;flex:0 0 auto;}',
      '.fe-editor-mini{position:fixed;display:flex;align-items:center;height:28px;width:164px;',
      'box-sizing:border-box;border-radius:7px;',
      'box-shadow:0 0 0 1px rgba(150,150,160,.3),0 6px 20px rgba(0,0,0,.45);',
      'color:var(--fe-fg,#e9e9ec);pointer-events:auto;',
      'z-index:2147482000;font-size:12px;font-family:var(--fe-font,ui-monospace,Consolas,monospace);',
      'overflow:hidden;}',
      '.fe-editor-mini::before{content:"";position:absolute;inset:0;border-radius:7px;',
      'background:var(--fe-bg,#1b1d23);opacity:var(--fe-alpha,.88);pointer-events:none;}',
      '.fe-editor-mini>*{position:relative;z-index:1;}',
      '.fe-editor-mini-title{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;',
      'white-space:nowrap;cursor:move;padding:0 32px 0 8px;user-select:none;opacity:.88;}',
      '.fe-editor-mini-btn{position:absolute;right:0;top:0;bottom:0;width:32px;z-index:2;',
      'border:0;border-left:1px solid rgba(150,150,160,.25);background:transparent;color:inherit;',
      'font-size:13px;line-height:1;cursor:pointer;border-radius:0 6px 6px 0;}',
      '.fe-editor-mini-btn:hover{background:rgba(150,150,160,.22);}',
      '.fe-editor-veil{position:fixed;inset:0;z-index:2147483000;cursor:move;pointer-events:auto;}',
      '.fe-editor-veil.is-size{cursor:nwse-resize;}',
      // ⚠ 边条热区原来只有 4px，换成 CM6 之后更难「摸到」——
      //   ① 热区加阔到 8px；② z-index 抬到 30，保证拖拽条永远压在编辑器
      //   （连同它自己的滚动条）上面。
      '.fe-editor-grip{position:absolute;z-index:30;}',
      '.fe-editor-grip.n{left:12px;right:12px;top:0;height:8px;cursor:ns-resize;}',
      '.fe-editor-grip.s{left:12px;right:12px;bottom:0;height:8px;cursor:ns-resize;}',
      '.fe-editor-grip.w{top:12px;bottom:12px;left:0;width:8px;cursor:ew-resize;}',
      '.fe-editor-grip.e{top:12px;bottom:12px;right:0;width:8px;cursor:ew-resize;}',
      '.fe-editor-grip.nw{left:0;top:0;width:12px;height:12px;cursor:nwse-resize;}',
      '.fe-editor-grip.ne{right:0;top:0;width:12px;height:12px;cursor:nesw-resize;}',
      '.fe-editor-grip.sw{left:0;bottom:0;width:12px;height:12px;cursor:nesw-resize;}',
      '.fe-editor-grip.se{right:0;bottom:0;width:14px;height:14px;cursor:nwse-resize;}',
      // ── CM6（CodeMirror 6）编辑器内核 ──────────────────────────────
      // 行号由 CM6 自己排版：它按每个逻辑行的【真实渲染高度】摆行号元素，
      // 所以「文字折行」跟「行号位置」本来就同源 —— 不存在两层对齐问题。
      // 背景交给浮窗自己画，.cm-editor 一律 transparent。
      // ⚠ 高度必须用 flex 撑满，唔可以只靠 height:100%：
      //   CM6 嘅 .cm-editor 係 flex column，但 height:100% 要「父元素有确定高度」
      //   先算得准；呢条链上任何一层退化成 auto，编辑器就只会「由内容撑开」。
      //   症状就係——水平滚动条缩到内容末尾（即係中间），下面嗰截唔属于编辑器，
      //   所以喺嗰度滚滚轮係废嘅。
      '.fe-editor-cm{position:absolute;inset:0;display:flex;flex-direction:column;}',
      '.fe-editor-cm-loading{padding:10px;font-size:11px;opacity:.6;}',
      '.fe-editor-cm .cm-editor{flex:1 1 auto;min-height:0;height:100%;',
      'background:transparent;color:var(--fe-fg,#e9e9ec);}',
      '.fe-editor-cm .cm-editor.cm-focused{outline:none;}',
      '.fe-editor-cm .cm-scroller{font-family:var(--fe-font,monospace);',
      'font-size:var(--fe-size,12.5px);line-height:1.55;overflow:auto;}',
      // ── 滚动条：透明度接受浮窗那条 alpha 滑块管制，并且係直角 ──────
      // ⚠ 一旦自己写 ::-webkit-scrollbar，Windows 11 默认那套「圆角 + 主题色」
      //   就全部作废，所以 track / thumb / corner / button 要自己写齐，
      //   否则会漏出灰白方块。
      // ⚠ alpha 直接吃 var(--fe-alpha)：那个变量挂在 .fe-editor-win 上，
      //   后代伪元素继承得到 ⇒ 拖动透明度条时滚动条会跟住一起变淡。
      // ⚠ 作用域锁在 .fe-editor-win 里面 —— 只改浮窗，唔碰 DSH 页面自己嘅滚动条。
      '.fe-editor-win ::-webkit-scrollbar{width:12px;height:12px;}',
      '.fe-editor-win ::-webkit-scrollbar-track{background:transparent;}',
      '.fe-editor-win ::-webkit-scrollbar-thumb{',
      'background:rgba(150,150,160,var(--fe-alpha,.88));border-radius:0;}',
      '.fe-editor-win ::-webkit-scrollbar-thumb:hover{',
      'background:rgba(138,180,248,var(--fe-alpha,.88));border-radius:0;}',
      '.fe-editor-win ::-webkit-scrollbar-corner{background:transparent;}',
      '.fe-editor-win ::-webkit-scrollbar-button{display:none;}',
      // ⚠ 行号栏底色（2026-09-27 定的方案）：
      //   CM6 的横向滚动的设计是「行号 sticky 钉住 + 内容从它底下滑过 +
      //   靠 gutter 自己的背景遮住」，官方默认底色是不透明的 #f5f5f5。
      //   我们先前改成 transparent ⇒ 等于把遮板拆了，「不换行 + 向右拖」时
      //   文字直接透过行号栏露出来（实测重叠 1485px）。
      //   但用户不想看到一条实色色带，所以改成：底色保持透明，
      //   改为在「横向滚动中」把整条行号栏淡出（见 client.js 的 onScroll 逻辑）。
      //   这样既不画色带、也不会出现「文字压在数字上」。
      '.fe-editor-cm .cm-gutters{background:transparent;border-right:0;',
      'color:var(--fe-fg,#e9e9ec);transition:opacity .12s linear;}',
      '.fe-editor-cm .cm-lineNumbers .cm-gutterElement{opacity:.45;padding:0 6px 0 4px;}',
      '.fe-editor-cm .cm-activeLine{background:rgba(150,150,160,.10);}',
      '.fe-editor-cm .cm-activeLineGutter{background:transparent;}',
      '.fe-editor-cm .cm-content{caret-color:var(--fe-fg,#e9e9ec);}',
      '.fe-editor-cm .cm-cursor,.fe-editor-cm .cm-dropCursor{border-left-color:var(--fe-fg,#e9e9ec);}',
      '.fe-editor-cm .cm-selectionBackground,.fe-editor-cm .cm-content ::selection{',
      'background:rgba(138,180,248,.30);}',
    ].join('')

    const GRIP_DIRS = ['n', 's', 'e', 'w', 'nw', 'ne', 'sw', 'se']
    const MIN_W = 260
    const MIN_H = 260
    const MINI_W = 164
    const MINI_H = 28
    const LINE_LIMIT = 400000
    const GUTTER_LINE_LIMIT = 20000
    const OVERLAY_LINE_LIMIT = 1200
    const VISUAL_LIMIT = 120000
    const DEFAULT_PATH = ''

    /**
     * 把一个 box 夹进视口。
     * ⚠ 为什么需要：浮窗坐标存在 settings.json 里，换分辨率／改显示缩放／
     *   接外接屏之后，旧坐标可能整块落在屏幕外 —— 看上去就是「浮窗不见了」。
     *   2026-09-26 实际发生：右边缘到了 1633，而工作区只有 1536。
     * @param b - { x, y, w, h }。
     * @param slack - true 时只保证「至少留一角」（拖动中用），false 时完全夹进来。
     * @returns 夹好的 box。
     */
    function clampBox(b, slack) {
      const vw = window.innerWidth
      const vh = window.innerHeight
      const w = Math.min(Math.max(MIN_W, b.w), Math.max(MIN_W, vw - 8))
      const h = Math.min(Math.max(MIN_H, b.h), Math.max(MIN_H, vh - 8))
      if (slack) {
        // 拖动中：允许探出屏幕，但至少留一点能抓回来。
        const keepX = 48
        const keepY = 28
        return {
          x: Math.min(Math.max(keepX - w, b.x), vw - keepX),
          y: Math.min(Math.max(0, b.y), vh - keepY),
          w: w, h: h,
        }
      }
      return {
        x: Math.min(Math.max(0, b.x), Math.max(0, vw - w)),
        y: Math.min(Math.max(0, b.y), Math.max(0, vh - h)),
        w: w, h: h,
      }
    }
    // ⚠ 0.5 一档，且必须跟滚轮能产生的值完全一致：
    //   <select> 的 value 匹配不到任何 <option> 时会回退显示第一项 ——
    //   滚轮如果产出 13.5 而列表里没有 13.5，画面就会出现
    //   「字号数字在 8 和真值之间来回跳」的鬼现象（2026-09-26 实际踩到）。
    const SIZE_CHOICES = [
      8, 8.5, 9, 9.5, 10, 10.5, 11, 11.5, 12, 12.5, 13, 13.5, 14, 14.5, 15, 15.5,
      16, 16.5, 17, 17.5, 18, 18.5, 19, 19.5, 20, 20.5, 21, 21.5, 22, 22.5, 23,
    ]
    const FALLBACK_FONTS = ['Cascadia Mono', 'Consolas', 'Microsoft YaHei', 'SimSun', 'Segoe UI']

    /**
     * 调一条本插件的 HTTP API。
     * @param name - API 名（read / save / list / fonts / pick / open-external）。
     * @param args - 参数对象。
     * @returns 解析后的 JSON 结果。
     */
    function callApi(name, args) {
      return fetch(API + name, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(args === undefined ? {} : args),
      }).then((res) => res.json())
    }

    /**
     * 把一个字体名变成 CSS font-family 值。
     * @param name - 字体名。
     * @returns 含引号（需要时）的 CSS 值。
     */
    function quoteFont(name) {
      const text = String(name)
      if (text.length === 0) return 'monospace'
      if (/[^a-zA-Z0-9-]/.test(text)) return '"' + text.replace(/"/g, '') + '"'
      return text
    }

    /**
     * 取一个路径的目录部分。
     * @param value - 文件路径。
     * @returns 目录路径。
     */
    function dirOf(value) {
      const text = String(value)
      const cut = Math.max(text.lastIndexOf('\\'), text.lastIndexOf('/'))
      return cut > 0 ? text.slice(0, cut) : text
    }

    /**
     * 拼一个子路径。
     * @param dir - 父目录。
     * @param name - 子项名。
     * @returns 拼好的路径。
     */
    function joinPath(dir, name) {
      const text = String(dir)
      const sep = text.indexOf('/') >= 0 && text.indexOf('\\') < 0 ? '/' : '\\'
      return text.endsWith(sep) ? text + name : text + sep + name
    }

    /**
     * 取路径的文件名部分。
     * @param value - 文件路径。
     * @returns 文件名。
     */
    function basenameOf(value) {
      const text = String(value)
      const cut = Math.max(text.lastIndexOf('\\'), text.lastIndexOf('/'))
      return cut >= 0 ? text.slice(cut + 1) : text
    }

    /**
     * 判断 path 就是 dir 本身、还是位于 dir 之下。
     * 大小写不敏感（Windows 路径本来就不分大小写），斜杠方向也统一处理。
     * @param path - 待判断的路径。
     * @param dir - 当作父目录的路径。
     * @returns 是否落在 dir 里面。
     */
    function isUnderPath(path, dir) {
      const norm = (value) => String(value).replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase()
      const target = norm(path)
      const base = norm(dir)
      if (target === '' || base === '') return false
      if (target === base) return true
      // 盘符根（G:）去掉尾斜杠后要自己补回一个，否则 G:\foo 不会以「g:\」开头。
      return target.startsWith(base + '\\')
    }

    /**
     * 数文本的逻辑行数；超限时返回 0 表示「不给行号」。
     * @param value - 文本内容。
     * @returns 行数，或 0。
     */
    function countLines(value) {
      const text = String(value)
      if (text.length > LINE_LIMIT) return 0
      let total = 1
      for (let i = 0; i < text.length; i += 1) {
        if (text.charCodeAt(i) === 10) total += 1
      }
      if (total > GUTTER_LINE_LIMIT) return 0
      return total
    }

    /**
     * 造独立行号栏的文本（换行关闭时用）。
     * @param total - 行数。
     * @returns 每行一个数字的字符串。
     */
    function buildGutter(total) {
      if (total <= 0) return ''
      const lines = []
      for (let n = 1; n <= total; n += 1) lines.push(String(n))
      return lines.join('\n')
    }

    /**
     * 造叠加层节点：**每个逻辑行一个 <div>**，行号是该 div 的第一个子元素。
     * ⚠ 为什么不把整份文本拼成一个流（行号内联 + 换行符）：
     *   那时一旦某行折行，行号跟逻辑行的对应就会漂移 ——
     *   实测同一个文件、同一个滚动位置：窗口宽（74%）时行号全对，
     *   窗口窄（79%）时行号整体落后 2 行。因为折行让视觉行数跟逻辑行数脱钩。
     *   所以这里一行一个 flex 行：**行号是一列、文本是另一列**。
     *   折行只可能发生在文本列内部，续行自动跟文本列左边缘对齐，
     *   行号在结构上就不可能跑到别的逻辑行去。
     * @param value - 文本内容。
     * @param withNums - 是否带行号。
     * @param withMarks - 是否把空格/Tab 换成 ·/→。
     * @returns React 子节点数组（每个元素是一个逻辑行）。
     */
    function buildOverlay(value, withNums, withMarks) {
      const lines = String(value).split('\n')
      const rows = []
      for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i]
        const body = []
        if (withMarks) {
          let buffer = ''
          let k = 0
          const flush = () => {
            if (buffer.length === 0) return
            body.push(h('span', { key: 't' + k }, buffer))
            k += 1
            buffer = ''
          }
          for (let j = 0; j < line.length; j += 1) {
            const ch = line.charAt(j)
            if (ch === ' ' || ch === '\t') {
              flush()
              body.push(h('span', { key: 'm' + k, className: 'fe-editor-mark' }, ch === ' ' ? '·' : '→'))
              k += 1
            } else {
              buffer += ch
            }
          }
          flush()
        } else if (line.length > 0) {
          body.push(line)
        }
        const children = []
        if (withNums) {
          children.push(h('span', { key: 'n', className: 'fe-editor-num' }, String(i + 1)))
        }
        children.push(h('span', { key: 'b', className: 'fe-editor-text' }, body))
        rows.push(h('div', { key: 'r' + i, className: 'fe-editor-row' }, children))
      }
      return rows
    }

    /** 阻止事件冒泡（按钮用，避免触发外层拖动）。 */
    function stop(event) {
      event.stopPropagation()
    }

    /**
     * 透明度滑块 → alpha。纯线性，跟外壳（dsh-electron-shell/chrome.js）一致：
     * 滑块 70% → alpha 0.70，读数亦直接显示滑块值，两者永远对得上。
     * @param value - 滑块值 0..100。
     * @returns alpha 0..1。
     */
    function sliderToAlpha(value) {
      return Math.min(100, Math.max(0, Number(value))) / 100
    }

    /**
     * alpha → 透明度滑块位置（线性，与外壳一致）。
     * @param alpha - alpha 0..1。
     * @returns 滑块值 0..100（四舍五入）。
     */
    function alphaToSlider(alpha) {
      return Math.round(Math.min(1, Math.max(0, Number(alpha))) * 100)
    }

    /** localStorage 嘅键名。 */
    const STORE_KEY = 'dsh-floating-editor/settings'

    /**
     * 读回上次保存嘅设置；读唔到或者损坏就返回空对象。
     * @returns 设置对象（可能为空）。
     */
    function loadSettings() {
      try {
        const raw = window.localStorage.getItem(STORE_KEY)
        if (raw === null) return {}
        const parsed = JSON.parse(raw)
        return parsed !== null && typeof parsed === 'object' ? parsed : {}
      } catch (error) {
        return {}
      }
    }

    /**
     * 把整份设置写进 localStorage —— 只当**启动缓存**用。
     * 真源是插件目录里的 settings.json（见 makeFileSaver）。
     * @param full - 完整设置对象。
     */
    function cacheSettings(full) {
      try {
        window.localStorage.setItem(STORE_KEY, JSON.stringify(full))
      } catch (error) {
        /* 隐私模式或者配额满：静默放弃缓存，界面照常工作 */
      }
    }

    /**
     * 造一个「写 settings.json」的节流器。
     * 真源是插件目录里那份文件（Host 的 set-settings），不是浏览器存储 ——
     * 所以换端口、清 Electron 缓存都不会丢，备份也跟着插件走。
     * ⚠ 必须节流：拖窗口／拉分隔条的时候 box、fileWidth 每一帧都在变，
     *   逐个请求写盘会把磁盘和 HTTP 都打爆。
     * @returns 接收完整设置对象的节流写入函数。
     */
    function makeFileSaver() {
      let timer = null
      let pending = null
      const flush = () => {
        timer = null
        const body = pending
        pending = null
        if (body === null) return
        callApi('set-settings', { settings: body }).then((res) => {
          if (!res || !res.ok) {
            console.warn('[dsh-floating-editor] 设置写盘失败：' + ((res && res.error) || '未知'))
          }
        }).catch((err) => {
          console.warn('[dsh-floating-editor] 设置写盘出错：' + String(err))
        })
      }
      return (full) => {
        pending = full
        if (timer === null) timer = setTimeout(flush, 600)
      }
    }

    /**
     * 外层：先搞定「设置从哪来」，再渲染真正的浮窗。
     * 真源是插件目录里的 settings.json（Host 的 get-settings）——
     * 不依赖浏览器 origin，换端口、清缓存都不会丢。
     * 拉不到（Host 未重启、API 还没生效、文件损坏…）就退回 localStorage 缓存。
     * 拿到之前不渲染任何东西 —— 否则会先闪一下默认值再跳成真值。
     */
    function FloatEditor() {
      const [initial, setInitial] = React.useState(undefined)
      React.useEffect(() => {
        let cancelled = false
        const fallback = () => { if (!cancelled) setInitial(loadSettings()) }
        const timer = setTimeout(fallback, 3000)
        callApi('get-settings', {}).then((res) => {
          if (cancelled) return
          clearTimeout(timer)
          if (!res || !res.ok) { setInitial(loadSettings()); return }
          const fromFile = res.settings
          if (fromFile === null) {
            // 文件还没建：把缓存里的东西写过去，完成一次性迁移。
            const seed = loadSettings()
            if (Object.keys(seed).length > 0) {
              callApi('set-settings', { settings: seed }).catch(() => {})
            }
            setInitial(seed)
            return
          }
          setInitial(fromFile)
        }).catch(() => { clearTimeout(timer); fallback() })
        return () => { cancelled = true; clearTimeout(timer) }
      }, [])
      if (initial === undefined) return null
      return h(FloatEditorInner, { initial: initial })
    }

    /** 内层：设置到手之后才 mount，所以 useState 初值可以直接吃真设置。 */
    function FloatEditorInner(props) {
      const saved = props.initial === null || typeof props.initial !== 'object' ? {} : props.initial
      const savedStr = (key, fallback) => (typeof saved[key] === 'string' && saved[key] !== '' ? saved[key] : fallback)
      const savedNum = (key, fallback) => (typeof saved[key] === 'number' && Number.isFinite(saved[key]) ? saved[key] : fallback)
      const savedBool = (key, fallback) => (typeof saved[key] === 'boolean' ? saved[key] : fallback)
      const savedPoint = (key, fallback) => {
        const v = saved[key]
        if (v === null || typeof v !== 'object') return fallback
        if (typeof v.x !== 'number' || typeof v.y !== 'number') return fallback
        if (typeof v.w === 'number' && typeof v.h === 'number') return { x: v.x, y: v.y, w: v.w, h: v.h }
        return { x: v.x, y: v.y }
      }
      const startPath = savedStr('path', DEFAULT_PATH)

      const [mode, setMode] = React.useState(savedStr('mode', 'open'))
      const [path, setPath] = React.useState(startPath)
      const [text, setText] = React.useState('')
      const [loaded, setLoaded] = React.useState(null)
      /**
       * 比较用的规范化：把 CRLF 折成 LF。
       * ⚠ 为什么要这一条：CRLF 文件（实测 `notes.md` 有 1464 个 `\r\n`）
       *   读进来是带 `\r` 的，而 CM6 内部把 `\r\n` 规范化成 `\n` 回吐给我们
       *   ⇒ `text` 永远 !== `loaded` ⇒ 标题永远挂 `*`、保存键永远亮着、
       *   外部修改探测永远走「有未保存改动」那条分支（连自动重载都失效）。
       *   注意：只在【比较】时折，`loaded` 本身保留 CRLF ——
       *   这样保存时要么原样写回、要么由 save() 按原来的行尾符还原。
       */
      const normNL = (value) => String(value).split('\r\n').join('\n')
      const [status, setStatus] = React.useState('正在载入 ' + basenameOf(startPath) + ' …')
      const [alpha, setAlpha] = React.useState(savedNum('alpha', 0.88))
      const [bg, setBg] = React.useState(savedStr('bg', '#1b1d23'))
      const [fg, setFg] = React.useState(savedStr('fg', '#e9e9ec'))
      const [fontFamily, setFontFamily] = React.useState(savedStr('fontFamily', 'Microsoft YaHei'))
      const [fontList, setFontList] = React.useState([])
      const [fontSize, setFontSize] = React.useState(savedNum('fontSize', 12.5))
      const [whiteMode, setWhiteMode] = React.useState(savedBool('whiteMode', false))
      const [showTools, setShowTools] = React.useState(savedBool('showTools', false))
      // 根目录可写：打开时，保存会把你主动加的根目录也当成可写边界（仍然走 workspace-write）。
      const [rootWritable, setRootWritable] = React.useState(savedBool('rootWritable', true))
      const [wrap, setWrap] = React.useState(savedBool('wrap', false))
      const [fileWidth, setFileWidth] = React.useState(savedNum('fileWidth', 176))
      const [box, setBox] = React.useState(() => clampBox(savedPoint('box', { x: 140, y: 90, w: 760, h: 500 }), false))
      const [miniAt, setMiniAt] = React.useState(savedPoint('miniAt', { x: 0, y: 0 }))
      const [drag, setDrag] = React.useState(null)
      const [busy, setBusy] = React.useState(false)
      const [diskVersion, setDiskVersion] = React.useState(null)
      const [entries, setEntries] = React.useState([])
      const [dir, setDir] = React.useState(dirOf(startPath))
      // 多根文件夹（Notepad++「Folder as Workspace」那种）：默认只有当前文件所在目录。
      const [roots, setRoots] = React.useState(() => {
        const v = saved.roots
        return Array.isArray(v) && v.length > 0 ? v : [dirOf(startPath)]
      })
      // 右键菜单状态：{ x, y, path, type, isRoot }；null = 不显示。
      const [menu, setMenu] = React.useState(null)
      // 目录树：tree[路径] = 已加载的子项数组；expanded[路径] = true 表示展开。
      const [tree, setTree] = React.useState({})
      const [expanded, setExpanded] = React.useState({})
      const [refreshing, setRefreshing] = React.useState(false)
      const [scrollTop, setScrollTop] = React.useState(0)
      const [scrollLeft, setScrollLeft] = React.useState(0)
      const [lineCount, setLineCount] = React.useState(1)
      const [overlayNodes, setOverlayNodes] = React.useState(null)
      // ── CM6（CodeMirror 6）编辑器内核 ──────────────────────────────
      // cmReady=false 时走旧的「叠加层 + textarea」两层路径（fallback）；
      // bundle 加载失败（cmFailed）就永久留在旧路径 —— 绝不黑屏。
      const [cmReady, setCmReady] = React.useState(() => window.CM6 !== undefined)
      const [cmFailed, setCmFailed] = React.useState(false)
      const cmHostRef = React.useRef(null)
      const cmViewRef = React.useRef(null)
      const cmWrapCompRef = React.useRef(null)
      const cmWsCompRef = React.useRef(null)
      const cmDocRef = React.useRef('')
      const saveRef = React.useRef(null)
      const toggleWrapRef = React.useRef(null)
      // 字体枚举的结果备注（'' = 成功；否则是错误原因）——
      // 尺寸自检会把它一起报出来，免得两条诊断互相覆盖。
      const fontNoteRef = React.useRef('')
      /**
       * 当前文件原本是不是 CRLF 行尾。
       * ⚠ CM6 内部只会用 `\n`，保存时若不还原，CRLF 文件会被静默改成 LF ——
       *   那是一次用户没要求的全文件改写（git diff 会炸成整篇）。
       */
      const crlfRef = React.useRef(false)

      // ⚠ 用规范化后的文本比较 —— 见 normNL 的注释（CRLF 文件否则永远算「有改动」）。
      const dirty = loaded !== null && normNL(text) !== normNL(loaded)
      const say = (message) => { setStatus(message) }

      /**
       * 打开文件列表的右键菜单。
       * @param event - React 的 contextmenu 事件。
       * @param targetPath - 被点中的路径。
       * @param type - 'file' 或 'directory'。
       * @param isRoot - 该路径是否已在根列表里。
       */
      const openMenu = (event, targetPath, type, isRoot) => {
        event.preventDefault()
        event.stopPropagation()
        setMenu({
          x: event.clientX, y: event.clientY,
          path: targetPath, type: type, isRoot: isRoot === true,
        })
      }

      /** 复制一段文本到剪贴板；失败时退回 execCommand。 */
      const copyText = (value) => {
        try {
          if (window.navigator && window.navigator.clipboard) {
            window.navigator.clipboard.writeText(value).catch(() => {})
            return true
          }
        } catch (error) {
          /* 退回下面的老办法 */
        }
        try {
          const box = document.createElement('textarea')
          box.value = value
          document.body.appendChild(box)
          box.select()
          document.execCommand('copy')
          box.remove()
          return true
        } catch (error) {
          return false
        }
      }

      /**
       * 把一次 list 的结果写进树缓存。
       * ⚠ 缓存的 key 用【请求时那个路径】，不是 res.dir：res.dir 是 Host 规范化后
       *   的 displayPath，跟点进来时的字符串可能差在盘符大小写、斜杠方向上 ——
       *   那样 renderTree 用 parent 查不到节点，会永远停在「加载中…」。
       * @param path - 请求时用的目录路径。
       * @param res - Host 的 list 返回。
       */
      const storeNode = (path, res) => {
        setTree((prev) => Object.assign({}, prev, {
          [path]: {
            entries: res.entries,
            total: typeof res.total === 'number' ? res.total : res.entries.length,
            truncated: res.truncated === true,
          },
        }))
      }

      /**
       * 懒加载一个目录的子项进树缓存。
       * @param target - 目录路径。
       */
      const loadNode = (target) => {
        callApi('list', { dir: target }).then((res) => {
          if (res && res.ok) storeNode(target, res)
          else say('列目录失败：' + ((res && res.error) || '未知'))
        }).catch((err) => { say('列目录出错：' + String(err)) })
      }

      /**
       * 展开／收起一个目录节点。
       * @param target - 目录路径。
       */
      const toggleNode = (target) => {
        setExpanded((prev) => {
          const next = Object.assign({}, prev)
          if (next[target] === true) {
            delete next[target]
          } else {
            // 展开节点数上限：每个目录最多 2000 条，展开太多累积起来一样会拖死浏览器。
            if (Object.keys(next).length >= 60) {
              say('已展开嘅目录太多了（60 个），先收起几个再展开')
              return prev
            }
            next[target] = true
            loadNode(target)
          }
          return next
        })
      }

      /**
       * 重新扫描文件列表：把每一个根目录、以及当前展开着的目录重新 list 一次。
       * 外面新建／删掉的文件不会自己长出来 —— 这就是给用户手动刷新的入口。
       * 已经翻开的目录保持翻开；扫描时发现目录已经不存在，就把它收起并报数。
       */
      const refreshAll = () => {
        if (refreshing) return
        const targets = []
        const seen = Object.create(null)
        const push = (value) => {
          const path = String(value)
          if (path === '' || seen[path] === true) return
          seen[path] = true
          targets.push(path)
        }
        for (const root of roots) push(root)
        for (const key of Object.keys(expanded)) {
          if (expanded[key] === true) push(key)
        }
        if (targets.length === 0) {
          say('没有可刷新的目录')
          return
        }
        setRefreshing(true)
        say('正在重新扫描 ' + targets.length + ' 个目录…')
        const dead = []
        let left = targets.length
        const finish = () => {
          setRefreshing(false)
          if (dead.length === 0) {
            say('已刷新 ' + targets.length + ' 个目录')
            return
          }
          // 目录已经不存在了：从展开表里剔掉，免得节点一直挂着「加载中…」。
          setExpanded((prev) => {
            const next = Object.assign({}, prev)
            for (const path of dead) delete next[path]
            return next
          })
          say('已刷新 ' + (targets.length - dead.length) + ' 个目录，' + dead.length + ' 个已失效（已收起）')
        }
        for (const target of targets) {
          callApi('list', { dir: target }).then((res) => {
            if (res && res.ok) storeNode(target, res)
            else dead.push(target)
          }).catch(() => { dead.push(target) }).then(() => {
            left -= 1
            if (left === 0) finish()
          })
        }
      }

      /**
       * 把一个目录加进根列表（去重）并展开它。
       * @param target - 目录路径。
       */
      const addRoot = (target) => {
        const value = String(target)
        if (value.length === 0) return
        setRoots((prev) => (prev.indexOf(value) >= 0 ? prev : prev.concat([value])))
        setExpanded((prev) => (prev[value] === true ? prev : Object.assign({}, prev, { [value]: true })))
        loadNode(value)
      }

      /** 弹系统目录选择框，把选中的目录加进根列表。 */
      const pickRoot = () => {
        if (busy) return
        setBusy(true)
        say('等你在系统对话框里选文件夹…')
        callApi('pick-dir', {}).then((res) => {
          if (res && res.ok && res.path) {
            addRoot(res.path)
            say('已加入工作区：' + res.path)
          } else if (res && res.cancelled) {
            say('已取消选择')
          } else {
            say('选择失败：' + ((res && res.error) || '未知'))
          }
        }).catch((err) => { say('对话框出错：' + String(err)) }).then(() => { setBusy(false) })
      }

      const refreshDir = (target) => {
        callApi('list', { dir: target }).then((res) => {
          if (res && res.ok) {
            setEntries(res.entries)
            setDir(res.dir)
          } else {
            setEntries([])
            say('列目录失败：' + ((res && res.error) || '未知'))
          }
        }).catch((err) => {
          setEntries([])
          say('列目录出错：' + String(err))
        })
      }

      React.useEffect(() => {
        callApi('fonts', {}).then((res) => {
          if (res && res.ok && res.fonts.length > 0) {
            setFontList(res.fonts)
            fontNoteRef.current = ''
          } else {
            // ⚠ 以前这里静默吞掉失败，UI 只显示内置 5 个字体而用户看不到原因。
            fontNoteRef.current = '字体枚举失败:' + ((res && res.error) || '未知')
            say(fontNoteRef.current)
          }
        }).catch((err) => {
          fontNoteRef.current = '字体枚举出错:' + String(err)
          say(fontNoteRef.current)
        })
      }, [])

      React.useEffect(() => {
        const source = String(text)
        const total = countLines(source)
        setLineCount(total)
        const marksOn = whiteMode && source.length <= VISUAL_LIMIT
        const numsOn = wrap && total > 0 && total <= OVERLAY_LINE_LIMIT
        if (!marksOn && !numsOn) {
          setOverlayNodes(null)
          return
        }
        setOverlayNodes(buildOverlay(source, numsOn, marksOn))
      }, [text, whiteMode, wrap])

      // ── CM6：加载编辑器内核 bundle（只跑一次；失败就永远留在旧路径）──
      React.useEffect(() => {
        if (window.CM6 !== undefined) { setCmReady(true); return undefined }
        let cancelled = false
        const el = document.createElement('script')
        el.src = API + 'vendor?name=cm6.bundle.js'
        el.onload = () => {
          if (cancelled) return
          if (window.CM6 === undefined) setCmFailed(true)
          else setCmReady(true)
        }
        el.onerror = () => { if (!cancelled) setCmFailed(true) }
        document.head.appendChild(el)
        return () => { cancelled = true }
      }, [])

      // ── CM6：建 view ───────────────────────────────────────────────
      // ⚠ 这一层就是「不依赖宽度」的正解：折行点、行号高度、光标位置
      //   全部由 CM6 自己的排版数据给出，不再是两个容器各自折行去猜。
      React.useEffect(() => {
        if (!cmReady) return undefined
        const host = cmHostRef.current
        if (host === null || host === undefined) return undefined
        const CM6 = window.CM6
        const wrapComp = new CM6.Compartment()
        cmWrapCompRef.current = wrapComp
        const wsComp = new CM6.Compartment()
        cmWsCompRef.current = wsComp
        const state = CM6.EditorState.create({
          doc: cmDocRef.current,
          extensions: [
            CM6.lineNumbers(),
            CM6.highlightActiveLine(),
            CM6.highlightSpecialChars(),
            CM6.history(),
            CM6.drawSelection(),
            CM6.keymap.of([
              { key: 'Mod-s', run: () => { const f = saveRef.current; if (f === null) return false; f(); return true } },
              { key: 'Alt-z', run: () => { const f = toggleWrapRef.current; if (f === null) return false; f(); return true } },
              { key: 'Tab', run: (view) => { view.dispatch(view.state.replaceSelection('\t')); return true } },
            ].concat(CM6.defaultKeymap, CM6.historyKeymap)),
            wrapComp.of(wrap ? CM6.EditorView.lineWrapping : []),
            // 空白字符可视化：只在 CM6 里做（叠加符号、不动真字符宽度 ⇒ 折行同
            // 行号都唔会漂）。函数缺失时降级为空扩展，唔会影响编辑器本身。
            wsComp.of(whiteMode && typeof CM6.whitespace === 'function' ? CM6.whitespace() : []),
            CM6.EditorView.updateListener.of((update) => {
              if (!update.docChanged) return
              const next = update.state.doc.toString()
              cmDocRef.current = next
              setText(next)
            }),
          ],
        })
        const view = new CM6.EditorView({ state: state, parent: host })
        cmViewRef.current = view
        // ── 行号栏：横向滚动中淡出 ─────────────────────────────────────
        // 为什么要这样：行号栏是 sticky 的，内容会从它【底下】滑过；CM6 官方
        // 靠一个不透明底色把滑过的内容挡住。用户不要那条色带，所以底色留透明，
        // 改为在「横向滚动中」把整条行号栏淡出 —— 不会出现「文字压在行号上」，
        // 也不会画任何色块。滚回最左（scrollLeft === 0）就恢复。
        const scroller = host.querySelector('.cm-scroller')
        const gutter = host.querySelector('.cm-gutters')
        let onScroll = null
        if (scroller !== null && gutter !== null) {
          onScroll = () => {
            gutter.style.opacity = scroller.scrollLeft > 0 ? '0' : ''
          }
          scroller.addEventListener('scroll', onScroll, { passive: true })
          onScroll()
        }
        // ⚠ CM6 感知唔到「外层容器被重新布局」（拖窗、展收工具栏、换字体、
        //   文件树宽度变化…）。唔重新测量嘅话，.cm-scroller 会照旧尺寸算，
        //   表现出来就係「滚动条位置唔对、底部拖拽热区被挤走」。
        let ro = null
        if (typeof ResizeObserver === 'function') {
          ro = new ResizeObserver(() => { view.requestMeasure() })
          ro.observe(host)
        }
        return () => {
          if (onScroll !== null && scroller !== null) {
            scroller.removeEventListener('scroll', onScroll)
          }
          if (ro !== null) ro.disconnect()
          view.destroy()
          cmViewRef.current = null
        }
      }, [cmReady])

      // ── CM6：浮窗尺寸 / 字体 / 工具栏变化之后补一次重新测量 ─────────
      React.useEffect(() => {
        const view = cmViewRef.current
        if (view === null || view === undefined) return
        view.requestMeasure()
        // ── 尺寸自检（临时诊断）────────────────────────────────────
        // 刷新之后状态栏会报各层实测高度：
        //   健康：stk ≈ cm ≈ ed ≈ scr（四个数差不多）
        //   病征：ed / scr 明显细过 cm ⇒ 高度冇传落去 ⇒ 滚动条会缩到中间
        const host = cmHostRef.current
        if (host === null || host === undefined) return
        const timer = setTimeout(() => {
          try {
            const h = (el) => (el === null || el === undefined
              ? -1 : Math.round(el.getBoundingClientRect().height))
            const note = fontNoteRef.current === '' ? '字体OK' : fontNoteRef.current
            say('尺寸 stk=' + h(host.parentNode) + ' cm=' + h(host)
              + ' ed=' + h(host.querySelector('.cm-editor'))
              + ' scr=' + h(host.querySelector('.cm-scroller')) + ' · ' + note)
          } catch (error) { /* 自检失败唔影响使用 */ }
        }, 400)
        return () => { clearTimeout(timer) }
      }, [box.x, box.y, box.w, box.h, fontSize, fontFamily, fileWidth, showTools, cmReady])

      // ── CM6：text 变了（打开文件等）就同步进 view ───────────────────
      React.useEffect(() => {
        cmDocRef.current = text
        const view = cmViewRef.current
        if (view === null || view === undefined) return
        const current = view.state.doc.toString()
        if (current === text) return
        view.dispatch({ changes: { from: 0, to: current.length, insert: text } })
      }, [text, cmReady])

      // ── CM6：换行开关 → Compartment 重组（不重建 view、不丢光标）────
      React.useEffect(() => {
        const view = cmViewRef.current
        const comp = cmWrapCompRef.current
        if (view === null || view === undefined) return
        if (comp === null || comp === undefined) return
        view.dispatch({
          effects: comp.reconfigure(wrap ? window.CM6.EditorView.lineWrapping : []),
        })
      }, [wrap, cmReady])

      // ── CM6：空白字符开关 → Compartment 重组 ───────────────────────
      React.useEffect(() => {
        const view = cmViewRef.current
        const comp = cmWsCompRef.current
        if (view === null || view === undefined) return
        if (comp === null || comp === undefined) return
        const CM6 = window.CM6
        const on = whiteMode && typeof CM6.whitespace === 'function'
        view.dispatch({ effects: comp.reconfigure(on ? CM6.whitespace() : []) })
      }, [whiteMode, cmReady])

      const openPath = (target) => {
        if (busy) return
        setBusy(true)
        say('读取中…')
        callApi('read', { path: target }).then((res) => {
          if (res && res.ok) {
            // 记住这个文件原本的行尾符（CRLF / LF），保存时按原样写回 ——
            // 不要在「打开→保存」之间偷偷把别人的 CRLF 文件改成 LF。
            crlfRef.current = res.text.indexOf('\r\n') >= 0
            setText(res.text)
            setLoaded(res.text)
            setPath(target)
            setScrollTop(0)
            setScrollLeft(0)
            say('已载入：' + (res.display || target) + '（' + res.size + ' 字）')
            setDiskVersion(res.version === undefined ? null : res.version)
            // 必要时把它所在目录加进根列表 —— 但**只有**这个目录不落在任何已有根
            // 底下时才加。否则从树里点开某个子目录里的文件，底下就会凭空多出
            // 一个跟原来子目录重复的根（2026-10-20 用户报的就是这个）。
            const parentDir = dirOf(target)
            if (!roots.some((root) => isUnderPath(parentDir, root))) addRoot(parentDir)
          } else {
            setLoaded('')
            say('读不到：' + ((res && res.error) || '未知错误'))
          }
        }).catch((err) => {
          setLoaded('')
          say('读取出错：' + String(err))
        }).then(() => { setBusy(false) })
      }

      React.useEffect(() => { openPath(startPath) }, [])

      // 视口变化（改显示缩放／接外接屏／拉窗口）时，把浮窗和迷你条夹回可见范围。
      // 不然旧坐标可能整块落到屏幕外，表现出来就是「浮窗／挂件不见了」。
      React.useEffect(() => {
        const onResize = () => {
          setBox((prev) => clampBox(prev, false))
          setMiniAt((prev) => {
            const vw = window.innerWidth
            const vh = window.innerHeight
            return {
              x: Math.min(Math.max(0, prev.x), Math.max(0, vw - MINI_W)),
              y: Math.min(Math.max(0, prev.y), Math.max(0, vh - MINI_H)),
            }
          })
        }
        window.addEventListener('resize', onResize)
        return () => { window.removeEventListener('resize', onResize) }
      }, [])

      // 装载时校验根列表。早前版本嘅「添加文件夹」误用咗选【文件】对话框，
      // 会把文件路径当成根存下去 —— 之后喺文件树顶层渲染成一条展开唔到、
      // 又移除唔到嘅孤儿条目。这里逐个探一下，把呢种脏数据清走。
      // 只剔除「明确唔係目录」嘅；盘符离线、目录暂时唔存在等情况一律保留，
      // 免得误删用户自己加嘅根。
      React.useEffect(() => {
        let cancelled = false
        Promise.all(roots.map((r) => callApi('list', { dir: r })
          .then((res) => {
            if (res && res.ok) return r
            const msg = (res && res.error) || ''
            return msg.indexOf('不是目录') >= 0 ? null : r
          })
          .catch(() => r)))
          .then((kept) => {
            if (cancelled) return
            const good = kept.filter((item) => item !== null)
            if (good.length === roots.length) return
            setRoots(good)
            say('已清掉 ' + (roots.length - good.length) + ' 个唔係文件夹嘅失效根条目')
          })
        return () => { cancelled = true }
      }, [])

      // 首屏把已保存的根全部展开并加载一次。
      React.useEffect(() => {
        const next = {}
        for (const root of roots) {
          next[root] = true
          loadNode(root)
        }
        setExpanded((prev) => Object.assign({}, prev, next))
      }, [])

      // 任何一项变咗：① 写一份 localStorage 当启动缓存 ② 节流写进 settings.json（真源）。
      const saveToFile = React.useMemo(() => makeFileSaver(), [])
      React.useEffect(() => {
        const full = {
          mode: mode, path: path, alpha: alpha, bg: bg, fg: fg,
          fontFamily: fontFamily, fontSize: fontSize,
          whiteMode: whiteMode, wrap: wrap, fileWidth: fileWidth, showTools: showTools,
          box: box, miniAt: miniAt, roots: roots, rootWritable: rootWritable,
        }
        cacheSettings(full)
        saveToFile(full)
      }, [mode, path, alpha, bg, fg, fontFamily, fontSize, whiteMode, wrap, fileWidth, showTools, box, miniAt, roots, rootWritable, saveToFile])

      // 外部修改探测：每 2 秒看一次文件 version（只读元数据，不读内容）。
      //   · 本地没有未保存改动 → 自动重新载入
      //   · 本地有未保存改动   → 只提示，绝不自动覆盖用户的编辑
      React.useEffect(() => {
        const timer = setInterval(() => {
          if (busy) return
          callApi('stat', { path: path }).then((res) => {
            if (!res || !res.ok) return
            const next = res.version === undefined ? null : res.version
            if (next === null) return
            if (diskVersion === null) {
              setDiskVersion(next)
              return
            }
            if (next === diskVersion) return
            if (dirty) {
              say('⚠ 文件已被其他程序修改（此时保存会覆盖它）—— 想放弃本地改动就按「打开」重载')
              setDiskVersion(next)
              return
            }
            say('检测到外部修改，已自动重新载入')
            openPath(path)
          }).catch(() => {})
        }, 2000)
        return () => clearInterval(timer)
      }, [path, diskVersion, dirty, busy])

      const save = () => {
        if (busy) return
        setBusy(true)
        say('保存中…')
        callApi('save', {
          path: path,
          // 原来是什么行尾符就写回什么（CRLF 文件不要被悄悄改成 LF）。
          text: crlfRef.current ? text.split('\r\n').join('\n').split('\n').join('\r\n') : text,
          roots: rootWritable ? roots : [],
        }).then((res) => {
          if (res && res.ok) {
            setLoaded(text)
            setDiskVersion(res.version === undefined ? null : res.version)
            say('已保存 ✓ ' + (res.operation === 'create' ? '（新建）' : '（覆盖）') + '  策略：' + (res.policy || '默认'))
          } else {
            say('保存失败：' + ((res && res.error) || '未知错误'))
          }
        }).catch((err) => {
          say('保存出错：' + String(err))
        }).then(() => { setBusy(false) })
      }

      const browse = () => {
        if (busy) return
        setBusy(true)
        say('等你在系统对话框里选文件…')
        callApi('pick', {}).then((res) => {
          if (res && res.ok && res.path) openPath(res.path)
          else if (res && res.cancelled) say('已取消选择')
          else say('选择失败：' + ((res && res.error) || '未知错误'))
        }).catch((err) => {
          say('对话框出错：' + String(err))
        }).then(() => { setBusy(false) })
      }

      const openExternal = () => {
        if (busy) return
        setBusy(true)
        say('启动 Notepad++…')
        callApi('open-external', { path: path }).then((res) => {
          if (res && res.ok) say('已用 Notepad++ 打开')
          else say('启动失败：' + ((res && res.error) || '未知错误'))
        }).catch((err) => {
          say('出错：' + String(err))
        }).then(() => { setBusy(false) })
      }

      const beginDrag = (kind, event, base, origin) => {
        setDrag({
          kind: kind,
          sx: event.clientX, sy: event.clientY,
          ox: origin === undefined ? box.x : origin.x,
          oy: origin === undefined ? box.y : origin.y,
          ow: box.w, oh: box.h,
          base: base === undefined ? 0 : base,
        })
        event.preventDefault()
      }

      const applyDrag = (dx, dy) => {
        if (drag === null) return
        if (drag.kind === 'move') {
          // slack=true：拖动时允许探出去，但至少留一角能抓回来。
          setBox(clampBox({ x: drag.ox + dx, y: drag.oy + dy, w: drag.ow, h: drag.oh }, true))
          return
        }
        if (drag.kind === 'mini') {
          setMiniAt({ x: drag.ox + dx, y: drag.oy + dy })
          return
        }
        if (drag.kind === 'split') {
          const next = drag.base + dx
          // 从 0 拖出来时直接跳到最小可见宽度：否则「拖一下松手」只会得到几像素，
          // 文件列表虽然渲染了但阔度近乎 0，看起来就像「拉不出来」。
          setFileWidth(next < 8 ? 0 : Math.max(60, Math.min(430, next)))
          return
        }
        const dir = drag.kind.slice(5)
        let x = drag.ox
        let y = drag.oy
        let w = drag.ow
        let h = drag.oh
        if (dir.indexOf('e') >= 0) w = Math.max(MIN_W, drag.ow + dx)
        if (dir.indexOf('s') >= 0) h = Math.max(MIN_H, drag.oh + dy)
        if (dir.indexOf('w') >= 0) {
          w = Math.max(MIN_W, drag.ow - dx)
          x = drag.ox + (drag.ow - w)
        }
        if (dir.indexOf('n') >= 0) {
          h = Math.max(MIN_H, drag.oh - dy)
          y = drag.oy + (drag.oh - h)
        }
        setBox(clampBox({ x: x, y: y, w: w, h: h }, true))
      }

      const minimize = () => {
        setMiniAt({ x: box.x + box.w - MINI_W, y: box.y })
        setMode('mini')
      }

      const restore = () => {
        // ⚠ 直接取 box 里的尺寸，不要另存一份「收起前嘅尺寸」：
        //   box 本身已经落 localStorage，而那份额外 state 冇持久化。
        //   一旦上次离开时系迷你态（mode:"mini"），重启后展开就永远拿到
        //   默认 760×500 —— 表现为「窗口长阔冇被记住」。
        const w = Math.max(MIN_W, box.w)
        const h = Math.max(MIN_H, box.h)
        const right = miniAt.x + MINI_W
        setBox(clampBox({ x: right - w, y: miniAt.y, w: w, h: h }, false))
        setMode('open')
      }

      const toggleWrap = () => {
        const next = !wrap
        setWrap(next)
        if (!next) say('自动换行：关')
        else if (lineCount === 0) say('自动换行：开（文件太大，行号隐藏）')
        else if (lineCount > OVERLAY_LINE_LIMIT) say('自动换行：开（超过 ' + OVERLAY_LINE_LIMIT + ' 行，行号隐藏）')
        else say('自动换行：开（行号保留，折行延续行留空）')
      }

      /**
       * Ctrl+滚轮 调字号（VS Code 同款手感）。
       * ⚠ 必须判 ctrlKey：<textarea> 上的滚轮本来是滚动内容的，不加这个判断
       *   就会把最基本、最常用的滚动功能吃掉。
       * 挂在浮窗根节点上，所以标题栏／文件树／状态栏上滚也一样有效。
       */
      const onWinWheel = (event) => {
        if (!event.ctrlKey) return
        event.preventDefault()
        // ⚠ 在 SIZE_CHOICES 的相邻档位之间走，不要自己算小数：
        //   算出来的 13.5 如果不在列表里，<select> 就匹配不到、回退显示
        //   第一项（8px），看起来像「数字在 8 跟真值之间乱跳」。
        let idx = 0
        let best = Infinity
        for (let i = 0; i < SIZE_CHOICES.length; i += 1) {
          const dist = Math.abs(SIZE_CHOICES[i] - fontSize)
          if (dist < best) { best = dist; idx = i }
        }
        const nextIdx = Math.min(SIZE_CHOICES.length - 1, Math.max(0, idx + (event.deltaY < 0 ? 1 : -1)))
        const next = SIZE_CHOICES[nextIdx]
        if (next === fontSize) return
        setFontSize(next)
        say('字号 ' + next + 'px')
      }

      const onAreaKeyDown = (event) => {
        const lower = String(event.key).toLowerCase()
        if (event.altKey && lower === 'z') {
          event.preventDefault()
          toggleWrap()
          return
        }
        if ((event.ctrlKey || event.metaKey) && lower === 's') {
          event.preventDefault()
          if (dirty) save()
          else say('没有改动需要保存')
          return
        }
        if (event.key !== 'Tab') return
        event.preventDefault()
        const el = event.target
        const start = el.selectionStart
        const end = el.selectionEnd
        setText(text.slice(0, start) + '\t' + text.slice(end))
        setTimeout(() => {
          el.setSelectionRange(start + 1, start + 1)
        }, 0)
      }

      // CM6 的 keymap 通过 ref 拿最新的 save / toggleWrap，
      // 否则会闭包捕获旧的 dirty / wrap。
      saveRef.current = save
      toggleWrapRef.current = toggleWrap

      const veil = drag === null ? null : h('div', {
        className: 'fe-editor-veil' + (drag.kind.indexOf('size') === 0 ? ' is-size' : ''),
        onMouseMove: (event) => {
          applyDrag(event.clientX - drag.sx, event.clientY - drag.sy)
        },
        onMouseUp: () => { setDrag(null) },
        onMouseLeave: () => { setDrag(null) },
      })

      // 迷你条：只在迷你态显示。窗口本体见下面的 windowNode —— 它**永远**挂着，
      // 迷你态只是 display:none（理由见 windowNode 上方那段注释）。
      const miniBar = mode !== 'mini' ? null : h('div', {
        onMouseUp: () => { if (drag !== null) setDrag(null) },
      },
        veil,
        h('div', {
          className: 'fe-editor-mini',
          style: {
            '--fe-alpha': alpha, '--fe-bg': bg, '--fe-fg': fg,
            '--fe-font': quoteFont(fontFamily) + ',monospace',
            left: miniAt.x + 'px', top: miniAt.y + 'px',
          },
        },
          h('span', {
            className: 'fe-editor-mini-title',
            title: '拖动移动位置',
            onMouseDown: ((at) => (event) => { beginDrag('mini', event, 0, at) })(miniAt),
          }, basenameOf(path) === '' ? '浮窗编辑器' : basenameOf(path)),
          h('button', {
            className: 'fe-editor-mini-btn', type: 'button',
            title: '展开',
            onMouseDown: stop,
            onClick: restore,
          }, '+'),
        ),
      );

      /**
       * 递归渲染一棵目录树；depth 只用来做左侧缩进。
       *
       * ⚠ keyBase 是这个子树在【整个列表】里的唯一前缀（根 + 逐级名字）。
       *   不能直接拿物理路径当 React key：同一个目录完全可能同时出现在两处
       *   （既是根、又是另一个根下面的子目录；或者两个根互相包含），那时两条
       *   子树里同一批文件会算出相同 key ⇒ React 复用错乱：DOM 里堆出重复行、
       *   点「收起」也收不掉，越点越多。（2026-10-20 实测复现，实测 6 份重复）
       */
      const renderTree = (parent, depth, keyBase) => {
        const node = tree[parent]
        const out = []
        const pad = { paddingLeft: (8 + depth * 12) + 'px' }
        if (node === undefined) {
          out.push(h('div', { className: 'fe-editor-entry is-root-head', key: keyBase + '|loading', style: pad }, '加载中…'))
          return out
        }
        const list = node.entries
        if (list.length === 0) {
          out.push(h('div', { className: 'fe-editor-entry is-root-head', key: keyBase + '|empty', style: pad }, '（空）'))
          return out
        }
        for (const entry of list) {
          const full = joinPath(parent, entry.name)
          const isDir = entry.type === 'directory'
          const open = expanded[full] === true
          const key = keyBase + '\u0000' + entry.name
          out.push(h('div', {
            className: 'fe-editor-entry',
            key: key,
            title: full,
            style: pad,
            onClick: () => { if (isDir) toggleNode(full); else openPath(full) },
            onContextMenu: (event) => { openMenu(event, full, entry.type, roots.indexOf(full) >= 0) },
          }, (isDir ? (open ? '▾ ' : '▸ ') : '   ') + (isDir ? '📁 ' : '📄 ') + entry.name))
          if (isDir && open) {
            for (const child of renderTree(full, depth + 1, key)) out.push(child)
          }
        }
        if (node.truncated) {
          out.push(h('div', {
            className: 'fe-editor-entry is-root-head',
            key: keyBase + '|trunc',
            style: pad,
            title: '目录太大，只列出前 2000 项',
          }, '… 只列出 2000 / 共 ' + node.total + ' 项'))
        }
        return out
      }

      const fileItems = []
      if (fileWidth > 40) {
        if (roots.length === 0) {
          fileItems.push(h('div', {
            className: 'fe-editor-entry is-root-head', key: '__noroot',
          }, '（右键空白处添加文件夹）'))
        }
        for (let r = 0; r < roots.length; r += 1) {
          const root = roots[r]
          const open = expanded[root] === true
          // 根那一行也带上序号：万一 roots 里出现两条一样的路径（旧版本存下来的
          // 脏数据），key 仍然唯一，不至于把整棵树搞乱。
          const rootKey = 'root|' + r + '\u0000' + root
          fileItems.push(h('div', {
            className: 'fe-editor-entry is-root' + (open ? ' is-cur' : ''),
            key: rootKey,
            title: root,
            onClick: () => { toggleNode(root) },
            onContextMenu: (event) => { openMenu(event, root, 'directory', true) },
          }, (open ? '▾ ' : '▸ ') + '📂 ' + (basenameOf(root) === '' ? root : basenameOf(root))))
          if (open) {
            for (const child of renderTree(root, 1, rootKey)) fileItems.push(child)
          }
        }
        // 最后一道保险：可见节点总数封顶（正常用不到，防极端情况）。
        if (fileItems.length > 4000) {
          fileItems.length = 4000
          fileItems.push(h('div', {
            className: 'fe-editor-entry is-root-head', key: '__toomany',
          }, '（一次显示嘅条目太多，已截断 —— 收起部分目录）'))
        }
      }

      const sourceFonts = fontList.length > 0 ? fontList : FALLBACK_FONTS
      const fontOptions = sourceFonts.map((name) => h('option', { key: name, value: name }, name))
      const sizeOptions = SIZE_CHOICES.map((size) => h('option', { key: String(size), value: String(size) }, String(size) + 'px'))

      const overlayOn = overlayNodes !== null
      const marksOn = whiteMode && overlayOn
      const numsOn = wrap && overlayOn
      const areaClass = 'fe-editor-area'
        + (marksOn ? ' is-veiled' : '')
        + (wrap ? ' is-wrap' : '')
        + (numsOn ? ' has-numcol' : '')
      const visualClass = 'fe-editor-visual'
        + (marksOn ? ' is-marks' : '')
        + (wrap ? ' is-wrap' : '')
        + (numsOn ? ' has-numcol' : '')

      const area = h('textarea', {
        className: areaClass,
        value: text, spellCheck: false,
        onChange: (event) => { setText(event.target.value) },
        onKeyDown: onAreaKeyDown,
        onScroll: (event) => {
          setScrollTop(event.target.scrollTop)
          setScrollLeft(event.target.scrollLeft)
        },
      })

      // CM6 就绪 → 编辑区完全交给 CM6（行号同折行由它自己排版，天然对齐）；
      // 未就绪 → 先显示一行提示；加载失败 → 永久退回旧的两层方案。
      const stack = h('div', { className: 'fe-editor-stack' },
        cmReady
          ? h('div', { className: 'fe-editor-cm', ref: cmHostRef })
          : (cmFailed
            ? h('div', null,
              overlayOn ? h('div', { className: 'fe-editor-visual-clip' },
                h('pre', {
                  className: visualClass,
                  style: { transform: 'translate(' + (-scrollLeft) + 'px,' + (-scrollTop) + 'px)' },
                }, overlayNodes),
              ) : null,
              area,
            )
            : h('div', { className: 'fe-editor-cm-loading' }, '正在加载编辑器内核（CodeMirror 6）…')),
      )

      const grips = GRIP_DIRS.map((dir) => h('div', {
        key: dir,
        className: 'fe-editor-grip ' + dir,
        onMouseDown: (event) => { beginDrag('size:' + dir, event) },
      }))

      // 行号栏宽度自适应：按行号位数算（等宽字体下数字宽约 0.62em），再留 12px 内边距。
      // 三种形态（独立栏 / 叠加层行号 / 编辑区左内边距）共用同一个值，切换换行时不会跳。
      const numDigits = String(Math.max(1, lineCount)).length
      const numWidth = Math.ceil(numDigits * fontSize * 0.62) + 12
      /** 右键菜单节点；点其他地方或者再右键就关掉。 */
      const menuNode = menu === null ? null : h('div', null,
        h('div', {
          className: 'fe-editor-veil',
          style: { zIndex: 2147483500, cursor: 'default' },
          onClick: () => { setMenu(null) },
          onContextMenu: (event) => { event.preventDefault(); setMenu(null) },
        }),
        h('div', {
          className: 'fe-editor-menu',
          style: { left: menu.x + 'px', top: menu.y + 'px' },
        },
          // 文件才有「打开」（目录不再显示「进入」—— 点条目本身就展开）。
          menu.type === 'file' ? h('div', {
            className: 'fe-editor-menu-item', key: 'open',
            onClick: () => { const p = menu.path; setMenu(null); openPath(p) },
          }, '打开') : null,
          // 空白处右键：整个菜单只有一项。
          menu.type === 'area' ? h('div', {
            className: 'fe-editor-menu-item', key: 'addonly',
            onClick: () => { setMenu(null); pickRoot() },
          }, '添加文件夹…') : null,
          menu.path === '' ? null : h('div', {
            className: 'fe-editor-menu-item', key: 'reveal',
            onClick: () => {
              const p = menu.path
              setMenu(null)
              say('正在文件管理器定位…')
              callApi('reveal', { path: p }).then((res) => {
                if (res && res.ok) say('已在文件管理器定位')
                else say('定位失败：' + ((res && res.error) || '未知'))
              }).catch((err) => { say('定位出错：' + String(err)) })
            },
          }, '在文件管理器打开'),
          menu.type === 'directory' ? h('div', {
            className: 'fe-editor-menu-item', key: 'term',
            onClick: () => {
              const p = menu.path
              setMenu(null)
              say('正在开命令行窗口…')
              callApi('open-terminal', { dir: p }).then((res) => {
                if (res && res.ok) say('已开命令行窗口')
                else say('开命令行失败：' + ((res && res.error) || '未知'))
              }).catch((err) => { say('出错：' + String(err)) })
            },
          }, '命令行打开') : null,
          menu.path === '' ? null : h('div', { className: 'fe-editor-menu-sep', key: 'sep1' }),
          menu.path === '' ? null : h('div', {
            className: 'fe-editor-menu-item', key: 'copy',
            onClick: () => {
              const p = menu.path
              setMenu(null)
              say(copyText(p) ? '已复制路径' : '复制失败')
            },
          }, '复制路径'),
          menu.type === 'directory' && !menu.isRoot ? h('div', {
            className: 'fe-editor-menu-item', key: 'addroot',
            onClick: () => {
              const p = menu.path
              setMenu(null)
              // 走 addRoot：它会去重、顺手展开并加载子项。
              addRoot(p)
              say('已加为根目录')
            },
          }, '加为根目录') : null,
          menu.isRoot ? h('div', {
            className: 'fe-editor-menu-item', key: 'delroot',
            onClick: () => {
              const p = menu.path
              setMenu(null)
              setRoots(roots.filter((r) => r !== p))
              say('已移除此根目录')
            },
          }, '移除此根目录') : null,
        ),
      )

      // CM6 模式下行号由 CM6 自己画，旧的独立行号栏一律不渲染。
      const gutterText = (wrap || cmReady) ? '' : buildGutter(lineCount)

      // ⚠⚠ 收成迷你条时【绝对不可以】把窗口 unmount 掉。
      //   2026-09-27 踩过：原来 `if (mode === 'mini') return 迷你条`，于是整个
      //   `.fe-editor-win`（连同里面的 CM6 宿主节点）被卸载 → 建 view 的那个
      //   effect 的 cleanup 把 view 销毁了；而它的依赖是 `[cmReady]`（没变），
      //   所以展开时【不会】重建 → 编辑区剩一个空 div，文档看不见，
      //   只能 Ctrl+Shift+R 强刷才回来。
      //   现在改成：窗口永远挂在树上，迷你态只是 `display:none`。
      //   顺带保住了滚动位置、光标、undo 历史。
      const windowNode = h('div', {
        className: 'fe-editor-win',
        onWheel: onWinWheel,
        style: {
          '--fe-alpha': alpha, '--fe-bg': bg, '--fe-fg': fg,
          '--fe-font': quoteFont(fontFamily) + ',monospace',
          '--fe-size': fontSize + 'px',
          '--fe-numw': numWidth + 'px',
          left: box.x + 'px', top: box.y + 'px',
          width: box.w + 'px', height: box.h + 'px',
          display: mode === 'mini' ? 'none' : 'flex',
        },
      },
          h('div', {
            className: 'fe-editor-head',
            onMouseDown: (event) => { beginDrag('move', event) },
          },
            h('span', { className: 'fe-editor-title' },
              '📝 ' + (path === '' ? '浮窗编辑器' : basenameOf(path)) + (dirty ? ' *' : '')),
            h('span', { className: 'fe-editor-alpha', onMouseDown: stop },
              h('input', {
                className: 'fe-editor-slider', type: 'range', min: '0', max: '100',
                value: String(alphaToSlider(alpha)),
                onChange: (event) => { setAlpha(sliderToAlpha(event.target.value)) },
              }),
              h('span', { className: 'fe-editor-alpha-val' }, Math.round(alpha * 100) + '%'),
            ),
            h('button', {
              className: 'fe-editor-head-btn', type: 'button',
              title: '缩小到右上角',
              onMouseDown: stop,
              onClick: minimize,
            }, '—'),
          ),
          h('div', { className: 'fe-editor-tools' },
            h('button', {
              className: 'fe-editor-btn', type: 'button',
              title: '刷新文件列表（重新扫描所有根目录同已展开嘅文件夹）',
              onClick: refreshAll, disabled: refreshing,
            }, refreshing ? '…' : '⟳'),
            h('input', {
              className: 'fe-editor-path', value: path, spellCheck: false,
              placeholder: '文件完整路径',
              onChange: (event) => { setPath(event.target.value) },
            }),
            h('button', { className: 'fe-editor-btn', type: 'button', onClick: () => { openPath(path) }, disabled: busy }, '打开'),
            h('button', {
              className: 'fe-editor-btn', type: 'button',
              title: '保存（Ctrl+S）',
              onClick: save, disabled: busy || !dirty,
            }, dirty ? '保存 *' : '保存'),
            h('button', { className: 'fe-editor-btn', type: 'button', onClick: browse, disabled: busy }, '浏览…'),
            h('button', {
              className: 'fe-editor-btn', type: 'button',
              title: '用 Notepad++ 打开（外部程序，自己读写文件）',
              onClick: openExternal, disabled: busy,
            }, 'np++'),
            h('button', {
              className: 'fe-editor-btn' + (showTools ? ' is-on' : ''), type: 'button',
              title: showTools ? '隐藏下面嘅控件行' : '显示下面嘅控件行',
              onClick: () => { setShowTools(!showTools) },
            }, showTools ? '▾' : '◂'),
          ),
          showTools ? h('div', { className: 'fe-editor-tools' },
            h('span', { className: 'fe-editor-tag' }, 'Font'),
            h('select', {
              className: 'fe-editor-select', value: fontFamily,
              onChange: (event) => { setFontFamily(event.target.value) },
            }, fontOptions),
            h('span', { className: 'fe-editor-tag' }, 'Size'),
            h('select', {
              className: 'fe-editor-select', value: String(fontSize),
              onChange: (event) => { setFontSize(Number(event.target.value)) },
            }, sizeOptions),
            h('span', { className: 'fe-editor-tag' }, 'Bg'),
            h('input', {
              className: 'fe-editor-swatch', type: 'color', value: bg,
              onChange: (event) => { setBg(event.target.value) },
            }),
            h('span', { className: 'fe-editor-tag' }, '字色'),
            h('input', {
              className: 'fe-editor-swatch', type: 'color', value: fg,
              onChange: (event) => { setFg(event.target.value) },
            }),
            h('button', {
              className: 'fe-editor-btn' + (whiteMode ? ' is-on' : ''), type: 'button',
              title: '在编辑区显示空格（·）和 Tab（→），仍然可以编辑',
              onClick: () => { setWhiteMode(!whiteMode) },
            }, '空白字符'),
            h('button', {
              className: 'fe-editor-btn' + (wrap ? ' is-on' : ''), type: 'button',
              title: '自动换行（Alt+Z）',
              onClick: toggleWrap,
            }, wrap ? '换行开' : '换行关'),
            h('div', {
              className: 'fe-editor-check',
              title: '打开时，左边文件树里你加的文件夹都可以保存（不再限于 DSH 工作区）。仍然受 DSH 沙箱约束，不是全盘放行。',
              onClick: () => { setRootWritable(!rootWritable) },
            },
              h('span', { className: 'fe-editor-switch' + (rootWritable ? ' is-on' : '') },
                h('span', { className: 'fe-editor-switch-knob' }),
              ),
              h('span', null, '文件树可写'),
            ),
          ) : null,
          h('div', { className: 'fe-editor-body' },
            fileWidth > 0 ? h('div', {
              className: 'fe-editor-files',
              style: { width: fileWidth + 'px' },
              // 右键列表空白处 → 在鼠标处弹一个只有「添加文件夹…」的小菜单
              onContextMenu: (event) => {
                event.preventDefault()
                event.stopPropagation()
                setMenu({ x: event.clientX, y: event.clientY, path: '', type: 'area', isRoot: false })
              },
            }, fileItems) : null,
            h('div', {
              className: 'fe-editor-split',
              // 文件列表收埋时，分隔条会贴到窗口左边界，同「左边界 resize 手柄」重叠。
              // 让开 5px，避免两者争同一块鼠标区域。
              style: fileWidth < 8 ? { marginLeft: '5px' } : undefined,
              title: '拖动改变文件列表宽度',
              onMouseDown: (event) => { beginDrag('split', event, fileWidth) },
            }),
            h('div', { className: 'fe-editor-code' },
              gutterText === '' ? null : h('div', { className: 'fe-editor-gutter-box' },
                h('pre', {
                  className: 'fe-editor-gutter',
                  style: { transform: 'translateY(' + (-scrollTop) + 'px)' },
                }, gutterText),
              ),
              stack,
            ),
          ),
          h('div', { className: 'fe-editor-status', title: status }, status),
          grips,
        );

      return h('div', { onMouseUp: () => { if (drag !== null) setDrag(null) } },
        veil, menuNode, miniBar, windowNode)
    }

    /**
     * 插入（或刷新）插件自己的样式表。
     * 静态插件没有 styles.insert 服务，直接操作 document。
     * @returns 卸载时移除该 <style> 的函数。
     */
    function installCss() {
      let el = document.getElementById(STYLE_ID)
      if (el === null) {
        el = document.createElement('style')
        el.id = STYLE_ID
        document.head.appendChild(el)
      }
      el.textContent = CSS
      return () => {
        const current = document.getElementById(STYLE_ID)
        if (current !== null) current.remove()
      }
    }

    const inject = ['slots']

    /**
     * 插件入口。
     * @param ctx - client cordis context。
     */
    function apply(ctx) {
      const slots = ctx.get('slots')
      if (slots === undefined) return

      ctx.effect(() => installCss(), 'dsh-floating-editor: styles')
      ctx.effect(() => slots.inject('shell.overlay', () => slots.register(
        { name: 'shell.overlay', id: 'fe-text-editor', order: 6 },
        FloatEditor,
      )), 'dsh-floating-editor: overlay')

      console.log('dsh-floating-editor client ready (static)')
    }

    exports.name = 'dsh-floating-editor'
    exports.inject = inject
    exports.apply = apply
    return module.exports
  },
})
