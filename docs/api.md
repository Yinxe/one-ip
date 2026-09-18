# API 接口参考

`/api/*` 全部由 `public/worker/index.js` 单一入口路由，Pages 部署的 `functions/api/[[path]].js` 只是复用同一份代码的薄适配层。改接口只改一处。

本文只收录当前代码里真实存在的接口。已下线见文末。

## 基础地址

项目支持自部署，**接口地址不固定**。所有示例用 `$API` 表示"协议 + 你的部署域名"：

```bash
# 本地开发（pnpm worker:dev / make worker-dev，统一入口）
API=http://127.0.0.1:8787

# 本地 Pages 预览（pnpm preview:pages，固定 8788）
API=http://127.0.0.1:8788

# Worker 自部署
API=https://<worker-name>.<account>.workers.dev

# Pages 自部署
API=https://<pages-project>.<account>.pages.dev

# 绑定自定义域名后
API=https://<你的域名>
```

前端侧对应 `VITE_API_BASE_URL`，缺省为同源 `/api`（见 `src/lib/network.ts`）。

本地开发注意：`worker:dev` 会注入 `LOCAL_DEV=true`，此时 `/api/me` 与设计上依赖真实访客 IP 的调用会返回 503，且所有限流键都会退化成同一个 `local` 桶。需要真实访客 IP 的接口请在部署实例上验证，或显式传 `?ip=`。

## 通用约定

| 项       | 规则                                                                                                                   |
| -------- | ---------------------------------------------------------------------------------------------------------------------- |
| 方法     | 仅 GET / POST。只有 `/api/ping/start` 与 `/api/browser/challenges/verify` 是 POST，其余必须 GET，否则 405              |
| 同源校验 | 请求带 `Origin` 时必须与站点 origin 一致，否则 403。`curl` 不发 `Origin`，因此命令行调用天然通过                       |
| 限流     | GET → `API_LIMITER`（180 次 / 60 秒）；POST → `ACTION_LIMITER`（5 次 / 60 秒），按 `CF-Connecting-IP` 计数             |
| IP 参数  | 只接受公网 IPv4 / IPv6，拒绝私有、回环、组播、文档与基准测试段；IPv4-mapped IPv6 会还原为 IPv4                         |
| 域名参数 | 只接受裸域名，不接受协议、路径、端口、`@`、`%`；自动转小写并去掉末尾点，IDN 转 ASCII；拒绝 `.localhost`/`.internal` 等 |
| 响应头   | JSON 一律 `Cache-Control: no-store` + `X-Content-Type-Options: nosniff`（`/api/ip-type`、`/api/icons` 例外，见下）     |
| 错误格式 | 始终 `{"error": "中文描述"}`，用 HTTP 状态码表达结果；不返回堆栈、上游响应体或访客 IP 日志                             |
| 上游超时 | 数据源统一 10 秒超时，响应体上限 2 MB（`/api/ping/nodes`、`/api/subdomains` 放宽到 8 MB）；POST 请求体上限 4 KB        |
| 路径细节 | 结尾斜杠会被归一，`/api/me/` 等价于 `/api/me`；`/worker/*` 恒为 404，避免暴露后端路径                                  |

## 速查表

