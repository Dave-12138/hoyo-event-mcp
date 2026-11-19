import { buildAnnouncementUrl, buildContentUrl, type GameApiConfig } from "./config.js";
import type { Logger } from "./logger.js";

export type AnnouncementSource = "list" | "pic";

export interface AnnouncementEntry {
    annId: number;
    /** 去掉 HTML 标签后的公告标题。 */
    title: string;
    tagLabel: string;
    startTime: string;
    endTime: string;
    source: AnnouncementSource;
}

export interface AnnouncementContent {
    annId: number;
    /** 去掉 HTML 标签后的公告标题。 */
    title: string;
    /** 正文纯文本，保留段落和列表换行。 */
    text: string;
    /** 正文中的图片地址，按出现顺序去重。 */
    images: string[];
}

export type AnnouncementErrorKind =
    | "timeout"
    | "aborted"
    | "network"
    | "http"
    | "json"
    | "retcode"
    | "structure";

export class AnnouncementError extends Error {
    readonly kind: AnnouncementErrorKind;

    constructor(message: string, kind: AnnouncementErrorKind) {
        super(message);
        this.name = "AnnouncementError";
        this.kind = kind;
    }
}

export interface FetchAnnouncementsOptions {
    requestTimeoutMs: number;
    /** 整次工具调用的取消信号，用于施加总超时。 */
    signal?: AbortSignal;
    logger: Logger;
}

interface TimedResponse {
    ok: boolean;
    status: number;
    text: string;
}

export async function fetchAnnouncements(
    game: GameApiConfig,
    options: FetchAnnouncementsOptions
): Promise<AnnouncementEntry[]> {
    const label = `${game.name}公告`;
    const data = await fetchAnnouncementData(buildAnnouncementUrl(game), label, options);

    if (game.key === "genshin" || game.key === "zzz") {
        assertListStructure(data, "list", label);
    }
    if (game.key === "hsr" || game.key === "zzz") {
        assertListStructure(data, "pic_list", label);
    }

    const entries: AnnouncementEntry[] = [];
    let skipped = 0;

    if (game.key !== "hsr") {
        for (const group of data.list as unknown[]) {
            const groupRecord = asRecord(group);
            const list = groupRecord && Array.isArray(groupRecord.list) ? groupRecord.list : [];
            for (const item of list) {
                const title = readTitle(item);
                if (title === undefined) {
                    continue;
                }
                const entry = readEntry(item, "list", title);
                if (entry) entries.push(entry);
                else skipped++;
            }
        }
    }

    if (game.key !== "genshin") {
        for (const group of data.pic_list as unknown[]) {
            const groupRecord = asRecord(group);
            const typeList = groupRecord && Array.isArray(groupRecord.type_list) ? groupRecord.type_list : [];
            for (const type of typeList) {
                const typeRecord = asRecord(type);
                const list = typeRecord && Array.isArray(typeRecord.list) ? typeRecord.list : [];
                for (const item of list) {
                    const title = readTitle(item);
                    if (title === undefined) {
                        continue;
                    }
                    const entry = readEntry(item, "pic", title);
                    if (entry) entries.push(entry);
                    else skipped++;
                }
            }
        }
    }

    if (skipped > 0) {
        options.logger.warn(`${label}中有 ${skipped} 条条目缺少必要字段，已跳过。`);
    }
    return entries;
}

/** 抓取全部公告正文，返回每条公告的纯文本和图片地址。 */
export async function fetchAnnouncementContents(
    game: GameApiConfig,
    options: FetchAnnouncementsOptions
): Promise<AnnouncementContent[]> {
    const label = `${game.name}公告正文`;
    const data = await fetchAnnouncementData(buildContentUrl(game), label, options);

    const keys = (["list", "pic_list"] as const).filter((key) => key in data);
    if (keys.length === 0) {
        throw new AnnouncementError(
            `${label}接口返回的数据结构不完整：缺少 data.list 和 data.pic_list。`,
            "structure"
        );
    }

    const contents: AnnouncementContent[] = [];
    for (const key of keys) {
        if (!Array.isArray(data[key])) {
            throw new AnnouncementError(`${label}接口返回的数据结构不正确：data.${key} 不是数组。`, "structure");
        }
        for (const item of data[key] as unknown[]) {
            const record = asRecord(item);
            if (!record) {
                continue;
            }
            const annId = readAnnId(record.ann_id);
            if (annId === undefined) {
                continue;
            }
            const html = typeof record.content === "string" ? record.content : "";
            const { text, images } = htmlToText(html);
            if (text.length === 0 && images.length === 0) {
                continue;
            }
            contents.push({
                annId,
                title: stripHtml(typeof record.title === "string" ? record.title : ""),
                text,
                images
            });
        }
    }
    return contents;
}

