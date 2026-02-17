import {
  createReplyPrefixContext,
  createTypingCallbacks,
  logTypingFailure,
  type OpenClawConfig,
  type RuntimeEnv,
  type ReplyPayload,
} from "openclaw/plugin-sdk";
import { getKookRuntime } from "./runtime.js";
import { sendKookMessage, updateKookMessage } from "./send.js";
import type { KookConfig } from "./types.js";
import { markdownToKMarkdown } from "./kmarkdown.js";
import { getQuotaTracker } from "./quota.js";
import {
  addTypingIndicator,
  removeTypingIndicator,
  type TypingIndicatorState,
} from "./typing.js";

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Resolve whether block streaming is enabled from config.
 */
function resolveBlockStreamingEnabled(cfg: OpenClawConfig): boolean {
  const kookCfg = cfg.channels?.kook as KookConfig | undefined;
  return kookCfg?.blockStreaming !== false; // default true
}

/**
 * Resolve block streaming mode: "edit" (default) or "append".
 */
function resolveBlockStreamingMode(cfg: OpenClawConfig): "edit" | "append" {
  const kookCfg = cfg.channels?.kook as KookConfig | undefined;
  return kookCfg?.blockStreamingMode ?? "edit";
}

export type CreateKookReplyDispatcherParams = {
  cfg: OpenClawConfig;
  agentId: string;
  runtime: RuntimeEnv;
  chatId: string;                       // channel ID or user ID (for DM target)
  channelType: "GROUP" | "PERSON";
  replyToMessageId?: string;
};

