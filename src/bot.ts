import type { OpenClawConfig, RuntimeEnv, HistoryEntry } from "openclaw/plugin-sdk";
import {
  buildPendingHistoryContextFromMap,
  recordPendingHistoryEntryIfEnabled,
  clearHistoryEntriesIfEnabled,
  DEFAULT_GROUP_HISTORY_LIMIT,
} from "openclaw/plugin-sdk";
import type { KookConfig, KookMessageContext, KookEventData } from "./types.js";
import { getKookRuntime } from "./runtime.js";
import {
  resolveKookGroupConfig,
  resolveKookReplyPolicy,
  resolveKookAllowlistMatch,
  isKookGroupAllowed,
} from "./policy.js";
import { createKookReplyDispatcher } from "./reply-dispatcher.js";
import { parseInboundKMarkdown, stripKMarkdownSyntax } from "./kmarkdown.js";
import { resolveKookMediaList, buildKookMediaPayload } from "./media.js";
import { addTypingIndicator } from "./typing.js";

// Sender name cache
const SENDER_NAME_TTL_MS = 10 * 60 * 1000;
const senderNameCache = new Map<string, { name: string; expireAt: number }>();

function resolveSenderName(event: KookEventData): string | undefined {
  const author = event.extra?.author;
  if (!author) return undefined;

  const name = author.nickname || author.username;
  if (name) {
    const now = Date.now();
    senderNameCache.set(author.id, { name, expireAt: now + SENDER_NAME_TTL_MS });
  }
  return name;
}

/**
 * Parse a KOOK event into a normalized message context.
 */
export function parseKookMessageEvent(
  event: KookEventData,
  botId?: string,
): KookMessageContext {
  const isGroup = event.channel_type === "GROUP";
  const channelType = isGroup ? "GROUP" : "PERSON";

  // Determine raw text content
  let content: string;
  if (event.type === 9) {
    // KMarkdown: use raw_content if available, otherwise strip syntax
    const rawContent = event.extra?.kmarkdown?.raw_content;
    content = parseInboundKMarkdown(event.content, rawContent);
  } else if (event.type === 1) {
    // Plain text
    content = event.content;
  } else {
    // Media and other types — content is URL or JSON
    content = event.content;
  }

  // Check if bot was mentioned
  const mentions = event.extra?.mention ?? [];
  const mentionAll = event.extra?.mention_all ?? false;
  const mentionHere = event.extra?.mention_here ?? false;

  // KOOK may represent bot mentions as (met)userId(met) OR (rol)roleId(rol)
  // Check multiple patterns:
  // 1. Standard mention list
  // 2. KMarkdown (met) pattern in content
  // 3. Role-based mention: content contains (rol)...（rol) and bot name appears in raw_content
  let mentionedBot = botId ? mentions.includes(botId) : false;
  if (!mentionedBot && botId) {
    // Check (met) pattern in raw content
    mentionedBot = event.content.includes(`(met)${botId}(met)`);
  }
  if (!mentionedBot) {
    // Check if any (rol) mention exists — KOOK represents bot @mentions as role mentions
    // We detect this by checking mention_roles or (rol) pattern in content
    const mentionRoles = event.extra?.mention_roles ?? [];
    const hasRoleMention = mentionRoles.length > 0 || /\(rol\)\d+\(rol\)/.test(event.content);
    if (hasRoleMention) {
      // Check kmarkdown.mention_role_part for bot name, or check raw_content
      const rawContent = event.extra?.kmarkdown?.raw_content ?? "";
      const roleParts = event.extra?.kmarkdown?.mention_role_part ?? [];
      // If the role mention resolves to a name matching the bot
      const botNameMatch = roleParts.some((p) => {
        const name = (p as { name?: string }).name ?? "";
        // Match common bot names - extend as needed
        const lowerName = name.toLowerCase();
        return lowerName === "clawdbot" || lowerName === "openclaw";
      });
      if (botNameMatch) {
        mentionedBot = true;
      } else if (!rawContent && /\(rol\)\d+\(rol\)/.test(event.content)) {
        // Only assume bot mention if there's a single unresolved role mention
        // (KOOK auto-creates a role for each bot)
        const mentionRoleCount = (event.extra?.mention_roles ?? []).length;
        if (mentionRoleCount === 1) {
          mentionedBot = true;
        }
      }
    }
  }

  // Strip bot mention from content but preserve "@Bot" prefix for AI context
  if (mentionedBot) {
    if (botId) {
      // KMarkdown mention format: (met)userId(met)
      content = content.replace(new RegExp(`\\(met\\)${botId}\\(met\\)`, "g"), "").trim();
      // Also strip @botName if present
      const botAuthor = event.extra?.kmarkdown?.mention_part?.find((m) => m.id === botId);
      if (botAuthor?.username) {
        content = content.replace(new RegExp(`@${botAuthor.username}\\s*`, "g"), "").trim();
      }
    }
    // Strip role-based bot mentions: (rol)roleId(rol)
    content = content.replace(/\(rol\)\d+\(rol\)\s*/g, "").trim();
    // Strip @Clawdbot text if present
    content = content.replace(/@Clawdbot\s*/gi, "").trim();
    // Prepend "@Bot " to indicate this message was directed at the bot
    content = `@Bot ${content}`;
  }

  // Parse quote
  const quote = event.extra?.quote
    ? {
        id: event.extra.quote.id,
        content: event.extra.quote.content,
        author: event.extra.quote.author
          ? { id: event.extra.quote.author.id, username: event.extra.quote.author.username }
          : undefined,
      }
    : undefined;

  return {
    channelId: event.target_id,
    messageId: event.msg_id,
    senderId: event.author_id,
    senderName: resolveSenderName(event),
    guildId: event.extra?.guild_id,
    channelType,
    messageType: event.type,
    mentionedBot,
    mentionAll,
    mentionHere,
    content,
    quote,
  };
}

