import type { KookConfigSchema, KookGroupSchema, z } from "./config-schema.js";

export type KookConfig = z.infer<typeof KookConfigSchema>;
export type KookGroupConfig = z.infer<typeof KookGroupSchema>;

export type ResolvedKookAccount = {
  accountId: string;
  enabled: boolean;
  configured: boolean;
  botId?: string;
  botName?: string;
};

export type KookMessageContext = {
  channelId: string;
  messageId: string;
  senderId: string;
  senderName?: string;
  guildId?: string;
  channelType: "GROUP" | "PERSON";
  messageType: number;
  mentionedBot: boolean;
  mentionAll: boolean;
  mentionHere: boolean;
  content: string;
  quote?: KookQuoteInfo;
};

export type KookQuoteInfo = {
  id: string;
  content: string;
  author?: { id: string; username: string };
};

export type KookSendResult = {
  msgId: string;
  msgTimestamp: number;
};

export type KookProbeResult = {
  ok: boolean;
  error?: string;
  botId?: string;
  botName?: string;
};

export type KookMediaInfo = {
  path: string;
  contentType?: string;
  placeholder: string;
};

// ---- KOOK API types ----

export type KookUser = {
  id: string;
  username: string;
  nickname?: string;
  identify_num: string;
  online: boolean;
  bot?: boolean;
  avatar?: string;
  vip_avatar?: string;
  banner?: string;
  status?: number;
  mobile_verified?: boolean;
  roles?: number[];
};

export type KookGuild = {
  id: string;
  name: string;
  topic?: string;
  master_id?: string;
  icon?: string;
  notify_type?: number;
  region?: string;
  enable_open?: boolean;
  open_id?: string;
  default_channel_id?: string;
  welcome_channel_id?: string;
};

export type KookChannel = {
  id: string;
  name: string;
  user_id?: string;
  guild_id?: string;
  topic?: string;
  is_category?: boolean;
  parent_id?: string;
  level?: number;
  slow_mode?: number;
  type?: number;  // 1=text, 2=voice
  permission_overwrites?: unknown[];
  permission_users?: unknown[];
  permission_sync?: number;
};

// WebSocket event data (s=0)
export type KookEventData = {
  channel_type: "GROUP" | "PERSON" | "BROADCAST";
  type: number;                    // 1=text, 2=image, 3=video, 4=file, 8=audio, 9=KMarkdown, 10=card, 255=system
  target_id: string;               // channel ID (GROUP) or user code (PERSON)
  author_id: string;
  content: string;
  msg_id: string;
  msg_timestamp: number;
  nonce: string;
  extra: KookEventExtra;
};

export type KookEventExtra = {
  type: number | string;
  guild_id?: string;
  channel_name?: string;
  mention?: string[];
  mention_all?: boolean;
  mention_roles?: number[];
  mention_here?: boolean;
  author?: KookUser;
  quote?: {
    id: string;
    type: number;
    content: string;
    create_at: number;
    author: KookUser;
  };
  attachments?: KookAttachment;
  kmarkdown?: {
    raw_content?: string;
    mention_part?: Array<{ id: string; username: string }>;
    mention_role_part?: Array<{ role_id: number; name: string }>;
  };
};

export type KookAttachment = {
  type: string;
  name: string;
  url: string;
  file_type?: string;
  size?: number;
  duration?: number;
  width?: number;
  height?: number;
};

// WebSocket signaling types
export type KookWSSignal = {
  s: number;           // 0=EVENT, 1=HELLO, 2=PING, 3=PONG, 4=RESUME, 5=RECONNECT, 6=RESUME_ACK
  d: unknown;
  sn?: number;         // only for s=0
};

export type KookHelloData = {
  code: number;        // 0=success, 40100=missing params, 40101=invalid token, 40102=token verify fail, 40103=token expired
  session_id?: string;
};

// KOOK REST API response wrapper
export type KookApiResponse<T = unknown> = {
  code: number;        // 0=success
  message: string;
  data: T;
};
