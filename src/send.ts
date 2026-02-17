import type { OpenClawConfig } from "openclaw/plugin-sdk";
import type { KookConfig, KookSendResult } from "./types.js";
import { createKookClient } from "./client.js";
import { getQuotaTracker } from "./quota.js";
import { serializeCards, type KookCard } from "./card-builder.js";

/**
 * Send a message to a KOOK channel or direct message.
 * Automatically routes to the correct API based on channelType.
 */
export async function sendKookMessage(params: {
  cfg: OpenClawConfig;
  channelType: "GROUP" | "PERSON";
  to: string;
  content: string;
  type?: number;        // 9=KMarkdown (default), 10=Card
  quote?: string;       // quote message ID
  nonce?: string;
  replyMsgId?: string;  // reply_msg_id for quota discount
}): Promise<KookSendResult> {
  const { cfg, channelType, to, content, type, quote, nonce, replyMsgId } = params;
  const kookCfg = cfg.channels?.kook as KookConfig | undefined;
  if (!kookCfg?.token) throw new Error("KOOK channel not configured");

  const client = createKookClient(kookCfg);
  const tracker = getQuotaTracker();

  let result: KookSendResult;

  if (channelType === "PERSON") {
    result = await client.createDirectMessage(to, content, {
      type: type ?? 9,
      quote,
      nonce,
      replyMsgId,
    });
  } else {
    result = await client.createMessage(to, content, {
      type: type ?? 9,
      quote,
      nonce,
      replyMsgId,
    });
  }

  tracker.record("create");
  return result;
}

/**
 * Update/edit an existing message.
 */
export async function updateKookMessage(params: {
  cfg: OpenClawConfig;
  channelType: "GROUP" | "PERSON";
  msgId: string;
  content: string;
  quote?: string;
  replyMsgId?: string;
}): Promise<void> {
  const { cfg, channelType, msgId, content, quote, replyMsgId } = params;
  const kookCfg = cfg.channels?.kook as KookConfig | undefined;
  if (!kookCfg?.token) throw new Error("KOOK channel not configured");

  const client = createKookClient(kookCfg);
  const tracker = getQuotaTracker();

  if (channelType === "PERSON") {
    await client.updateDirectMessage(msgId, content, { quote, replyMsgId });
  } else {
    await client.updateMessage(msgId, content, { quote, replyMsgId });
  }

  tracker.record("update");
}

/**
 * Delete a message.
 */
export async function deleteKookMessage(params: {
  cfg: OpenClawConfig;
  channelType: "GROUP" | "PERSON";
  msgId: string;
}): Promise<void> {
  const { cfg, channelType, msgId } = params;
  const kookCfg = cfg.channels?.kook as KookConfig | undefined;
  if (!kookCfg?.token) throw new Error("KOOK channel not configured");

  const client = createKookClient(kookCfg);

  if (channelType === "PERSON") {
    await client.deleteDirectMessage(msgId);
  } else {
    await client.deleteMessage(msgId);
  }
}

/**
 * Send a Card message.
 */
export async function sendKookCardMessage(params: {
  cfg: OpenClawConfig;
  channelType: "GROUP" | "PERSON";
  to: string;
  cards: KookCard[];
  quote?: string;
}): Promise<KookSendResult> {
  const content = serializeCards(params.cards);
  return sendKookMessage({
    ...params,
    content,
    type: 10, // Card message type
  });
}
