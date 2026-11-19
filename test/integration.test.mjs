import test, { after, before, describe } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { startMockServer } from "./fixtures.mjs";

const SERVER_PATH = path.resolve("dist/index.js");
const KEPT_ANN_IDS = [1001, 2001, 2002, 3001, 3011, 3012];
const EXCLUDED_ANN_IDS = [
    1002, 1003, 1004, 1005, 1006, 1007, 1008, 1009, 1010, 1011, 1012, 1013,
    2003, 2004, 2005, 2006, 2007, 2008, 2009, 2010, 2011, 2012, 2099,
    3002, 3003, 3004, 3005, 3006, 3007, 3008, 3013, 3014, 3015, 3016, 3017, 3018, 3019
];

function childEnv(overrides) {
    const entries = Object.entries({ ...process.env, ...overrides }).filter(([, value]) => typeof value === "string");
    return Object.fromEntries(entries);
}

async function connectClient(env) {
    const client = new Client({ name: "integration-test", version: "1.0.0" });
    const transport = new StdioClientTransport({
        command: process.execPath,
        args: [SERVER_PATH],
        cwd: process.cwd(),
        env,
        stderr: "pipe"
    });
    let stderr = "";
    transport.stderr?.on("data", (chunk) => {
        stderr += chunk.toString();
    });
    try {
        await client.connect(transport);
    } catch (error) {
        throw new Error(
            `连接测试服务器失败：${error instanceof Error ? error.message : String(error)}\n${stderr}`
        );
    }
    return { client, transport, stderr: () => stderr };
}

