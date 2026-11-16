# hoyo-event

抓取米哈游官方公告，筛出真正的限时玩法活动，并通过 MCP 工具返回活动列表的服务器。服务使用 stdio 与 MCP 客户端连接，只暴露一个工具 `list_events`。

覆盖三款游戏：

- 原神
- 崩铁
- 绝区零

## 使用

需要 Node.js 20 或更高版本。

### 通过 npx 启动

```bash
npx -y github:Dave-12138/hoyo-event-mcp#dist
```

仓库地址是 `https://github.com/Dave-12138/hoyo-event-mcp`。`dist` 分支由 GitHub Actions 构建并发布。

MCP 客户端配置：

```json
{
  "mcpServers": {
    "hoyo-event": {
      "command": "npx",
      "args": ["-y", "github:Dave-12138/hoyo-event-mcp#dist"]
    }
  }
}
```

不需要 API Key。默认配置已经包含各游戏的公告接口地址和请求参数。

### 通过 npm 全局安装

```bash
npm i -g github:Dave-12138/hoyo-event-mcp#dist
```

安装后可以用 `hoyo-event` 命令启动：

```json
{
  "mcpServers": {
    "hoyo-event": {
      "command": "hoyo-event"
    }
  }
}
```

如果客户端找不到全局命令，可以改成通过 shell 启动：

- Unix：`sh -c hoyo-event`
- Windows：`cmd /c hoyo-event`

## 工具

### list_events

列出活动。默认只返回已经开始且尚未结束的活动。

| 参数 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `game` | string | 否 | 全部 | 只查看某款游戏，可选 `原神`、`崩铁`、`绝区零`。 |
| `includeUpcoming` | boolean | 否 | `false` | 为 `true` 时加入尚未开始的活动。 |
| `includeEnded` | boolean | 否 | `false` | 为 `true` 时加入已经结束的活动。 |

返回文本摘要和 `structuredContent`。文本按游戏分组展示活动表格；列表为空时给出明确说明。

`structuredContent` 顶层字段：

| 字段 | 说明 |
| --- | --- |
| `query` | 本次查询参数，`game` 省略时为 `null`。 |
| `total` | 返回的活动数量。 |
| `counts` | 每款游戏返回的活动数量。 |
| `updatedAt` | 本次结果中最旧的抓取时间，格式为 `YYYY-MM-DD HH:mm:ss`；没有可用数据时为 `null`。 |
| `stale` | 是否有游戏使用了过期缓存。 |
| `failedGames` | 抓取失败且没有可用缓存的游戏。 |
| `warnings` | 抓取失败、缓存回退等中文提示。 |
| `events` | 活动列表。 |

`events` 中每一项的字段：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `game` | string | 游戏名。 |
| `name` | string | 规范化后的活动名，取标题中第一个 `「…」` 的内容。 |
| `title` | string | 公告原始标题，已去掉 HTML 标签，便于人工核对。 |
| `startAt` | string | 开始时间，格式为 `YYYY-MM-DD HH:mm:ss`。 |
| `endAt` | string | 结束时间，格式为 `YYYY-MM-DD HH:mm:ss`。 |
| `daysLeft` | integer | 距结束的整数天数，向上取整；已结束为负数。 |
| `annId` | integer | 公告 ID，用于后续查正文。 |
| `source` | string | `list` 表示纯文本公告，`pic` 表示图文资讯。 |

时间按公告时区的本地时间输出，默认是 UTC+8。`daysLeft` 按真实时间差计算，与显示时的时区无关。

## 数据源

服务直接 GET 以下公告接口，不添加自定义请求头。`retcode` 为 0 时数据在 `data`。

| 游戏 | 接口根地址 | 读取的列表 |
| --- | --- | --- |
| 原神 | `https://hk4e-ann-api.mihoyo.com` | `data.list` 中 `tag_label` 为 `活动` 的条目。 |
| 崩铁 | `https://hkrpg-ann-api.mihoyo.com` | 只读 `data.pic_list`；`data.list` 没有版本活动，直接跳过。 |
| 绝区零 | `https://announcement-api.mihoyo.com` | `data.list` 中 `tag_label` 为 `活动公告` 的条目，以及 `data.pic_list` 中标题含 `活动说明` 的条目。 |

