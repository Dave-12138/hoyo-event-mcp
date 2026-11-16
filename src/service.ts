import type { AppConfig, GameApiConfig, GameKey, GameName } from "./config.js";
import { GAME_NAME_ORDER, GAME_NAME_TO_KEY } from "./config.js";
import { fetchAnnouncements } from "./announcements.js";
import {
    daysLeft,
    dedupeByAnnId,
    eventStatus,
    formatAnnouncementTime,
    selectGameEvents,
    sortEvents,
    type EventRecord,
    type EventStatus
} from "./filter.js";
import type { Logger } from "./logger.js";

export interface EventsQuery {
    /** 只查询这款游戏；省略时查询三款游戏。 */
    game?: GameName;
    includeUpcoming: boolean;
    includeEnded: boolean;
}

export interface ListEvent extends EventRecord {
    daysLeft: number;
    status: EventStatus;
}

export interface ListEventsResult {
    query: EventsQuery;
    requestedGames: GameName[];
    events: ListEvent[];
    counts: Record<GameName, number>;
    /** 本次结果中最旧的抓取时间。 */
    updatedAt: number | null;
    /** 是否有游戏使用了过期缓存。 */
    stale: boolean;
    failedGames: GameName[];
    warnings: string[];
}

interface GameSnapshot {
    events: EventRecord[];
    fetchedAt: number;
}

interface GameOutcome {
    game: GameApiConfig;
    snapshot?: GameSnapshot;
    stale: boolean;
    warning?: string;
}

export class EventService {
    private readonly config: AppConfig;
    private readonly logger: Logger;
    private readonly cache = new Map<GameKey, GameSnapshot>();

    constructor(config: AppConfig, logger: Logger) {
        this.config = config;
        this.logger = logger;
    }

    async listEvents(query: EventsQuery): Promise<ListEventsResult> {
        const requestedGames = query.game ? [query.game] : [...GAME_NAME_ORDER];
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.config.totalTimeoutMs);

        let outcomes: GameOutcome[];
        try {
            outcomes = await Promise.all(
                requestedGames.map((name) => this.resolveGame(name, controller.signal))
            );
        } finally {
            clearTimeout(timer);
        }

        const warnings = outcomes.flatMap((outcome) => (outcome.warning ? [outcome.warning] : []));
        const failedGames = outcomes
            .filter((outcome) => !outcome.snapshot)
            .map((outcome) => outcome.game.name);
        const snapshots = outcomes
            .map((outcome) => outcome.snapshot)
            .filter((snapshot): snapshot is GameSnapshot => snapshot !== undefined);

        const now = Date.now();
        const allEvents = snapshots.flatMap((snapshot) => snapshot.events);
        const visible = dedupeByAnnId(allEvents).filter((event) => {
            const status = eventStatus(event, now);
            if (status === "ended" && !query.includeEnded) {
                return false;
            }
            if (status === "upcoming" && !query.includeUpcoming) {
                return false;
            }
            return true;
        });
        const sorted = sortEvents(visible, now);
        const events: ListEvent[] = sorted.map((event) => ({
            ...event,
            daysLeft: daysLeft(event.endMs, now),
            status: eventStatus(event, now)
        }));

        const counts = Object.fromEntries(
            GAME_NAME_ORDER.map((name) => [name, 0])
        ) as Record<GameName, number>;
        for (const event of events) {
            counts[event.game]++;
        }

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

    private async resolveGame(name: GameName, signal: AbortSignal): Promise<GameOutcome> {
        const game = this.config.games[GAME_NAME_TO_KEY[name]];
        const cached = this.cache.get(game.key);
        const now = Date.now();
        if (cached && now - cached.fetchedAt < this.config.cacheTtlMs) {
            return { game, snapshot: cached, stale: false };
        }

        try {
            const snapshot = await this.refreshGame(game, signal);
            this.cache.set(game.key, snapshot);
            return { game, snapshot, stale: false };
        } catch (error) {
            const message = signal.aborted
                ? `整体请求超时（${this.config.totalTimeoutMs} 毫秒）`
                : errorMessage(error);
            if (cached) {
                const time = formatAnnouncementTime(cached.fetchedAt, this.config.timezoneOffsetHours);
                const warning = `${game.name}刷新失败：${message}；已使用 ${time} 的缓存数据，结果可能不是最新。`;
                this.logger.warn(warning);
                return { game, snapshot: cached, stale: true, warning };
            }
            const warning = `${game.name}刷新失败：${message}`;
            this.logger.warn(warning);
            return { game, stale: false, warning };
        }
    }

    private async refreshGame(game: GameApiConfig, signal: AbortSignal): Promise<GameSnapshot> {
        const entries = await fetchAnnouncements(game, {
            requestTimeoutMs: this.config.requestTimeoutMs,
            signal,
            logger: this.logger
        });
        const events = selectGameEvents(game.key, entries, {
            timezoneOffsetHours: this.config.timezoneOffsetHours
        });
        return { events, fetchedAt: Date.now() };
    }
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