| 方法与路径                            | 用途                    | 数据源                  |
| ------------------------------------- | ----------------------- | ----------------------- |
| `GET /api/me`                         | 当前访客 IP 与归属地    | Cloudflare `request.cf` |
| `GET /api/ip/health`                  | IP 健康度 / 信誉分      | Net.Coffee              |
| `GET /api/geoip/{ip}`                 | 单源归属地              | ipwho.is                |
| `GET /api/ip/network/{ip}`            | 前缀 / ASN / PTR / RPKI | RIPEstat                |
| `GET /api/ip-type/{ip}`               | 机房 / 移动 / 代理标记  | ip-api.com              |
| `GET /api/ip/lookup/{ip}`             | 多源聚合 + RDAP         | ipwho.is · ip.sb · RDAP |
| `GET /api/whois/lookup/{query}`       | 注册信息（域名/IP/AS）  | RDAP                    |
| `GET /api/subdomains/{domain}`        | 子域枚举                | crt.sh                  |
| `GET /api/icons/{host}`               | 站点图标代理            | DuckDuckGo              |
| `GET /api/ping/nodes`                 | 全球探针目录            | Globalping              |
| `POST /api/ping/start`                | 创建全球测量            | Globalping              |
| `GET /api/ping/result/{id}`           | 读取测量结果            | Globalping              |
| `GET /api/status/{serviceId}`         | 服务运行状态            | 各官方状态页            |
| `GET /api/browser/tls-fingerprint`    | TLS / JA3 / JA4 指纹    | Cloudflare              |
| `GET /api/browser/challenges`         | 验证器配置状态          | 环境变量                |
| `POST /api/browser/challenges/verify` | 校验人机验证凭证        | Turnstile / reCAPTCHA   |

## IP 类

### `GET /api/me`

读取 Cloudflare 在当前请求上打上的真实访客元数据。无参数。本地环境（`LOCAL_DEV`）或拿不到 `CF-Connecting-IP` 时返回 503，不会伪造 IP。

```bash
curl -fsS "$API/api/me"
```

```json
{
  "ip": "203.0.113.9",
  "country": "US",
  "country_code": "US",
  "region": "California",
  "city": "San Francisco",
  "isp": "Example ISP",
  "asn": 64512,
  "latitude": 37.7749,
  "longitude": -122.4194,
  "timezone": "America/Los_Angeles",
  "source": "Cloudflare request.cf"
}
```

### `GET /api/ip/health`

IP 健康度与信誉标记。唯一支持纯文本输出的接口。

| 查询参数 | 说明                                                |
| -------- | --------------------------------------------------- |
| `ip`     | 省略则取当前访客 IP；本地未部署实例必须显式传该参数 |
| `format` | `json`（默认）或 `text`                             |

```bash
# 查自己的出口 IP
curl -fsS "$API/api/ip/health"

# 查指定 IP
curl -fsS "$API/api/ip/health?ip=1.1.1.1"

# 终端友好输出（脚本 / shell 集成首选）
curl -fsS "$API/api/ip/health?format=text"
curl -fsS "$API/api/ip/health?ip=2606:4700:4700::1111&format=text"
```

```json
{
  "ip": "1.1.1.1",
  "source": "Net.Coffee",
  "checked_at": "2026-09-18T10:54:59.910Z",
  "score": 41,
  "status": "poor",
  "country": "Australia",
  "region": "Queensland",
  "city": "South Brisbane",
  "isp": "Cloudflare, Inc.",
  "asn": 13335,
  "flags": {
    "residential": false,
    "datacenter": true,
    "mobile": false,
    "vpn": false,
    "proxy": false,
    "tor": false,
    "crawler": false,
    "abuser": false
  }
}
```

`score` 不在 0–100 内时为 `null`，`status` 相应为 `unknown`；否则按 ≥75 `good`、≥45 `moderate`、其余 `poor` 分档。`flags` 中上游未给布尔值的项为 `null`，不猜。返回地址与请求地址不一致时直接 502。`text` 格式会过滤控制字符，避免上游文本污染终端。

### `GET /api/geoip/{ip}`

```bash
curl -fsS "$API/api/geoip/2606:4700:4700::1111"
```

返回 `ip` `country` `country_code` `region` `city` `isp` `asn` `latitude` `longitude` `timezone` `source`。ipwho.is 免费额度较小，限流时返回 429。

### `GET /api/ip/network/{ip}`

RIPEstat 的路由与反解信息，含逐个 ASN 的 RPKI 验证。

```bash
curl -fsS "$API/api/ip/network/8.8.8.8"
```

```json
{
  "prefix": "8.8.8.0/24",
  "asns": ["15169"],
  "ptr": "dns.google",
  "routeAvailable": true,
  "ptrAvailable": true,
  "validations": [{ "asn": "15169", "status": "valid" }],
  "source": "RIPE RIS / RIPEstat",
  "checkedAt": "2026-09-18T10:55:04.213Z"
}
```