export function createKookReplyDispatcher(params: CreateKookReplyDispatcherParams) {
  const core = getKookRuntime();
  const { cfg, agentId, chatId, channelType, replyToMessageId } = params;

  const prefixContext = createReplyPrefixContext({
    cfg,
    agentId,
  });

  const kookCfg = cfg.channels?.kook as KookConfig | undefined;
  const blockStreamingEnabled = resolveBlockStreamingEnabled(cfg);
  const blockStreamingMode = resolveBlockStreamingMode(cfg);
  const quotaTracker = getQuotaTracker();

  // ---- Block Streaming State ----
  let currentStreamMsgId: string | null = null;
  let accumulatedText = "";
  let lastEditTime = 0;
  const MIN_EDIT_INTERVAL_MS = 300; // prevent rate limiting
  const MAX_KMARKDOWN_LENGTH = 7500; // leave some margin from 8000 limit

  // ---- Typing State ----
  let typingState: TypingIndicatorState | null = null;

  const typingCallbacks = createTypingCallbacks({
    start: async () => {
      if (!replyToMessageId) return;
      typingState = await addTypingIndicator({
        cfg,
        messageId: replyToMessageId,
        channelType,
      });
      params.runtime.log?.("kook: added typing indicator");
    },
    stop: async () => {
      if (!typingState) return;
      await removeTypingIndicator({ cfg, state: typingState });
      typingState = null;
      params.runtime.log?.("kook: removed typing indicator");
    },
    onStartError: (err) => {
      logTypingFailure({
        log: (message) => params.runtime.log?.(message),
        channel: "kook",
        action: "start",
        error: err,
      });
    },
    onStopError: (err) => {
      logTypingFailure({
        log: (message) => params.runtime.log?.(message),
        channel: "kook",
        action: "stop",
        error: err,
      });
    },
  });

  const textChunkLimit = core.channel.text.resolveTextChunkLimit({
    cfg,
    channel: "kook",
    defaultLimit: 5000,
  });
  const chunkMode = core.channel.text.resolveChunkMode(cfg, "kook");

  const { dispatcher, replyOptions, markDispatchIdle } =
    core.channel.reply.createReplyDispatcherWithTyping({
      responsePrefix: prefixContext.responsePrefix,
      responsePrefixContextProvider: prefixContext.responsePrefixContextProvider,
      humanDelay: core.channel.reply.resolveHumanDelayConfig(cfg, agentId),
      onReplyStart: typingCallbacks.onReplyStart,
      deliver: async (payload: ReplyPayload, info: { kind: string }) => {
        const text = payload.text ?? "";
        if (!text.trim()) return;

        const isBlock = info.kind === "block";

        if (isBlock && blockStreamingEnabled && blockStreamingMode === "edit") {
          // ---- Block Streaming via Edit ----
          const converted = markdownToKMarkdown(text);
          accumulatedText += (accumulatedText ? "\n\n" : "") + converted;

          if (!currentStreamMsgId) {
            // First block: create new message
            try {
              const result = await sendKookMessage({
                cfg,
                channelType,
                to: chatId,
                content: accumulatedText,
                type: 9,
                quote: replyToMessageId,
                replyMsgId: replyToMessageId, // quota discount
              });
              currentStreamMsgId = result.msgId;
              params.runtime.log?.(`kook: block streaming started, msgId=${currentStreamMsgId}`);
            } catch (err) {
              params.runtime.error?.(`kook: failed to create streaming message: ${err}`);
            }
          } else {
            // Subsequent blocks: edit existing message
            const now = Date.now();
            const elapsed = now - lastEditTime;
            if (elapsed < MIN_EDIT_INTERVAL_MS) {
              await sleep(MIN_EDIT_INTERVAL_MS - elapsed);
            }

            // If accumulated text exceeds KMarkdown limit, start a new message
            if (accumulatedText.length > MAX_KMARKDOWN_LENGTH) {
              // Finalize current message and start new one
              currentStreamMsgId = null;
              const overflow = converted; // current block text
              accumulatedText = overflow;

              const result = await sendKookMessage({
                cfg,
                channelType,
                to: chatId,
                content: accumulatedText,
                type: 9,
              });
              currentStreamMsgId = result.msgId;
              params.runtime.log?.("kook: block streaming overflow, new message created");
            } else {
              try {
                await updateKookMessage({
                  cfg,
                  channelType,
                  msgId: currentStreamMsgId,
                  content: accumulatedText,
                  replyMsgId: replyToMessageId, // quota discount
                });
                lastEditTime = Date.now();
              } catch (err) {
                params.runtime.error?.(`kook: failed to update streaming message: ${err}`);
              }
            }
          }
        } else {
          // ---- Final reply or non-streaming / append mode ----
          const converted = markdownToKMarkdown(text);

          if (currentStreamMsgId && blockStreamingEnabled && blockStreamingMode === "edit") {
            // Finalize streaming message with final content
            const finalText = accumulatedText + (accumulatedText ? "\n\n" : "") + converted;
            try {
              await updateKookMessage({
                cfg,
                channelType,
                msgId: currentStreamMsgId,
                content: finalText,
                replyMsgId: replyToMessageId, // quota discount
              });
              params.runtime.log?.("kook: block streaming finalized");
            } catch (err) {
              params.runtime.error?.(`kook: failed to finalize streaming message: ${err}`);
              // Fallback: send as new message
              await sendFallback(converted);
            }
            currentStreamMsgId = null;
            accumulatedText = "";
          } else {
            // Normal send (chunked if needed)
            await sendFallback(converted);
          }
        }
      },
      onError: (err, info) => {
        params.runtime.error?.(`kook ${info.kind} reply failed: ${String(err)}`);
        typingCallbacks.onIdle?.();
      },
      onIdle: typingCallbacks.onIdle,
    });

  async function sendFallback(converted: string): Promise<void> {
    const chunks = core.channel.text.chunkTextWithMode(converted, textChunkLimit, chunkMode);
    for (const chunk of chunks) {
      if (!chunk.trim()) continue;
      await sendKookMessage({
        cfg,
        channelType,
        to: chatId,
        content: chunk,
        type: 9,
        quote: replyToMessageId,
        replyMsgId: replyToMessageId, // quota discount
      });
    }
  }

  return {
    dispatcher,
    replyOptions: {
      ...replyOptions,
      disableBlockStreaming: !blockStreamingEnabled,
      onModelSelected: prefixContext.onModelSelected,
    },
    markDispatchIdle,
  };
}
