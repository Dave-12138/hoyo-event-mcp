import type { CallToolResult, McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { GAME_NAME_ORDER, type AppConfig } from "./config.js";
import { formatAnnouncementTime, formatUtcOffset } from "./filter.js";
import type { EventService, ListEvent, ListEventsResult } from "./service.js";

const listEventsInputSchema = z.object({
    game: z
        .enum(GAME_NAME_ORDER)
        .optional()
        .describe("只查看这款游戏的活动，可选 原神、崩铁、绝区零。省略时返回三款游戏的全部活动。"),
    includeUpcoming: z
        .boolean()
        .default(false)
        .describe("是否包含尚未开始的活动，默认 false。"),
    includeEnded: z
        .boolean()
        .default(false)
        .describe("是否包含已经结束的活动，默认 false。")
});

export function registerEventTools(server: McpServer, config: AppConfig, service: EventService): void {
    server.registerTool(
        "list_events",
        {
            title: "查看限时活动",
            description:
                "列出米哈游官方公告中当前可参与的限时玩法活动，覆盖原神、崩铁和绝区零。默认只返回已经开始且尚未结束的活动；includeUpcoming=true 时加入尚未开始的活动，includeEnded=true 时加入已结束的活动；game 可以只看一款游戏。返回活动名、公告原始标题、起止时间、距结束天数、公告 ID 和公告来源。时间按公告时区的本地时间输出。结果在进程内缓存，刷新失败时会回退到上次缓存。",
            inputSchema: listEventsInputSchema,
            annotations: {
                title: "查看限时活动",
                readOnlyHint: true,
                idempotentHint: true,
                openWorldHint: true
            }
        },
        async (args) => {
            try {
                const result = await service.listEvents({
                    game: args.game,
                    includeUpcoming: args.includeUpcoming,
                    includeEnded: args.includeEnded
                });

                if (result.events.length === 0 && result.failedGames.length === result.requestedGames.length) {
                    return toolError(formatAllFailed(result));
                }

                return textResult(formatText(result, config), buildStructuredContent(result, config));
            } catch (error) {
                return toolError(`获取活动列表失败：${messageOf(error)}`);
            }
        }
    );
}

function buildStructuredContent(result: ListEventsResult, config: AppConfig): Record<string, unknown> {
    return {
        query: {
            game: result.query.game ?? null,
            includeUpcoming: result.query.includeUpcoming,
            includeEnded: result.query.includeEnded
        },
        total: result.events.length,
        counts: result.counts,
        updatedAt: result.updatedAt === null ? null : formatAnnouncementTime(result.updatedAt, config.timezoneOffsetHours),
        stale: result.stale,
        failedGames: result.failedGames,
        warnings: result.warnings,
        events: result.events.map((event) => ({
            game: event.game,
            name: event.name,
            title: event.title,
            startAt: event.startAt,
            endAt: event.endAt,
            daysLeft: event.daysLeft,
            annId: event.annId,
            source: event.source
        }))
    };
}

function formatText(result: ListEventsResult, config: AppConfig): string {
    const lines: string[] = [];
    const total = result.events.length;

    if (total === 0) {
        lines.push(emptyResultMessage(result));
        const hint = emptyResultHint(result.query.includeUpcoming, result.query.includeEnded);
        if (hint.length > 0) {
            lines.push("", hint);
        }
    } else {
        lines.push(`共 ${total} 个活动。`);

        for (const name of result.requestedGames) {
            const events = result.events.filter((event) => event.game === name);
            lines.push("", `${name}（${events.length}）`);
            if (events.length === 0) {
                lines.push(
                    result.failedGames.includes(name)
                        ? "数据获取失败，详见下方提示。"
                        : "该游戏当前没有符合条件的新活动。"
                );
                continue;
            }
            lines.push(formatTable(events));
        }
    }

    if (result.stale) {
        lines.push("", "注意：以下结果包含进程内缓存，数据可能不是最新的。");
    }

    const updatedAt =
        result.updatedAt === null
            ? "未知"
            : formatAnnouncementTime(result.updatedAt, config.timezoneOffsetHours);
    lines.push(
        "",
        `数据获取时间：${updatedAt}（${formatUtcOffset(config.timezoneOffsetHours)}），缓存有效期：${formatCacheTtl(
            config.cacheTtlMs
        )}。`
    );

    if (result.warnings.length > 0) {
        lines.push("", "提示：");
        for (const warning of result.warnings) {
            lines.push(`- ${warning}`);
        }
    }

    return lines.join("\n");
}

function formatTable(events: ListEvent[]): string {
    const lines = [
        "| 活动名 | 公告标题 | 开始时间 | 结束时间 | 距结束 | 公告 ID | 来源 |",
        "| --- | --- | --- | --- | --- | --- | --- |"
    ];
    for (const event of events) {
        lines.push(
            `| ${escapeCell(event.name)} | ${escapeCell(event.title)} | ${event.startAt} | ${event.endAt} | ${formatDaysLeft(
                event
            )} | ${event.annId} | ${event.source} |`
        );
    }
    return lines.join("\n");
}

function formatDaysLeft(event: ListEvent): string {
    const status =
        event.status === "ended" ? "已结束" : event.status === "upcoming" ? "未开始" : "进行中";
    return `${event.daysLeft} 天（${status}）`;
}

function emptyResultMessage(result: ListEventsResult): string {
    if (result.query.game) {
        return `${result.query.game}当前没有符合条件的新活动。`;
    }
    return "三款游戏当前都没有符合条件的新活动。";
}

function emptyResultHint(includeUpcoming: boolean, includeEnded: boolean): string {
    const params: string[] = [];
    if (!includeUpcoming) {
        params.push("includeUpcoming");
    }
    if (!includeEnded) {
        params.push("includeEnded");
    }
    if (params.length === 0) {
        return "公告接口没有返回可识别的限时玩法活动。";
    }
    const missing: string[] = [];
    if (!includeUpcoming) {
        missing.push("尚未开始的活动");
    }
    if (!includeEnded) {
        missing.push("已结束的活动");
    }
    return `当前未包含${missing.join("和")}；可以将 ${params.join(" 或 ")} 设为 true 后重试。`;
}

function formatAllFailed(result: ListEventsResult): string {
    const lines = ["无法获取活动数据。"];
    if (result.warnings.length > 0) {
        for (const warning of result.warnings) {
            lines.push(`- ${warning}`);
        }
    } else {
        lines.push(`- ${result.requestedGames.join("、")}的公告接口都没有返回可用数据。`);
    }
    lines.push("", "请检查网络连接或稍后重试。");
    return lines.join("\n");
}

function formatCacheTtl(ttlMs: number): string {
    if (ttlMs === 0) {
        return "不启用（每次调用都重新抓取）";
    }
    if (ttlMs < 60_000) {
        return `${Math.round(ttlMs / 1000)} 秒`;
    }
    if (ttlMs < 60 * 60_000) {
        return `${Math.round(ttlMs / 60_000)} 分钟`;
    }
    return `${Math.round(ttlMs / (60 * 60_000))} 小时`;
}

function textResult(text: string, structuredContent?: unknown): CallToolResult {
    return structuredContent === undefined
        ? { content: [{ type: "text", text }] }
        : { content: [{ type: "text", text }], structuredContent };
}

function toolError(message: string): CallToolResult {
    return { content: [{ type: "text", text: message }], isError: true };
}

function messageOf(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function escapeCell(value: string): string {
    return value.replace(/\|/g, "\\|").replace(/\r?\n/g, " ").trim();
}
