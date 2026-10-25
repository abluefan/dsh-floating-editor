# 踩过的坑（全部实际发生过）

> 📖 返回 [README](../README.md) · 相关：[API.md](API.md) · [TREE.md](TREE.md) · [MAINTAIN.md](MAINTAIN.md)


### ① `shell.overlay` 是 click-through，条目必须自己开 `pointer-events`
`shell.overlay` 整层是 `pointer-events:none`（否则盖住整个应用），
所以浮窗容器和拖动覆盖层**必须显式声明 `pointer-events:auto`**，否则整个浮窗点不到。
→ 排查手段：光标移上去有没有反应。

### ② `fs.writeText` 不带 session policy 会退化成错误的 workspace 根
`fs-sandbox` 内部调 `sandboxPolicy.resolve()`（**无参**）→ workspace 根退回
「DSH 进程的 cwd」→ 工作区内的文件也被判越界：
`cannot write "…": file access denied under workspace-write mode`。
→ 修法：遍历活 session，挑出 workspace 根**包含目标文件**的那个，用它的 policy。
（仍然受 `workspace-write` 约束，不是绕过沙箱。）

### ③ `webServer.register` 的 prefix path **不能带尾斜杠**
写 `'/floating-editor/api/'` → 所有请求 404（路由注册成功但匹配不到）；
写 `'/floating-editor'` → 正常。
→ 反例参考：font-picker 写的是 `'/font-picker'`。

### ④ pnpm 对 `file:` 依赖建的是**硬链接**
正常改源码会自动同步；但**用编辑器改写文件会打断硬链接**，
之后两边就不一致（node_modules 是旧的）。
→ 修法：改完源码手动 `Copy-Item` 一次，或者删掉 node_modules 里那份重装。
（`pnpm install --force` 说 "Already up to date" **不会**重拷。）

### ⑤ `patchReload: "live"` 不处理**新增**的 insert 行
追加新 insert 行后，热重载不会加载它 —— 必须**重启 DSH**。
（改已存在行的 config 才会即时生效。Client 半边改动则只需强刷。）

### ⑥ `<select>` 不支持 `::before` 伪元素
窗口那套「伪元素 + opacity」做半透明的办法对 `<select>` 无效。
→ 改用 `color-mix(in srgb, var(--fe-bg) calc(var(--fe-alpha) * 100%), transparent)`。

### ⑦ CSS 漏一个 `}` 会吞掉后面所有规则
后果极隐蔽：浮窗还在，但 `position:fixed`／背景／z-index 全失效 →
**看起来像「整个工具不见了」**。
→ 以后每次改 CSS 都跑一次大括号计数：
```powershell
$c = Get-Content <file> -Raw
"$(([regex]::Matches($c,'\{')).Count) vs $(([regex]::Matches($c,'\}')).Count)"
```

### ⑧ ★ `addRoot()` 零校验 + 用错对话框 = 清不掉的孤儿条目
**现象**：文件树顶层出现一条展不开、点不动的条目（例如
`Z:\…\废弃\设定集讨论草稿&想法&灵感.txt`），右键也找不到移除入口。

**成因链**：
1. 早期 Host 只有 `pick`（**选文件**），没有 `pick-dir`
2. Client 的「添加文件夹…」却把它当「选目录」用
3. 用户在对话框里选了个 `.txt` → 返回的是**文件路径**
4. `addRoot(res.path)` **照着塞进 roots，从不校验是不是目录**
5. roots 变成「目录 + 文件」混合数组，文件树照渲染 → 幽灵条目

**教训**：
- **对话框的语义要对上**（选文件 ≠ 选目录），Host 侧宁可多做一个 API
- **缓存型状态（roots）入库前必须校验**，哪怕调用方「理论上」不会传错
- 加根这种异步动作，校验的代价很低，脏数据的代价很高（用户根本删不掉）

**修法**：`pickRoot()` 改走 `pick-dir`；`client.js` 装载时用 `list` 探针
把非目录的根剔掉（见 §6.5）。

### ⑨ ★ `cmd /c start <名字> <程序>` —— `start` 的标题不带引号会被当程序名
**现象**：点「命令行打开」弹出
`Windows找不到文件'<窗口标题>'。请确定文件名是否正确后，再试一次。`

