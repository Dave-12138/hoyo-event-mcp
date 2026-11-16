export const SERVER_NAME = "hoyo-event";
export const SERVER_VERSION = "0.1.0";

/** 默认缓存十分钟。 */
export const DEFAULT_CACHE_TTL_MS = 10 * 60_000;
/** 单个公告请求的默认超时时间。 */
export const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;
/** 一次抓取全部游戏的默认总超时时间。 */
export const DEFAULT_TOTAL_TIMEOUT_MS = 20_000;
/** 公告接口默认使用的时区偏移，单位为小时。 */
export const DEFAULT_TIMEZONE_OFFSET_HOURS = 8;

export const GAME_KEYS = ["genshin", "hsr", "zzz"] as const;
export type GameKey = (typeof GAME_KEYS)[number];

export const GAME_NAME_ORDER = ["原神", "崩铁", "绝区零"] as const;
export type GameName = (typeof GAME_NAME_ORDER)[number];

export const GAME_NAMES: Record<GameKey, GameName> = {
    genshin: "原神",
    hsr: "崩铁",
    zzz: "绝区零"
};

export const GAME_NAME_TO_KEY: Record<GameName, GameKey> = {
    原神: "genshin",
    崩铁: "hsr",
    绝区零: "zzz"
};

export interface GameApiConfig {
    key: GameKey;
    name: GameName;
    /** 公告接口根地址，末尾不带斜杠。 */
    apiBase: string;
    /** 公告接口路径，以斜杠开头。 */
    apiPath: string;
    /** 公告接口固定查询参数，用户 ID 等可变值也在这里组装。 */
    query: Readonly<Record<string, string>>;
}

export interface AppConfig {
    games: Record<GameKey, GameApiConfig>;
    /** 进程内缓存的有效时长；为 0 时每次都重新抓取，但仍保留上次结果用于失败回退。 */
    cacheTtlMs: number;
    /** 单个公告请求的超时时间。 */
    requestTimeoutMs: number;
    /** 一次工具调用中全部公告请求的总超时时间。 */
    totalTimeoutMs: number;
    /** 公告时间使用的时区偏移，单位为小时。 */
    timezoneOffsetHours: number;
}

export class ConfigError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "ConfigError";
    }
}

interface GameDefaults {
    key: GameKey;
    name: GameName;
    apiBase: string;
    apiPath: string;
    query: {
        game: string;
        gameBiz: string;
        bundleId: string;
        uid: string;
        level: string;
        region: string;
        platform: string;
        channelId: string;
    };
}

