import test from "node:test";
import assert from "node:assert/strict";
import {
    ConfigError,
    DEFAULT_CACHE_TTL_MS,
    DEFAULT_REQUEST_TIMEOUT_MS,
    DEFAULT_TIMEZONE_OFFSET_HOURS,
    DEFAULT_TOTAL_TIMEOUT_MS,
    GAME_NAME_ORDER,
    buildAnnouncementUrl,
    loadConfig
} from "../src/config.ts";

test("未设置环境变量时使用默认配置", () => {
    const config = loadConfig({});

    assert.equal(config.cacheTtlMs, DEFAULT_CACHE_TTL_MS);
    assert.equal(config.cacheTtlMs, 10 * 60_000);
    assert.equal(config.requestTimeoutMs, DEFAULT_REQUEST_TIMEOUT_MS);
    assert.equal(config.totalTimeoutMs, DEFAULT_TOTAL_TIMEOUT_MS);
    assert.equal(config.timezoneOffsetHours, DEFAULT_TIMEZONE_OFFSET_HOURS);
    assert.deepEqual(Object.keys(config.games), ["genshin", "hsr", "zzz"]);
    assert.deepEqual(GAME_NAME_ORDER, ["原神", "崩铁", "绝区零"]);
    assert.deepEqual(
        Object.values(config.games).map((game) => game.name),
        ["原神", "崩铁", "绝区零"]
    );

    assert.equal(config.games.genshin.apiBase, "https://hk4e-ann-api.mihoyo.com");
    assert.equal(config.games.hsr.apiBase, "https://hkrpg-ann-api.mihoyo.com");
    assert.equal(config.games.zzz.apiBase, "https://announcement-api.mihoyo.com");
    assert.equal(config.games.genshin.query.uid, "100003872");
    assert.equal(config.games.hsr.query.level, "70");
    assert.equal(config.games.zzz.query.region, "prod_gf_cn");
});

test("读取自定义配置并组装公告地址", () => {
    const config = loadConfig({
        HOYO_EVENT_API_BASE: "http://127.0.0.1:8123/proxy/",
        HOYO_EVENT_GENSHIN_UID: "42",
        HOYO_EVENT_GENSHIN_LEVEL: "55",
        HOYO_EVENT_GENSHIN_REGION: "cn_gf02",
        HOYO_EVENT_GENSHIN_PLATFORM: "android",
        HOYO_EVENT_GENSHIN_CHANNEL_ID: "2",
        HOYO_EVENT_CACHE_TTL_MS: "60000",
        HOYO_EVENT_REQUEST_TIMEOUT_MS: "3000",
        HOYO_EVENT_TOTAL_TIMEOUT_MS: "5000",
        HOYO_EVENT_TIMEZONE_OFFSET: "-5"
    });

    assert.equal(config.cacheTtlMs, 60_000);
    assert.equal(config.requestTimeoutMs, 3_000);
    assert.equal(config.totalTimeoutMs, 5_000);
    assert.equal(config.timezoneOffsetHours, -5);
    assert.equal(config.games.genshin.apiBase, "http://127.0.0.1:8123/proxy");
    assert.equal(config.games.genshin.query.uid, "42");
    assert.equal(config.games.genshin.query.level, "55");
    assert.equal(config.games.genshin.query.region, "cn_gf02");
    assert.equal(config.games.genshin.query.platform, "android");
    assert.equal(config.games.genshin.query.channel_id, "2");

    const url = new URL(buildAnnouncementUrl(config.games.genshin));
    assert.equal(url.origin, "http://127.0.0.1:8123");
    assert.equal(url.pathname, "/proxy/common/hk4e_cn/announcement/api/getAnnList");
    assert.equal(url.searchParams.get("game"), "hk4e");
    assert.equal(url.searchParams.get("game_biz"), "hk4e_cn");
    assert.equal(url.searchParams.get("bundle_id"), "hk4e_cn");
    assert.equal(url.searchParams.get("lang"), "zh-cn");
    assert.equal(url.searchParams.get("uid"), "42");
    assert.equal(url.searchParams.get("level"), "55");
    assert.equal(url.searchParams.get("platform"), "android");
    assert.equal(url.searchParams.get("region"), "cn_gf02");
    assert.equal(url.searchParams.get("channel_id"), "2");
});

