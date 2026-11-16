import { GAME_NAMES, type GameKey, type GameName } from "./config.js";
import { stripHtml, type AnnouncementEntry, type AnnouncementSource } from "./announcements.js";

export const DAY_MS = 24 * 60 * 60_000;
/** 活动期限上限：90 天。 */
export const MAX_EVENT_DURATION_MS = 90 * DAY_MS;

const GLOBAL_EXCLUDES = [
    "纪行",
    "城募",
    "无名勋礼",
    "千星",
    "幽境危战",
    "七圣召唤",
    "雅集",
    "寻遗",
    "新手",
    "回归",
    "常驻",
    "礼包",
    "周边",
    "开售",
    "上新",
    "上架",
    "签到",
    "问卷",
    "调研",
    "声明",
    "FAQ",
    "攻略征集",
    "激励计划",
    "网页活动",
    "微博",
    "小红书",
    "音乐",
    "听歌"
] as const;

const GENSHIN_EXCLUDES = ["时限内完成", "上架"] as const;

const HSR_EXCLUDES = [
    "网页",
    "回归",
    "专题",
    "展示页",
    "跃迁",
    "卡池",
    "商城",
    "上新",
    "赛季",
    "时装",
    "开场好礼",
    "更新说明",
    "差分宇宙",
    "货币战争",
    "群星之旅"
] as const;

const ZZZ_PIC_EXCLUDES = ["频段", "商城", "剧情", "更新"] as const;

export interface EventRecord {
    gameKey: GameKey;
    game: GameName;
    /** 规范化后的活动名。 */
    name: string;
    /** 公告原始标题，已去掉 HTML 标签。 */
    title: string;
    startAt: string;
    endAt: string;
    startMs: number;
    endMs: number;
    annId: number;
    source: AnnouncementSource;
}

export type EventStatus = "active" | "upcoming" | "ended";

export interface SelectGameEventsOptions {
    /** 公告时间使用的时区偏移，单位为小时。 */
    timezoneOffsetHours: number;
}

/**
 * 按游戏规则、通用关键词和 90 天期限筛选公告，并按 ann_id 去掉同一游戏内的重复条目。
 * 返回值保留公告中的先后顺序。
 */
export function selectGameEvents(
    gameKey: GameKey,
    entries: AnnouncementEntry[],
    options: SelectGameEventsOptions
): EventRecord[] {
    const selected: EventRecord[] = [];
    const seen = new Set<number>();

    for (const rawEntry of entries) {
        const title = stripHtml(rawEntry.title);
        if (title.length === 0) {
            continue;
        }
        const entry = title === rawEntry.title ? rawEntry : { ...rawEntry, title };
        if (!isGameCandidate(gameKey, entry)) {
            continue;
        }
        if (containsAny(title, GLOBAL_EXCLUDES)) {
            continue;
        }
        if (seen.has(entry.annId)) {
            continue;
        }

        const startMs = parseAnnouncementTime(entry.startTime, options.timezoneOffsetHours);
        const endMs = parseAnnouncementTime(entry.endTime, options.timezoneOffsetHours);
        if (startMs === undefined || endMs === undefined || endMs <= startMs) {
            continue;
        }
        if (endMs - startMs > MAX_EVENT_DURATION_MS) {
            continue;
        }

        const name = normalizeEventName(entry.title);
        if (name.length === 0) {
            continue;
        }

        seen.add(entry.annId);
        selected.push({
            gameKey,
            game: GAME_NAMES[gameKey],
            name,
            title: entry.title,
            startAt: formatAnnouncementTime(startMs, options.timezoneOffsetHours),
            endAt: formatAnnouncementTime(endMs, options.timezoneOffsetHours),
            startMs,
            endMs,
            annId: entry.annId,
            source: entry.source
        });
    }

    return selected;
}

function isGameCandidate(gameKey: GameKey, entry: AnnouncementEntry): boolean {
    switch (gameKey) {
        case "genshin":
            return (
                entry.source === "list" &&
                entry.tagLabel.trim() === "活动" &&
                entry.title.includes("活动") &&
                !containsAny(entry.title, GENSHIN_EXCLUDES) &&
                !isGenshinSystemUpdate(entry.title)
            );
        case "hsr":
            return entry.source === "pic" && !containsAny(entry.title, HSR_EXCLUDES);
        case "zzz":
            if (entry.source === "list") {
                return entry.tagLabel.trim() === "活动公告" && !entry.title.includes("城募");
            }
            return entry.title.includes("活动说明") && !containsAny(entry.title, ZZZ_PIC_EXCLUDES);
    }
}

/** 匹配「…」：某系统更新 这类带冒号的系统更新公告。 */
function isGenshinSystemUpdate(title: string): boolean {
    return /」\s*[：:][^」]*更新/u.test(title);
}

function containsAny(text: string, keywords: readonly string[]): boolean {
    const lower = text.toLowerCase();
    return keywords.some((keyword) => lower.includes(keyword.toLowerCase()));
}

