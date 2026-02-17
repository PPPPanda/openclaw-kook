import type { ChannelOutboundAdapter } from "openclaw/plugin-sdk";
import { getKookRuntime } from "./runtime.js";
import { sendKookMessage } from "./send.js";
import { sendMediaKook } from "./media.js";
import { markdownToKMarkdown } from "./kmarkdown.js";

export const kookOutbound: ChannelOutboundAdapter = {
  deliveryMode: "direct",
  chunker: (text, limit) => getKookRuntime().channel.text.chunkMarkdownText(text, limit),
  chunkerMode: "markdown",
  textChunkLimit: 5000,
  sendText: async ({ cfg, to, text, replyToId }) => {
    // Determine channel type from target format
    const channelType = to.startsWith("user:") ? "PERSON" : "GROUP";
    const targetId = to.replace(/^(channel|user):/, "");
    const content = markdownToKMarkdown(text);

    const result = await sendKookMessage({
      cfg,
      channelType,
      to: targetId,
      content,
      type: 9,
      quote: replyToId,
    });
    return { channel: "kook", messageId: result.msgId, chatId: targetId };
  },
  sendMedia: async ({ cfg, to, text, mediaUrl, replyToId }) => {
    const channelType = to.startsWith("user:") ? "PERSON" : "GROUP";
    const targetId = to.replace(/^(channel|user):/, "");

    // Send text first if provided
    if (text?.trim()) {
      const content = markdownToKMarkdown(text);
      await sendKookMessage({
        cfg,
        channelType,
        to: targetId,
        content,
        type: 9,
        quote: replyToId,
      });
    }

    // Upload and send media
    if (mediaUrl) {
      try {
        const result = await sendMediaKook({
          cfg,
          channelType,
          to: targetId,
          mediaUrl,
        });
        return { channel: "kook", ...result, chatId: targetId };
      } catch (err) {
        console.error(`[kook] sendMediaKook failed:`, err);
        // Fallback to URL link
        const fallbackText = `📎 ${mediaUrl}`;
        const result = await sendKookMessage({
          cfg,
          channelType,
          to: targetId,
          content: fallbackText,
          type: 9,
        });
        return { channel: "kook", messageId: result.msgId, chatId: targetId };
      }
    }

    const result = await sendKookMessage({
      cfg,
      channelType,
      to: targetId,
      content: text ?? "",
      type: 9,
    });
    return { channel: "kook", messageId: result.msgId, chatId: targetId };
  },
};