`status` 取值 `valid` / `invalid` / `unknown` / `unavailable`；两个 RIPE 子查询都是并行的、允许单个失败，所以缺失信息用 `routeAvailable` / `ptrAvailable` 表达，而不是填假数据。RIPE 结果有 5 分钟边缘缓存。

### `GET /api/ip-type/{ip}`

```bash
curl -fsS "$API/api/ip-type/8.8.8.8"
```

```json
{ "available": true, "hosting": true, "mobile": false, "proxy": false }
```

ip-api.com 只支持 HTTP 且限流严格，因此本接口**永不抛错**：不可用时降级为 `{"available": false}`（200）。命中限流会按上游 `X-Ttl` 退避。这是唯一 `Cache-Control: public, max-age=3600` 的 JSON 接口，并同时写入 Cache API。

### `GET /api/ip/lookup/{ip}`

一次请求同时拿三个来源，用于对比归属地口径差异。

```bash
curl -fsS "$API/api/ip/lookup/1.1.1.1"
```

```json
{
  "geo": { "ip": "1.1.1.1", "country": "Australia", "source": "ipwho.is" },
  "sources": [{ "source": "ipwho.is" }, { "source": "ip.sb" }],
  "rdap": { "rdapConformance": ["rdap_level_0"] }
}
```

`geo` 取第一个成功来源（可能只有 `{ "ip": ... }`）；`sources` 只放成功项，长度 0–2；RDAP 失败时 `rdap` 字段省略。三个上游用 `Promise.allSettled` 并行，部分失败不影响整体返回。

## 域名类

### `GET /api/whois/lookup/{query}`

RDAP 实时注册数据，接受三种输入：域名、IP、`AS` + 数字。

```bash
curl -fsS "$API/api/whois/lookup/example.com"   # 域名：经 IANA bootstrap 定位权威 RDAP
curl -fsS "$API/api/whois/lookup/8.8.8.8"       # IPv4 / IPv6：按最长前缀匹配权威服务
curl -fsS "$API/api/whois/lookup/AS15169"       # AS 号：走 rdap.org
```

```json
{
  "source": "RDAP · 注册局实时数据",
  "query": "example.com",
  "data": { "handle": "..." }
}
```

域名后缀没有 HTTPS RDAP 服务时返回 422。`rdap.org` 对部分出口 IP 会返回 403，此时按上游故障映射为 502。IANA bootstrap 表边缘缓存 24 小时。

### `GET /api/subdomains/{domain}`

从证书透明日志枚举子域，含通配符条目。

```bash
curl -fsS "$API/api/subdomains/cloudflare.com" | jq '.names[:8]'
```

```json
{
  "domain": "cloudflare.com",
  "source": "crt.sh",
  "sourceUrl": "https://crt.sh/?q=%25.cloudflare.com&output=json",
  "names": ["*.cfargotunnel.com", "api.cloudflare.com"],
  "checkedAt": "2026-09-18T10:00:00.000Z"
}
```

结果按名称排序去重，落在证书里的无关域名会被丢弃。crt.sh 常见超时，超时后返回 502，重试即可；边缘缓存 5 分钟。

### `GET /api/icons/{host}`

站点图标代理，返回图片二进制（非 JSON）。

```bash
curl -fsS "$API/api/icons/github.com" -o icon.ico
# 只看响应头（后端不放行 HEAD，所以用 -r 0-0 取一个字节）
curl -fsS -r 0-0 -D - -o /dev/null "$API/api/icons/github.com"
```

上游 Content-Type 必须在 `x-icon` / `png` / `jpeg` / `webp` / `gif` 白名单内，否则 502，避免把任意响应体当图片渲染。成功缓存 24 小时（`public, max-age=86400`），上游状态 200–299 边缘缓存 7 天、4xx/5xx 不缓存。`weixin.qq.com` 有专用地址。

## 全球 Ping

### `GET /api/ping/nodes`

```bash
curl -fsS "$API/api/ping/nodes" | jq 'length'
curl -fsS "$API/api/ping/nodes" | jq '.[] | select(.cc=="cn")'
```