/** 取标题中第一个 「…」 的内容，并去掉活动类后缀。 */
export function normalizeEventName(title: string): string {
    const text = stripHtml(title);
    if (text.length === 0) {
        return "";
    }

    const stripped = stripActivitySuffix(text);
    const cleaned = stripped.length > 0 ? stripped : text;
    const start = cleaned.indexOf("「");
    const end = start >= 0 ? cleaned.indexOf("」", start + 1) : -1;
    const candidate = end > start + 1 ? cleaned.slice(start + 1, end).trim() : cleaned;
    return candidate.length > 0 ? candidate : cleaned;
}

function stripActivitySuffix(value: string): string {
    return value.replace(/\s*活动(?:说明)?\s*(?:[：:].*)?$/u, "").trim();
}

/** 把公告中的 YYYY-MM-DD HH:mm:ss 按指定时区解析成时间戳。 */
export function parseAnnouncementTime(raw: string, timezoneOffsetHours: number): number | undefined {
    const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/.exec(raw.trim());
    if (!match) {
        return undefined;
    }

    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const hour = Number(match[4]);
    const minute = Number(match[5]);
    const second = Number(match[6]);
    if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59) {
        return undefined;
    }

    const offsetMs = timezoneOffsetHours * 60 * 60_000;
    const epochMs = Date.UTC(year, month - 1, day, hour, minute, second) - offsetMs;
    const check = new Date(epochMs + offsetMs);
    if (
        check.getUTCFullYear() !== year ||
        check.getUTCMonth() !== month - 1 ||
        check.getUTCDate() !== day ||
        check.getUTCHours() !== hour ||
        check.getUTCMinutes() !== minute ||
        check.getUTCSeconds() !== second
    ) {
        return undefined;
    }
    return epochMs;
}

/** 把时间戳按指定时区格式化成 YYYY-MM-DD HH:mm:ss。 */
export function formatAnnouncementTime(epochMs: number, timezoneOffsetHours: number): string {
    const date = new Date(epochMs + timezoneOffsetHours * 60 * 60_000);
    const datePart = [date.getUTCFullYear(), pad2(date.getUTCMonth() + 1), pad2(date.getUTCDate())].join("-");
    const timePart = [date.getUTCHours(), date.getUTCMinutes(), date.getUTCSeconds()]
        .map(pad2)
        .join(":");
    return `${datePart} ${timePart}`;
}

function pad2(value: number): string {
    return String(value).padStart(2, "0");
}

/** 距离结束的天数，向上取整；已经结束的活动返回负数。 */
export function daysLeft(endMs: number, nowMs: number): number {
    const diff = endMs - nowMs;
    if (diff <= 0) {
        return -Math.max(1, Math.ceil(-diff / DAY_MS));
    }
    return Math.ceil(diff / DAY_MS);
}

export function eventStatus(event: EventRecord, nowMs: number): EventStatus {
    if (event.endMs <= nowMs) {
        return "ended";
    }
    if (event.startMs > nowMs) {
        return "upcoming";
    }
    return "active";
}

/** 按 ann_id 去重，保留先出现的条目。 */
export function dedupeByAnnId(events: EventRecord[]): EventRecord[] {
    const seen = new Set<number>();
    const result: EventRecord[] = [];
    for (const event of events) {
        if (seen.has(event.annId)) {
            continue;
        }
        seen.add(event.annId);
        result.push(event);
    }
    return result;
}

const STATUS_ORDER: Record<EventStatus, number> = {
    active: 0,
    upcoming: 1,
    ended: 2
};

/** 按游戏、状态和结束时间排序；已结束的活动按结束时间倒序。 */
export function sortEvents(events: EventRecord[], nowMs: number): EventRecord[] {
    return [...events].sort((left, right) => {
        const leftStatus = eventStatus(left, nowMs);
        const rightStatus = eventStatus(right, nowMs);
        if (leftStatus !== rightStatus) {
            return STATUS_ORDER[leftStatus] - STATUS_ORDER[rightStatus];
        }
        if (left.gameKey !== right.gameKey) {
            return GAME_KEYS_ORDER[left.gameKey] - GAME_KEYS_ORDER[right.gameKey];
        }
        if (leftStatus === "ended") {
            return right.endMs - left.endMs;
        }
        if (leftStatus === "upcoming") {
            return left.startMs - right.startMs;
        }
        return left.endMs - right.endMs;
    });
}

const GAME_KEYS_ORDER: Record<GameKey, number> = {
    genshin: 0,
    hsr: 1,
    zzz: 2
};

/** 时区偏移的可读标签，例如 UTC+8。 */
export function formatUtcOffset(timezoneOffsetHours: number): string {
    const sign = timezoneOffsetHours >= 0 ? "+" : "-";
    return `UTC${sign}${Math.abs(timezoneOffsetHours)}`;
}
