import { createServer } from "node:http";
import { once } from "node:events";

const HOUR_MS = 60 * 60_000;
const TIME_ZONE_OFFSET_HOURS = 8;

/** 把时间戳格式化成公告时区（UTC+8）的 YYYY-MM-DD HH:mm:ss。 */
export function formatWallTime(epochMs) {
    const date = new Date(epochMs + TIME_ZONE_OFFSET_HOURS * HOUR_MS);
    const pad = (value) => String(value).padStart(2, "0");
    return `${String(date.getUTCFullYear()).padStart(4, "0")}-${pad(date.getUTCMonth() + 1)}-${pad(
        date.getUTCDate()
    )} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`;
}

function makeEntry(now) {
    return (annId, title, tagLabel, startHours, endHours) => ({
        ann_id: annId,
        title,
        tag_label: tagLabel,
        start_time: formatWallTime(now + startHours * HOUR_MS),
        end_time: formatWallTime(now + endHours * HOUR_MS)
    });
}

function makeGenshin(now) {
    const entry = makeEntry(now);
    const active = [-48, 108];
    return {
        retcode: 0,
        message: "OK",
        data: {
            list: [
                {
                    type_id: 1,
                    type_label: "活动公告",
                    list: [
                        entry(1001, "「星辉庆典」活动：完成挑战获取原石", "活动", ...active),
                        entry(1002, "「坏灭肇始之时」时限内完成魔神任务，可额外获得原石", "活动", ...active),
                        entry(1003, "「灵圣纪行」活动说明", "活动", ...active),
                        entry(1004, "「冒险助力礼包」第53期限时上架", "活动", ...active),
                        entry(1005, "「长线旅程」活动：持续一百天", "活动", -120, 2400),
                        entry(1006, "「即将开启的庆典」活动：等待开启", "活动", 48, 156),
                        entry(1007, "「往昔回响」活动：已经结束", "活动", -720, -246),
                        entry(1008, "「万序衍盈」祈愿：「列律名虚·米提亚(雷)」概率UP！", "扭蛋", ...active),
                        entry(1009, "「旅途手记」：探索系统更新", "活动", ...active),
                        entry(1010, "「千星创作赛」活动正式开启！", "活动", ...active),
                        entry(1011, "「每日签到」活动开启", "活动", ...active)
                    ]
                },
                {
                    type_id: 2,
                    type_label: "游戏公告",
                    list: [
                        entry(1012, "全新内容一览：角色·祈愿·武器·地区·剧情等", "活动", ...active),
                        entry(1013, "「纳西妲粘土人」上架", "活动", ...active)
                    ]
                }
            ],
            pic_list: []
        }
    };
}

function makeHsr(now) {
    const entry = makeEntry(now);
    const active = [-72, 204];
    return {
        retcode: 0,
        message: "OK",
        data: {
            list: [
                {
                    type_id: 4,
                    type_label: "公告",
                    list: [entry(2099, "「列表里的活动」活动说明", "活动", ...active)]
                }
            ],
            pic_list: [
                {
                    type_id: 3,
                    type_label: "资讯",
                    type_list: [
                        { pic_type: 1, list: [entry(2098, "", "", -72, 204)] },
                        {
                            pic_type: 2,
                            list: [
                                entry(
                                    2001,
                                    "「剧场版绒绒号：欢闹厨房」：经营甜品店、完成漫画稿，获取自塑尘脂等奖励！",
                                    "",
                                    ...active
                                ),
                                entry(
                                    2002,
                                    "「星际和平盛典：成名之路」：击败强敌，获取命运的足迹等奖励！",
                                    "",
                                    ...active
                                ),
                                entry(2003, "「重返群星之旅」回归网页活动现已开启", "", ...active),
                                entry(2004, "「寰宇美学•幻乐秀场」时装抽取活动说明", "", ...active),
                                entry(2005, "「货币战争•入画奇航」全新赛季来袭！", "", ...active),
                                entry(2006, "「差分宇宙•乐园漫记」更新说明 V4.5", "", ...active),
                                entry(2007, "「开场好礼先抱走」活动说明", "", ...active),
                                entry(2008, "「版本专题」展示页现已上线", "", ...active),
                                entry(2009, "「长线活动」活动：持续一百天", "", -120, 2400),
                                entry(2010, "「下期活动」活动说明", "", 48, 156),
                                entry(2011, "「已结束活动」活动说明", "", -720, -246),
                                entry(2012, "「跃迁特惠」活动说明", "", ...active)
                            ]
                        }
                    ]
                }
            ]
        }
    };
}