**原因**：`start` 的语法是 `start ["title"] [/D path] [command]`。
**标题只有在被引号包住时才算标题**；不包引号时，`start` 会把第一个
非选项参数当成**程序名**去找 —— 所以它真的在磁盘上搜一个叫
`<窗口标题>` 的可执行文件。

**修法**：干脆别用 `start`，改走 PowerShell：

```js
argv: ['powershell.exe', '-NoProfile', '-NonInteractive', '-Command',
       'Start-Process cmd.exe -WorkingDirectory ' + dirLiteral]
```

好处三样：
1. 没有「标题」这回事，这个坑根本不存在；
2. `Start-Process` **天然开新窗口**（直接 spawn `cmd` 会继承父进程控制台，
   不一定弹窗 —— DSH 由 launcher 拉起，有没有控制台不由我们决定）；
3. `-WorkingDirectory` 语义明确，不用把 `cd /d "…"` 拼进命令行字符串。

`dirLiteral` 用 PowerShell **单引号**字符串（内部 `'` 用 `''` 转义）包住路径，
避免路径里的 `$`、反引号等被 PowerShell 先解释掉。

**教训**：`start` 是 cmd 内置命令，它的参数规则跟普通可执行文件**不一样**；
跨工具边界（我们的 argv → cmd → `start`）时不要凭「看起来对」就写。
实测做法：改完先单独在 pwsh 里跑一遍那条命令，确认真的弹窗了再写进代码。

### ⑩ ★ 换行时行号错位 —— 行号不能跟文本共用一个文本流
**现象**（用户提供的决定性证据）：同一个文件、同一个滚动位置 ——
- 窗口**宽**（74%）时行号全对
- 窗口**窄**（79%）时行号整体**往前跑**：`3` 对着横线，而「用途」那一行
  没有数字，之后全部错位

**根因**：叠加层（行号 + 空白字符可视化）原来是把**整份文本拼成一个文本流**
（`[行号1][行1] 换行 [行号2][行2] …`），行号是内联元素。一旦某行**折行**，
视觉行数就跟逻辑行数脱钩，行号跟内容的对应开始漂移；窗口越窄折行越多，漂移越大。

**踩过的两个弯路**（都写下来，免得下次重犯）：
1. 先怀疑 `font-family` 没被继承 → 其实 `:41` 早就把 `textarea` 写进选择器了，
   我只读了 `:42` 就下结论
2. 再改成「一行一个 `<div>`，行号内联 + 负 margin」→ **还是错**，
   因为本质上仍然是一个文本流，只是切了块而已

**最终修法**：**一行一个 flex 行，行号一列、文本一列**。

```css
.fe-editor-row{display:flex;align-items:flex-start;white-space:inherit;min-height:1.55em;}
.fe-editor-text{flex:1 1 auto;min-width:0;white-space:inherit;}
.fe-editor-visual.has-numcol{padding-left:0;}   /* 行号列自己占掉 --fe-numw */
.fe-editor-num{flex:0 0 auto;width:var(--fe-numw,40px);…}
```

折行**只可能发生在文本列内部**，续行自动跟文本列左边缘对齐，行号
**在结构上**不可能跑到别的逻辑行去。（textarea 那边 `padding-left: var(--fe-numw)`
正好等于行号列宽，两边文本起点严丝合缝。）

**教训**：靠「文本流自然折行」来对齐的叠加层方案，迟早会被折行打败。
**要用布局（flex／grid）把两样东西的定位解耦**，而不是指望它们在同一流里恰好对齐。

**附带修掉的**：两层 `tab-size` 不一致（textarea `8` / 叠加层 `1`）—— 含 Tab 的
行折行点不同。现在默认两边都 `8`；标记模式下两边一起变 `1`
（因为 Tab 被换成单个 `→`，只占 1 列）。

### ⑪ ★ 「收起前尺寸」存成了不持久化的 state → 长宽永远记不住
**现象**：窗口调到合适的长宽，收成迷你条，下次打开（重启 DSH／刷页面）
展开之后尺寸回到默认 `760×500`。

**根因**：`minimize()` 把当前尺寸存进 `savedBox` 这个 **`useState(null)`**，
而它**从不写进设置**。`restore()` 里：

