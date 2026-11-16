import test from "node:test";
import assert from "node:assert/strict";
import {
    DAY_MS,
    MAX_EVENT_DURATION_MS,
    dedupeByAnnId,
    daysLeft,
    eventStatus,
    formatAnnouncementTime,
    formatUtcOffset,
    normalizeEventName,
    parseAnnouncementTime,
    selectGameEvents
} from "../src/filter.ts";

const NOW = Date.UTC(2026, 10, 16, 10, 0, 0);
const TIME_ZONE = 8;

function wall(epochMs) {
    return formatAnnouncementTime(epochMs, TIME_ZONE);
}

const ACTIVE_START = wall(NOW - 2 * DAY_MS);
const ACTIVE_END = wall(NOW + 5 * DAY_MS);

function raw(overrides = {}) {
    return {
        annId: 1,
        title: "「默认活动」活动：参与挑战",
        tagLabel: "活动",
        startTime: ACTIVE_START,
        endTime: ACTIVE_END,
        source: "list",
        ...overrides
    };
}

test("活动名取第一个「」内容并去掉活动类后缀", () => {
    assert.equal(
        normalizeEventName("「全域镇卫·逆捍谬罚」活动：参与自选邀请4星角色"),
        "全域镇卫·逆捍谬罚"
    );
    assert.equal(normalizeEventName("「『嗯呢』从天降」活动说明"), "『嗯呢』从天降");
    assert.equal(
        normalizeEventName("「星际和平盛典：成名之路」：击败强敌，获取奖励"),
        "星际和平盛典：成名之路"
    );
    assert.equal(normalizeEventName('<p style="white-space: pre-wrap;">「修复吧！漂流画集」活动说明</p>'), "修复吧！漂流画集");
    assert.equal(normalizeEventName("星辉庆典活动说明"), "星辉庆典");
    assert.equal(normalizeEventName("星辉庆典活动：完成挑战"), "星辉庆典");
    assert.equal(normalizeEventName("没有引号的活动公告"), "没有引号的活动公告");
    assert.equal(normalizeEventName(""), "");
});

test("公告时间按固定时区解析和格式化", () => {
    const epoch = parseAnnouncementTime("2026-11-02 12:00:00", TIME_ZONE);
    assert.equal(epoch, Date.UTC(2026, 10, 2, 4, 0, 0));
    assert.equal(formatAnnouncementTime(epoch, TIME_ZONE), "2026-11-02 12:00:00");
    assert.equal(parseAnnouncementTime("2026-02-30 12:00:00", TIME_ZONE), undefined);
    assert.equal(parseAnnouncementTime("2026-11-02 24:00:00", TIME_ZONE), undefined);
    assert.equal(parseAnnouncementTime("2026/11/02 12:00:00", TIME_ZONE), undefined);
    assert.equal(formatUtcOffset(8), "UTC+8");
    assert.equal(formatUtcOffset(-5), "UTC-5");
    assert.equal(formatUtcOffset(0), "UTC+0");
});

test("距结束天数向上取整，已结束为负数", () => {
    assert.equal(daysLeft(NOW + 1, NOW), 1);
    assert.equal(daysLeft(NOW + DAY_MS, NOW), 1);
    assert.equal(daysLeft(NOW + DAY_MS + 1, NOW), 2);
    assert.equal(daysLeft(NOW - 1, NOW), -1);
    assert.equal(daysLeft(NOW - (10 * DAY_MS + 1), NOW), -11);
});

test("原神只保留活动公告中的玩法活动", () => {
    const entries = [
        raw({ annId: 1, title: "「保留活动」活动：参与挑战" }),
        raw({ annId: 2, title: "「时限活动」时限内完成魔神任务" }),
        raw({ annId: 3, title: "「纪行活动」活动说明" }),
        raw({ annId: 4, title: "「上架活动」活动上架" }),
        raw({ annId: 5, title: "「更新活动」：系统更新" }),
        raw({ annId: 6, title: "「没有关键字」公告" }),
        raw({ annId: 7, title: "「扭蛋活动」祈愿开启", tagLabel: "扭蛋" }),
        raw({ annId: 8, title: "「千星创作赛」活动开启" }),
        raw({ annId: 9, title: "「九十天活动」活动", startTime: wall(NOW - 5 * DAY_MS), endTime: wall(NOW - 5 * DAY_MS + MAX_EVENT_DURATION_MS) }),
        raw({
            annId: 10,
            title: "「超一天活动」活动",
            startTime: wall(NOW - 5 * DAY_MS),
            endTime: wall(NOW - 5 * DAY_MS + MAX_EVENT_DURATION_MS + 1000)
        }),
        raw({ annId: 11, title: "「往期活动」活动", startTime: wall(NOW - 30 * DAY_MS), endTime: wall(NOW - 10 * DAY_MS) }),
        raw({ annId: 12, title: "「未来活动」活动", startTime: wall(NOW + 2 * DAY_MS), endTime: wall(NOW + 6 * DAY_MS) })
    ];

    const selected = selectGameEvents("genshin", entries, { timezoneOffsetHours: TIME_ZONE });
    assert.deepEqual(
        selected.map((event) => event.annId),
        [1, 9, 11, 12]
    );
    assert.equal(selected[0].name, "保留活动");
    assert.equal(selected[0].game, "原神");
    assert.equal(selected[0].source, "list");
    assert.equal(eventStatus(selected[2], NOW), "ended");
    assert.equal(eventStatus(selected[3], NOW), "upcoming");
});

