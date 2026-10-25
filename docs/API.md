# HTTP API 与设置持久化

> 📖 返回 [README](../README.md) · 相关：[TREE.md](TREE.md) · [PITFALLS.md](PITFALLS.md) · [MAINTAIN.md](MAINTAIN.md)


Host 半边注册一条 **prefix 路由**（⚠ **不能带尾斜杠**，见坑 ③），由请求地址
切出方法名。全部走 POST JSON。

| 方法 | 参数 | 返回 |
|:--|:--|:--|
| `read` | `{ path }` | `{ ok, text, display, size, version }` |
| `save` | `{ path, text }` | `{ ok, operation, display, policy, version }` |
| `stat` | `{ path }` | `{ ok, version, size }` ← 只要元数据，用于 2 秒轮询 |
| `list` | `{ dir }` | `{ ok, dir, entries, total, truncated }`；**非目录会被拒绝**（`不是目录：…`） |
| `fonts` | — | `{ ok, fonts: [名…] }`（注册表 + 安装时间倒序） |
| `pick` | — | `{ ok, path }` / `{ ok:false, cancelled:true }` ← 选**文件** |
| `pick-dir` | — | 同上，但选**文件夹** |
| `open-external` | `{ path }` | `{ ok }`（起 Notepad++） |
| `reveal` | `{ path }` | `{ ok }`（资源管理器定位到该文件/文件夹） |
| `open-terminal` | `{ dir }` | `{ ok }`（在该目录起命令行窗口，走 PowerShell `Start-Process`，见坑 ⑨） |
| `get-settings` | — | `{ ok, settings }`；文件还没建立时 `settings:null` |
| `set-settings` | `{ settings }` | `{ ok, path }`（整份覆盖，缩进 2 空格，方便用户手改） |
| `vendor` | `?name=<文件名>` | **静态资源**，不是 JSON：返回 `lib\vendor\` 下的文件（用途：CM6 bundle） |

### `vendor` 注意事项（2026-09-27 加）

- 走**同一条路由、同一道信任栅栏**（`conn.requestRejection`），只把响应体换成 JS。
- **文件名白名单**只放行 `[A-Za-z0-9._-]`，从物理上堵死 `../` 目录穿越。
- 响应头 `cache-control: no-cache` —— 改完 bundle 刷新就能拿到新的。
- 目录常量：`VENDOR_DIR = <插件目录>\lib\vendor`
  （指**源码目录**，理由同 `SETTINGS_PATH`：node_modules 里那份副本会被重装清掉）。

⚠ **`API_PREFIX` 与 `API_ROUTE` 是两个不同的常量，别混**：

| 常量 | 值 | 用途 |
|:--|:--|:--|
| `API_PREFIX` | `/floating-editor/api/` | **带**尾斜杠，`bare.slice(API_PREFIX.length)` 切方法名 |
| `API_ROUTE` | `/floating-editor` | **不带**尾斜杠，交给 `webServer.register` 注册 |

**文件读写走 `ctx.fs` 服务**（不是 `node:fs`），所以仍然受 DSH 沙箱约束 ——
写入时会带上调用方 session 的 sandbox policy（见坑 ②）。


## 设置持久化

**真源是插件包目录里的一个 JSON 文件**，由 Host 侧读写：

```
<插件目录>\settings.json
```

```json
{ "mode": "open", "path": "D:\\notes\\example.md", "alpha": 0.21,
  "bg": "#9dabaf", "fg": "#194825", "fontFamily": "Consolas",
  "fontSize": 14, "whiteMode": false, "wrap": false, "fileWidth": 110,
  "showTools": true,
  "box": { "x": 1009, "y": 6, "w": 581, "h": 778 },
  "miniAt": { "x": 1455, "y": 34 },
  "roots": ["D:\\notes", "D:\\docs"], "rootWritable": false }
```
（示例随手取某次运行的值，字段含义才是重点；**用户会自己改这些值，数字对不上先别当 bug**。）

**为什么不用 `localStorage`**（2026-09-26 改）：
- 换端口 → origin 变了 → 设置全丢
- 清 Electron 浏览数据 → 丢
- 不在插件目录里，备份／迁移都不方便
- 现在是**跟着插件走**，改完能直接打开看、能手工改、能随备份一起走

**Client 侧的两层结构**（`FloatEditor` → `FloatEditorInner`）：
外层先 `get-settings` 把设置拉回来，**拿到才 mount 内层**，所以内层的
`useState` 初值可以直接吃真值，不会「先闪一下默认值再跳成真值」。

**写盘是节流的（600ms）** —— 拖窗口／拉分隔条的时候 `box`、`fileWidth`
每一帧都在变，逐个请求写盘会把磁盘和 HTTP 都打爆。

**降级**：Host 还没重启（API 404）、文件损坏、3 秒超时 → 一律退回
`localStorage` 缓存，界面照常工作。
`localStorage`（键名 `dsh-floating-editor/settings`）从此只当**启动缓存**。
文件还不存在时，第一次打开会**自动把缓存迁移过去**，不需要手工搬。

> ⚠ 降级是有代价的：退回缓存后，页面显示的是**缓存里的旧值**，
> 而不是 `settings.json` 里你现在看到的值。所以「设置明明改了、界面却是旧样子」
> 时要先怀疑 `get-settings` 是不是没成功（Host 没重启 / 路由 404）。
> 2026-09-27 实测遇到过：离屏探针里读到的 `alpha` 是缓存里的 `0.88`，
> 而 `settings.json` 写的是 `0.21`。


*文档建立：2026-09-26 · 最后更新：2026-09-27 14:30 · 由作者维护*