```js
const size = savedBox === null ? { w: 760, h: 500 } : savedBox
```

只要上次离开时是迷你态（`mode:"mini"` 也被持久化了），重启后展开就必然
拿到默认值 —— 而 `box` 里明明存着正确的 `821×613`。

**修法**：别另存影子状态，直接取 `box.w / box.h`（它本来就持久化）：

```js
const w = Math.max(MIN_W, box.w)
const h = Math.max(MIN_H, box.h)
```

**教训**：任何「为了临时记住某个值」而新开的 state，都要先问一句
「它跟已经持久化的那份数据重复了吗？」—— 重复的影子状态一旦漏存，
就会变成这种「看起来明明存了、实际没用上」的诡异 bug。

### ⑫ ★ 滚轮改字号时，字号显示在「8」和真值之间乱跳
**现象**：Ctrl+滚轮 调字号，下拉框里显示的**一会儿是 8px、一会儿是真值**，
但实际字号是对的。

**根因**：滚轮当时是自己算小数的（`fontSize ± 0.5`），但 `<select>` 的
`SIZE_CHOICES` 里只有 `12.5` 这一个 0.5 档位。滚出 `13.5` 时：

- `fontSize = 13.5` → 状态栏正确显示「字号 13.5px」
- `<select value="13.5">` **匹配不到任何 `<option>`** → 浏览器**静默回退显示第一项**
  = **`8px`**

**修法**（两件事一起做才干净）：
1. `SIZE_CHOICES` 改成 **8→23 每 0.5 一档，共 31 档** —— 滚轮能产生的每个值都在列表里
2. `onWinWheel` 改成**走列表索引**（先找最近档位再 ±1），不再自己算小数 ——
   这样**结构上**不可能产出列表外的值

**教训**：`<select>` 的 `value` 匹配不到 `<option>` 时**不报错、不显示空**，
而是静默回退到第一项 —— 这种「无声降级」最难查。
**凡是「程序算出来的值」要塞进 `<select>`，就要保证它的取值域跟选项列表完全一致。**

### ⑬ ★ 出现两条滚动条
**现象**：编辑区旁边莫名其妙多出一条滚动条，非常诡异。

**根因**：`.fe-editor-visual-clip`（叠加层）和 `<textarea>` **各自都是独立滚动容器**
（都是 `overflow-y:auto`）。平时两边内容高度一致所以只露一条；一旦差了半行
（折行数不同、字体度量差一点），叠加层那条就也冒出来了。

**修法**：叠加层只负责**裁剪 + 跟 textarea 同步位移**，不显示自己的滚动条：

```css
.fe-editor-visual-clip{overflow-y:scroll;overflow-x:hidden;
                       scrollbar-width:none;pointer-events:none;}
.fe-editor-visual-clip::-webkit-scrollbar{width:0;height:0;}
.fe-editor-area{overflow-y:scroll;overflow-x:auto;}   /* auto → scroll */
```

⚠ **不能图省事把叠加层改成 `overflow:hidden`** —— 那它就不再预留滚动条宽度，
两边的可用宽度不一致，**折行点又会歪**（等于把坑 ⑩ 重新踩一遍）。
两边都用 `scroll`、再把其中一条的滚动条**藏起来**，才是既有对齐又只有一条滚动条。
### ⑭ ★ 浮窗坐标没做视口钳制 → 换分辨率后面板跑到屏幕外
**现象**：浮窗「不见了」。实测数据：`box` 存在 settings 里的 `x:939, w:694`，
右边缘到 **1633**，而屏幕工作区只有 **1536** —— 整块压到屏幕外。

**根因**：`box` 的坐标从 `settings.json` 原样读回来，**只钳了尺寸、没钳位置**。
换分辨率、改显示缩放、接外接屏之后，旧坐标就可能落在新视口之外。

**修法**：加一个 `clampBox(b, slack)`：

