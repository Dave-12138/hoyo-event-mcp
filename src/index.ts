#!/usr/bin/env node
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { ConfigError, loadConfig, type AppConfig } from "./config.js";
import { formatUtcOffset } from "./filter.js";
import { createLogger } from "./logger.js";
import { createMcpServer } from "./server.js";
import { EventService } from "./service.js";

function main(): void {
    const logger = createLogger();
    let config: AppConfig;
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
    logger.info(
        `启动：时区 ${formatUtcOffset(config.timezoneOffsetHours)}，缓存 ${config.cacheTtlMs} 毫秒，单请求超时 ${config.requestTimeoutMs} 毫秒，总超时 ${config.totalTimeoutMs} 毫秒。`
    );

    const handle = serveStdio(() => createMcpServer(config, service), {
        onerror: (error) => logger.error("stdio 连接错误", error)
    });

    const shutdown = (reason: string): void => {
        logger.info(`收到 ${reason}，正在关闭。`);
        void handle
            .close()
            .catch(() => undefined)
            .finally(() => process.exit(0));
    };
    process.once("SIGINT", () => shutdown("SIGINT"));
    process.once("SIGTERM", () => shutdown("SIGTERM"));
}

try {
    main();
} catch (error) {
    const logger = createLogger();
    logger.error("服务启动失败", error);
    process.exitCode = 1;
}