返回探针城市数组：`id`（`国家:城市`，`nodes` 参数就用它）、`cc`、`continent`、`city`、`name`、`probes`，以及可选的 `preferredAsn` / `preferredNetwork` / `preferredProbes`。后者按"主流云厂商 + 中国三大运营商"里探针最多的 ASN 选出，用于把测量定向到机房或家宽出口。全量探针列表边缘缓存 5 分钟，因此首次调用较慢（响应可达数 MB）。

### `POST /api/ping/start`

创建一次多节点测量，透传 Globalping 的 measurement 对象，关键字段是 `id`。

```bash
curl -fsS -X POST "$API/api/ping/start" \
  -H 'Content-Type: application/json' \
  -d '{"host":"example.com","nodes":["US:New York","DE:Frankfurt"]}'
```

按大洲批量选择：

```bash
curl -fsS -X POST "$API/api/ping/start" \
  -H 'Content-Type: application/json' \
  -d '{"host":"example.com","regions":["NA","EU"],"perRegion":3}'
```

HTTPS 测量（走 443 的 `HEAD /`，用于测握手与可达性而非 ICMP）：

```bash
curl -fsS -X POST "$API/api/ping/start" \
  -H 'Content-Type: application/json' \
  -d '{"host":"example.com","protocol":"https","regions":["AS"],"perRegion":2}'
```

| 字段        | 说明                                                                     |
| ----------- | ------------------------------------------------------------------------ |
| `host`      | 必填，公网域名或 IP                                                      |
| `protocol`  | `icmp`（默认，`ping`，3 个包）或 `https`（Globalping `http` + `HEAD /`） |
| `nodes`     | 城市 ID 数组，1–50 个，与 `regions` 二选一                               |
| `regions`   | `AF` `AS` `EU` `NA` `OC` `SA` 的子集，需同时给 `perRegion`               |
| `perRegion` | 每大洲探针数，`regions.size × perRegion ≤ 50`                            |
| `preferred` | `true` 时对支持的城市附带 `preferredAsn`                                 |

请求体必须是 JSON 对象且 ≤ 4 KB（超出返回 413），`Content-Type` 缺失或不是 `application/json` 返回 415。注意 POST 限流是 5 次 / 60 秒。

### `GET /api/ping/result/{id}`

```bash
ID=$(curl -fsS -X POST "$API/api/ping/start" -H 'Content-Type: application/json' \
  -d '{"host":"example.com","nodes":["JP:Tokyo"]}' | jq -r .id)
curl -fsS "$API/api/ping/result/$ID" | jq '{status, n: (.results | length)}'
```

`id` 需匹配 `^[a-zA-Z0-9_-]{8,80}$`，否则 400。响应透传 Globalping：`status`（`in-progress` / `finished` / `failed` / `offline`）、`target`、`results[].probe` 与 `results[].result`（`stats.min/avg/max/loss`、`statusCode`、`resolvedAddress`、`rawOutput` 等）。未完成时 `status` 不是 `finished`，调用方自行轮询——前端的做法是 12 轮、间隔 2–5 秒（`src/views/ping/api.ts`）。

## 服务状态

### `GET /api/status/{serviceId}`

`serviceId` 取 `public/worker/services.json` 的 `id`。**当前多数条目的 id 是数字字符串**（前端路由 `/status/openai`、`/status/claude` 只是页面别名，映射到 id `9` 与 `4`，见 `src/views/ai/platforms.ts`），少数是语义 id。

```bash
# 列出可用 id 及其分组
jq -r '.[] | "\(.id)\t\(.name)\t\(.group)"' public/worker/services.json

curl -fsS "$API/api/status/9"          # OpenAI
curl -fsS "$API/api/status/4"          # Claude
curl -fsS "$API/api/status/telegram"   # Telegram
curl -fsS "$API/api/status/aws"        # AWS
```

返回统一为 Statuspage 风格，便于前端一处渲染：

