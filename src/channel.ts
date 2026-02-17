import type { ChannelPlugin, OpenClawConfig } from "openclaw/plugin-sdk";
import { DEFAULT_ACCOUNT_ID, PAIRING_APPROVED_MESSAGE } from "openclaw/plugin-sdk";
import type { ResolvedKookAccount, KookConfig } from "./types.js";
import { resolveKookAccount, resolveKookToken } from "./accounts.js";
import { kookOutbound } from "./outbound.js";
import { probeKook } from "./probe.js";
import { resolveKookGroupToolPolicy } from "./policy.js";
import { normalizeKookTarget, looksLikeKookId } from "./targets.js";
import { sendKookMessage } from "./send.js";
import {
  listKookDirectoryPeers,
  listKookDirectoryGroups,
  listKookDirectoryPeersLive,
  listKookDirectoryGroupsLive,
} from "./directory.js";
import { kookOnboardingAdapter } from "./onboarding.js";
import { kookMessageActions } from "./actions.js";

const meta = {
  id: "kook",
  label: "KOOK",
  selectionLabel: "KOOK (开黑啦)",
  docsPath: "/channels/kook",
  docsLabel: "kook",
  blurb: "KOOK (开黑啦) gaming community platform.",
  aliases: ["kaiheila"],
  order: 75,
} as const;