function makeZzz(now) {
    const entry = makeEntry(now);
    const active = [-48, 108];
    return {
        retcode: 0,
        message: "OK",
        data: {
            list: [
                {
                    type_id: 3,
                    type_label: "游戏公告",
                    list: [
                        entry(
                            3001,
                            '<p style="white-space: pre-wrap;">「修复吧！漂流画集」活动说明</p>',
                            "活动公告",
                            ...active
                        ),
                        entry(3002, "「『嗯呢』从天降」活动说明", "福利活动", ...active),
                        entry(3003, '3.3版本「丽都城募」说明', "活动公告", ...active),
                        entry(3004, "「每日签到」活动说明", "活动公告", ...active),
                        entry(3005, "「超长活动」活动说明", "活动公告", -120, 2400),
                        entry(3006, "「普通公告」活动说明", "常规公告", ...active),
                        entry(3007, "「即将开启的委托」活动说明", "活动公告", 48, 156),
                        entry(3008, "「已经结束的委托」活动说明", "活动公告", -720, -246)
                    ]
                },
                { type_id: 4, type_label: "活动公告", list: [] }
            ],
            pic_list: [
                {
                    type_id: 1,
                    type_label: "丽都资讯",
                    type_list: [
                        { pic_type: 1, list: [entry(3098, "", "", -72, 204)] },
                        {
                            pic_type: 2,
                            list: [
                                entry(
                                    3001,
                                    '<p style="white-space: pre-wrap;">「修复吧！漂流画集」活动说明</p>',
                                    "",
                                    ...active
                                ),
                                entry(
                                    3011,
                                    '<p style="white-space: pre-wrap;">「怪奇诡屋惊魂记」活动说明</p>',
                                    "",
                                    ...active
                                ),
                                entry(3012, "「天使应援大作战」活动说明", "", ...active),
                                entry(3013, "3.3版本限时频段（下期）", "", ...active),
                                entry(3014, "3.3版本「商城」上新说明", "", ...active),
                                entry(
                                    3015,
                                    "新剧情：主线第三季第四章「重返天空的旅程」",
                                    "",
                                    ...active
                                ),
                                entry(3016, "「剧情回顾」活动说明", "", ...active),
                                entry(3017, "「版本更新」活动说明", "", ...active),
                                entry(3018, "「下期委托」活动说明", "", 48, 156),
                                entry(3019, "「已结束委托」活动说明", "", -720, -246)
                            ]
                        }
                    ]
                }
            ]
        }
    };
}

export function buildFixtures(now = Date.now()) {
    return {
        genshin: makeGenshin(now),
        hsr: makeHsr(now),
        zzz: makeZzz(now)
    };
}

export function emptyPayload() {
    return { retcode: 0, message: "OK", data: { list: [], pic_list: [] } };
}

export function retcodePayload() {
    return { retcode: 10001, message: "服务器繁忙", data: {} };
}

export function malformedPayload() {
    return { retcode: 0, message: "OK", data: {} };
}

const GAME_BY_PATH = {
    "/common/hk4e_cn/announcement/api/getAnnList": "genshin",
    "/common/hkrpg_cn/announcement/api/getAnnList": "hsr",
    "/common/nap_cn/announcement/api/getAnnList": "zzz"
};

export async function startMockServer(options = {}) {
    const now = Date.now();
    const state = {
        now,
        fixtures: buildFixtures(now),
        modes: {
            genshin: "normal",
            hsr: "normal",
            zzz: "normal",
            ...(options.modes ?? {})
        },
        delayMs: options.delayMs ?? 500,
        requests: []
    };

    const server = createServer((request, response) => {
        const url = new URL(request.url ?? "/", "http://127.0.0.1");
        const game = GAME_BY_PATH[url.pathname];
        state.requests.push({ method: request.method, pathname: url.pathname, search: url.search, headers: request.headers });
        if (!game) {
            response.writeHead(404, { "content-type": "application/json; charset=utf-8" });
            response.end(JSON.stringify({ message: "not found" }));
            return;
        }

        const mode = state.modes[game];
        const sendJson = (body) => {
            if (response.destroyed || response.writableEnded) {
                return;
            }
            response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
            response.end(JSON.stringify(body));
        };

        if (mode === "slow") {
            const timer = setTimeout(() => sendJson(state.fixtures[game]), state.delayMs);
            timer.unref?.();
            return;
        }
        if (mode === "error500") {
            response.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
            response.end("服务器错误");
            return;
        }
        if (mode === "retcode") {
            sendJson(retcodePayload());
            return;
        }
        if (mode === "malformed") {
            sendJson(malformedPayload());
            return;
        }
        if (mode === "empty") {
            sendJson(emptyPayload());
            return;
        }
        sendJson(state.fixtures[game]);
    });

    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;

    return {
        server,
        state,
        port,
        baseUrl: `http://127.0.0.1:${port}`,
        async close() {
            server.closeAllConnections?.();
            await new Promise((resolve) => server.close(resolve));
        }
    };
}
