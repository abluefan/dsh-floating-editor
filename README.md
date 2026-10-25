# dsh-floating-editor —— 浮窗文本编辑器

常驻 DSH 网页界面的浮窗编辑器：可拖动、可调透明度／字体／字号／颜色，读写文件、
多根文件夹树、行号与空白字符可视化、一键拉起 Notepad++ / 资源管理器 / 命令行。

**2026-09-26 由动态 Cordis 插件（`floating-editor`）固化而来** —— 之前它是临时的
（DSH 重启即消失），现在是一个真插件（`profiles\web\cordis.patch.yml` 的 insert 行）。

**2026-09-27 换成 CodeMirror 6 内核** —— 行号／折行／空白字符全部交给 CM6 自己排版，
不再靠「textarea + 叠加层」两层对齐。见 `docs\MAINTAIN.md` 的 CM6 一节。

> 📚 **本 README 只做概览与索引**，细节拆在 `docs\` 下：

| 文档 | 内容 |
|:--|:--|
| `README.md` | ← 本文件：概览、功能、结构、安装 |
| `docs\API.md` | HTTP API 一览、`API_PREFIX` vs `API_ROUTE`、设置持久化 |
| `docs\TREE.md` | 文件夹树的规则（多根 / 右键菜单 / 防爆限制 / 可写开关 / 装载校验） |
| `docs\PITFALLS.md` | **踩过的坑 ①–⑲**（全部实际发生过，最值得读的一份） |
| `docs\MAINTAIN.md` | 维护须知、CM6 重新打包、已知限制、待定 |

---

## 一、它长什么样

```
┌──────────────────────────────────────────────────────────┐
│ 📝 tasks.txt  *        ━━●━━ 88%              [—]     │  ← 标题栏（可拖动）
├──────────────────────────────────────────────────────────┤
│ D:\notes\tasks.txt [打开][保存][浏览…][np++][▾]   │
├──────────────────────────────────────────────────────────┤   （下面这行默认收起，按 ▾ 展开）
│ Font[微软雅黑▾] Size[12.5px▾] Bg[■] 字色[■] [空白字符][换行关][文件树可写] │
├──────────┬───────────────────────────────────────────────┤
│▾ 📂 废弃  │   1  第一行…                                   │
│  📄 草稿… │   2  第二行…            ← 行号由 CM6 自己画     │
│▾ 📂 live  │   3  …                                        │
│  📄 a.txt │   4  …                                        │
│  📄 b.txt │   5  …                                        │
├──────────┴───────────────────────────────────────────────┤
│ 已载入：…（xxxx 字）                     已清掉 1 个失效根 │  ← 状态栏
└──────────────────────────────────────────────────────────┘
```

按 `—` 会收成一条迷你条：`[ tasks.txt ] [+]`（标题可拖动，`+` 展开）。

---

## 二、功能清单

| 分类 | 功能 |
|:--|:--|
| **文件** | 读 / 原子写回；`Ctrl+S` 保存；右侧路径输入框；「浏览…」弹 Windows 原生选文件框 |
| **外部程序** | 「np++」一键用 Notepad++ 打开同一个文件（外部程序自己读写，不受插件沙箱约束） |
| **外部修改探测** | 每 2 秒查一次文件 `version`；本地没改动就**自动重新载入**，有改动就**只提示不覆盖** |
| **行号** | 由 **CodeMirror 6** 排版：它按每个逻辑行的**真实渲染高度**摆行号元素，折行天然对齐 |
| **行号栏视觉** | 底色**全透明**（不画色带）；**横向滚动中整条行号栏淡出**，滚回最左即恢复（见坑 ⑰） |
| **空白字符** | CM6 `Decoration.mark` 叠加 `·` / `→`；**不动真字符宽度** ⇒ 折行点不漂，开了仍可编辑 |
| **换行** | `Alt+Z` 切换；工具行亦有按钮（走 CM6 Compartment 重组，不重建 view、不丢光标） |
| **字体** | 读注册表枚举系统字族（有中文名，如「微软雅黑」），按字体文件安装时间新→旧排序 |
| **字号** | 下拉 **8–23px 共 31 档（每 0.5 一档）**；**Ctrl+滚轮** 在浮窗任意位置都能调 |
| **颜色** | 底色（Bg）、字色、透明度（Alpha，线性 0–100%） |
| **窗口** | 八向 resize、标题栏拖动、右下/四边四角热区、"瞬间"最小化（无过渡动画） |
| **收起 / 展开** | 迷你条；**收展不丢文档、滚动位置、光标、undo 历史**（窗口只 `display:none`，不 unmount，见坑 ⑱） |
| **行尾符** | **保持文件原本的 CRLF / LF**，保存时原样写回，绝不静默转换（见坑 ⑲） |
| **文件夹树** | 多根树（Notepad++「Folder as Workspace」风格）；点目录展开/收起、点文件打开；可拖分隔条 → 详见 `docs\TREE.md` |
| **持久化** | 位置/大小/字体/字号/颜色/透明度/换行/空白字符/树宽度/根列表/可写开关/上次文件 → 详细见 `docs\API.md` |

---

## 三、文件结构

```
<插件目录>\
  package.json       清单：main / exports（含 ./client）/ dsh.client.platform = web
  index.js           Host 半边：一组同源 HTTP API（Node ESM，普通 Cordis 插件）
  lib\client.js      Client 半边：浮窗 UI（window.__ModuleLoader__ 壳的 lazy-CJS）
  lib\vendor\        cm6.bundle.js —— CM6 内核（esbuild 打好的 IIFE，window.CM6）
  build\             cm6-entry.js（bundle 入口）+ build-cm6.mjs（打包脚本）
  cordis.patch.yml   包自带 patch（本包用 profile 的 insert 行挂载）
  settings.json      设置真源（运行时自动生成 / 自动迁移，可直接手改）
  README.md          本文件
  docs\
    API.md          HTTP API + 设置持久化
    TREE.md         文件夹树的规则
    PITFALLS.md     踩过的坑 ①–⑲
    MAINTAIN.md     维护 / CM6 打包 / 限制 / 待定
    _probe\         诊断探针（Electron 里跑，量真实页面的尺寸与像素）
