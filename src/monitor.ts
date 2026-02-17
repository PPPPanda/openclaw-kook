import type { OpenClawConfig, RuntimeEnv, HistoryEntry } from "openclaw/plugin-sdk";
import type { KookConfig, KookEventData } from "./types.js";
import { resolveKookToken } from "./accounts.js";
import { createKookClient } from "./client.js";
import { KookWSClient } from "./ws-client.js";
import { handleKookMessage } from "./bot.js";
import { probeKook } from "./probe.js";
import { getQuotaTracker, resetQuotaTracker } from "./quota.js";

export type MonitorKookOpts = {
  config?: OpenClawConfig;
  runtime?: RuntimeEnv;
  abortSignal?: AbortSignal;
  accountId?: string;
};

let currentWsClient: KookWSClient | null = null;
let botId: string | undefined;

async function fetchBotId(cfg: KookConfig): Promise<string | undefined> {
  try {
    const result = await probeKook(cfg);
    return result.ok ? result.botId : undefined;
  } catch {
    return undefined;
  }
}

export async function monitorKookProvider(opts: MonitorKookOpts = {}): Promise<void> {
  const cfg = opts.config;
  if (!cfg) {
    throw new Error("Config is required for KOOK monitor");
  }

  const kookCfg = cfg.channels?.kook as KookConfig | undefined;
  const token = resolveKookToken(kookCfg);
  if (!token) {
    throw new Error("KOOK token not configured");
  }

  const log = opts.runtime?.log ?? console.log;
  const error = opts.runtime?.error ?? console.error;

  // Fetch bot info
  if (kookCfg) {
    botId = await fetchBotId(kookCfg);
    log(`kook: bot ID resolved: ${botId ?? "unknown"}`);
  }

  // Initialize quota tracker
  resetQuotaTracker();
  const quotaTracker = getQuotaTracker({
    warningThreshold: kookCfg?.quotaWarningThreshold ?? 0.8,
    log,
  });

  const connectionMode = kookCfg?.connectionMode ?? "websocket";

  if (connectionMode === "websocket") {
    return monitorWebSocket({ cfg, kookCfg: kookCfg!, runtime: opts.runtime, abortSignal: opts.abortSignal });
  }

  log("kook: webhook mode not yet implemented");
}

async function monitorWebSocket(params: {
  cfg: OpenClawConfig;
  kookCfg: KookConfig;
  runtime?: RuntimeEnv;
  abortSignal?: AbortSignal;
}): Promise<void> {
  const { cfg, kookCfg, runtime, abortSignal } = params;
  const log = runtime?.log ?? console.log;
  const error = runtime?.error ?? console.error;

  log("kook: starting WebSocket connection...");

  const client = createKookClient(kookCfg);
  const chatHistories = new Map<string, HistoryEntry[]>();

  const wsClient = new KookWSClient({
    client,
    compress: true,
    log: (...args) => log("kook:", ...args),
    error: (...args) => error("kook:", ...args),
    abortSignal,
    onConnected: () => {
      log("kook: WebSocket connected and ready");
    },
    onDisconnected: () => {
      log("kook: WebSocket disconnected");
    },
    onError: (err) => {
      error("kook: WebSocket error:", err.message);
    },
    onEvent: (event: KookEventData) => {
      // Handle events asynchronously
      handleKookMessage({
        cfg,
        event,
        botId,
        runtime,
        chatHistories,
      }).catch((err) => {
        error(`kook: error handling event: ${String(err)}`);
      });
    },
  });

  currentWsClient = wsClient;

  return new Promise<void>((resolve) => {
    const cleanup = () => {
      if (currentWsClient === wsClient) {
        currentWsClient = null;
      }
    };

    const handleAbort = () => {
      log("kook: abort signal received, stopping");
      wsClient.stop();
      cleanup();
      resolve();
    };

    if (abortSignal?.aborted) {
      cleanup();
      resolve();
      return;
    }

    abortSignal?.addEventListener("abort", handleAbort, { once: true });

    wsClient.start().catch((err) => {
      error(`kook: WebSocket start failed: ${err}`);
      cleanup();
      resolve();
    });
  });
}

export function stopKookMonitor(): void {
  if (currentWsClient) {
    currentWsClient.stop();
    currentWsClient = null;
  }
}