describe("MCP 服务器", { concurrency: false }, () => {
    let mock;
    let client;
    let transport;
    let stderrText;

    before(async () => {
        mock = await startMockServer();
        const env = childEnv({
            HOYO_EVENT_API_BASE: mock.baseUrl,
            HOYO_EVENT_CACHE_TTL_MS: "0",
            HOYO_EVENT_REQUEST_TIMEOUT_MS: "2000",
            HOYO_EVENT_TOTAL_TIMEOUT_MS: "5000"
        });
        ({ client, transport, stderr: stderrText } = await connectClient(env));
    });

    after(async () => {
        await client?.close().catch(() => undefined);
        await mock?.close();
    });

    async function callEvents(args = {}) {
        return client.callTool({ name: "list_events", arguments: args });
    }

    test("只暴露 list_events 工具", async () => {
        const tools = await client.listTools();
        assert.deepEqual(tools.tools.map((tool) => tool.name), ["list_events"]);
        const tool = tools.tools[0];
        assert.match(tool.description, /原神/);
        assert.match(tool.description, /includeUpcoming/);
        assert.equal(tool.annotations?.readOnlyHint, true);
        assert.equal(tool.annotations?.openWorldHint, true);
    });

    test("默认返回三款游戏当前进行中的活动", async () => {
        const result = await callEvents();
        assert.equal(result.isError, undefined, result.content?.[0]?.text);
        assert.ok(result.structuredContent, "应返回 structuredContent。");

        const structured = result.structuredContent;
        assert.equal(structured.total, 6);
        assert.deepEqual(structured.counts, { 原神: 1, 崩铁: 2, 绝区零: 3 });
        assert.equal(structured.query.game, null);
        assert.equal(structured.query.includeUpcoming, false);
        assert.equal(structured.query.includeEnded, false);
        assert.equal(structured.stale, false);
        assert.deepEqual(structured.warnings, []);
        assert.match(structured.updatedAt, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);

        const events = structured.events;
        assert.deepEqual(
            events.map((event) => event.annId).sort((left, right) => left - right),
            KEPT_ANN_IDS
        );
        for (const excluded of EXCLUDED_ANN_IDS) {
            assert.ok(
                !events.some((event) => event.annId === excluded),
                `公告 ${excluded} 不应出现在结果中。`
            );
        }
        assert.equal(events.filter((event) => event.annId === 3001).length, 1, "重复公告应去重。");

        const expectedKeys = [
            "game",
            "name",
            "title",
            "startAt",
            "endAt",
            "daysLeft",
            "status",
            "annId",
            "source",
            "content",
            "images"
        ];
        for (const event of events) {
            assert.deepEqual(Object.keys(event).sort(), [...expectedKeys].sort());
            assert.match(event.startAt, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
            assert.match(event.endAt, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
            assert.ok(Number.isInteger(event.daysLeft));
            assert.ok(event.daysLeft > 0);
            assert.equal(event.status, "active");
            assert.ok(event.source === "list" || event.source === "pic");
            assert.ok(event.content === null || typeof event.content === "string");
            assert.ok(Array.isArray(event.images));
        }

        const genshinKeep = events.find((event) => event.annId === 1001);
        assert.ok(genshinKeep);
        assert.equal(genshinKeep.game, "原神");
        assert.equal(genshinKeep.name, "星辉庆典");
        assert.equal(genshinKeep.daysLeft, 5);
        const fixtureEntry = mock.state.fixtures.genshin.data.list[0].list.find((entry) => entry.ann_id === 1001);
        assert.equal(genshinKeep.startAt, fixtureEntry.start_time);
        assert.equal(genshinKeep.endAt, fixtureEntry.end_time);

        const hsrKeep = events.find((event) => event.annId === 2001);
        assert.ok(hsrKeep);
        assert.equal(hsrKeep.name, "剧场版绒绒号：欢闹厨房");
        assert.equal(hsrKeep.source, "pic");

        const zzzList = events.find((event) => event.annId === 3001);
        assert.ok(zzzList);
        assert.equal(zzzList.source, "list");
        assert.equal(zzzList.title, "「修复吧！漂流画集」活动说明");
        assert.equal(zzzList.name, "修复吧！漂流画集");
        assert.equal(events.find((event) => event.annId === 3011)?.source, "pic");

        assert.match(genshinKeep.content, /在星辉庆典中完成挑战/);
        assert.deepEqual(genshinKeep.images, ["https://example.com/genshin-1001-reward.png"]);
        const zzzPic = events.find((event) => event.annId === 3011);
        assert.match(zzzPic.content, /驱赶/);
        assert.doesNotMatch(zzzPic.content, /不应返回/, "正文应按标题匹配到同 ann_id 的正确条目。");

        const text = result.content[0].text;
        const payload = JSON.parse(text);
        assert.deepEqual(payload, structured);
        assert.equal(payload.total, 6);
        assert.equal(payload.timezone, "UTC+8");
        assert.doesNotMatch(text, /灵圣纪行|差分宇宙|货币战争|七圣召唤/);
        assert.ok(mock.state.requests.some((request) => request.pathname.endsWith("getAnnContent")));

        const stderr = stderrText();
        assert.match(stderr, /\[hoyo-event\] info 启动/);
        assert.doesNotMatch(stderr, /\[hoyo-event\] error/);
    });

    test("game 参数只返回指定游戏", async () => {
        const result = await callEvents({ game: "原神" });
        assert.equal(result.isError, undefined, result.content?.[0]?.text);
        const structured = result.structuredContent;
        assert.equal(structured.query.game, "原神");
        assert.equal(structured.total, 1);
        assert.deepEqual(structured.counts, { 原神: 1, 崩铁: 0, 绝区零: 0 });
        assert.ok(structured.events.every((event) => event.game === "原神"));
        const payload = JSON.parse(result.content[0].text);
        assert.deepEqual(payload.events, structured.events);
    });

    test("includeUpcoming 加入尚未开始的活动", async () => {
        const result = await callEvents({ includeUpcoming: true });
        assert.equal(result.isError, undefined, result.content?.[0]?.text);
        const events = result.structuredContent.events;
        assert.equal(result.structuredContent.total, 10);
        for (const annId of [1006, 2010, 3007, 3018]) {
            const event = events.find((item) => item.annId === annId);
            assert.ok(event, `应包含尚未开始的公告 ${annId}。`);
            assert.ok(event.daysLeft > 0);
        }
        assert.ok(!events.some((event) => [1007, 2011, 3008, 3019].includes(event.annId)));
    });

    test("includeEnded 加入已结束的活动，daysLeft 为负数", async () => {
        const result = await callEvents({ includeEnded: true });
        assert.equal(result.isError, undefined, result.content?.[0]?.text);
        const events = result.structuredContent.events;
        assert.equal(result.structuredContent.total, 10);
        for (const annId of [1007, 2011, 3008, 3019]) {
            const event = events.find((item) => item.annId === annId);
            assert.ok(event, `应包含已结束的公告 ${annId}。`);
            assert.ok(event.daysLeft < 0);
        }
        assert.ok(!events.some((event) => [1006, 2010, 3007, 3018].includes(event.annId)));
    });

    test("同时包含未开始和已结束的活动", async () => {
        const result = await callEvents({ includeUpcoming: true, includeEnded: true });
        assert.equal(result.isError, undefined, result.content?.[0]?.text);
        assert.equal(result.structuredContent.total, 14);
    });

    test("空结果给出明确说明", async () => {
        mock.state.modes.genshin = "empty";
        mock.state.modes.hsr = "empty";
        mock.state.modes.zzz = "empty";
        try {
            const result = await callEvents();
            assert.equal(result.isError, undefined, result.content?.[0]?.text);
            assert.equal(result.structuredContent.total, 0);
            assert.deepEqual(result.structuredContent.events, []);
            assert.deepEqual(result.structuredContent.counts, { 原神: 0, 崩铁: 0, 绝区零: 0 });
            assert.equal(result.structuredContent.stale, false);
            const text = result.content[0].text;
            const payload = JSON.parse(text);
            assert.deepEqual(payload.events, []);
            assert.match(payload.message, /三款游戏当前都没有符合条件的新活动/);
            assert.match(payload.message, /includeUpcoming/);
            assert.match(payload.message, /includeEnded/);

            const single = await callEvents({ game: "绝区零" });
            assert.equal(single.isError, undefined, single.content?.[0]?.text);
            assert.equal(single.structuredContent.total, 0);
            assert.match(single.content[0].text, /绝区零当前没有符合条件的新活动/);
        } finally {
            mock.state.modes.genshin = "normal";
            mock.state.modes.hsr = "normal";
            mock.state.modes.zzz = "normal";
        }
    });

    test("接口报错时回退到上次缓存并说明数据不是最新", async () => {
        const fresh = await callEvents();
        assert.equal(fresh.structuredContent.total, 6);
        const freshUpdatedAt = fresh.structuredContent.updatedAt;

        mock.state.modes.genshin = "error500";
        mock.state.modes.hsr = "error500";
        mock.state.modes.zzz = "error500";
        try {
            const result = await callEvents();
            assert.equal(result.isError, undefined, result.content?.[0]?.text);
            const structured = result.structuredContent;
            assert.equal(structured.total, 6);
            assert.equal(structured.stale, true);
            assert.equal(structured.updatedAt, freshUpdatedAt);
            assert.deepEqual(
                structured.events.map((event) => event.annId).sort((left, right) => left - right),
                KEPT_ANN_IDS
            );
            assert.equal(structured.warnings.length, 3);
            assert.ok(structured.warnings.every((warning) => warning.includes("HTTP 500")));
            const text = result.content[0].text;
            assert.match(text, /缓存/);
            assert.match(text, /不是最新/);
            assert.match(text, /HTTP 500/);
        } finally {
            mock.state.modes.genshin = "normal";
            mock.state.modes.hsr = "normal";
            mock.state.modes.zzz = "normal";
        }
    });

    test("没有缓存时接口报错返回中文错误文本", async () => {
        const failing = await startMockServer({
            modes: { genshin: "error500", hsr: "error500", zzz: "error500" }
        });
        const { client: failingClient } = await connectClient(
            childEnv({
                HOYO_EVENT_API_BASE: failing.baseUrl,
                HOYO_EVENT_CACHE_TTL_MS: "0",
                HOYO_EVENT_REQUEST_TIMEOUT_MS: "2000",
                HOYO_EVENT_TOTAL_TIMEOUT_MS: "5000"
            })
        );
        try {
            const result = await failingClient.callTool({ name: "list_events", arguments: {} });
            assert.equal(result.isError, true);
            const text = result.content[0].text;
            assert.match(text, /无法获取活动数据/);
            assert.match(text, /原神/);
            assert.match(text, /崩铁/);
            assert.match(text, /绝区零/);
            assert.match(text, /HTTP 500/);
            assert.match(text, /请检查网络/);
        } finally {
            await failingClient.close().catch(() => undefined);
            await failing.close();
        }
    });

    test("部分游戏失败时保留其他游戏的数据并给出提示", async () => {
        const partial = await startMockServer({
            modes: { genshin: "error500", hsr: "normal", zzz: "normal" }
        });
        const { client: partialClient } = await connectClient(
            childEnv({
                HOYO_EVENT_API_BASE: partial.baseUrl,
                HOYO_EVENT_CACHE_TTL_MS: "0",
                HOYO_EVENT_REQUEST_TIMEOUT_MS: "2000",
                HOYO_EVENT_TOTAL_TIMEOUT_MS: "5000"
            })
        );
        try {
            const result = await partialClient.callTool({ name: "list_events", arguments: {} });
            assert.equal(result.isError, undefined, result.content?.[0]?.text);
            const structured = result.structuredContent;
            assert.equal(structured.total, 5);
            assert.deepEqual(structured.counts, { 原神: 0, 崩铁: 2, 绝区零: 3 });
            assert.deepEqual(structured.failedGames, ["原神"]);
            assert.equal(structured.warnings.length, 1);
            assert.match(structured.warnings[0], /原神刷新失败：原神公告请求失败：HTTP 500/);
            assert.ok(structured.events.every((event) => event.game === "崩铁" || event.game === "绝区零"));
            const payload = JSON.parse(result.content[0].text);
            assert.equal(payload.counts.原神, 0);
            assert.deepEqual(payload.failedGames, ["原神"]);
            assert.match(payload.warnings[0], /原神刷新失败/);
        } finally {
            await partialClient.close().catch(() => undefined);
            await partial.close();
        }
    });

    test("正文抓取失败时仍返回活动并给出提示", async () => {
        const contentFail = await startMockServer({ contentModes: { genshin: "error500" } });
        const { client: contentClient } = await connectClient(
            childEnv({
                HOYO_EVENT_API_BASE: contentFail.baseUrl,
                HOYO_EVENT_CACHE_TTL_MS: "0",
                HOYO_EVENT_REQUEST_TIMEOUT_MS: "2000",
                HOYO_EVENT_TOTAL_TIMEOUT_MS: "5000"
            })
        );
        try {
            const result = await contentClient.callTool({ name: "list_events", arguments: { game: "原神" } });
            assert.equal(result.isError, undefined, result.content?.[0]?.text);
            const structured = result.structuredContent;
            assert.equal(structured.total, 1);
            assert.equal(structured.events[0].content, null);
            assert.deepEqual(structured.events[0].images, []);
            assert.ok(
                structured.warnings.some((warning) => warning.includes("原神公告正文获取失败")),
                `警告中应包含正文失败原因：${structured.warnings.join("；")}`
            );
        } finally {
            await contentClient.close().catch(() => undefined);
            await contentFail.close();
        }
    });

    test("整体超时会取消并发请求并返回中文错误", async () => {
        const slow = await startMockServer({
            modes: { genshin: "slow", hsr: "slow", zzz: "slow" },
            delayMs: 5000
        });
        const { client: slowClient } = await connectClient(
            childEnv({
                HOYO_EVENT_API_BASE: slow.baseUrl,
                HOYO_EVENT_CACHE_TTL_MS: "0",
                HOYO_EVENT_REQUEST_TIMEOUT_MS: "5000",
                HOYO_EVENT_TOTAL_TIMEOUT_MS: "1000"
            })
        );
        try {
            const result = await slowClient.callTool({ name: "list_events", arguments: {} });
            assert.equal(result.isError, true);
            const text = result.content[0].text;
            assert.match(text, /无法获取活动数据/);
            assert.match(text, /整体请求超时（1000 毫秒）/);
        } finally {
            await slowClient.close().catch(() => undefined);
            await slow.close();
        }
    });
});