```

**已装到**：`profiles\web\node_modules\dsh-floating-editor\`
**已声明**：`profiles\web\package.json` 的 `dependencies`（`file:` 指回上面的源码目录）
**已挂载**：`profiles\web\cordis.patch.yml` 的 `insert` 行（id `floating-editor`）

---

## 四、安装

### ① 通过插件市场（推荐）

在 [awesome-dsh-plugin](https://awesome-dsh-plugin.com) 的目录里找到本插件，
或在 dsh 的 **插件 → 发现** 里搜索 `dsh-floating-editor`，点安装。

### ② 手动安装

任选一种，**不要两种同时用**：

**A. 复制 + 手写 insert（适合本地开发）**

1. 把本目录复制到 `$DSH_HOME/profiles/web/node_modules/dsh-floating-editor/`
2. 在 `$DSH_HOME/profiles/web/cordis.patch.yml` 加：

   ```yaml
   - insert:
       - id: floating-editor
         name: 'dsh-floating-editor'
   ```

3. 重启 dsh，或让 Loader 重载配置

**B. `dsh plugin add`（需要包已发布到 npm）**

```sh
dsh plugin --profile web add dsh-floating-editor
```

> ⚠ 用 B 之后，包名会进 `dsh.profile.bundles`，bundles 层会读本包自带的
> `cordis.patch.yml`；此时**不要**再做 A 的第 2 步 —— 同一个 id 会被插两次，
> DSH 启动会直接失败。

## 五、快速上手

| 想做什么 | 怎么做 |
|:--|:--|
| 打开一个文件 | 左边树里点它；或者上面那行路径框里敲完回车；或者「浏览…」 |
| 打开浮窗外的文件 | 右键树里任意目录 →「加为根目录」；打开任意文件时会**自动**把它所在目录加进根 |
| 存盘 | `Ctrl+S`，或「保存」。未保存时标题会带 `*` |
| 换行开关 | `Alt+Z`，或工具行里的按钮 |
| 调字号 | **Ctrl+滚轮**（在浮窗任何位置），或用下拉框 |
| 在外部编辑器改 | 「np++」把同一个文件丢给 Notepad++ 打开，回来时会自动探测到变更 |
| 加/移除根目录 | 右键列表空白处 →「添加文件夹…」；右键某个根 →「移除此根目录」 |
| 窗口收起来 | 标题栏最右边的 `—`；想展开点迷你条上的 `+`（**收展不会丢文档**） |

**改完源码之后**：`node --check` → **手动 `Copy-Item` 到 `node_modules`**
→ **Host 改动要重启 DSH，Client 改动强刷（Ctrl+Shift+R）即可**。详见 `docs\MAINTAIN.md`。

> ⚠ 改 `lib\client.js` 这类 Client 改动，**不刷新页面是不会生效的** ——
> 表现就是「改了没反应」甚至「编辑区一片空白」。改了就先强刷一次。

---

*文档建立：2026-09-26 · 最后更新：2026-09-27 14:30 · 由作者维护*