接口路径和默认请求参数写在 `src/config.ts`：

- 原神：`game=hk4e`、`game_biz=hk4e_cn`、`bundle_id=hk4e_cn`、`uid=100003872`、`level=60`、`region=cn_gf01`
- 崩铁：`game=hkrpg`、`game_biz=hkrpg_cn`、`bundle_id=hkrpg_cn`、`uid=103128907`、`level=70`、`region=prod_gf_cn`
- 绝区零：`game=nap`、`game_biz=nap_cn`、`bundle_id=nap_cn`、`uid=10408661`、`level=60`、`region=prod_gf_cn`
- 三款游戏默认使用 `lang=zh-cn`、`platform=pc`、`channel_id=1`。

## 筛选规则

只保留有独立玩法入口、独立奖励，且期限不超过 90 天的限时玩法活动。

- 原神：标题必须含 `活动`；剔除含 `时限内完成`、`上架` 的条目，以及 `「…」：某系统更新` 形式的条目。
- 崩铁：剔除标题含 `网页`、`回归`、`专题`、`展示页`、`跃迁`、`卡池`、`商城`、`上新`、`赛季`、`时装`、`开场好礼`、`更新说明`、`差分宇宙`、`货币战争`、`群星之旅` 的条目。
- 绝区零：`data.list` 中只取 `活动公告`，剔除标题含 `城募` 的战令；`福利活动` 标签是启动游戏时的签到福利，不取。`data.pic_list` 中要求标题含 `活动说明`，且不含 `频段`、`商城`、`剧情`、`更新`。
- 三款游戏统一剔除标题含以下词的条目：`纪行`、`城募`、`无名勋礼`、`千星`、`幽境危战`、`七圣召唤`、`雅集`、`寻遗`、`新手`、`回归`、`常驻`、`礼包`、`周边`、`开售`、`上新`、`上架`、`签到`、`问卷`、`调研`、`声明`、`FAQ`、`攻略征集`、`激励计划`、`网页活动`、`微博`、`小红书`、`音乐`、`听歌`。
- 按 `ann_id` 去重，保留先出现的条目。

活动名取公告标题中第一个 `「…」` 的内容；`『…』` 等内层引号原样保留。标题外的 `活动`、`活动说明`、`活动：…` 后缀会被去掉，崩铁活动名内部的冒号后缀整段保留。

## 配置

| 变量 | 默认值 | 范围 | 说明 |
| --- | --- | --- | --- |
| `HOYO_EVENT_CACHE_TTL_MS` | `600000` | 0 到 86400000 | 进程内缓存的有效时长，单位毫秒。0 表示每次调用都重新抓取，失败时仍会回退到上次结果。 |
| `HOYO_EVENT_REQUEST_TIMEOUT_MS` | `10000` | 1000 到 120000 | 单个公告请求的超时时间，单位毫秒。 |
| `HOYO_EVENT_TOTAL_TIMEOUT_MS` | `20000` | 1000 到 180000 | 一次工具调用中全部公告请求的总超时时间，单位毫秒。 |
| `HOYO_EVENT_TIMEZONE_OFFSET` | `8` | -12 到 14 | 公告时间的时区偏移，单位为小时。用于解析接口时间和格式化输出。 |
| `HOYO_EVENT_API_BASE` | 不设置 | http 或 https 地址 | 覆盖三款游戏的接口根地址，可以带路径前缀。用于代理或本地测试。 |

每款游戏还可以单独覆盖请求参数。原神、崩铁、绝区零的变量前缀分别是 `HOYO_EVENT_GENSHIN`、`HOYO_EVENT_HSR`、`HOYO_EVENT_ZZZ`：

| 后缀 | 说明 |
| --- | --- |
| `_UID` | 玩家 UID。 |
| `_LEVEL` | 角色等级。 |
| `_REGION` | 服务器区域。 |
| `_PLATFORM` | 平台，默认 `pc`。 |
| `_CHANNEL_ID` | 渠道 ID。 |

例如：

```bash
HOYO_EVENT_HSR_UID=103128907
HOYO_EVENT_ZZZ_LEVEL=60
HOYO_EVENT_GENSHIN_REGION=cn_gf01
```

