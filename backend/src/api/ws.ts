import type { FastifyInstance } from 'fastify';
import { onLog } from '../infra/logger';
import { subscribe } from '../infra/bus';
import { listLogs } from '../infra/db/repo/log';
import { log } from '../infra/logger';

/** WebSocket 广播 —— §7.3：后台单向推送，消息统一 { type, ts, payload } */
export async function registerWs(app: FastifyInstance): Promise<void> {
  await app.register(import('@fastify/websocket'));

  app.get('/ws', { websocket: true }, (socket) => {
    // 连上时先补一段历史日志，避免页面空白
    const history = listLogs({ limit: 30 }).reverse();
    for (const l of history) {
      socket.send(
        JSON.stringify({
          type: 'log',
          ts: l.createdAt,
          payload: { level: l.level, taskId: l.taskId, message: l.message, context: l.context },
        }),
      );
    }

    const offLog = onLog((entry) => {
      socket.send(
        JSON.stringify({
          type: 'log',
          ts: entry.createdAt,
          payload: {
            level: entry.level,
            taskId: entry.taskId,
            message: entry.message,
            context: entry.context,
          },
        }),
      );
    });

    const offBus = subscribe((e) => {
      socket.send(JSON.stringify(e));
    });

    socket.on('close', () => {
      offLog();
      offBus();
    });
    socket.on('error', () => {
      offLog();
      offBus();
    });
    log('debug', 'ws client connected');
  });
}
