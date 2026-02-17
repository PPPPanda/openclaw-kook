import type { OpenClawConfig } from "openclaw/plugin-sdk";
import {
  createActionGate,
  readStringParam,
  readNumberParam,
  jsonResult,
} from "openclaw/plugin-sdk";
import type { KookConfig } from "./types.js";
import { createKookClient } from "./client.js";
import { sendKookMessage, updateKookMessage, deleteKookMessage } from "./send.js";
import { addReactionKook, removeReactionKook } from "./reactions.js";
import { sendMediaKook } from "./media.js";
import { markdownToKMarkdown } from "./kmarkdown.js";

/**
 * Determine channel type from a target string.
 * "user:xxx" → PERSON, everything else → GROUP.
 */
function resolveChannelType(target: string): "GROUP" | "PERSON" {
  return target.startsWith("user:") ? "PERSON" : "GROUP";
}

/**
 * Strip the prefix from a target string (user: or channel:).
 */
function stripTargetPrefix(target: string): string {
  return target.replace(/^(channel|user):/, "");
}

export const kookMessageActions = {
  listActions: ({ cfg }: { cfg: OpenClawConfig }): string[] => {
    const kookCfg = cfg.channels?.kook as KookConfig | undefined;
    if (!kookCfg?.token) return [];

    const gate = createActionGate((kookCfg as Record<string, unknown>).actions as Record<string, unknown> | undefined);
    const actions = new Set<string>(["send"]);

    if (gate("reactions")) {
      actions.add("react");
    }
    if (gate("messages")) {
      actions.add("read");
      actions.add("edit");
      actions.add("delete");
    }
    if (gate("channelInfo")) {
      actions.add("channel-info");
      actions.add("channel-list");
    }
    if (gate("memberInfo")) {
      actions.add("member-info");
    }

    return Array.from(actions);
  },

  extractToolSend: ({ args }: { args: Record<string, unknown> }): { to: string } | null => {
    const action = typeof args.action === "string" ? args.action.trim() : "";
    if (action === "send") {
      const to = typeof args.to === "string" ? args.to.trim() : undefined;
      return to ? { to } : null;
    }
    return null;
  },

  handleAction: async ({
    action,
    params,
    cfg,
    accountId: _accountId,
  }: {
    action: string;
    params: Record<string, unknown>;
    cfg: OpenClawConfig;
    accountId?: string;
  }) => {
    const kookCfg = cfg.channels?.kook as KookConfig | undefined;
    if (!kookCfg?.token) throw new Error("KOOK channel not configured");

    const client = createKookClient(kookCfg);

    // --- send ---
    if (action === "send") {
      const to = readStringParam(params, "to", { required: true })!;
      const message = readStringParam(params, "message", { required: true, allowEmpty: true });
      const mediaUrl = readStringParam(params, "media", { trim: false });
      const replyTo = readStringParam(params, "replyTo");
      const explicitType = readNumberParam(params, "type", { integer: true });
      const messageType = explicitType && explicitType > 0 ? explicitType : 9;
      const channelType = resolveChannelType(to);
      const targetId = stripTargetPrefix(to);

      // Send media if provided
      if (mediaUrl) {
        try {
          const mediaResult = await sendMediaKook({
            cfg,
            channelType,
            to: targetId,
            mediaUrl,
            caption: message ?? undefined,
          });

          // If there's text and media was sent separately, send text too
          if (message?.trim() && mediaUrl) {
            const content = messageType === 10 ? message : markdownToKMarkdown(message);
            await sendKookMessage({
              cfg,
              channelType,
              to: targetId,
              content,
              type: messageType,
              quote: replyTo ?? undefined,
            });
          }

          return jsonResult({ ok: true, messageId: mediaResult.messageId });
        } catch (err) {
          // Fallback: send media URL as text
          const fallback = message ? `${message}\n📎 ${mediaUrl}` : `📎 ${mediaUrl}`;
          const content = markdownToKMarkdown(fallback);
          const result = await sendKookMessage({
            cfg,
            channelType,
            to: targetId,
            content,
            type: messageType,
            quote: replyTo ?? undefined,
          });
          return jsonResult({ ok: true, messageId: result.msgId, mediaFallback: true });
        }
      }

      // Text-only send
      const content = messageType === 10 ? (message ?? "") : markdownToKMarkdown(message ?? "");
      const result = await sendKookMessage({
        cfg,
        channelType,
        to: targetId,
        content,
        type: messageType,
        quote: replyTo ?? undefined,
      });
      return jsonResult({ ok: true, messageId: result.msgId });
    }

    // --- react ---
    if (action === "react") {
      const messageId = readStringParam(params, "messageId", { required: true })!;
      const emoji = readStringParam(params, "emoji", { required: true, allowEmpty: true })!;
      const remove = typeof params.remove === "boolean" ? params.remove : false;
      const channelId = readStringParam(params, "channelId") ?? readStringParam(params, "to");
      const channelType = channelId ? resolveChannelType(channelId) : "GROUP";

      if (remove) {
        await removeReactionKook({
          cfg,
          messageId,
          emoji,
          channelType,
        });
        return jsonResult({ ok: true, action: "removed", emoji });
      }

      await addReactionKook({
        cfg,
        messageId,
        emoji,
        channelType,
      });
      return jsonResult({ ok: true, action: "added", emoji });
    }

    // --- read ---
    if (action === "read") {
      const channelId = readStringParam(params, "channelId") ?? readStringParam(params, "to", { required: true })!;
      const targetId = stripTargetPrefix(channelId);
      const channelType = resolveChannelType(channelId);
      const limit = readNumberParam(params, "limit", { integer: true }) ?? 20;
      const before = readStringParam(params, "before");
      const after = readStringParam(params, "after");

      if (channelType === "PERSON") {
        // Direct messages use /direct-message/list
        const listParams: Record<string, string> = { target_id: targetId };
        if (before) listParams.msg_id = before;
        if (limit) listParams.page_size = String(Math.min(limit, 50));
        if (after) listParams.flag = "after";
        else if (before) listParams.flag = "before";

        const result = await client.get<{ items: unknown[] }>("/direct-message/list", listParams);
        const items = (result.items ?? []).slice(0, limit);
        return jsonResult({ ok: true, messages: items, count: items.length });
      }

      // Channel messages
      const result = await client.listMessages(targetId, {
        msgId: before ?? after ?? undefined,
        flag: after ? "after" : before ? "before" : undefined,
        pageSize: Math.min(limit, 50),
      });
      const items = (result.items ?? []).slice(0, limit);
      return jsonResult({ ok: true, messages: items, count: items.length });
    }

    // --- edit ---
    if (action === "edit") {
      const messageId = readStringParam(params, "messageId", { required: true })!;
      const message = readStringParam(params, "message", { required: true })!;
      const channelId = readStringParam(params, "channelId") ?? readStringParam(params, "to");
      const channelType = channelId ? resolveChannelType(channelId) : "GROUP";
      const content = markdownToKMarkdown(message);

      await updateKookMessage({
        cfg,
        channelType,
        msgId: messageId,
        content,
      });
      return jsonResult({ ok: true, messageId });
    }

    // --- delete ---
    if (action === "delete") {
      const messageId = readStringParam(params, "messageId", { required: true })!;
      const channelId = readStringParam(params, "channelId") ?? readStringParam(params, "to");
      const channelType = channelId ? resolveChannelType(channelId) : "GROUP";

      await deleteKookMessage({
        cfg,
        channelType,
        msgId: messageId,
      });
      return jsonResult({ ok: true, messageId });
    }

    // --- channel-info ---
    if (action === "channel-info") {
      const channelId = readStringParam(params, "channelId") ?? readStringParam(params, "to", { required: true })!;
      const targetId = stripTargetPrefix(channelId);

      const channelData = await client.get<unknown>("/channel/view", { target_id: targetId });
      return jsonResult({ ok: true, channel: channelData });
    }

    // --- channel-list ---
    if (action === "channel-list") {
      const guildId = readStringParam(params, "guildId", { required: true })!;
      const result = await client.listChannels(guildId);
      return jsonResult({ ok: true, channels: result.items ?? [] });
    }

    // --- member-info ---
    if (action === "member-info") {
      const userId = readStringParam(params, "userId", { required: true })!;
      const guildId = readStringParam(params, "guildId");

      const user = await client.getUser(userId, guildId ?? undefined);
      return jsonResult({ ok: true, user });
    }

    throw new Error(`Action "${action}" is not supported for KOOK.`);
  },
};