```js
function clampBox(b, slack) {
  const vw = window.innerWidth, vh = window.innerHeight
  const w = Math.min(Math.max(MIN_W, b.w), Math.max(MIN_W, vw - 8))
  const h = Math.min(Math.max(MIN_H, b.h), Math.max(MIN_H, vh - 8))
  if (slack) {                    // 拖动中：允许探出去，但至少留一角能抓回来
    return { x: Math.min(Math.max(48 - w, b.x), vw - 48),
             y: Math.min(Math.max(0, b.y), vh - 28), w: w, h: h }
  }
  return { x: Math.min(Math.max(0, b.x), Math.max(0, vw - w)),   // 完全夹进来
           y: Math.min(Math.max(0, b.y), Math.max(0, vh - h)), w: w, h: h }
}
```

用在四处：**初始状态**、**拖动**（`slack=true`）、**缩放**（`slack=true`）、
**从迷你条展开**（`slack=false`）；另外挂一个 `window.resize` 监听，
视口一变就把 `box` 和 `miniAt` 都夹回来。

**为什么拖动/缩放用 `slack=true`**：那时候完全夹住会让手感很硬（拖到边缘就顶住）。
允许探出去、只保证「留一角能抓回来」更自然。

**教训**：**任何「持久化的屏幕坐标」都必须假设它已经过期。**
屏幕尺寸、缩放、显示器组合、甚至浏览器窗口大小都可能变，
存下来的绝对坐标一律要在用之前夹一遍。尺寸要夹，位置**同样**要夹。

### ⑮ ★ 我们的 `<textarea>` 骗过了鲸鱼挂件的「主界面自检」
**现象**：DSH 界面偶发崩坏 —— 拉到页面「地下」会见到**两个超大嘅鲸鱼图标**；
平时鲸鱼「人间蒸发」。重启 DSH 都唔会好。

**排查过程（试过但唔成立嘅假设，照记低免得重猜）**：
- ❌ 浮窗遮挡 → 位置钳制咗、重启后依旧发生
- ❌ z-index 冲突 → 鲸鱼 `z-index:9999`，我们嘅浮窗盖到佢，但重启重载页面佢应该返嚟
- ❌ `pnpm install` 升级咗鲸鱼 → 版本仍然係 `0.3.0`
- ❌ 挂载层冲突 → 鲸鱼喺 `dsh.profile.bundles`，我们喺 `cordis.patch.yml` 嘅 `insert`，两层独立
- ❌ HTML 注入失败 → 页面 HTML 里 `<script defer src="/dsh-whale/widget.js">` 仲在
- ❌ 服务端未挂载 → `/dsh-whale/*` 返 **401**（唔係 404），即係路由在

**真凶**：`dsh-whale-widget/assets/whale-widget.js` 开头嘅自检：

```js
// —— 页面自检：只在 DSH 主聊天界面挂载挂件 ——
// 挂件脚本通过 tapIndex 注入 DSH 嘅每一个 index 页面（含插件市场等 SPA 视图）。
// 市场页用 ReactDOM.createPortal 渲染到 document.body，若挂件在此初始化，
// 会在 body 插入节点并注册全局捕获拦截，干扰 React 渲染树（removeChild 报错、页面空白）。
// 主聊天界面嘅特征：composer 输入区。
function dshwIsChatRoot(r) {
  return !!(r && (r.querySelector('textarea') || r.querySelector('[contenteditable="true"]')))
}
```

**佢用 `querySelector('textarea')` 判断「呢度係唔係主聊天界面」。**

而我们嘅浮窗（挂喺 `shell.overlay`，**全局常驻**）里面**正好有一个 `<textarea>`**（编辑器本体）。
于是喺插件市场等 SPA 视图，佢嘅自检**命中我们嘅 textarea** → 误判成主界面 →
喺嗰页 `body` 插节点 + 注册全局捕获拦截 → 干扰嗰页嘅 React 渲染树 →
布局崩 → 佢自己嘅 `position:fixed` 失效掉进文档流 → 「地下两个超大鲸鱼」。

**佢注释里描述嘅失败模式（removeChild 报错、页面空白）正係佢加自检想规避嘅嘢** ——
但畀一个新出现嘅 `textarea` 骗过去咗。

**修法（2026-09-27）**：把鲸鱼由「市场版 `^0.3.0`」改为「本地拥有一份」，
喺 `<dsh-whale-widget 目录>\assets\whale-widget.js` 打一行补丁：

```js
return !!(r && (r.querySelector('textarea:not(.fe-editor-area)') || r.querySelector('[contenteditable="true"]')))
```