数值配置必须是整数，超出范围或格式错误会让服务在启动时退出。`HOYO_EVENT_API_BASE` 不能包含查询参数或片段。

## 缓存与容错

- 三款游戏并发抓取，每个请求有独立超时，整次调用有总超时。
- 抓取成功后按游戏缓存筛选后的活动，默认缓存十分钟。
- 缓存过期后重新抓取；抓取失败时回退到上次成功的结果，并在文本中说明结果可能不是最新。
- 某款游戏失败且没有缓存时，结果中会保留其他游戏的数据，并列出失败原因。
- 所有游戏都失败且没有缓存时，工具返回中文错误文本，不会让服务退出。
- 网络错误、`retcode` 非 0、JSON 解析失败、数据结构缺失都会转成中文错误文本。
- 缓存只保存在当前进程内，服务重启后清空。

## 开发

从源码构建需要 Node.js 20.19 或更高版本，或 22.12 及以上（Vite 8 的要求）。GitHub Actions 使用 Node 24。

### 安装与构建

```bash
npm install
npm run build
```

构建会先执行 `tsc` 类型检查，再用 Vite 把服务打包成单个 ESM 文件 `dist/index.js`，同时生成 source map。运行依赖 `@modelcontextprotocol/server` 和 `zod` 保持为外部依赖，由包管理器安装。

### 测试

```bash
npm test
```

测试会先构建 `dist/index.js`，再运行：

- `test/config.test.mjs`：环境变量、默认值和公告地址组装。
- `test/filter.test.mjs`：三款游戏的筛选规则、活动名规范化、时间解析、90 天期限和去重。
- `test/announcements.test.mjs`：HTTP 错误、`retcode`、结构缺失、超时和网络错误的处理。
- `test/integration.test.mjs`：启动本地模拟的公告 HTTP 服务和真实的 `dist/index.js` 子进程，通过 MCP 客户端调用 `list_events`，覆盖筛选结果、空结果、缓存回退和总超时。

集成测试通过 `HOYO_EVENT_API_BASE` 指向本地模拟服务，不访问线上接口。样例响应包含三款游戏各自应当保留的活动和应当剔除的条目。

### 常用脚本

| 命令 | 说明 |
| --- | --- |
| `npm run build` | 类型检查并打包。 |
| `npm run typecheck` | 只执行类型检查。 |
| `npm start` | 运行已构建的 `dist/index.js`。 |
| `npm run dev` | 先构建再运行。 |
| `npm run watch` | 监听源码变化并重新打包。 |

### 项目结构

- `src/index.ts`：stdio 入口、配置加载、启动和关闭处理。
- `src/config.ts`：游戏配置、环境变量、公告地址组装。
- `src/announcements.ts`：公告接口请求、超时、响应解析和 HTML 清理。
- `src/filter.ts`：各游戏筛选规则、通用排除词、活动名规范化和时间处理。
- `src/service.ts`：三款游戏并发抓取、进程内缓存、失败回退和结果汇总。
- `src/tools.ts`：`list_events` 的参数、中文文本和 `structuredContent`。
- `src/server.ts`：MCP 服务器组装。
- `test/`：配置、筛选、抓取和端到端测试。
- `vite.config.ts`：Vite 打包配置。
- `.github/workflows/publish-dist.yml`：推送 `main` 后构建并发布孤儿分支 `dist`。

## 发布 dist 分支

`.github/workflows/publish-dist.yml` 在推送到 `main` 或手动触发时执行：

1. `npm ci` 安装依赖。
2. `npm run build` 生成 `dist/index.js`。
3. 生成只含运行依赖和 `bin` 的精简 `package.json`。
4. 强制推送到孤儿分支 `dist`。

`dist` 分支由 CI 覆盖，不要手工提交。分支保护需要允许强制推送。`dist` 分支的 `package.json` 不能包含 `prepack`、`prepare` 或 `devDependencies`，否则从 git 安装时会尝试重新构建。

## 说明

- stdout 只承载 MCP JSON-RPC 消息；日志全部写 stderr。
- 请求不需要 API Key，也不添加自定义请求头。
- 工具只读，不修改任何外部状态。
