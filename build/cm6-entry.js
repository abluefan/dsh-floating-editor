// CM6 bundle 入口 —— 只取浮窗编辑器真正需要的那几块。
//
// 产出：lib/vendor/cm6.bundle.js（IIFE，暴露 window.CM6）
// 跑法：node build/build-cm6.mjs
//
// ⚠ 改动本文件之后必须重新打包，否则 client 加载到的仍是旧 bundle。
// ⚠⚠ 必须用 import 真正【引入本地作用域】：
//   `export { X } from '...'` 只係「重新导出」，唔会在本模块作用域里绑定 X。
//   下面 whitespace() 用到 Decoration / ViewPlugin / EditorView —— 若只写 export
//   就会 ReferenceError，而 IIFE 顶层抛错 = 整份 bundle 作废 = window.CM6 冇定义，
//   客户端会一路静默退回旧方案（2026-09-27 踩过：报错 Decoration is not defined）。
import { RangeSetBuilder } from '@codemirror/state'
import { Decoration, ViewPlugin, EditorView, WidgetType } from '@codemirror/view'

export { EditorState, Compartment, StateEffect, RangeSetBuilder } from '@codemirror/state'

export {
  EditorView,
  lineNumbers,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  drawSelection,
  dropCursor,
  rectangularSelection,
  crosshairCursor,
  keymap,
  ViewPlugin,
  Decoration,
  WidgetType,
} from '@codemirror/view'

export {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
  undo,
  redo,
} from '@codemirror/commands'

// ── 空白字符可视化（旧版「空白字符」按钮的等价物）────────────────────
//
// 空格显示「·」、Tab 显示「→」，但【不动真字符】。
//
// ⚠ 为什么不用 Decoration.replace 把空格换成 widget：
//   替换会改变字符宽度 ⇒ 折行点跟着变 ⇒ 「行号对齐」又变成一件要祈祷的事。
//   这里只在真字符上叠加一个绝对定位的伪元素符号，宽度一个像素都不动，
//   所以开了这个功能之后，行号、光标、折行点全都不会漂。
//
// ⚠ 只处理可见范围（visibleRanges）：整份文件里空格成千上万，
//   全量加 span 会直接拖死浏览器 —— 而看不见的地方本来也不用显示。
const WS_SPACE = 'cm-ws-space'
const WS_TAB = 'cm-ws-tab'
const spaceMark = Decoration.mark({ class: WS_SPACE })
const tabMark = Decoration.mark({ class: WS_TAB })

/**
 * 扫可见范围，给每个空格 / Tab 加一个 mark decoration。
 * @param view - EditorView。
 * @returns RangeSet。
 */
function buildWsDecorations(view) {
  const builder = new RangeSetBuilder()
  let last = -1
  for (const range of view.visibleRanges) {
    let pos = range.from
    while (pos <= range.to) {
      const line = view.state.doc.lineAt(pos)
      const text = line.text
      for (let i = 0; i < text.length; i += 1) {
        const ch = text.charAt(i)
        if (ch !== ' ' && ch !== '\t') continue
        const from = line.from + i
        // RangeSetBuilder 要求严格递增：多个 visibleRange 可能覆盖同一行，
        // 重复位置会直接抛错。
        if (from <= last) continue
        builder.add(from, from + 1, ch === ' ' ? spaceMark : tabMark)
        last = from
      }
      pos = line.to + 1
    }
  }
  return builder.finish()
}

const wsPlugin = ViewPlugin.fromClass(class {
  constructor(view) {
    this.decorations = buildWsDecorations(view)
  }

  update(update) {
    if (update.docChanged || update.viewportChanged) {
      this.decorations = buildWsDecorations(update.view)
    }
  }
}, { decorations: (v) => v.decorations })

const wsTheme = EditorView.baseTheme({
  '.cm-ws-space': { position: 'relative' },
  '.cm-ws-space::before': {
    content: '"·"',
    position: 'absolute', top: '0', left: '0', right: '0',
    textAlign: 'center', opacity: '0.35', pointerEvents: 'none',
  },
  '.cm-ws-tab': { position: 'relative' },
  '.cm-ws-tab::before': {
    content: '"→"',
    position: 'absolute', top: '0', left: '0', right: '0',
    textAlign: 'center', opacity: '0.35', pointerEvents: 'none',
  },
})

/**
 * 空白字符可视化扩展（可放进 Compartment 开关）。
 * @returns 扩展数组。
 */
export function whitespace() {
  return [wsPlugin, wsTheme]
}
