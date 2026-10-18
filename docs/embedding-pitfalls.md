# Electron 内嵌第三方页面的 4 个高频坑

做「桌面壳 + 内嵌平台网页」这类应用时反复踩到的坑，以及验证过的解法。
全部是通用 Electron 工程问题，不涉及任何具体平台。

## ① SameSite 让跨站 cookie 存不进、发不出

**现象**：登录接口返回成功，页面却立刻跳回登录页；日志显示「下一个请求 401/未登录」。

**原因**：Chromium 把内嵌的桌面版页面按第三方上下文处理，`SameSite=Lax/Strict` 的 cookie 既不保存也不随请求发送。

**解法**：主进程手动搬运 cookie，绕开浏览器的同站判定：

```js
const cookieJar = {}
const cookieHeader = () => Object.entries(cookieJar).map(([k, v]) => `${k}=${v}`).join('; ')

const wr = session.defaultSession.webRequest

// 请求发出前：把 jar 里的 cookie 注入请求头
wr.onBeforeSendHeaders({ urls: [`${API_ORIGIN}/*`] }, (details, cb) => {
  const headers = details.requestHeaders || {}
  const c = cookieHeader()
  if (c) headers['Cookie'] = c
  cb({ requestHeaders: headers })
})

// 响应回来后：抓 Set-Cookie 存进 jar，顺带补齐 CORS 头
wr.onHeadersReceived({ urls: [`${API_ORIGIN}/*`] }, (details, cb) => {
  const headers = details.responseHeaders || {}
  const setCookie = headers['set-cookie'] || headers['Set-Cookie']
  if (Array.isArray(setCookie)) setCookie.forEach((line) => {
    const nv = line.split(';')[0]
    const i = nv.indexOf('=')
    if (i > 0) cookieJar[nv.slice(0, i).trim()] = nv.slice(i + 1).trim()
  })
  headers['Access-Control-Allow-Origin'] = ['*']
  headers['Access-Control-Allow-Credentials'] = ['true']
  cb({ responseHeaders: headers })
})
```

**注意**：这套只对「你自己发的请求」有效。页面内部发出的 XHR/WebSocket 请求不受 `onBeforeSendHeaders` 之外的影响，所以它解决的是「壳 ↔ 自己后端」的会话问题，不是「壳 ↔ 目标站点」的。

## ② UA 泄漏，被识别成第三方客户端

**现象**：页面能打开但功能受限，或直接给一个权限/兼容性拦截页。

**原因**：Electron 默认 UA 里带 `Electron/<版本>`，目标站点很容易识别出这是壳。

**解法**：只在目标 session 上设 UA，别动全局：

```js
session.fromPartition('persist:target').setUserAgent(DESKTOP_UA)
```

**千万不要改 `session.defaultSession`**：如果其他模块退出时用 `session.defaultSession.getUserAgent()` 恢复 UA，会把目标窗口的 UA 一起复原，表现是「改完 UA 一退出就失效」，很难查。

## ③ per-window session 污染

**现象**：多账号场景下，A 账号的登录态串到 B 账号窗口。

**解法**：一账号一个 partition，名字固定可推导：

```js
const partitionOf = (id) => `persist:v-${id}`
const sess = session.fromPartition(partitionOf(id))
```

再加一层「会话导出/导入」，就能做到**免重复扫码登录**：

```js
// 定时导出（30s）
async function exportSession(id) {
  const cookies = await session.fromPartition(partitionOf(id)).cookies.get({})
  fs.writeFileSync(sessionFile(id), JSON.stringify(cookies))
}
// 开窗前导入
async function importSession(id) {
  const saved = JSON.parse(fs.readFileSync(sessionFile(id), 'utf8'))
  const sess = session.fromPartition(partitionOf(id))
  for (const c of saved) await sess.cookies.set(c).catch(() => {})
}
```

注意：导出的是**明文 cookie**，文件要放权限 700 的目录，别进版本库。

## ④ 多开把网络/CPU 打满，或触发风控

**现象**：批量启动 N 个窗口，立刻出现大面积超时或验证码。

**解法**：排队 + 限流，别一次性拉起：

```js
const LAUNCH_INTERVAL = 3000   // 每 3 秒开一个
let activeLimit = 1            // 同时存活上限
let pumping = false
function pump() {
  if (pumping) return
  const active = [...wins.values()].filter((w) => !w.finished).length
  if (active >= activeLimit || !queue.length) return
  pumping = true
  openWindow(queue.shift())
  setTimeout(() => { pumping = false; pump() }, LAUNCH_INTERVAL)
}
```

配合窗口网格排布（按屏幕尺寸算行列，`x = col*40`、`y = row*30` 层叠），避免 N 个窗口叠在一起没法操作。

## 小结

| 坑 | 一句话解法 |
|---|---|
| SameSite 丢 cookie | 主进程 cookieJar + `onBeforeSendHeaders` / `onHeadersReceived` |
| UA 泄漏 | 只改目标 partition，不动 defaultSession |
| 多账号串号 | `persist:v-<id>` 每账号一个 partition + 会话导出 |
| 多开打满 | 队列 + 3 秒间隔 + 并发上限 |
