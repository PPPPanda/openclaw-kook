import type { OpenClawConfig } from "openclaw/plugin-sdk";
import type { KookConfig } from "./types.js";
import { createKookClient } from "./client.js";

// KOOK doesn't have a native typing indicator.
// We use a reaction (emoji) on the user's message as a typing indicator.
const TYPING_EMOJI = "💭";

export type TypingIndicatorState = {
  messageId: string;
  channelType: "GROUP" | "PERSON";
  emoji: string;
};

/**
 * Add a typing indicator (reaction) to a message.
 */
export async function addTypingIndicator(params: {
  cfg: OpenClawConfig;
  messageId: string;
  channelType: "GROUP" | "PERSON";
}): Promise<TypingIndicatorState> {
  const { cfg, messageId, channelType } = params;
  const kookCfg = cfg.channels?.kook as KookConfig | undefined;
  if (!kookCfg?.token) {
    return { messageId, channelType, emoji: TYPING_EMOJI };
  }

  try {
    const client = createKookClient(kookCfg);

    if (channelType === "PERSON") {
      await client.addDirectReaction(messageId, TYPING_EMOJI);
    } else {
      await client.addReaction(messageId, TYPING_EMOJI);
    }
  } catch {
    // Silently fail - typing indicator is not critical
  }

  return { messageId, channelType, emoji: TYPING_EMOJI };
}

/**
 * Remove the typing indicator (reaction) from a message.
 */
export async function removeTypingIndicator(params: {
  cfg: OpenClawConfig;
  state: TypingIndicatorState;
}): Promise<void> {
  const { cfg, state } = params;
  const kookCfg = cfg.channels?.kook as KookConfig | undefined;
  if (!kookCfg?.token) return;

  try {
    const client = createKookClient(kookCfg);

    if (state.channelType === "PERSON") {
      await client.deleteDirectReaction(state.messageId, state.emoji);
    } else {
      await client.deleteReaction(state.messageId, state.emoji);
    }
  } catch {
    // Silently fail - cleanup is not critical
  }
}