配套：
- `profiles\web\package.json` 嘅 `dependencies`：`"dsh-whale-widget": "file:<dsh-whale-widget 目录>"`
- `bundles` **唔使改** —— 佢引用嘅係包名，会自动解析去本地嗰份
- `pnpm install` 之后 `node_modules` 嗰份係**硬链接**，两边自动同步
- 备份：`备份目录\dsh-whale-widget.<时间戳>\`（原版整包）

**教训（两层）**：
1. **`querySelector('textarea')` 呢种「特征探测」极度脆弱。** 任何插件都唔应该靠
   「页面有冇某类元素」判断自己身处边个视图 —— 加一个无关插件就可能误判。
   要判断就查**稳定嘅锚点**（例如 `#root` 上嘅特定属性、或者显式嘅路由钩子）。
2. **挂在 `shell.overlay` 嘅插件会污染全页面嘅 `querySelector` 结果。**
   我们嘅节点虽然全部 `position:fixed`、唔影响布局，但**元素本身係查得到嘅** ——
   呢个係「全局命名空间污染」嘅 DOM 版本。
   → 根本解法係**把浮窗封进 Shadow DOM**（Shadow 内部元素外部 `querySelector` 找唔到），
   顺带仲解决「CSS 全靠前缀自觉」嘅隐患。**未做，列入待定。**

### ⑯ 鲸鱼返唔到嚟 —— 真凶唔止一个（2026-09-27 深夜续查）

⑮ 修好咗「市场页误判」，但用户刷新之后鲸鱼**仲係唔见**，重启都唔得。深夜实测（靠浏览器侧回报）
揾到第二个真凶，同 ⑮ 唔係同一个层次嘅嘢：

**真凶 A：补丁之后，鲸鱼嘅「主界面自检」再冇任何锚点命中得到主界面。**
原版係 `querySelector('textarea') || querySelector('[contenteditable="true"]')`。
⑮ 排除咗我哋嗰个 textarea 之后，净低 `contenteditable` —— 但实测首屏 `ce=false`：
DSH 新版 composer 实际用 `data-composer-input`
（源码 `packages\client\ui-conversation\src\client\input\editor\ComposerContentEditable.tsx:42`），
而 `contenteditable` 喺 `editor===null || !editable` 嗰阵会渲染成 `"false"`。
→ 加 `[data-composer-input]` 做锚点先至救得返。

**真凶 B：鲸鱼嘅位置记忆坏咗（`localStorage.dshw-pos`）。**
存咗 `{"vAnchor":"bottom","vDist":-1011}`；恢复公式 `top = vp.h - vDist - h` 算出 1875，
而钳制上限 `vp.h - h` 又依赖元素高度 —— 一旦 `h` 算成 0（渲染时序），上限变 864
→ **挂件黐喺视窗底边之外，完全睇唔到**。
保存嗰边用同一个 `h`，`h=0` 时算出大负数 → **每次加载又推远啲** → 重启都唔会返。

**讽刺嘅係**：⑭ 啱啱先总结过「任何持久化嘅屏幕坐标，用之前一律要夹」——
同一个道理我哋喺浮窗度修咗，鲸鱼自己嗰边一样有，只不过唔係我哋嘅代码。

**完整记录**（补丁位置、代码片段、诊断方法、实测数据）：
`<dsh-whale-widget 目录>\本地补丁说明.md`

**教训（补一条）**：**「修好一个 bug」之后如果现象冇变，唔好假设係同一个 bug 未修好** ——
可能係另一个独立 bug 顶上嚟。呢次就係：⑮ 修完先睇得到 B，
而 A 一直都存在，只不过一直畀浮窗嗰个 textarea 遮住咗。

### ⑰ ★ 不换行 + 向右拖 ⇒ 文字压在行号上（CM6 的遮板被我们自己拆了）

**现象**（用户报的）：不换行（`lineWrapping` 关）时，把编辑区往右拖，
文档文字**跨在行号上面**渲染。

**实测数据**（`docs/_probe/cm-overlap-probe.cjs`，在真实 DSH 页面里量矩形）：