```json
{
  "status": { "indicator": "none", "description": "All Systems Operational" },
  "incidents": [],
  "components": [{ "id": "...", "name": "API", "status": "operational" }],
  "checkedAt": "2026-09-18T10:55:16.906Z",
  "fetchedAt": "2026-09-18T10:55:17.500Z",
  "source": "https://status.openai.com/api/v2/summary.json"
}
```

`indicator` 由上游决定：Statuspage 类来源直接透传（`none` / `minor` / `major` / `critical`），其余来源经 `normalizeStatus` 映射为 `none` / `minor` / `maintenance`。Statuspage 来源的 `page` 字段一并透传，所以上例实际还会带回 `page`、`components` 的完整原始结构。上游没有时间戳时只有 `fetchedAt`。未知 id 返回 404 `未知服务`；`services.json` 里没配 `url` 的条目返回 503，提示去看官方状态页，而不是给一个假的健康度。

## 浏览器诊断

### `GET /api/browser/tls-fingerprint`

```bash
curl -fsS "$API/api/browser/tls-fingerprint"
```

```json
{
  "source": "cloudflare",
  "ja3": null,
  "ja4": null,
  "tlsVersion": "TLSv1.3",
  "tlsCipher": "AEAD-AES256-GCM-SHA384"
}
```

只读 Cloudflare 在入站请求上写的可信元数据，不采集任何客户端信息。读不到的字段为 `null`。JA3/JA4 需要站点开启 Bot Management 才有值；本地 `wrangler dev` 只有 TLS 版本与套件。

### `GET /api/browser/challenges`

```bash
curl -fsS "$API/api/browser/challenges"
```

```json
[
  {
    "id": "turnstile",
    "name": "Cloudflare Turnstile",
    "configured": false,
    "reason": "当前运行环境缺少站点 Key。"
  }
]
```

`id` 为 `turnstile` / `turnstile-noninteractive` / `recaptcha`。`configured` 同时要求站点 Key、服务端 Secret 和当前 hostname 在白名单内，是排查 Secret 是否同步正确的现成手段。未配置时不下发 `sitekey`；`turnstile-noninteractive` 仅在配置了对应 Key 时出现在列表里。本地 `localhost` 等域名必须在生产环境过滤，不会成为授权白名单。

### `POST /api/browser/challenges/verify`

```bash
curl -fsS -X POST "$API/api/browser/challenges/verify" \
  -H 'Content-Type: application/json' \
  -d '{"provider":"turnstile","token":"<前端拿到的 token>"}'
```

```json
{
  "success": true,
  "message": "本站本次验证通过",
  "verifiedAt": "2026-09-18T10:00:00.000Z"
}
```

校验顺序：provider 已配置 → token 长度（reCAPTCHA 8192，其余 2048）→ 上游验签 → `hostname` 一致 → `action === "browser_check"` → reCAPTCHA 分数 ≥ 0.5。失败也是 200，靠 `success: false` + `message` 表达，只有配置与参数问题才用 503 / 400。上游不可达返回 502。

## 错误码

| 状态码 | 含义                                                                              |
| ------ | --------------------------------------------------------------------------------- |
| 400    | 参数无效：非公网 IP、域名含协议或路径、`format` 非法、测量 ID 非法、JSON 不是对象 |
| 403    | 跨站 `Origin`                                                                     |
| 404    | 接口不存在、未知服务；`/worker/*` 与 `/api/dns/*` 恒为 404                        |
| 405    | 方法不允许                                                                        |
| 413    | POST 请求体超过 4 KB                                                              |
| 415    | POST 缺少 `application/json`                                                      |
| 422    | 域名后缀没有可用的 HTTPS RDAP 服务                                                |
| 429    | 本接口限流，或上游明确限流                                                        |
| 502    | 上游连接失败、超时、状态码异常或返回数据校验不通过                                |
| 503    | 本地环境没有真实访客 IP、服务未接入公开状态接口、验证器未在当前站点配置           |

## 已下线

`/api/dns/*`、`/api/iprisk/*`、`/api/card.svg` 均返回 404，`tests/worker.test.mjs` 有断言防止误恢复。