test("默认公告地址包含各自的固定参数", () => {
    const config = loadConfig({});
    const cases = [
        ["genshin", "hk4e", "hk4e_cn", "100003872", "60", "cn_gf01"],
        ["hsr", "hkrpg", "hkrpg_cn", "103128907", "70", "prod_gf_cn"],
        ["zzz", "nap", "nap_cn", "10408661", "60", "prod_gf_cn"]
    ];

    for (const [key, game, bundleId, uid, level, region] of cases) {
        const url = new URL(buildAnnouncementUrl(config.games[key]));
        assert.equal(url.pathname, `/common/${bundleId}/announcement/api/getAnnList`);
        assert.equal(url.searchParams.get("game"), game);
        assert.equal(url.searchParams.get("game_biz"), bundleId);
        assert.equal(url.searchParams.get("bundle_id"), bundleId);
        assert.equal(url.searchParams.get("uid"), uid);
        assert.equal(url.searchParams.get("level"), level);
        assert.equal(url.searchParams.get("region"), region);
        assert.equal(url.searchParams.get("platform"), "pc");
        assert.equal(url.searchParams.get("channel_id"), "1");
        assert.equal(url.searchParams.get("lang"), "zh-cn");
    }
});

test("无效的数值配置会抛出 ConfigError", () => {
    assert.throws(
        () => loadConfig({ HOYO_EVENT_CACHE_TTL_MS: "abc" }),
        (error) => error instanceof ConfigError && error.message.includes("HOYO_EVENT_CACHE_TTL_MS")
    );
    assert.throws(
        () => loadConfig({ HOYO_EVENT_REQUEST_TIMEOUT_MS: "0" }),
        (error) => error instanceof ConfigError && error.message.includes("HOYO_EVENT_REQUEST_TIMEOUT_MS")
    );
    assert.throws(
        () => loadConfig({ HOYO_EVENT_TOTAL_TIMEOUT_MS: "999999" }),
        (error) => error instanceof ConfigError && error.message.includes("HOYO_EVENT_TOTAL_TIMEOUT_MS")
    );
    assert.throws(
        () => loadConfig({ HOYO_EVENT_TIMEZONE_OFFSET: "-13" }),
        (error) => error instanceof ConfigError && error.message.includes("HOYO_EVENT_TIMEZONE_OFFSET")
    );
});

test("无效的游戏请求参数会抛出 ConfigError", () => {
    assert.throws(
        () => loadConfig({ HOYO_EVENT_GENSHIN_UID: "not-a-uid" }),
        (error) => error instanceof ConfigError && error.message.includes("HOYO_EVENT_GENSHIN_UID")
    );
    assert.throws(
        () => loadConfig({ HOYO_EVENT_HSR_LEVEL: "0" }),
        (error) => error instanceof ConfigError && error.message.includes("HOYO_EVENT_HSR_LEVEL")
    );
});

test("无效的 API 地址会抛出 ConfigError", () => {
    assert.throws(
        () => loadConfig({ HOYO_EVENT_API_BASE: "ftp://example.com/api" }),
        (error) => error instanceof ConfigError && error.message.includes("http")
    );
    assert.throws(
        () => loadConfig({ HOYO_EVENT_API_BASE: "not-a-url" }),
        (error) => error instanceof ConfigError
    );
    assert.throws(
        () => loadConfig({ HOYO_EVENT_API_BASE: "https://example.com/api?token=1" }),
        (error) => error instanceof ConfigError
    );
});