/**
 * Handle an incoming KOOK message event.
 */
export async function handleKookMessage(params: {
  cfg: OpenClawConfig;
  event: KookEventData;
  botId?: string;
  runtime?: RuntimeEnv;
  chatHistories?: Map<string, HistoryEntry[]>;
}): Promise<void> {
  const { cfg, event, botId, runtime, chatHistories } = params;
  const kookCfg = cfg.channels?.kook as KookConfig | undefined;
  const log = runtime?.log ?? console.log;
  const error = runtime?.error ?? console.error;

  // Filter bot's own messages
  if (botId && event.author_id === botId) return;

  // Filter system messages
  if (event.type === 255) return;

  // Filter bot users
  if (event.extra?.author?.bot) return;

  const ctx = parseKookMessageEvent(event, botId);
  const isGroup = ctx.channelType === "GROUP";

  log(`kook: received message from ${ctx.senderId} in ${ctx.channelId} (${ctx.channelType}) type=${ctx.messageType} mentionedBot=${ctx.mentionedBot} content="${event.content.substring(0, 100)}" mentions=${JSON.stringify(event.extra?.mention)} mentionRoles=${JSON.stringify(event.extra?.mention_roles)}`);

  const historyLimit = Math.max(
    0,
    kookCfg?.historyLimit ?? cfg.messages?.groupChat?.historyLimit ?? DEFAULT_GROUP_HISTORY_LIMIT,
  );

  // ---- Access Control ----
  if (isGroup) {
    const groupPolicy = kookCfg?.groupPolicy ?? "open";
    const groupAllowFrom = kookCfg?.groupAllowFrom ?? [];
    const groupConfig = resolveKookGroupConfig({ cfg: kookCfg, groupId: ctx.guildId ?? ctx.channelId });

    const senderAllowFrom = groupConfig?.allowFrom ?? groupAllowFrom;
    const allowed = isKookGroupAllowed({
      groupPolicy,
      allowFrom: senderAllowFrom,
      senderId: ctx.senderId,
      senderName: ctx.senderName,
    });

    if (!allowed) {
      log(`kook: sender ${ctx.senderId} not in group allowlist`);
      return;
    }

    const { requireMention } = resolveKookReplyPolicy({
      isDirectMessage: false,
      globalConfig: kookCfg,
      groupConfig,
    });

    if (requireMention && !ctx.mentionedBot) {
      log(`kook: message in ${ctx.channelId} did not mention bot, recording to history`);
      if (chatHistories) {
        recordPendingHistoryEntryIfEnabled({
          historyMap: chatHistories,
          historyKey: ctx.channelId,
          limit: historyLimit,
          entry: {
            sender: ctx.senderId,
            body: `${ctx.senderName ?? ctx.senderId}: ${ctx.content}`,
            timestamp: Date.now(),
            messageId: ctx.messageId,
          },
        });
      }
      return;
    }
  } else {
    const dmPolicy = kookCfg?.dmPolicy ?? "pairing";
    const allowFrom = kookCfg?.allowFrom ?? [];

    if (dmPolicy === "allowlist") {
      const match = resolveKookAllowlistMatch({
        allowFrom,
        senderId: ctx.senderId,
      });
      if (!match.allowed) {
        log(`kook: sender ${ctx.senderId} not in DM allowlist`);
        return;
      }
    }
  }

  // ---- Early Typing Indicator (send ASAP, before API call) ----
  const _earlyT0 = Date.now();
  try {
    await addTypingIndicator({
      cfg,
      messageId: ctx.messageId,
      channelType: ctx.channelType,
    });
    log(`kook: [early-typing] sent in ${Date.now() - _earlyT0}ms`);
  } catch (e) {
    log(`kook: [early-typing] failed in ${Date.now() - _earlyT0}ms: ${e}`);
  }

  // ---- Dispatch to Agent ----
  try {
    const core = getKookRuntime();

    const kookFrom = `kook:${ctx.senderId}`;
    const kookTo = isGroup ? `channel:${ctx.channelId}` : `user:${ctx.senderId}`;

    const route = core.channel.routing.resolveAgentRoute({
      cfg,
      channel: "kook",
      peer: {
        kind: isGroup ? "group" : "dm",
        id: isGroup ? ctx.channelId : ctx.senderId,
      },
    });

    const preview = ctx.content.replace(/\s+/g, " ").slice(0, 160);
    const inboundLabel = isGroup
      ? `KOOK message in channel ${ctx.channelId}`
      : `KOOK DM from ${ctx.senderId}`;

    core.system.enqueueSystemEvent(`${inboundLabel}: ${preview}`, {
      sessionKey: route.sessionKey,
      contextKey: `kook:message:${ctx.channelId}:${ctx.messageId}`,
    });

    // Resolve media
    const mediaMaxBytes = (kookCfg?.mediaMaxMb ?? 30) * 1024 * 1024;
    const mediaList = await resolveKookMediaList({
      cfg,
      event,
      maxBytes: mediaMaxBytes,
      log,
    });
    const mediaPayload = buildKookMediaPayload(mediaList);

    // Build message body
    const envelopeOptions = core.channel.reply.resolveEnvelopeFormatOptions(cfg);

    let messageBody = ctx.content;

    // Include media placeholders in text
    if (mediaList.length > 0 && !messageBody.trim()) {
      messageBody = mediaList.map((m) => m.placeholder).join(" ");
    }

    // Include quote context
    if (ctx.quote) {
      messageBody = `[Replying to: "${ctx.quote.content}"]\n\n${messageBody}`;
    }

    // Include speaker label
    const speaker = ctx.senderName ?? ctx.senderId;
    messageBody = `${speaker}: ${messageBody}`;

    const envelopeFrom = isGroup ? `${ctx.channelId}:${ctx.senderId}` : ctx.senderId;

    const body = core.channel.reply.formatAgentEnvelope({
      channel: "KOOK",
      from: envelopeFrom,
      timestamp: new Date(),
      envelope: envelopeOptions,
      body: messageBody,
    });

    let combinedBody = body;
    const historyKey = isGroup ? ctx.channelId : undefined;

    if (isGroup && historyKey && chatHistories) {
      combinedBody = buildPendingHistoryContextFromMap({
        historyMap: chatHistories,
        historyKey,
        limit: historyLimit,
        currentMessage: combinedBody,
        formatEntry: (entry) =>
          core.channel.reply.formatAgentEnvelope({
            channel: "KOOK",
            from: `${ctx.channelId}:${entry.sender}`,
            timestamp: entry.timestamp,
            body: entry.body,
            envelope: envelopeOptions,
          }),
      });
    }

    const ctxPayload = core.channel.reply.finalizeInboundContext({
      Body: combinedBody,
      RawBody: ctx.content,
      CommandBody: ctx.content,
      From: kookFrom,
      To: kookTo,
      SessionKey: route.sessionKey,
      AccountId: route.accountId,
      ChatType: isGroup ? "group" : "direct",
      GroupSubject: isGroup ? ctx.channelId : undefined,
      SenderName: ctx.senderName ?? ctx.senderId,
      SenderId: ctx.senderId,
      Provider: "kook" as const,
      Surface: "kook" as const,
      MessageSid: ctx.messageId,
      Timestamp: Date.now(),
      WasMentioned: ctx.mentionedBot,
      CommandAuthorized: true,
      OriginatingChannel: "kook" as const,
      OriginatingTo: kookTo,
      ...mediaPayload,
    });

    // For DMs, use sender ID as chat target (to reply back to the user).
    // For groups, use channel ID.
    const replyTargetId = isGroup ? ctx.channelId : ctx.senderId;

    const { dispatcher, replyOptions, markDispatchIdle } = createKookReplyDispatcher({
      cfg,
      agentId: route.agentId,
      runtime: runtime as RuntimeEnv,
      chatId: replyTargetId,
      channelType: ctx.channelType,
      replyToMessageId: ctx.messageId,
    });

    log(`kook: dispatching to agent (session=${route.sessionKey})`);

    const { queuedFinal, counts } = await core.channel.reply.dispatchReplyFromConfig({
      ctx: ctxPayload,
      cfg,
      dispatcher,
      replyOptions,
    });

    markDispatchIdle();

    if (isGroup && historyKey && chatHistories) {
      clearHistoryEntriesIfEnabled({
        historyMap: chatHistories,
        historyKey,
        limit: historyLimit,
      });
    }

    log(`kook: dispatch complete (queuedFinal=${queuedFinal}, replies=${counts.final})`);
  } catch (err) {
    error(`kook: failed to dispatch message: ${String(err)}`);
  }
}