test("崩铁只读图文资讯并剔除版本、卡池类条目", () => {
    const entries = [
        raw({ annId: 21, title: "「剧场版绒绒号：欢闹厨房」：经营甜品店", source: "pic", tagLabel: "" }),
        raw({ annId: 22, title: "「列表里的活动」活动说明", source: "list" }),
        raw({ annId: 23, title: "「回归活动」回归网页活动现已开启", source: "pic", tagLabel: "" }),
        raw({ annId: 24, title: "「跃迁活动」跃迁说明", source: "pic", tagLabel: "" }),
        raw({ annId: 25, title: "「时装活动」时装箱上架", source: "pic", tagLabel: "" }),
        raw({ annId: 26, title: "「差分宇宙」更新说明", source: "pic", tagLabel: "" }),
        raw({ annId: 27, title: "「群星之旅」专题展示页", source: "pic", tagLabel: "" }),
        raw({ annId: 28, title: "「更新说明活动」更新说明", source: "pic", tagLabel: "" }),
        raw({ annId: 29, title: "「正常图文活动」：获取奖励", source: "pic", tagLabel: "" })
    ];

    const selected = selectGameEvents("hsr", entries, { timezoneOffsetHours: TIME_ZONE });
    assert.deepEqual(
        selected.map((event) => event.annId),
        [21, 29]
    );
    assert.equal(selected[0].name, "剧场版绒绒号：欢闹厨房");
});

test("绝区零同时读取列表和图文，并按各自规则筛选", () => {
    const entries = [
        raw({ annId: 31, title: "<p>「修复吧！漂流画集」活动说明</p>", tagLabel: "活动公告" }),
        raw({ annId: 32, title: "「福利签到」活动说明", tagLabel: "福利活动" }),
        raw({ annId: 33, title: "3.3版本「丽都城募」说明", tagLabel: "活动公告" }),
        raw({ annId: 34, title: "「普通公告」活动说明", tagLabel: "常规公告" }),
        raw({ annId: 35, title: "「怪奇诡屋惊魂记」活动说明", tagLabel: "", source: "pic" }),
        raw({ annId: 36, title: "3.3版本限时频段（下期）", tagLabel: "", source: "pic" }),
        raw({ annId: 37, title: "3.3版本「商城」上新说明", tagLabel: "", source: "pic" }),
        raw({ annId: 38, title: "「剧情回顾」活动说明", tagLabel: "", source: "pic" }),
        raw({ annId: 39, title: "「版本更新」活动说明", tagLabel: "", source: "pic" }),
        raw({ annId: 40, title: "「没有关键词」公告", tagLabel: "", source: "pic" }),
        raw({ annId: 31, title: "<p>「修复吧！漂流画集」活动说明</p>", tagLabel: "", source: "pic" })
    ];

    const selected = selectGameEvents("zzz", entries, { timezoneOffsetHours: TIME_ZONE });
    assert.deepEqual(
        selected.map((event) => event.annId),
        [31, 35]
    );
    assert.equal(selected[0].source, "list");
    assert.equal(selected[0].title, "「修复吧！漂流画集」活动说明");
    assert.equal(selected[1].source, "pic");
});

test("按 ann_id 去重时保留先出现的条目", () => {
    const first = {
        gameKey: "genshin",
        game: "原神",
        name: "活动甲",
        title: "「活动甲」活动",
        startAt: ACTIVE_START,
        endAt: ACTIVE_END,
        startMs: NOW - DAY_MS,
        endMs: NOW + DAY_MS,
        annId: 88,
        source: "list"
    };
    const second = {
        ...first,
        gameKey: "hsr",
        game: "崩铁",
        name: "活动乙",
        title: "「活动乙」活动",
        source: "pic"
    };
    assert.deepEqual(dedupeByAnnId([first, second]), [first]);
});
