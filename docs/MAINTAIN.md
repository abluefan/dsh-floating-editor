# 维护 · CM6 打包 · 已知限制 · 待定

> 📖 返回 [README](../README.md) · 相关：[API.md](API.md) · [TREE.md](TREE.md) · [PITFALLS.md](PITFALLS.md)


## 一、日常维护

- **改源码后**：`node --check lib/client.js` → 括号计数 → 手动 `Copy-Item` 到
  `node_modules`（**`edit` 工具会打断 pnpm 的硬链接**，两边就不一致了）
  → **Host 改动要重启 DSH，Client 改动强刷（Ctrl+Shift+R）即可**。
  > ⚠ Client 改动**不刷新页面完全不生效**。典型误判：「我改了啊怎么没反应」／
  > 「编辑区一片空白」—— 九成是没强刷，跑着旧代码。
- **改 profile 的 `cordis.patch.yml`** 会触发一次热重载：
  改**已有行**的 config 会拆掉活会话（表现为浏览器标记 removed、输入框 disabled，F5 恢复）；
  追加新行才无感。
- **回滚**：`备份目录\` 里有带时间戳的 `dsh-floating-editor.*\`（整包）
  与 `profiles-web-cordis.patch.yml.*` / `profiles-web-package.json.*`，
  复制回去 + 重启即可。**旧备份不要删。**
- **调试**：日志在 `dsh_data_files\launcher\logs\dsh-<启动时间戳>.out.log`
  （`console.log` 走 `.out.log`，`.err.log` 未必有东西）。
  Host 半边在 `apply()` 里打了 4 行诊断日志，重启后可直接确认有没有加载。


## 二、CodeMirror 6 内核（2026-09-27 换装）

**结论先说**：编辑器内核已经是 CM6，**行号／折行／空白字符可视化全部由它排版**，
那套「textarea + 叠加层两层对齐」的老方案只作为 bundle 加载失败时的 fallback 保留。

### 结构

| 文件 | 作用 |
|:--|:--|
| `build\cm6-entry.js` | bundle 入口。**只导出客户端真正用到的那几块** |
| `build\build-cm6.mjs` | 打包脚本（esbuild，IIFE，`globalName: 'CM6'`，minify） |
| `lib\vendor\cm6.bundle.js` | 产物（约 **287 KB**）。Client 通过 `/floating-editor/api/vendor?name=cm6.bundle.js` 取 |
| `lib\client.js` | 建 `EditorView`、管 Compartment、管行号栏淡出 |

### 什么时候要重新打包

**只有两种情况**：

1. 改了 `build\cm6-entry.js`（比如想多暴露一个 CM6 的 API）
2. 升级了 `@codemirror/*` 依赖

**日常改 `lib\client.js`（浮窗 UI）完全不用重新打包。**

```powershell
cd <插件目录>
node build\build-cm6.mjs      # 产出 lib/vendor/cm6.bundle.js
```

### ⚠ 两个必须记住的坑

1. **`export { X } from '…'` 只做「重新导出」，不会在本模块作用域绑定 `X`。**
   `cm6-entry.js` 里 `whitespace()` 用到了 `Decoration` / `ViewPlugin` / `EditorView`，
   如果只写 `export ... from`，就会 `ReferenceError: Decoration is not defined`；
   而 **IIFE 顶层抛错 = 整份 bundle 作废 = `window.CM6` 没有定义**，
   客户端会一路静默退回旧方案（表面看「什么都没变」，非常难查）。
   → 所以那几个必须**先 `import` 进本地作用域**再 `export`。

2. **改完 entry 必须重新打包**，否则 client 加载到的还是旧 bundle。

### 版本（当前）

```
@codemirror/state    6.7.6
@codemirror/view     6.43.13
@codemirror/commands 6.11.1
esbuild              ^0.28.2   （devDependency）
```

### 行号栏行为（说明清楚，别误当 bug）

- **底色是全透明的** —— 我们**不画色带**（用户明确不要）。
- **横向滚动中整条行号栏淡出**（`opacity → 0`），滚回最左（`scrollLeft === 0`）恢复。
- 为什么要这样：CM6 的横向滚动设计是「行号 sticky 钉住 + 内容从它底下滑过 +
  靠 gutter 自己的背景挡住」，官方默认底色是不透明的 `#f5f5f5`。
  我们不要色带，就只能改用「淡出」来避免文字压在行号上。
  **完整推导与实测数据见 [PITFALLS.md](PITFALLS.md) 的 ⑰。**

### 行尾符（CRLF / LF）

**插件是编辑别人的文件的，无权替别人决定行尾符。**
读入时记住原文件是 CRLF 还是 LF（`crlfRef`），保存时按原样写回。
比较 `dirty` 时把 CRLF 折成 LF（只影响比较）。
**完整推导见 [PITFALLS.md](PITFALLS.md) 的 ⑲。**


## 三、诊断探针（`docs\_probe\`）

用**离屏 Electron 窗口加载真实 DSH 页面**，直接在页面里量尺寸／采像素 ——
离线复现测不出 DSH 全局 CSS、`shell.overlay` 定位、半透明外壳这些东西。

⚠ **Electron 是 GUI 程序，Windows 上 stdout 收不到。结果一律写 JSON 文件，别靠 `console.log`。**
（`console.log` 在父进程管道关闭后会抛 EPIPE，**弹错误对话框**，而且会一直弹。）

```powershell
cd <DSH 源码>\dsh-electron-shell          # 这里才有 electron 模块
$env:DSH_PROBE_URL='http://127.0.0.1:<端口>/?token=<启动日志里的 token>'
electron.exe <插件目录>\docs\_probe\<探针>.cjs
```

> token 在 `dsh_data_files\launcher\logs\dsh-<时间戳>.out.log` 里那行
> `dsh web: http://127.0.0.1:<端口>/?token=…`。

| 探针 | 量什么 |
|:--|:--|
| `real-probe.cjs` | 真实页面里浮窗各层高度、CM6 各层矩形 |
| `cm-overlap-probe.cjs` | 横向滚动前后，文字与行号栏的重叠像素 |
| `fade-ab-probe.cjs` | 行号栏「淡出 / 压制淡出」两种状态下的实测像素 |
| `fade-final-probe.cjs` | 同上，单次运行内前后对比 |
| `fix-verify-probe.cjs` | 收展是否保留文档 + CRLF 文件是否假 dirty |
| `dirty-guard-probe.cjs` | 防呆：真改动仍要能标出 `*`、撤销要能清掉 |
| `crlf-probe.cjs` | 用插件自己的 API 读文件，数 CR / LF / BOM |
| `nowrap-clip-probe.cjs`、`clip-ab-probe.cjs`、`see-nothing-probe.cjs` | 排查途中的过程探针 |


## 四、已知限制

| 限制 | 说明 |
|:--|:--|
| **行号** | 交给 CM6。超大文件仍受下面几条上限保护 |
| **可视化上限** | 「空白字符」模式超过 **12 万字符**不启用（`VISUAL_LIMIT`） |
| **超大文本** | 超过 **40 万字符**时不做行号相关处理（`LINE_LIMIT`） |
| **横向滚动时行号消失** | 这是我们**选定的**行为（见 ⑰），不是 bug |
| **`<option>` 样式** | Windows 原生控件，背景色可改但下拉列表外框可能跟系统主题 |
| **CM6 bundle 加载失败** | 自动退回旧的 `<textarea>` + 叠加层方案（`cmFailed`），绝不黑屏 |
| **旧 fallback 路径仍在** | 仅在 bundle 加载失败时启用，平时走不到 |
| **树里没有删除/重命名** | 破坏性操作一律交给资源管理器（右键「在文件管理器打开」） |


## 五、待定（未做，将来可考虑）

- 多标签页
- 搜索 / 跳转到行（CM6 有 `@codemirror/search`，需要重打 bundle）
- 语法高亮（CM6 `@codemirror/language` 已在依赖里，需要重打 bundle）
- 树里的新建 / 重命名 / 删除（**设计上倾向于不做** —— 破坏性操作交给资源管理器）
- 把浮窗封进 **Shadow DOM**（顺带解决「CSS 全靠前缀自觉」与「污染全页面 `querySelector`」两个隐患，见 PITFALLS ⑮）


*文档建立：2026-09-26 · 最后更新：2026-09-27 14:30 · 由作者维护*