| 量度项 | 数值 |
|:--|:--|
| `.cm-gutters` | `position:sticky`, `z-index:200`, `background:rgba(0,0,0,0)` |
| `scrollLeft = 0` | 文字最左 `1052`，行号右缘 `1052` ⇒ **重叠 0** ✅ |
| `scrollLeft = 1485` | 文字最左 `-433`，行号右缘 `1052` ⇒ **重叠 1485px** ❌ |

**根因**：**不是** z-index／层叠问题（sticky 与 200 都好好的），
而是我们在 CSS 里自己写了 `.cm-gutters{background:transparent}`。

CM6 的横向滚动**本来就是这么设计的**：行号 sticky 钉住，内容照常滚动，
滑到行号底下的那部分**靠 gutter 自己的背景遮住**。
官方默认底色是 **`#f5f5f5`（不透明）** —— 证据在
`node_modules/@codemirror/view/dist/index.js` 的 `&light .cm-gutters`。
我们把遮板换成透明，于是「底下滑过的文字」就透过行号栏露出来了。

**踩过的弯路**（写下来免得重犯）：
1. 先怀疑 z-index 不够高 → 量出来是 200，比内容高，**方向错了**
2. 试 `clip-path: inset(0 0 0 31px)` 落在 `.cm-scroller` 上 → **整条行号栏
   连同数字一起被剪掉**。因为 `.cm-gutters` 正是 `.cm-scroller` 的子元素
   （sticky 的包含块就是 scroller），剪父元素必然剪到它。
3. 还有个探针自己写错的坑：`var g` 声明在使用之后 ⇒ ReferenceError ⇒
   整个 PREP 脚本抛错 ⇒ 两次采样的像素完全一样，我一度误判「clip 无效」。
   **教训：探针本身也会骗人，两次结果一模一样时先怀疑探针。**

**最终方案（用户拍板）**：**行号栏底色保持 transparent，改为在横向滚动中把整条
行号栏淡出**（`opacity → 0`），滚回最左（`scrollLeft === 0`）即恢复。

```js
// client.js 里建 view 之后
const scroller = host.querySelector('.cm-scroller')
const gutter = host.querySelector('.cm-gutters')
onScroll = () => { gutter.style.opacity = scroller.scrollLeft > 0 ? '0' : '' }
scroller.addEventListener('scroll', onScroll, { passive: true })
```

```css
.fe-editor-cm .cm-gutters{background:transparent;border-right:0;
                           color:var(--fe-fg,#e9e9ec);transition:opacity .12s linear;}
```

**为什么这样既透明又不透字**：行号栏整条看不见了 ⇒ 就没有「文字压住数字」
这回事；同时**一个像素的色块都没多画**（用户明确不要那条色带）。

**实测证据**（`docs/_probe/fade-ab-probe.cjs`，采样行号栏那条 44×275 的带子）：

| 状态 | 静止时 darkPx | 滚到最右 darkPx |
|:--|:--|:--|
| 压制淡出（旧行为） | 0 | **162** ← 文字透出来了 |
| 插件淡出生效 | 162 | **162** ← 没有任何变化 |

两次「滚到最右」的数值都是 162，说明带子里画的东西**完全没变**。

**⚠ 一个测量陷阱**：`getComputedStyle(gutter).opacity` 在过渡动画跑完之前
**读到的是旧值 `"1"`**（实测等了 1 秒仍是 1，而行内样式的 `gutter.style.opacity`
已经是 `"0"`）。判断视觉结果**必须采像素**，不能信 computed style。

**代价（已知且已接受）**：横向滚动的那一刻行号会消失，滚回左边就回来。

### ⑱ ★ 缩成迷你条再展开 ⇒ 文档空白（CM6 view 被卸载后没重建）

**现象**：点标题栏的 `—` 收成迷你条，再点 `+` 展开 —— **编辑区一片空白**，
只能 `Ctrl+Shift+R` 强刷才回来。

**根因**：渲染里写着

```js
if (mode === 'mini') { return h(...迷你条...) }   // ← 整个窗口被卸载
```

于是 `.fe-editor-win`（连同里面的 `.fe-editor-cm` 宿主节点）被 React 卸载 →
建 CM6 view 那个 effect 的 **cleanup 把 view 销毁了**；
而那个 effect 的依赖是 `[cmReady]`（没有变），
所以展开时**不会**重新跑 → 留下一个空的宿主 div。

