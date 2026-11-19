# hoyo-event

## Project

- 通过 stdio 提供 MCP 服务的米哈游活动查询工具，抓取原神、崩铁、绝区零的官方公告。
- 运行时入口是 `src/index.ts`，构建后入口是 `dist/index.js`，`package.json` 的 `bin` 指向它。
- 对外只暴露一个工具：`list_events`。
- 工具返回 JSON 文本和 `structuredContent`，两者内容相同；每个活动带公告正文纯文本和正文图片地址。默认只返回进行中的活动，`includeUpcoming` / `includeEnded` 扩展时间范围，`game` 限定游戏。
- 三款游戏并发抓取列表和正文，进程内缓存筛选结果，默认十分钟；刷新失败时回退到上次缓存，并在 `warnings` 中说明。
- `.github/workflows/publish-dist.yml` 在推送到 `main` 后构建，并强制推送到孤儿分支 `dist`；`dist` 分支用于 `npx -y github:Dave-12138/hoyo-event-mcp#dist`。

## Commands

- 安装依赖：`npm install`
- 构建：`npm run build`，先执行 `tsc` 类型检查，再用 Vite 打包成单个 `dist/index.js`。
- 类型检查：`npm run typecheck`
- 测试：`npm test`，先构建，再用 `node --import tsx` 运行 `test/config.test.mjs`、`test/filter.test.mjs`、`test/announcements.test.mjs` 和 `test/integration.test.mjs`。
- 开发运行：`npm run dev`，先构建再运行 `dist/index.js`。
- 监听构建：`npm run watch`，使用 `vite build --watch` 监听源码变化。
- 运行构建产物：`npm start`
- 只跑一个测试文件：先执行 `npm run build`，再执行 `node --import tsx --test test/integration.test.mjs`。
- 发布 `dist` 分支：推送到 `main` 后自动执行，也可以在 Actions 页面手动触发 `workflow_dispatch`。

## Architecture

- `src/config.ts`：定义三款游戏的列表和正文接口地址、固定查询参数、可覆盖的 UID/等级/区域/平台/渠道，以及缓存和超时配置。
- `src/announcements.ts`：请求列表和正文接口，处理 HTTP 状态、`retcode`、JSON、`data.list` / `data.pic_list` 结构、单请求超时、HTML 转纯文本和图片提取。
- `src/filter.ts`：按游戏规则和通用排除词筛选，限制活动期限为 90 天，规范化活动名，解析和格式化公告时间，按 `ann_id` 去重。
- `src/service.ts`：并发抓取三款游戏的列表和正文，按 `ann_id` 和标题匹配正文，维护进程内缓存，失败时回退到上次快照，按查询参数过滤开始/结束状态并汇总结果。
- `src/tools.ts`：`list_events` 的 Zod 参数、JSON 文本和 `structuredContent`。
- `src/server.ts`：创建 `McpServer` 并注册工具。
- `src/index.ts`：加载配置、创建服务和 stdio 传输、处理退出信号。
- `test/fixtures.mjs`：三款游戏的样例列表和正文响应、按请求路径分发的本地 HTTP 服务，以及可切换的空结果、HTTP 500、`retcode`、结构缺失和慢响应模式；列表和正文的错误模式分开配置。
- `vite.config.ts`：把 `src/index.ts` 打包成单个 ESM 文件，保留 shebang，并把运行依赖和 Node 内置模块标记为外部依赖。

## Conventions

- stdout 只用于 MCP JSON-RPC 消息；日志一律写 stderr。
- TypeScript 使用 `NodeNext` 模块解析，源码中的相对导入必须带 `.js` 扩展名。
- 面向用户的文本、错误信息和代码注释使用中文。
- 运行依赖保持为外部依赖：`@modelcontextprotocol/server` 和 `zod`。
- 公告时间按 `HOYO_EVENT_TIMEZONE_OFFSET`（默认 UTC+8）解析和格式化，不使用进程本地时区；`daysLeft` 用时间戳计算。
- 接口返回的原始标题先去掉 HTML 标签，再参与关键词匹配；返回的 `title` 是去标签后的公告标题。
- 活动名取标题中第一个 `「…」` 的内容；标题外的活动类后缀在提取前去掉。
- `ann_id` 去重在最后统一执行，保留先出现的条目。
- 正文按 `ann_id` 和标题匹配；同一 `ann_id` 可能对应多条标题不同的公告，标题相同的那条才采用。
- 正文图片单独放在 `images`，不内联到正文文本。
- 缓存保存筛选后的每款游戏活动和正文；开始/结束状态在每次工具调用时按当前时间计算。
- 正文获取失败的结果不参与缓存命中，下次调用会重新抓取。
- `HOYO_EVENT_CACHE_TTL_MS=0` 表示不使用新鲜缓存，但抓取失败时仍会回退到上次成功结果。

## Pitfalls

- Node.js 版本要求 20 或更高；从源码构建需要 Node.js 20.19 或更高版本，或 22.12 及以上（Vite 8 的要求）。
- 集成测试启动真实的 `dist/index.js` 子进程，所以单独运行测试前必须先执行 `npm run build`。
- 集成测试通过 `HOYO_EVENT_API_BASE` 指向本地模拟服务，不访问线上接口；默认配置仍指向米哈游线上地址。
- 原神只读 `data.list`，崩铁只读 `data.pic_list`，绝区零两个都读；不要跨游戏复用列表规则。
- `data.pic_list` 中 `title` 为空的是横幅条目，解析时直接跳过，不计入结构错误。
- 崩铁 `data.list` 里的条目即使标题看起来像活动也不读取。
- 绝区零 `福利活动` 标签的签到福利不取；`活动公告` 标签里的 `城募` 也不取。
- 正文接口是同一根地址下的 `getAnnContent`，查询参数与列表接口相同。
- 正文 HTML 中有以 `&lt;t …&gt;` 形式转义的标签，需要先解码实体再清理标签。
- 总超时使用独立的 `AbortController`；任一游戏被取消后，服务会把该游戏记为失败并尝试回退缓存。
- 测试中关闭 MCP 子进程可能延迟数秒，不要以进程立即退出作为通过条件。
- 发布 `dist` 分支时，精简 `package.json` 不能包含 `prepack`、`prepare` 或 `devDependencies`，否则从 git 安装时会尝试构建。
- `dist` 分支由 CI 覆盖，不要手工提交；分支保护需要允许强制推送。

## Maintenance

- 发现新的构建、测试、运行命令或项目约定时，直接更新本文件。
- 本文件只记录当前有效的事实，删除已经不适用的内容。
