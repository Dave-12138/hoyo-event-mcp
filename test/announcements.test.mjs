import test, { after, before, describe } from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../src/config.ts";
import { fetchAnnouncements } from "../src/announcements.ts";
import { startMockServer } from "./fixtures.mjs";

function testLogger() {
    const warnings = [];
    return {
        warnings,
        info() {},
        warn(message) {
            warnings.push(message);
        },
        error() {}
    };
}

describe("公告抓取", { concurrency: false }, () => {
    let mock;
    let config;

    before(async () => {
        mock = await startMockServer();
        config = loadConfig({ HOYO_EVENT_API_BASE: mock.baseUrl });
    });

    after(async () => {
        await mock?.close();
    });

    test("解析列表和图文公告并去掉 HTML", async () => {
        const logger = testLogger();
        const genshin = await fetchAnnouncements(config.games.genshin, {
            requestTimeoutMs: 2_000,
            logger
        });
        const genshinKeep = genshin.find((entry) => entry.annId === 1001);
        assert.ok(genshinKeep);
        assert.equal(genshinKeep.source, "list");
        assert.equal(genshinKeep.tagLabel, "活动");

        const zzz = await fetchAnnouncements(config.games.zzz, {
            requestTimeoutMs: 2_000,
            logger
        });
        const zzzList = zzz.find((entry) => entry.annId === 3001 && entry.source === "list");
        assert.ok(zzzList);
        assert.equal(zzzList.title, "「修复吧！漂流画集」活动说明");
        assert.equal(zzzList.tagLabel, "活动公告");
        const zzzPic = zzz.find((entry) => entry.annId === 3011);
        assert.ok(zzzPic);
        assert.equal(zzzPic.source, "pic");
        assert.equal(zzzPic.title, "「怪奇诡屋惊魂记」活动说明");
        assert.ok(!zzz.some((entry) => entry.annId === 3098), "空标题条目应被跳过。");

        const hsr = await fetchAnnouncements(config.games.hsr, {
            requestTimeoutMs: 2_000,
            logger
        });
        assert.ok(hsr.every((entry) => entry.source === "pic"));
        assert.ok(!hsr.some((entry) => entry.annId === 2099), "崩铁不应读取 data.list。");
        assert.ok(!hsr.some((entry) => entry.annId === 2098), "空标题条目应被跳过。");
        assert.deepEqual(logger.warnings, []);
    });

    test("retcode 非 0 转为中文错误", async () => {
        mock.state.modes.genshin = "retcode";
        try {
            await assert.rejects(
                fetchAnnouncements(config.games.genshin, { requestTimeoutMs: 2_000, logger: testLogger() }),
                (error) =>
                    error.message.includes("原神公告接口返回错误") &&
                    error.message.includes("retcode=10001") &&
                    error.message.includes("服务器繁忙")
            );
        } finally {
            mock.state.modes.genshin = "normal";
        }
    });

    test("结构缺失转为中文错误", async () => {
        mock.state.modes.genshin = "malformed";
        mock.state.modes.hsr = "malformed";
        try {
            await assert.rejects(
                fetchAnnouncements(config.games.genshin, { requestTimeoutMs: 2_000, logger: testLogger() }),
                (error) => error.message.includes("数据结构不完整") && error.message.includes("data.list")
            );
            await assert.rejects(
                fetchAnnouncements(config.games.hsr, { requestTimeoutMs: 2_000, logger: testLogger() }),
                (error) => error.message.includes("数据结构不完整") && error.message.includes("data.pic_list")
            );
        } finally {
            mock.state.modes.genshin = "normal";
            mock.state.modes.hsr = "normal";
        }
    });

    test("HTTP 错误码转为中文错误", async () => {
        mock.state.modes.zzz = "error500";
        try {
            await assert.rejects(
                fetchAnnouncements(config.games.zzz, { requestTimeoutMs: 2_000, logger: testLogger() }),
                (error) => error.message.includes("绝区零公告请求失败") && error.message.includes("HTTP 500")
            );
        } finally {
            mock.state.modes.zzz = "normal";
        }
    });

    test("单次请求超时转为中文错误", async () => {
        mock.state.modes.genshin = "slow";
        try {
            await assert.rejects(
                fetchAnnouncements(config.games.genshin, { requestTimeoutMs: 100, logger: testLogger() }),
                (error) => error.message.includes("请求超时") && error.message.includes("100 毫秒")
            );
        } finally {
            mock.state.modes.genshin = "normal";
        }
    });

    test("网络错误转为中文错误", async () => {
        const unavailable = await startMockServer();
        await unavailable.close();
        const brokenConfig = loadConfig({ HOYO_EVENT_API_BASE: unavailable.baseUrl });
        await assert.rejects(
            fetchAnnouncements(brokenConfig.games.genshin, { requestTimeoutMs: 1_000, logger: testLogger() }),
            (error) => error.message.includes("原神公告请求失败") && error.message.includes("无法连接服务器")
        );
    });
});