**修法**：**窗口永远挂在树上，迷你态只是 `display:none`。**

```js
const windowNode = h('div', {
  className: 'fe-editor-win',
  ...
  style: { ..., display: mode === 'mini' ? 'none' : 'flex' },
}, ...)

// 迷你条单独一个节点，非迷你态为 null
const miniBar = mode !== 'mini' ? null : h('div', {...}, ...)

return h('div', {...}, veil, menuNode, miniBar, windowNode)
```

顺带白赚三样：**滚动位置、光标、undo 历史**在收展之间都保住了。

**实测**（`docs/_probe/fix-verify-probe.cjs`）：

| 阶段 | `.cm-editor` 在树上 | `.cm-content` 字数 | 判定 |
|:--|:--|:--|:--|
| 初始 | 有 | 1207 | — |
| 缩成迷你条（`winDisplay:none`） | 有 | 1207 | 未被销毁 |
| 展开（`winDisplay:flex`） | 有 | **1207（不变）** | ✅ |

**教训**：**「条件渲染整个组件」等于「让它带着所有副作用一起死」。**
凡是里面挂着命令式对象的（编辑器实例、canvas、第三方组件），
收起／隐藏一律用 CSS（`display` / `visibility`），不要用 unmount。

### ⑲ ★ CRLF 文件永远显示「有未保存改动」

**现象**：有些文件打开之后标题一直挂着 `*`、「保存」键一直是亮的，
但其实一个字符都没改。（另一些文件完全正常。）

**根因**：那些文件是 **CRLF** 行尾。实测行尾分布：

| 行尾 | 文件 |
|:--|:--|
| CRLF | 含中文的说明文档（实测多个 `.md`） |
| LF | 纯文本任务清单（实测多个 `.txt`） |

**两种并存**，所以不能统一成任何一种。

链路：`openPath` 把**带 `\r`** 的原文存进 `loaded`；而 CM6 内部把 `\r\n`
规范化成 `\n` 再回吐 ⇒ `setText` 拿到的 `text` **不含 `\r`**
⇒ `dirty = text !== loaded` **永远为真**。

副作用不止标题挂星：**每 2 秒一次的外部修改探测**也因为 `dirty === true`
永远走「只提示、不自动重载」那条分支 ⇒ 自动重载等于被关掉了。

**修法（两条）**：

```js
// 1) 比较时把 CRLF 折成 LF（只影响比较，loaded 本身保留原样）
const normNL = (value) => String(value).split('\r\n').join('\n')
const dirty = loaded !== null && normNL(text) !== normNL(loaded)

// 2) 保存时按文件原本的行尾符写回（别把人家 CRLF 悄悄改成 LF）
const crlfRef = React.useRef(false)          // openPath 里：res.text.indexOf('\r\n') >= 0
...
text: crlfRef.current ? text.split('\r\n').join('\n').split('\n').join('\r\n') : text,
```

**为什么不能一刀切用 LF**：用户的规矩是**按工具类型定**，不是全机统一 ——
全局 agmd 第 29 行写「文件统一 UTF-8 无 BOM；`.bat` 必须 CRLF；`.ps1`/`.py` 用 LF 没问题」，
`toolkit.txt` 也写「含中文的 `.ps1` 要 UTF-8 **with BOM**；`.cmd` 必须 CRLF」。
live 目录下 CRLF/LF 两种并存正是这条规矩的体现。
**插件是编辑别人的文件的，无权替别人决定行尾符** —— 原样保留才是对的。

**实测**（`docs/_probe/fix-verify-probe.cjs` + `dirty-guard-probe.cjs`）：

| 状态 | 标题 | 保存键 | 字数 |
|:--|:--|:--|:--|
| 刚打开 CRLF 文件 | 无 `*` | disabled | 1207 |
| 打一个字符 | **有 `*`** | 可用 | 1208 |
| Ctrl+Z 撤销 | 无 `*` | disabled | 1207 |

（第三行很重要：**假 dirty 修好了，但真改动仍然认得出**，没有矫枉过正。）

### 附：`shell` 服务在动态插件里死，`subprocess` 可用