export const kookPlugin: ChannelPlugin<ResolvedKookAccount> = {
  id: "kook",
  meta: { ...meta },
  pairing: {
    idLabel: "kookUserId",
    normalizeAllowEntry: (entry) => entry.replace(/^(kook|user):/i, ""),
    notifyApproval: async ({ cfg, id }) => {
      await sendKookMessage({
        cfg,
        channelType: "PERSON",
        to: id,
        content: PAIRING_APPROVED_MESSAGE,
        type: 9,
      });
    },
  },
  capabilities: {
    chatTypes: ["direct", "channel"],
    polls: false,
    threads: false,       // KOOK has no native threads
    media: true,
    reactions: true,
    edit: true,
    reply: true,
  },
  agentPrompt: {
    messageToolHints: () => [
      "- KOOK targeting: omit `target` to reply to the current conversation (auto-inferred). Explicit targets: `user:userId` or `channel:channelId`.",
      "- KOOK supports KMarkdown (similar to standard Markdown) and Card messages for rich content.",
    ],
  },
  groups: {
    resolveToolPolicy: resolveKookGroupToolPolicy,
  },
  reload: { configPrefixes: ["channels.kook"] },
  configSchema: {
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        enabled: { type: "boolean" },
        token: { type: "string" },
        connectionMode: { type: "string", enum: ["websocket", "webhook"] },
        webhookPath: { type: "string" },
        webhookPort: { type: "integer", minimum: 1 },
        verifyToken: { type: "string" },
        encryptKey: { type: "string" },
        dmPolicy: { type: "string", enum: ["open", "pairing", "allowlist"] },
        allowFrom: { type: "array", items: { oneOf: [{ type: "string" }, { type: "number" }] } },
        groupPolicy: { type: "string", enum: ["open", "allowlist", "disabled"] },
        groupAllowFrom: { type: "array", items: { oneOf: [{ type: "string" }, { type: "number" }] } },
        requireMention: { type: "boolean" },
        historyLimit: { type: "integer", minimum: 0 },
        dmHistoryLimit: { type: "integer", minimum: 0 },
        textChunkLimit: { type: "integer", minimum: 1 },
        chunkMode: { type: "string", enum: ["length", "newline"] },
        blockStreaming: { type: "boolean" },
        blockStreamingMode: { type: "string", enum: ["edit", "append"] },
        mediaMaxMb: { type: "number", minimum: 0 },
        renderMode: { type: "string", enum: ["auto", "kmarkdown", "card"] },
        quotaWarningThreshold: { type: "number", minimum: 0, maximum: 1 },
      },
    },
  },
  config: {
    listAccountIds: () => [DEFAULT_ACCOUNT_ID],
    resolveAccount: (cfg) => resolveKookAccount({ cfg }),
    defaultAccountId: () => DEFAULT_ACCOUNT_ID,
    setAccountEnabled: ({ cfg, enabled }) => ({
      ...cfg,
      channels: {
        ...cfg.channels,
        kook: {
          ...cfg.channels?.kook,
          enabled,
        },
      },
    }),
    deleteAccount: ({ cfg }) => {
      const next = { ...cfg } as OpenClawConfig;
      const nextChannels = { ...cfg.channels };
      delete (nextChannels as Record<string, unknown>).kook;
      if (Object.keys(nextChannels).length > 0) {
        next.channels = nextChannels;
      } else {
        delete next.channels;
      }
      return next;
    },
    isConfigured: (_account, cfg) =>
      Boolean(resolveKookToken(cfg.channels?.kook as KookConfig | undefined)),
    describeAccount: (account) => ({
      accountId: account.accountId,
      enabled: account.enabled,
      configured: account.configured,
    }),
    resolveAllowFrom: ({ cfg }) =>
      (cfg.channels?.kook as KookConfig | undefined)?.allowFrom ?? [],
    formatAllowFrom: ({ allowFrom }) =>
      allowFrom
        .map((entry) => String(entry).trim())
        .filter(Boolean)
        .map((entry) => entry.toLowerCase()),
  },
  security: {
    collectWarnings: ({ cfg }) => {
      const kookCfg = cfg.channels?.kook as KookConfig | undefined;
      const defaultGroupPolicy = (cfg.channels as Record<string, { groupPolicy?: string }> | undefined)?.defaults?.groupPolicy;
      const groupPolicy = kookCfg?.groupPolicy ?? defaultGroupPolicy ?? "allowlist";
      if (groupPolicy !== "open") return [];
      return [
        `- KOOK groups: groupPolicy="open" allows any member to trigger (mention-gated). Set channels.kook.groupPolicy="allowlist" + channels.kook.groupAllowFrom to restrict senders.`,
      ];
    },
  },
  setup: {
    resolveAccountId: () => DEFAULT_ACCOUNT_ID,
    applyAccountConfig: ({ cfg }) => ({
      ...cfg,
      channels: {
        ...cfg.channels,
        kook: {
          ...cfg.channels?.kook,
          enabled: true,
        },
      },
    }),
  },
  onboarding: kookOnboardingAdapter,
  messaging: {
    normalizeTarget: normalizeKookTarget,
    targetResolver: {
      looksLikeId: looksLikeKookId,
      hint: "<channelId|user:userId|channel:channelId>",
    },
  },
  directory: {
    self: async () => null,
    listPeers: async ({ cfg, query, limit }) =>
      listKookDirectoryPeers({ cfg, query, limit }),
    listGroups: async ({ cfg, query, limit }) =>
      listKookDirectoryGroups({ cfg, query, limit }),
    listPeersLive: async ({ cfg, query, limit }) =>
      listKookDirectoryPeersLive({ cfg, query, limit }),
    listGroupsLive: async ({ cfg, query, limit }) =>
      listKookDirectoryGroupsLive({ cfg, query, limit }),
  },
  actions: kookMessageActions,
  outbound: kookOutbound,
  status: {
    defaultRuntime: {
      accountId: DEFAULT_ACCOUNT_ID,
      running: false,
      lastStartAt: null,
      lastStopAt: null,
      lastError: null,
      port: null,
    },
    buildChannelSummary: ({ snapshot }) => ({
      configured: snapshot.configured ?? false,
      running: snapshot.running ?? false,
      lastStartAt: snapshot.lastStartAt ?? null,
      lastStopAt: snapshot.lastStopAt ?? null,
      lastError: snapshot.lastError ?? null,
      port: snapshot.port ?? null,
      probe: snapshot.probe,
      lastProbeAt: snapshot.lastProbeAt ?? null,
    }),
    probeAccount: async ({ cfg }) =>
      await probeKook(cfg.channels?.kook as KookConfig | undefined),
    buildAccountSnapshot: ({ account, runtime, probe }) => ({
      accountId: account.accountId,
      enabled: account.enabled,
      configured: account.configured,
      running: runtime?.running ?? false,
      lastStartAt: runtime?.lastStartAt ?? null,
      lastStopAt: runtime?.lastStopAt ?? null,
      lastError: runtime?.lastError ?? null,
      port: runtime?.port ?? null,
      probe,
    }),
  },
  gateway: {
    startAccount: async (ctx) => {
      const { monitorKookProvider } = await import("./monitor.js");
      const kookCfg = ctx.cfg.channels?.kook as KookConfig | undefined;
      const port = kookCfg?.webhookPort ?? null;
      ctx.setStatus({ accountId: ctx.accountId, port });
      ctx.log?.info(`starting KOOK provider (mode: ${kookCfg?.connectionMode ?? "websocket"})`);
      return monitorKookProvider({
        config: ctx.cfg,
        runtime: ctx.runtime,
        abortSignal: ctx.abortSignal,
        accountId: ctx.accountId,
      });
    },
  },
};
