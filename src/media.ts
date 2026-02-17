import type { OpenClawConfig } from "openclaw/plugin-sdk";
import type { KookConfig, KookEventData, KookMediaInfo, KookAttachment } from "./types.js";
import { createKookClient } from "./client.js";
import { getKookRuntime } from "./runtime.js";
import { sendKookMessage } from "./send.js";

/**
 * Upload a file to KOOK CDN via asset/create.
 */
export async function uploadMediaKook(params: {
  cfg: OpenClawConfig;
  buffer: Buffer;
  filename: string;
}): Promise<{ url: string }> {
  const { cfg, buffer, filename } = params;
  const kookCfg = cfg.channels?.kook as KookConfig | undefined;
  if (!kookCfg?.token) throw new Error("KOOK channel not configured");

  const client = createKookClient(kookCfg);
  return client.uploadAsset(buffer, filename);
}

/**
 * Download media from a URL.
 */
export async function downloadMediaKook(params: {
  url: string;
  maxBytes: number;
}): Promise<{ buffer: Buffer; contentType?: string }> {
  const { url, maxBytes } = params;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download media: HTTP ${res.status}`);

  const contentType = res.headers.get("content-type") ?? undefined;
  const arrayBuf = await res.arrayBuffer();
  const buffer = Buffer.from(arrayBuf);

  if (buffer.length > maxBytes) {
    throw new Error(`Media too large: ${buffer.length} bytes (max: ${maxBytes})`);
  }

  return { buffer, contentType };
}

/**
 * Infer placeholder text based on KOOK message type.
 */
function inferPlaceholder(messageType: number): string {
  switch (messageType) {
    case 2: return "<media:image>";
    case 3: return "<media:video>";
    case 4: return "<media:document>";
    case 8: return "<media:audio>";
    default: return "<media:document>";
  }
}

/**
 * Resolve media from a KOOK message event.
 *
 * KOOK media message content is the URL directly:
 * - type=2 (image): content = image URL
 * - type=3 (video): content = video URL
 * - type=4 (file): content = file URL, details in extra.attachments
 * - type=8 (audio): content = audio URL
 */
export async function resolveKookMediaList(params: {
  cfg: OpenClawConfig;
  event: KookEventData;
  maxBytes: number;
  log?: (msg: string) => void;
}): Promise<KookMediaInfo[]> {
  const { cfg, event, maxBytes, log } = params;
  const mediaTypes = [2, 3, 4, 8]; // image, video, file, audio
  if (!mediaTypes.includes(event.type)) return [];

  const core = getKookRuntime();
  const out: KookMediaInfo[] = [];

  try {
    // For media messages, content is the URL
    let mediaUrl = event.content;

    // For file messages, extra.attachments has details
    const attachment = event.extra?.attachments as KookAttachment | undefined;
    if (attachment?.url) {
      mediaUrl = attachment.url;
    }

    if (!mediaUrl) return [];

    log?.(`kook: downloading media type=${event.type} from ${mediaUrl}`);

    const { buffer, contentType: rawContentType } = await downloadMediaKook({
      url: mediaUrl,
      maxBytes,
    });

    let contentType = rawContentType;
    if (!contentType) {
      contentType = await core.media.detectMime({ buffer });
    }

    const fileName = attachment?.name;
    const saved = await core.channel.media.saveMediaBuffer(
      buffer,
      contentType,
      "inbound",
      maxBytes,
      fileName,
    );

    out.push({
      path: saved.path,
      contentType: saved.contentType,
      placeholder: inferPlaceholder(event.type),
    });

    log?.(`kook: saved media to ${saved.path}`);
  } catch (err) {
    log?.(`kook: failed to download media: ${String(err)}`);
  }

  return out;
}

/**
 * Build media payload for inbound context.
 */
export function buildKookMediaPayload(
  mediaList: KookMediaInfo[],
): {
  MediaPath?: string;
  MediaType?: string;
  MediaUrl?: string;
  MediaPaths?: string[];
  MediaUrls?: string[];
  MediaTypes?: string[];
} {
  if (mediaList.length === 0) return {};

  const first = mediaList[0];
  const mediaPaths = mediaList.map((m) => m.path);
  const mediaTypes = mediaList.map((m) => m.contentType).filter(Boolean) as string[];

  return {
    MediaPath: first?.path,
    MediaType: first?.contentType,
    MediaUrl: first?.path,
    MediaPaths: mediaPaths.length > 0 ? mediaPaths : undefined,
    MediaUrls: mediaPaths.length > 0 ? mediaPaths : undefined,
    MediaTypes: mediaTypes.length > 0 ? mediaTypes : undefined,
  };
}

/**
 * Send media to KOOK by uploading to CDN first, then sending.
 */
export async function sendMediaKook(params: {
  cfg: OpenClawConfig;
  channelType: "GROUP" | "PERSON";
  to: string;
  mediaUrl: string;
  caption?: string;
}): Promise<{ messageId: string }> {
  const { cfg, channelType, to, mediaUrl, caption } = params;

  // Upload media to KOOK CDN
  const res = await fetch(mediaUrl);
  if (!res.ok) throw new Error(`Failed to fetch media: HTTP ${res.status}`);

  const buffer = Buffer.from(await res.arrayBuffer());
  const filename = mediaUrl.split("/").pop() || "file";

  const { url: kookUrl } = await uploadMediaKook({ cfg, buffer, filename });

  // Send as image message (type=2) or as KMarkdown with link
  const contentType = res.headers.get("content-type") ?? "";

  if (contentType.startsWith("image/")) {
    const result = await sendKookMessage({
      cfg,
      channelType,
      to,
      content: kookUrl,
      type: 2, // image
    });
    return { messageId: result.msgId };
  }

  // For non-image, send as KMarkdown link
  const text = caption ? `${caption}\n${kookUrl}` : kookUrl;
  const result = await sendKookMessage({
    cfg,
    channelType,
    to,
    content: text,
    type: 9,
  });
  return { messageId: result.msgId };
}