const GAME_DEFAULTS: Record<GameKey, GameDefaults> = {
    genshin: {
        key: "genshin",
        name: GAME_NAMES.genshin,
        apiBase: "https://hk4e-ann-api.mihoyo.com",
        apiPath: "/common/hk4e_cn/announcement/api/getAnnList",
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

const ENV_PREFIXES: Record<GameKey, string> = {
    genshin: "HOYO_EVENT_GENSHIN",
    hsr: "HOYO_EVENT_HSR",
    zzz: "HOYO_EVENT_ZZZ"
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
    const apiBaseOverride = readString(env, "HOYO_EVENT_API_BASE");
    if (apiBaseOverride !== undefined) {
        normalizeApiBase(apiBaseOverride, "HOYO_EVENT_API_BASE");
    }

    const games = {} as Record<GameKey, GameApiConfig>;
    for (const key of GAME_KEYS) {
        games[key] = loadGameConfig(key, env, apiBaseOverride);
    }

    return {
        games,
        cacheTtlMs: readInt(env, "HOYO_EVENT_CACHE_TTL_MS", DEFAULT_CACHE_TTL_MS, 0, 24 * 60 * 60_000),
        requestTimeoutMs: readInt(env, "HOYO_EVENT_REQUEST_TIMEOUT_MS", DEFAULT_REQUEST_TIMEOUT_MS, 1_000, 120_000),
        totalTimeoutMs: readInt(env, "HOYO_EVENT_TOTAL_TIMEOUT_MS", DEFAULT_TOTAL_TIMEOUT_MS, 1_000, 180_000),
        timezoneOffsetHours: readInt(
            env,
            "HOYO_EVENT_TIMEZONE_OFFSET",
            DEFAULT_TIMEZONE_OFFSET_HOURS,
            -12,
            14
        )
    };
}

export function buildAnnouncementUrl(game: GameApiConfig): string {
    const url = new URL(`${game.apiBase.replace(/\/+$/, "")}${game.apiPath}`);
    for (const [key, value] of Object.entries(game.query)) {
        url.searchParams.set(key, value);
    }
    return url.toString();
}

function loadGameConfig(
    key: GameKey,
    env: NodeJS.ProcessEnv,
    apiBaseOverride: string | undefined
): GameApiConfig {
    const defaults = GAME_DEFAULTS[key];
    const prefix = ENV_PREFIXES[key];
    const uid = readDigits(env, `${prefix}_UID`, defaults.query.uid, 1, 9_999_999_999);
    const level = readDigits(env, `${prefix}_LEVEL`, defaults.query.level, 1, 100);
    const channelId = readDigits(env, `${prefix}_CHANNEL_ID`, defaults.query.channelId, 0, 100);
    const region = readString(env, `${prefix}_REGION`) ?? defaults.query.region;
    const platform = readString(env, `${prefix}_PLATFORM`) ?? defaults.query.platform;

    return {
        key,
        name: defaults.name,
        apiBase: normalizeApiBase(apiBaseOverride ?? defaults.apiBase, "HOYO_EVENT_API_BASE"),
        apiPath: defaults.apiPath,
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

function readString(env: NodeJS.ProcessEnv, name: string): string | undefined {
    const raw = env[name];
    if (raw === undefined) {
        return undefined;
    }
    const value = raw.trim();
    return value.length > 0 ? value : undefined;
}

function readInt(
    env: NodeJS.ProcessEnv,
    name: string,
    fallback: number,
    min: number,
    max: number
): number {
    const raw = readString(env, name);
    if (raw === undefined) {
        return fallback;
    }
    if (!/^-?\d+$/.test(raw)) {
        throw new ConfigError(`${name} 必须是 ${min} 到 ${max} 之间的整数，当前值为“${raw}”。`);
    }
    const value = Number(raw);
    if (!Number.isSafeInteger(value) || value < min || value > max) {
        throw new ConfigError(`${name} 必须是 ${min} 到 ${max} 之间的整数，当前值为“${raw}”。`);
    }
    return value;
}

function readDigits(
    env: NodeJS.ProcessEnv,
    name: string,
    fallback: string,
    min: number,
    max: number
): number {
    const raw = readString(env, name);
    if (raw === undefined) {
        return Number(fallback);
    }
    if (!/^\d+$/.test(raw)) {
        throw new ConfigError(`${name} 必须是由数字组成的整数，当前值为“${raw}”。`);
    }
    const value = Number(raw);
    if (!Number.isSafeInteger(value) || value < min || value > max) {
        throw new ConfigError(`${name} 必须是 ${min} 到 ${max} 之间的整数，当前值为“${raw}”。`);
    }
    return value;
}

function normalizeApiBase(raw: string, name: string): string {
    let url: URL;
    try {
        url = new URL(raw);
    } catch {
        throw new ConfigError(`${name} 不是合法的 URL：“${raw}”。`);
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
        throw new ConfigError(`${name} 只支持 http 或 https 地址。`);
    }
    if (url.search.length > 0 || url.hash.length > 0) {
        throw new ConfigError(`${name} 不能包含查询参数或片段。`);
    }
    url.pathname = url.pathname.replace(/\/+$/, "");
    return url.toString().replace(/\/$/, "");
}
