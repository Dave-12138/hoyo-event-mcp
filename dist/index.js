#!/usr/bin/env node
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
// src/config.ts
var SERVER_NAME = "hoyo-event";
var SERVER_VERSION = "0.1.0";
/** 默认缓存十分钟。 */
var DEFAULT_CACHE_TTL_MS = 6e5;
/** 单个公告请求的默认超时时间。 */
var DEFAULT_REQUEST_TIMEOUT_MS = 1e4;
/** 一次抓取全部游戏的默认总超时时间。 */
var DEFAULT_TOTAL_TIMEOUT_MS = 2e4;
var GAME_KEYS = [
	"genshin",
	"hsr",
	"zzz"
];
var GAME_NAME_ORDER = [
	"原神",
	"崩铁",
	"绝区零"
];
var GAME_NAMES = {
	genshin: "原神",
	hsr: "崩铁",
	zzz: "绝区零"
};
var GAME_NAME_TO_KEY = {
	原神: "genshin",
	崩铁: "hsr",
	绝区零: "zzz"
};
var ConfigError = class extends Error {
	constructor(message) {
		super(message);
		this.name = "ConfigError";
	}
};
var GAME_DEFAULTS = {
	genshin: {
		key: "genshin",
		name: GAME_NAMES.genshin,
		apiBase: "https://hk4e-ann-api.mihoyo.com",
		apiPath: "/common/hk4e_cn/announcement/api/getAnnList",
		contentApiPath: "/common/hk4e_cn/announcement/api/getAnnContent",
		query: {
			game: "hk4e",
			gameBiz: "hk4e_cn",
			bundleId: "hk4e_cn",
			uid: "100003872",
			level: "60",
			region: "cn_gf01",
			platform: "pc",
			channelId: "1"
		}
	},
	hsr: {
		key: "hsr",
		name: GAME_NAMES.hsr,
		apiBase: "https://hkrpg-ann-api.mihoyo.com",
		apiPath: "/common/hkrpg_cn/announcement/api/getAnnList",
		contentApiPath: "/common/hkrpg_cn/announcement/api/getAnnContent",
		query: {
			game: "hkrpg",
			gameBiz: "hkrpg_cn",
			bundleId: "hkrpg_cn",
			uid: "103128907",
			level: "70",
			region: "prod_gf_cn",
			platform: "pc",
			channelId: "1"
		}
	},
	zzz: {
		key: "zzz",
		name: GAME_NAMES.zzz,
		apiBase: "https://announcement-api.mihoyo.com",
		apiPath: "/common/nap_cn/announcement/api/getAnnList",
		contentApiPath: "/common/nap_cn/announcement/api/getAnnContent",
		query: {
			game: "nap",
			gameBiz: "nap_cn",
			bundleId: "nap_cn",
			uid: "10408661",
			level: "60",
			region: "prod_gf_cn",
			platform: "pc",
			channelId: "1"
		}
	}
};
var ENV_PREFIXES = {
	genshin: "HOYO_EVENT_GENSHIN",
	hsr: "HOYO_EVENT_HSR",
	zzz: "HOYO_EVENT_ZZZ"
};
function loadConfig(env = process.env) {
	const apiBaseOverride = readString(env, "HOYO_EVENT_API_BASE");
	if (apiBaseOverride !== void 0) normalizeApiBase(apiBaseOverride, "HOYO_EVENT_API_BASE");
	const games = {};
	for (const key of GAME_KEYS) games[key] = loadGameConfig(key, env, apiBaseOverride);
	return {
		games,
		cacheTtlMs: readInt(env, "HOYO_EVENT_CACHE_TTL_MS", DEFAULT_CACHE_TTL_MS, 0, 864e5),
		requestTimeoutMs: readInt(env, "HOYO_EVENT_REQUEST_TIMEOUT_MS", DEFAULT_REQUEST_TIMEOUT_MS, 1e3, 12e4),
		totalTimeoutMs: readInt(env, "HOYO_EVENT_TOTAL_TIMEOUT_MS", DEFAULT_TOTAL_TIMEOUT_MS, 1e3, 18e4),
		timezoneOffsetHours: readInt(env, "HOYO_EVENT_TIMEZONE_OFFSET", 8, -12, 14)
	};
}
function buildAnnouncementUrl(game) {
	return buildApiUrl(game, game.apiPath);
}
function buildContentUrl(game) {
	return buildApiUrl(game, game.contentApiPath);
}
function buildApiUrl(game, apiPath) {
	const url = new URL(`${game.apiBase.replace(/\/+$/, "")}${apiPath}`);
	for (const [key, value] of Object.entries(game.query)) url.searchParams.set(key, value);
	return url.toString();
}
function loadGameConfig(key, env, apiBaseOverride) {
	const defaults = GAME_DEFAULTS[key];
	const prefix = ENV_PREFIXES[key];
	const uid = readDigits(env, `${prefix}_UID`, defaults.query.uid, 1, 9999999999);
	const level = readDigits(env, `${prefix}_LEVEL`, defaults.query.level, 1, 100);
	const channelId = readDigits(env, `${prefix}_CHANNEL_ID`, defaults.query.channelId, 0, 100);
	const region = readString(env, `${prefix}_REGION`) ?? defaults.query.region;
	const platform = readString(env, `${prefix}_PLATFORM`) ?? defaults.query.platform;
	return {
		key,
		name: defaults.name,
		apiBase: normalizeApiBase(apiBaseOverride ?? defaults.apiBase, "HOYO_EVENT_API_BASE"),
		apiPath: defaults.apiPath,
		contentApiPath: defaults.contentApiPath,
		query: {
			game: defaults.query.game,
			game_biz: defaults.query.gameBiz,
			lang: "zh-cn",
			bundle_id: defaults.query.bundleId,
			channel_id: String(channelId),
			level: String(level),
			platform,
			region,
			uid: String(uid)
		}
	};
}
function readString(env, name) {
	const raw = env[name];
	if (raw === void 0) return;
	const value = raw.trim();
	return value.length > 0 ? value : void 0;
}
function readInt(env, name, fallback, min, max) {
	const raw = readString(env, name);
	if (raw === void 0) return fallback;
	if (!/^-?\d+$/.test(raw)) throw new ConfigError(`${name} 必须是 ${min} 到 ${max} 之间的整数，当前值为“${raw}”。`);
	const value = Number(raw);
	if (!Number.isSafeInteger(value) || value < min || value > max) throw new ConfigError(`${name} 必须是 ${min} 到 ${max} 之间的整数，当前值为“${raw}”。`);
	return value;
}
function readDigits(env, name, fallback, min, max) {
	const raw = readString(env, name);
	if (raw === void 0) return Number(fallback);
	if (!/^\d+$/.test(raw)) throw new ConfigError(`${name} 必须是由数字组成的整数，当前值为“${raw}”。`);
	const value = Number(raw);
	if (!Number.isSafeInteger(value) || value < min || value > max) throw new ConfigError(`${name} 必须是 ${min} 到 ${max} 之间的整数，当前值为“${raw}”。`);
	return value;
}
function normalizeApiBase(raw, name) {
	let url;
	try {
		url = new URL(raw);
	} catch {
		throw new ConfigError(`${name} 不是合法的 URL：“${raw}”。`);
	}
	if (url.protocol !== "http:" && url.protocol !== "https:") throw new ConfigError(`${name} 只支持 http 或 https 地址。`);
	if (url.search.length > 0 || url.hash.length > 0) throw new ConfigError(`${name} 不能包含查询参数或片段。`);
	url.pathname = url.pathname.replace(/\/+$/, "");
	return url.toString().replace(/\/$/, "");
}
// src/announcements.ts
var AnnouncementError = class extends Error {
	kind;
	constructor(message, kind) {
		super(message);
		this.name = "AnnouncementError";
		this.kind = kind;
	}
};
async function fetchAnnouncements(game, options) {
	const label = `${game.name}公告`;
	const data = await fetchAnnouncementData(buildAnnouncementUrl(game), label, options);
	if (game.key === "genshin" || game.key === "zzz") assertListStructure(data, "list", label);
	if (game.key === "hsr" || game.key === "zzz") assertListStructure(data, "pic_list", label);
	const entries = [];
	let skipped = 0;
	if (game.key !== "hsr") for (const group of data.list) {
		const groupRecord = asRecord(group);
		const list = groupRecord && Array.isArray(groupRecord.list) ? groupRecord.list : [];
		for (const item of list) {
			const title = readTitle(item);
			if (title === void 0) continue;
			const entry = readEntry(item, "list", title);
			if (entry) entries.push(entry);
			else skipped++;
		}
	}
	if (game.key !== "genshin") for (const group of data.pic_list) {
		const groupRecord = asRecord(group);
		const typeList = groupRecord && Array.isArray(groupRecord.type_list) ? groupRecord.type_list : [];
		for (const type of typeList) {
			const typeRecord = asRecord(type);
			const list = typeRecord && Array.isArray(typeRecord.list) ? typeRecord.list : [];
			for (const item of list) {
				const title = readTitle(item);
				if (title === void 0) continue;
				const entry = readEntry(item, "pic", title);
				if (entry) entries.push(entry);
				else skipped++;
			}
		}
	}
	if (skipped > 0) options.logger.warn(`${label}中有 ${skipped} 条条目缺少必要字段，已跳过。`);
	return entries;
}
/** 抓取全部公告正文，返回每条公告的纯文本和图片地址。 */
async function fetchAnnouncementContents(game, options) {
	const label = `${game.name}公告正文`;
	const data = await fetchAnnouncementData(buildContentUrl(game), label, options);
	const keys = ["list", "pic_list"].filter((key) => key in data);
	if (keys.length === 0) throw new AnnouncementError(`${label}接口返回的数据结构不完整：缺少 data.list 和 data.pic_list。`, "structure");
	const contents = [];
	for (const key of keys) {
		if (!Array.isArray(data[key])) throw new AnnouncementError(`${label}接口返回的数据结构不正确：data.${key} 不是数组。`, "structure");
		for (const item of data[key]) {
			const record = asRecord(item);
			if (!record) continue;
			const annId = readAnnId(record.ann_id);
			if (annId === void 0) continue;
			const { text, images } = htmlToText(typeof record.content === "string" ? record.content : "");
			if (text.length === 0 && images.length === 0) continue;
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
async function fetchAnnouncementData(url, label, options) {
	const response = await requestWithTimeout(url, label, options);
	if (!response.ok) throw new AnnouncementError(`${label}请求失败：HTTP ${response.status}。`, "http");
	let payload;
	try {
		payload = JSON.parse(response.text);
	} catch {
		throw new AnnouncementError(`${label}接口返回的内容不是 JSON。`, "json");
	}
	const root = asRecord(payload);
	if (!root) throw new AnnouncementError(`${label}接口返回了无法识别的响应。`, "structure");
	if (!("retcode" in root)) throw new AnnouncementError(`${label}接口返回的数据结构不完整：缺少 retcode。`, "structure");
	if (root.retcode !== 0 && root.retcode !== "0") {
		const message = readMessage(root);
		const detail = message === void 0 ? "" : `，message=${truncate(message, 200)}`;
		throw new AnnouncementError(`${label}接口返回错误：retcode=${String(root.retcode)}${detail}。`, "retcode");
	}
	const data = asRecord(root.data);
	if (!data) throw new AnnouncementError(`${label}接口返回的数据结构不完整：缺少 data。`, "structure");
	return data;
}
function assertListStructure(data, key, label) {
	if (!(key in data)) throw new AnnouncementError(`${label}接口返回的数据结构不完整：缺少 data.${key}。`, "structure");
	if (!Array.isArray(data[key])) throw new AnnouncementError(`${label}接口返回的数据结构不正确：data.${key} 不是数组。`, "structure");
}
function readTitle(value) {
	const record = asRecord(value);
	if (!record) return;
	const title = stripHtml(typeof record.title === "string" ? record.title : "");
	return title.length > 0 ? title : void 0;
}
function readEntry(value, source, title) {
	const record = asRecord(value);
	if (!record) return;
	const annId = readAnnId(record.ann_id);
	if (annId === void 0) return;
	const startTime = typeof record.start_time === "string" ? record.start_time.trim() : "";
	const endTime = typeof record.end_time === "string" ? record.end_time.trim() : "";
	if (startTime.length === 0 || endTime.length === 0) return;
	return {
		annId,
		title,
		tagLabel: stripHtml(typeof record.tag_label === "string" ? record.tag_label : ""),
		startTime,
		endTime,
		source
	};
}
function readAnnId(value) {
	if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) return value;
	if (typeof value === "string" && /^\d+$/.test(value.trim())) {
		const parsed = Number(value);
		if (Number.isSafeInteger(parsed) && parsed > 0) return parsed;
	}
}
async function requestWithTimeout(url, label, options) {
	const controller = new AbortController();
	const outer = options.signal;
	let timedOut = false;
	let outerAborted = false;
	const onOuterAbort = () => {
		outerAborted = true;
		controller.abort();
	};
	if (outer?.aborted) onOuterAbort();
	else outer?.addEventListener("abort", onOuterAbort, { once: true });
	const timer = setTimeout(() => {
		timedOut = true;
		controller.abort();
	}, options.requestTimeoutMs);
	try {
		const response = await fetch(url, {
			method: "GET",
			signal: controller.signal
		});
		const text = await response.text();
		return {
			ok: response.ok,
			status: response.status,
			text
		};
	} catch (error) {
		if (timedOut) throw new AnnouncementError(`${label}请求超时（${options.requestTimeoutMs} 毫秒）。`, "timeout");
		if (outerAborted || outer?.aborted) throw new AnnouncementError(`${label}请求已取消。`, "aborted");
		throw new AnnouncementError(`${label}请求失败：${describeNetworkError(error)}。`, "network");
	} finally {
		clearTimeout(timer);
		outer?.removeEventListener("abort", onOuterAbort);
	}
}
function describeNetworkError(error) {
	if (error instanceof Error) {
		const cause = error.cause;
		if (cause && typeof cause === "object" && "code" in cause) {
			const code = String(cause.code);
			if (code.length > 0) return `无法连接服务器（${error.message}，${code}）`;
		}
		return `无法连接服务器（${error.message}）`;
	}
	return `无法连接服务器（${String(error)}）`;
}
function readMessage(record) {
	for (const key of ["message", "msg"]) if (typeof record[key] === "string" && record[key].length > 0) return record[key];
}
function asRecord(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value) ? value : void 0;
}
function truncate(value, maxLength) {
	const singleLine = value.replace(/\s+/g, " ").trim();
	return singleLine.length > maxLength ? `${singleLine.slice(0, maxLength)}...` : singleLine;
}
var NAMED_ENTITIES = {
	amp: "&",
	lt: "<",
	gt: ">",
	quot: "\"",
	apos: "'",
	nbsp: " "
};
function isValidCodePoint(codePoint) {
	return Number.isInteger(codePoint) && codePoint >= 0 && codePoint <= 1114111;
}
/** 去掉 HTML 标签、解码常见实体并合并空白。 */
function stripHtml(value) {
	return decodeEntities(value.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
}
var BLOCK_END_TAGS = /<\/(?:p|div|section|article|h[1-6]|ul|ol|li|table|thead|tbody|tr|td|th|blockquote|pre|figure|figcaption)\s*>/gi;
/**
* 把公告正文的 HTML 转成纯文本，段落和列表换行保留；
* 同时收集正文中的图片地址。
*/
function htmlToText(html) {
	const images = [];
	const collectImages = (value) => value.replace(/<img\b[^>]*>/gi, (tag) => {
		const src = readAttribute(tag, "src");
		if (src !== void 0 && src.length > 0 && !src.startsWith("data:")) images.push(src);
		return "";
	});
	return {
		text: collectImages(decodeEntities(collectImages(html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, "")).replace(/<a\b[^>]*>[\s\S]*?<\/a>/gi, (anchor) => {
			const href = readAttribute(anchor, "href");
			const label = decodeEntities(anchor.replace(/<[^>]*>/g, "")).replace(/\s+/g, " ").trim();
			if (href === void 0 || href.length === 0) return label;
			return label.length > 0 && label !== href ? `${label}（${href}）` : href;
		}))).replace(/<br\s*\/?>/gi, "\n").replace(/<li\b[^>]*>/gi, "\n- ").replace(BLOCK_END_TAGS, "\n").replace(/<[^>]*>/g, "").replace(/[ \t\f\v\u00a0\u3000]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").replace(/\n{2,}(?=- )/g, "\n").trim(),
		images: [...new Set(images)]
	};
}
function readAttribute(tag, name) {
	const doubleQuoted = new RegExp(`${name}\\s*=\\s*"([^"]*)"`, "i").exec(tag);
	if (doubleQuoted) return decodeEntities(doubleQuoted[1]).trim();
	const singleQuoted = new RegExp(`${name}\\s*=\\s*'([^']*)'`, "i").exec(tag);
	if (singleQuoted) return decodeEntities(singleQuoted[1]).trim();
	const unquoted = new RegExp(`${name}\\s*=\\s*([^\\s>]+)`, "i").exec(tag);
	return unquoted ? decodeEntities(unquoted[1]).trim() : void 0;
}
function decodeEntities(value) {
	return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity) => {
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
// src/filter.ts
var DAY_MS = 864e5;
90 * DAY_MS;
var GLOBAL_EXCLUDES = [
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
];
var GENSHIN_EXCLUDES = ["时限内完成", "上架"];
var HSR_EXCLUDES = [
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
];
var ZZZ_PIC_EXCLUDES = [
	"频段",
	"商城",
	"剧情",
	"更新"
];
/**
* 按游戏规则、通用关键词和 90 天期限筛选公告，并按 ann_id 去掉同一游戏内的重复条目。
* 返回值保留公告中的先后顺序。
*/
function selectGameEvents(gameKey, entries, options) {
	const selected = [];
	const seen = /* @__PURE__ */ new Set();
	for (const rawEntry of entries) {
		const title = stripHtml(rawEntry.title);
		if (title.length === 0) continue;
		const entry = title === rawEntry.title ? rawEntry : {
			...rawEntry,
			title
		};
		if (!isGameCandidate(gameKey, entry)) continue;
		if (containsAny(title, GLOBAL_EXCLUDES)) continue;
		if (seen.has(entry.annId)) continue;
		const startMs = parseAnnouncementTime(entry.startTime, options.timezoneOffsetHours);
		const endMs = parseAnnouncementTime(entry.endTime, options.timezoneOffsetHours);
		if (startMs === void 0 || endMs === void 0 || endMs <= startMs) continue;
		if (endMs - startMs > 7776e6) continue;
		const name = normalizeEventName(entry.title);
		if (name.length === 0) continue;
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
function isGameCandidate(gameKey, entry) {
	switch (gameKey) {
		case "genshin": return entry.source === "list" && entry.tagLabel.trim() === "活动" && entry.title.includes("活动") && !containsAny(entry.title, GENSHIN_EXCLUDES) && !isGenshinSystemUpdate(entry.title);
		case "hsr": return entry.source === "pic" && !containsAny(entry.title, HSR_EXCLUDES);
		case "zzz":
			if (entry.source === "list") return entry.tagLabel.trim() === "活动公告" && !entry.title.includes("城募");
			return entry.title.includes("活动说明") && !containsAny(entry.title, ZZZ_PIC_EXCLUDES);
	}
}
/** 匹配「…」：某系统更新 这类带冒号的系统更新公告。 */
function isGenshinSystemUpdate(title) {
	return /」\s*[：:][^」]*更新/u.test(title);
}
function containsAny(text, keywords) {
	const lower = text.toLowerCase();
	return keywords.some((keyword) => lower.includes(keyword.toLowerCase()));
}
/** 取标题中第一个 「…」 的内容，并去掉活动类后缀。 */
function normalizeEventName(title) {
	const text = stripHtml(title);
	if (text.length === 0) return "";
	const stripped = stripActivitySuffix(text);
	const cleaned = stripped.length > 0 ? stripped : text;
	const start = cleaned.indexOf("「");
	const end = start >= 0 ? cleaned.indexOf("」", start + 1) : -1;
	const candidate = end > start + 1 ? cleaned.slice(start + 1, end).trim() : cleaned;
	return candidate.length > 0 ? candidate : cleaned;
}
function stripActivitySuffix(value) {
	return value.replace(/\s*活动(?:说明)?\s*(?:[：:].*)?$/u, "").trim();
}
/** 把公告中的 YYYY-MM-DD HH:mm:ss 按指定时区解析成时间戳。 */
function parseAnnouncementTime(raw, timezoneOffsetHours) {
	const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/.exec(raw.trim());
	if (!match) return;
	const year = Number(match[1]);
	const month = Number(match[2]);
	const day = Number(match[3]);
	const hour = Number(match[4]);
	const minute = Number(match[5]);
	const second = Number(match[6]);
	if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59) return;
	const offsetMs = timezoneOffsetHours * 60 * 6e4;
	const epochMs = Date.UTC(year, month - 1, day, hour, minute, second) - offsetMs;
	const check = new Date(epochMs + offsetMs);
	if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day || check.getUTCHours() !== hour || check.getUTCMinutes() !== minute || check.getUTCSeconds() !== second) return;
	return epochMs;
}
/** 把时间戳按指定时区格式化成 YYYY-MM-DD HH:mm:ss。 */
function formatAnnouncementTime(epochMs, timezoneOffsetHours) {
	const date = new Date(epochMs + timezoneOffsetHours * 60 * 6e4);
	return `${[
		date.getUTCFullYear(),
		pad2(date.getUTCMonth() + 1),
		pad2(date.getUTCDate())
	].join("-")} ${[
		date.getUTCHours(),
		date.getUTCMinutes(),
		date.getUTCSeconds()
	].map(pad2).join(":")}`;
}
function pad2(value) {
	return String(value).padStart(2, "0");
}
/** 距离结束的天数，向上取整；已经结束的活动返回负数。 */
function daysLeft(endMs, nowMs) {
	const diff = endMs - nowMs;
	if (diff <= 0) return -Math.max(1, Math.ceil(-diff / DAY_MS));
	return Math.ceil(diff / DAY_MS);
}
function eventStatus(event, nowMs) {
	if (event.endMs <= nowMs) return "ended";
	if (event.startMs > nowMs) return "upcoming";
	return "active";
}
/** 按 ann_id 去重，保留先出现的条目。 */
function dedupeByAnnId(events) {
	const seen = /* @__PURE__ */ new Set();
	const result = [];
	for (const event of events) {
		if (seen.has(event.annId)) continue;
		seen.add(event.annId);
		result.push(event);
	}
	return result;
}
var STATUS_ORDER = {
	active: 0,
	upcoming: 1,
	ended: 2
};
/** 按游戏、状态和结束时间排序；已结束的活动按结束时间倒序。 */
function sortEvents(events, nowMs) {
	return [...events].sort((left, right) => {
		const leftStatus = eventStatus(left, nowMs);
		const rightStatus = eventStatus(right, nowMs);
		if (leftStatus !== rightStatus) return STATUS_ORDER[leftStatus] - STATUS_ORDER[rightStatus];
		if (left.gameKey !== right.gameKey) return GAME_KEYS_ORDER[left.gameKey] - GAME_KEYS_ORDER[right.gameKey];
		if (leftStatus === "ended") return right.endMs - left.endMs;
		if (leftStatus === "upcoming") return left.startMs - right.startMs;
		return left.endMs - right.endMs;
	});
}
var GAME_KEYS_ORDER = {
	genshin: 0,
	hsr: 1,
	zzz: 2
};
/** 时区偏移的可读标签，例如 UTC+8。 */
function formatUtcOffset(timezoneOffsetHours) {
	return `UTC${timezoneOffsetHours >= 0 ? "+" : "-"}${Math.abs(timezoneOffsetHours)}`;
}
// src/logger.ts
var LOG_PREFIX = "hoyo-event";
function createLogger(prefix = LOG_PREFIX) {
	const write = (level, message, error) => {
		const suffix = error === void 0 ? "" : ` ${formatError(error)}`;
		process.stderr.write(`[${prefix}] ${level} ${message}${suffix}\n`);
	};
	return {
		info: (message) => write("info", message),
		warn: (message, error) => write("warn", message, error),
		error: (message, error) => write("error", message, error)
	};
}
function formatError(error) {
	if (error instanceof Error) return error.stack ?? error.message;
	return String(error);
}
// src/tools.ts
var listEventsInputSchema = z.object({
	game: z.enum(GAME_NAME_ORDER).optional().describe("只查看这款游戏的活动，可选 原神、崩铁、绝区零。省略时返回三款游戏的全部活动。"),
	includeUpcoming: z.boolean().default(false).describe("是否包含尚未开始的活动，默认 false。"),
	includeEnded: z.boolean().default(false).describe("是否包含已经结束的活动，默认 false。")
});
function registerEventTools(server, config, service) {
	server.registerTool("list_events", {
		title: "查看限时活动",
		description: "列出米哈游官方公告中当前可参与的限时玩法活动，覆盖原神、崩铁和绝区零。默认只返回已经开始且尚未结束的活动；includeUpcoming=true 时加入尚未开始的活动，includeEnded=true 时加入已结束的活动；game 可以只看一款游戏。返回 JSON 文本和 structuredContent，每个活动包含活动名、公告标题、起止时间、距结束天数、状态、公告 ID、正文纯文本和正文图片地址。时间按公告时区的本地时间输出。结果在进程内缓存，刷新失败时会回退到上次缓存。",
		inputSchema: listEventsInputSchema,
		annotations: {
			title: "查看限时活动",
			readOnlyHint: true,
			idempotentHint: true,
			openWorldHint: true
		}
	}, async (args) => {
		try {
			const result = await service.listEvents({
				game: args.game,
				includeUpcoming: args.includeUpcoming,
				includeEnded: args.includeEnded
			});
			if (result.events.length === 0 && result.failedGames.length === result.requestedGames.length) return toolError(formatAllFailed(result));
			const payload = buildPayload(result, config);
			return textResult(JSON.stringify(payload, null, 2), payload);
		} catch (error) {
			return toolError(`获取活动列表失败：${messageOf(error)}`);
		}
	});
}
function buildPayload(result, config) {
	const payload = {
		query: {
			game: result.query.game ?? null,
			includeUpcoming: result.query.includeUpcoming,
			includeEnded: result.query.includeEnded
		},
		total: result.events.length,
		counts: result.counts,
		updatedAt: result.updatedAt === null ? null : formatAnnouncementTime(result.updatedAt, config.timezoneOffsetHours),
		timezone: formatUtcOffset(config.timezoneOffsetHours),
		stale: result.stale,
		failedGames: result.failedGames,
		warnings: result.warnings
	};
	if (result.events.length === 0) payload.message = emptyResultMessage(result);
	payload.events = result.events.map(buildEvent);
	return payload;
}
function buildEvent(event) {
	return {
		game: event.game,
		name: event.name,
		title: event.title,
		startAt: event.startAt,
		endAt: event.endAt,
		daysLeft: event.daysLeft,
		status: event.status,
		annId: event.annId,
		source: event.source,
		content: event.content,
		images: event.images
	};
}
function emptyResultMessage(result) {
	const message = result.query.game ? `${result.query.game}当前没有符合条件的新活动。` : "三款游戏当前都没有符合条件的新活动。";
	const hint = emptyResultHint(result.query.includeUpcoming, result.query.includeEnded);
	return hint.length === 0 ? message : `${message}\n${hint}`;
}
function emptyResultHint(includeUpcoming, includeEnded) {
	const params = [];
	if (!includeUpcoming) params.push("includeUpcoming");
	if (!includeEnded) params.push("includeEnded");
	if (params.length === 0) return "公告接口没有返回可识别的限时玩法活动。";
	const missing = [];
	if (!includeUpcoming) missing.push("尚未开始的活动");
	if (!includeEnded) missing.push("已结束的活动");
	return `当前未包含${missing.join("和")}；可以将 ${params.join(" 或 ")} 设为 true 后重试。`;
}
function formatAllFailed(result) {
	const lines = ["无法获取活动数据。"];
	if (result.warnings.length > 0) for (const warning of result.warnings) lines.push(`- ${warning}`);
	else lines.push(`- ${result.requestedGames.join("、")}的公告接口都没有返回可用数据。`);
	lines.push("", "请检查网络连接或稍后重试。");
	return lines.join("\n");
}
function textResult(text, structuredContent) {
	return structuredContent === void 0 ? { content: [{
		type: "text",
		text
	}] } : {
		content: [{
			type: "text",
			text
		}],
		structuredContent
	};
}
function toolError(message) {
	return {
		content: [{
			type: "text",
			text: message
		}],
		isError: true
	};
}
function messageOf(error) {
	return error instanceof Error ? error.message : String(error);
}
// src/server.ts
var INSTRUCTIONS = [
	"本服务从米哈游官方公告接口抓取原神、崩铁、绝区零的限时玩法活动。",
	"list_events 默认只返回已经开始且尚未结束的活动；includeUpcoming 加入尚未开始的活动，includeEnded 加入已结束的活动，game 可以只看一款游戏。",
	"工具返回 JSON 文本和 structuredContent，每条活动包含公告正文纯文本和正文图片地址。",
	"活动时间按公告时区（默认 UTC+8）以 YYYY-MM-DD HH:mm:ss 输出，daysLeft 为距结束的天数，已结束为负数。",
	"结果在进程内缓存，公告接口刷新失败时会回退到上次缓存，并在 warnings 中说明。"
].join("\n");
function createMcpServer(config, service) {
	const server = new McpServer({
		name: SERVER_NAME,
		version: SERVER_VERSION
	}, {
		capabilities: { tools: {} },
		instructions: INSTRUCTIONS
	});
	registerEventTools(server, config, service);
	return server;
}
// src/service.ts
var EventService = class {
	config;
	logger;
	cache = /* @__PURE__ */ new Map();
	constructor(config, logger) {
		this.config = config;
		this.logger = logger;
	}
	async listEvents(query) {
		const requestedGames = query.game ? [query.game] : [...GAME_NAME_ORDER];
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), this.config.totalTimeoutMs);
		let outcomes;
		try {
			outcomes = await Promise.all(requestedGames.map((name) => this.resolveGame(name, controller.signal)));
		} finally {
			clearTimeout(timer);
		}
		const warnings = outcomes.flatMap((outcome) => outcome.warning ? [outcome.warning] : []);
		const failedGames = outcomes.filter((outcome) => !outcome.snapshot).map((outcome) => outcome.game.name);
		const snapshots = outcomes.map((outcome) => outcome.snapshot).filter((snapshot) => snapshot !== void 0);
		const now = Date.now();
		const events = sortEvents(dedupeByAnnId(snapshots.flatMap((snapshot) => snapshot.events)).filter((event) => {
			const status = eventStatus(event, now);
			if (status === "ended" && !query.includeEnded) return false;
			if (status === "upcoming" && !query.includeUpcoming) return false;
			return true;
		}), now).map((event) => ({
			...event,
			daysLeft: daysLeft(event.endMs, now),
			status: eventStatus(event, now)
		}));
		const counts = Object.fromEntries(GAME_NAME_ORDER.map((name) => [name, 0]));
		for (const event of events) counts[event.game]++;
		return {
			query,
			requestedGames,
			events,
			counts,
			updatedAt: snapshots.length === 0 ? null : Math.min(...snapshots.map((snapshot) => snapshot.fetchedAt)),
			stale: outcomes.some((outcome) => outcome.stale),
			failedGames,
			warnings
		};
	}
	async resolveGame(name, signal) {
		const game = this.config.games[GAME_NAME_TO_KEY[name]];
		const cached = this.cache.get(game.key);
		const now = Date.now();
		if (cached && cached.complete && now - cached.fetchedAt < this.config.cacheTtlMs) return {
			game,
			snapshot: cached,
			stale: false
		};
		try {
			const { snapshot, contentWarning } = await this.refreshGame(game, signal);
			this.cache.set(game.key, snapshot);
			return {
				game,
				snapshot,
				stale: false,
				warning: contentWarning
			};
		} catch (error) {
			const message = signal.aborted ? `整体请求超时（${this.config.totalTimeoutMs} 毫秒）` : errorMessage(error);
			if (cached) {
				const time = formatAnnouncementTime(cached.fetchedAt, this.config.timezoneOffsetHours);
				const warning = `${game.name}刷新失败：${message}；已使用 ${time} 的缓存数据，结果可能不是最新。`;
				this.logger.warn(warning);
				return {
					game,
					snapshot: cached,
					stale: true,
					warning
				};
			}
			const warning = `${game.name}刷新失败：${message}`;
			this.logger.warn(warning);
			return {
				game,
				stale: false,
				warning
			};
		}
	}
	async refreshGame(game, signal) {
		const options = {
			requestTimeoutMs: this.config.requestTimeoutMs,
			signal,
			logger: this.logger
		};
		const contentPromise = fetchAnnouncementContents(game, options).then((contents) => ({
			contents,
			error: void 0
		}), (error) => ({
			contents: [],
			error
		}));
		const entries = await fetchAnnouncements(game, options);
		const { contents, error } = await contentPromise;
		const events = selectGameEvents(game.key, entries, { timezoneOffsetHours: this.config.timezoneOffsetHours });
		const index = indexContents(contents);
		const stored = events.map((event) => {
			const content = index.get(contentKey(event.annId, event.title)) ?? index.get(annIdKey(event.annId));
			return {
				...event,
				content: content?.text ?? null,
				images: content?.images ?? []
			};
		});
		if (error !== void 0) {
			const warning = `${game.name}公告正文获取失败：${errorMessage(error)}；本次只返回标题和时间。`;
			this.logger.warn(warning);
			return {
				snapshot: {
					events: stored,
					fetchedAt: Date.now(),
					complete: false
				},
				contentWarning: warning
			};
		}
		return { snapshot: {
			events: stored,
			fetchedAt: Date.now(),
			complete: true
		} };
	}
};
function indexContents(contents) {
	const index = /* @__PURE__ */ new Map();
	for (const content of contents) {
		const key = contentKey(content.annId, content.title);
		if (!index.has(key)) index.set(key, content);
		const fallback = annIdKey(content.annId);
		if (!index.has(fallback)) index.set(fallback, content);
	}
	return index;
}
function contentKey(annId, title) {
	return `${annId}\u0000${title}`;
}
function annIdKey(annId) {
	return `id\u0000${annId}`;
}
function errorMessage(error) {
	return error instanceof Error ? error.message : String(error);
}
// src/index.ts
function main() {
	const logger = createLogger();
	let config;
	try {
		config = loadConfig();
	} catch (error) {
		if (error instanceof ConfigError) {
			logger.error(`配置错误：${error.message}`);
			process.exitCode = 1;
			return;
		}
		throw error;
	}
	const service = new EventService(config, logger);
	logger.info(`启动：时区 ${formatUtcOffset(config.timezoneOffsetHours)}，缓存 ${config.cacheTtlMs} 毫秒，单请求超时 ${config.requestTimeoutMs} 毫秒，总超时 ${config.totalTimeoutMs} 毫秒。`);
	const handle = serveStdio(() => createMcpServer(config, service), { onerror: (error) => logger.error("stdio 连接错误", error) });
	const shutdown = (reason) => {
		logger.info(`收到 ${reason}，正在关闭。`);
		handle.close().catch(() => void 0).finally(() => process.exit(0));
	};
	process.once("SIGINT", () => shutdown("SIGINT"));
	process.once("SIGTERM", () => shutdown("SIGTERM"));
}
try {
	main();
} catch (error) {
	createLogger().error("服务启动失败", error);
	process.exitCode = 1;
}

//# sourceMappingURL=index.js.map