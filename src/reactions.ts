import type { OpenClawConfig } from "openclaw/plugin-sdk";
import type { KookConfig } from "./types.js";
import { createKookClient } from "./client.js";

/**
 * Add a reaction to a channel message.
 */
export async function addReactionKook(params: {
  cfg: OpenClawConfig;
  messageId: string;
  emoji: string;
  channelType?: "GROUP" | "PERSON";
}): Promise<void> {
  const { cfg, messageId, emoji, channelType } = params;
  const kookCfg = cfg.channels?.kook as KookConfig | undefined;
  if (!kookCfg?.token) throw new Error("KOOK channel not configured");

  const client = createKookClient(kookCfg);
  if (channelType === "PERSON") {
    await client.addDirectReaction(messageId, emoji);
  } else {
    await client.addReaction(messageId, emoji);
  }
}

/**
 * Remove a reaction from a channel message.
 */
export async function removeReactionKook(params: {
  cfg: OpenClawConfig;
  messageId: string;
  emoji: string;
  userId?: string;
  channelType?: "GROUP" | "PERSON";
}): Promise<void> {
  const { cfg, messageId, emoji, userId, channelType } = params;
  const kookCfg = cfg.channels?.kook as KookConfig | undefined;
  if (!kookCfg?.token) throw new Error("KOOK channel not configured");

  const client = createKookClient(kookCfg);
  if (channelType === "PERSON") {
    await client.deleteDirectReaction(messageId, emoji, userId);
  } else {
    await client.deleteReaction(messageId, emoji, userId);
  }
}
