import { McpServer } from "@modelcontextprotocol/server";
import { SERVER_NAME, SERVER_VERSION, type AppConfig } from "./config.js";
import type { EventService } from "./service.js";
import { registerEventTools } from "./tools.js";

const INSTRUCTIONS = [
    "本服务从米哈游官方公告接口抓取原神、崩铁、绝区零的限时玩法活动。",
    "list_events 默认只返回已经开始且尚未结束的活动；includeUpcoming 加入尚未开始的活动，includeEnded 加入已结束的活动，game 可以只看一款游戏。",
    "工具返回 JSON 文本和 structuredContent，每条活动包含公告正文纯文本和正文图片地址。",
    "活动时间按公告时区（默认 UTC+8）以 YYYY-MM-DD HH:mm:ss 输出，daysLeft 为距结束的天数，已结束为负数。",
    "结果在进程内缓存，公告接口刷新失败时会回退到上次缓存，并在 warnings 中说明。"
].join("\n");

export function createMcpServer(config: AppConfig, service: EventService): McpServer {
    const server = new McpServer(
        { name: SERVER_NAME, version: SERVER_VERSION },
        {
            capabilities: { tools: {} },
            instructions: INSTRUCTIONS
        }
    );
    registerEventTools(server, config, service);
    return server;
}