async function fetchAnnouncementData(
    url: string,
    label: string,
    options: FetchAnnouncementsOptions
): Promise<Record<string, unknown>> {
    const response = await requestWithTimeout(url, label, options);

    if (!response.ok) {
        throw new AnnouncementError(`${label}请求失败：HTTP ${response.status}。`, "http");
    }

    let payload: unknown;
    try {
        payload = JSON.parse(response.text);
    } catch {
        throw new AnnouncementError(`${label}接口返回的内容不是 JSON。`, "json");
    }

    const root = asRecord(payload);
    if (!root) {
        throw new AnnouncementError(`${label}接口返回了无法识别的响应。`, "structure");
    }

    if (!("retcode" in root)) {
        throw new AnnouncementError(`${label}接口返回的数据结构不完整：缺少 retcode。`, "structure");
    }
    if (root.retcode !== 0 && root.retcode !== "0") {
        const message = readMessage(root);
        const detail = message === undefined ? "" : `，message=${truncate(message, 200)}`;
        throw new AnnouncementError(`${label}接口返回错误：retcode=${String(root.retcode)}${detail}。`, "retcode");
    }

    const data = asRecord(root.data);
    if (!data) {
        throw new AnnouncementError(`${label}接口返回的数据结构不完整：缺少 data。`, "structure");
    }
    return data;
}

function assertListStructure(
    data: Record<string, unknown>,
    key: "list" | "pic_list",
    label: string
): void {
    if (!(key in data)) {
        throw new AnnouncementError(`${label}接口返回的数据结构不完整：缺少 data.${key}。`, "structure");
    }
    if (!Array.isArray(data[key])) {
        throw new AnnouncementError(`${label}接口返回的数据结构不正确：data.${key} 不是数组。`, "structure");
    }
}

function readTitle(value: unknown): string | undefined {
    const record = asRecord(value);
    if (!record) {
        return undefined;
    }
    const title = stripHtml(typeof record.title === "string" ? record.title : "");
    return title.length > 0 ? title : undefined;
}

function readEntry(value: unknown, source: AnnouncementSource, title: string): AnnouncementEntry | undefined {
    const record = asRecord(value);
    if (!record) {
        return undefined;
    }

    const annId = readAnnId(record.ann_id);
    if (annId === undefined) {
        return undefined;
    }

    const startTime = typeof record.start_time === "string" ? record.start_time.trim() : "";
    const endTime = typeof record.end_time === "string" ? record.end_time.trim() : "";
    if (startTime.length === 0 || endTime.length === 0) {
        return undefined;
    }

    return {
        annId,
        title,
        tagLabel: stripHtml(typeof record.tag_label === "string" ? record.tag_label : ""),
        startTime,
        endTime,
        source
    };
}

function readAnnId(value: unknown): number | undefined {
    if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) {
        return value;
    }
    if (typeof value === "string" && /^\d+$/.test(value.trim())) {
        const parsed = Number(value);
        if (Number.isSafeInteger(parsed) && parsed > 0) {
            return parsed;
        }
    }
    return undefined;
}

async function requestWithTimeout(
    url: string,
    label: string,
    options: FetchAnnouncementsOptions
): Promise<TimedResponse> {
    const controller = new AbortController();
    const outer = options.signal;
    let timedOut = false;
    let outerAborted = false;

    const onOuterAbort = (): void => {
        outerAborted = true;
        controller.abort();
    };
    if (outer?.aborted) {
        onOuterAbort();
    } else {
        outer?.addEventListener("abort", onOuterAbort, { once: true });
    }

    const timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
    }, options.requestTimeoutMs);

    try {
        const response = await fetch(url, { method: "GET", signal: controller.signal });
        const text = await response.text();
        return { ok: response.ok, status: response.status, text };
    } catch (error) {
        if (timedOut) {
            throw new AnnouncementError(`${label}请求超时（${options.requestTimeoutMs} 毫秒）。`, "timeout");
        }
        if (outerAborted || outer?.aborted) {
            throw new AnnouncementError(`${label}请求已取消。`, "aborted");
        }
        throw new AnnouncementError(`${label}请求失败：${describeNetworkError(error)}。`, "network");
    } finally {
        clearTimeout(timer);
        outer?.removeEventListener("abort", onOuterAbort);
    }
}

function describeNetworkError(error: unknown): string {
    if (error instanceof Error) {
        const cause = error.cause;
        if (cause && typeof cause === "object" && "code" in cause) {
            const code = String((cause as { code?: unknown }).code);
            if (code.length > 0) {
                return `无法连接服务器（${error.message}，${code}）`;
            }
        }
        return `无法连接服务器（${error.message}）`;
    }
    return `无法连接服务器（${String(error)}）`;
}

function readMessage(record: Record<string, unknown>): string | undefined {
    for (const key of ["message", "msg"]) {
        if (typeof record[key] === "string" && record[key].length > 0) {
            return record[key];
        }
    }
    return undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
    return typeof value === "object" && value !== null && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : undefined;
}

function truncate(value: string, maxLength: number): string {
    const singleLine = value.replace(/\s+/g, " ").trim();
    return singleLine.length > maxLength ? `${singleLine.slice(0, maxLength)}...` : singleLine;
}

const NAMED_ENTITIES: Record<string, string> = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    nbsp: " "
};

function isValidCodePoint(codePoint: number): boolean {
    return Number.isInteger(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff;
}

/** 去掉 HTML 标签、解码常见实体并合并空白。 */
export function stripHtml(value: string): string {
    return decodeEntities(value.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
}

const BLOCK_END_TAGS =
    /<\/(?:p|div|section|article|h[1-6]|ul|ol|li|table|thead|tbody|tr|td|th|blockquote|pre|figure|figcaption)\s*>/gi;

/**
 * 把公告正文的 HTML 转成纯文本，段落和列表换行保留；
 * 同时收集正文中的图片地址。
 */
export function htmlToText(html: string): { text: string; images: string[] } {
    const images: string[] = [];
    const collectImages = (value: string): string =>
        value.replace(/<img\b[^>]*>/gi, (tag) => {
            const src = readAttribute(tag, "src");
            if (src !== undefined && src.length > 0 && !src.startsWith("data:")) {
                images.push(src);
            }
            return "";
        });

    const withoutScripts = html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, "");
    const withLinks = collectImages(withoutScripts).replace(/<a\b[^>]*>[\s\S]*?<\/a>/gi, (anchor) => {
        const href = readAttribute(anchor, "href");
        const label = decodeEntities(anchor.replace(/<[^>]*>/g, "")).replace(/\s+/g, " ").trim();
        if (href === undefined || href.length === 0) {
            return label;
        }
        return label.length > 0 && label !== href ? `${label}（${href}）` : href;
    });

    // 正文中有以 &lt;t&gt; 形式转义的标签，解码后再清理一次标签和图片。
    const text = collectImages(decodeEntities(withLinks))
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<li\b[^>]*>/gi, "\n- ")
        .replace(BLOCK_END_TAGS, "\n")
        .replace(/<[^>]*>/g, "")
        .replace(/[ \t\f\v\u00a0\u3000]+/g, " ")
        .replace(/ *\n */g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .replace(/\n{2,}(?=- )/g, "\n")
        .trim();

    return { text, images: [...new Set(images)] };
}

function readAttribute(tag: string, name: string): string | undefined {
    const doubleQuoted = new RegExp(`${name}\\s*=\\s*"([^"]*)"`, "i").exec(tag);
    if (doubleQuoted) {
        return decodeEntities(doubleQuoted[1]).trim();
    }
    const singleQuoted = new RegExp(`${name}\\s*=\\s*'([^']*)'`, "i").exec(tag);
    if (singleQuoted) {
        return decodeEntities(singleQuoted[1]).trim();
    }
    const unquoted = new RegExp(`${name}\\s*=\\s*([^\\s>]+)`, "i").exec(tag);
    return unquoted ? decodeEntities(unquoted[1]).trim() : undefined;
}

function decodeEntities(value: string): string {
    return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity: string) => {
        const lower = entity.toLowerCase();
        if (lower.startsWith("#x")) {
            const codePoint = Number.parseInt(lower.slice(2), 16);
            return isValidCodePoint(codePoint) ? String.fromCodePoint(codePoint) : match;
        }
        if (lower.startsWith("#")) {
            const codePoint = Number.parseInt(lower.slice(1), 10);
            return isValidCodePoint(codePoint) ? String.fromCodePoint(codePoint) : match;
        }
        return NAMED_ENTITIES[lower] ?? match;
    });
}
