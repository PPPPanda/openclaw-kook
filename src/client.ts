import type {
  KookApiResponse,
  KookUser,
  KookGuild,
  KookChannel,
  KookSendResult,
  KookConfig,
} from "./types.js";

const BASE_URL = "https://www.kookapp.cn/api/v3";

export class KookApiError extends Error {
  constructor(
    public readonly code: number,
    public readonly apiMessage: string,
  ) {
    super(`KOOK API error ${code}: ${apiMessage}`);
    this.name = "KookApiError";
  }
}

export class KookRateLimitError extends Error {
  constructor(
    public readonly resetAfterMs: number,
  ) {
    super(`KOOK rate limit hit, reset after ${resetAfterMs}ms`);
    this.name = "KookRateLimitError";
  }
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export class KookClient {
  private token: string;
  private maxRetries = 3;

  constructor(token: string) {
    this.token = token.startsWith("Bot ") ? token : token;
  }

  private get authHeader(): string {
    return `Bot ${this.token}`;
  }

  async get<T>(path: string, params?: Record<string, string>): Promise<T> {
    return this.request<T>("GET", path, { params });
  }

  async post<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>("POST", path, { body });
  }

  async postForm<T>(path: string, formData: FormData): Promise<T> {
    return this.request<T>("POST", path, { formData });
  }

  private async request<T>(
    method: string,
    path: string,
    opts: { body?: unknown; params?: Record<string, string>; formData?: FormData },
    retryCount = 0,
  ): Promise<T> {
    let url = `${BASE_URL}${path}`;
    if (opts.params) {
      const qs = new URLSearchParams(opts.params).toString();
      if (qs) url += `?${qs}`;
    }

    const headers: Record<string, string> = {
      Authorization: this.authHeader,
    };

    let fetchBody: BodyInit | undefined;

    if (opts.formData) {
      fetchBody = opts.formData;
      // Don't set Content-Type for FormData, let fetch handle it
    } else if (opts.body !== undefined) {
      headers["Content-Type"] = "application/json";
      fetchBody = JSON.stringify(opts.body);
    }

    const res = await fetch(url, {
      method,
      headers,
      body: fetchBody,
    });

    // Handle rate limiting
    const remaining = res.headers.get("X-Rate-Limit-Remaining");
    const resetAfter = res.headers.get("X-Rate-Limit-Reset");

    if (res.status === 429) {
      const waitMs = resetAfter ? parseInt(resetAfter, 10) * 1000 : 5000;
      if (retryCount < this.maxRetries) {
        await sleep(waitMs);
        return this.request<T>(method, path, opts, retryCount + 1);
      }
      throw new KookRateLimitError(waitMs);
    }

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`KOOK HTTP ${res.status}: ${text}`);
    }

    const json = (await res.json()) as KookApiResponse<T>;
    if (json.code !== 0) {
      throw new KookApiError(json.code, json.message);
    }

    return json.data;
  }

  // ---- Gateway ----

  async getGateway(compress = 0): Promise<{ url: string }> {
    return this.get<{ url: string }>("/gateway/index", {
      compress: String(compress),
    });
  }

  // ---- Messages (Channel) ----

  async createMessage(
    targetId: string,
    content: string,
    opts?: {
      type?: number;
      quote?: string;
      nonce?: string;
      tempTargetId?: string;
      replyMsgId?: string;
    },
  ): Promise<KookSendResult> {
    const body: Record<string, unknown> = {
      target_id: targetId,
      content,
      type: opts?.type ?? 9, // default to KMarkdown
    };
    if (opts?.quote) body.quote = opts.quote;
    if (opts?.nonce) body.nonce = opts.nonce;
    if (opts?.tempTargetId) body.temp_target_id = opts.tempTargetId;
    if (opts?.replyMsgId) body.reply_msg_id = opts.replyMsgId;

    const data = await this.post<{ msg_id: string; msg_timestamp: number }>(
      "/message/create",
      body,
    );
    return { msgId: data.msg_id, msgTimestamp: data.msg_timestamp };
  }

  async updateMessage(
    msgId: string,
    content: string,
    opts?: { quote?: string; tempTargetId?: string; replyMsgId?: string },
  ): Promise<void> {
    const body: Record<string, unknown> = {
      msg_id: msgId,
      content,
    };
    if (opts?.quote) body.quote = opts.quote;
    if (opts?.tempTargetId) body.temp_target_id = opts.tempTargetId;
    if (opts?.replyMsgId) body.reply_msg_id = opts.replyMsgId;

    await this.post<void>("/message/update", body);
  }

  async deleteMessage(msgId: string): Promise<void> {
    await this.post<void>("/message/delete", { msg_id: msgId });
  }

  async getMessage(msgId: string): Promise<unknown> {
    return this.get<unknown>("/message/view", { msg_id: msgId });
  }

  // ---- Messages (Direct / Private) ----

  async createDirectMessage(
    targetId: string,
    content: string,
    opts?: {
      type?: number;
      chatCode?: string;
      quote?: string;
      nonce?: string;
      replyMsgId?: string;
    },
  ): Promise<KookSendResult> {
    const body: Record<string, unknown> = {
      target_id: targetId,
      content,
      type: opts?.type ?? 9,
    };
    if (opts?.chatCode) body.chat_code = opts.chatCode;
    if (opts?.quote) body.quote = opts.quote;
    if (opts?.nonce) body.nonce = opts.nonce;
    if (opts?.replyMsgId) body.reply_msg_id = opts.replyMsgId;

    const data = await this.post<{ msg_id: string; msg_timestamp: number }>(
      "/direct-message/create",
      body,
    );
    return { msgId: data.msg_id, msgTimestamp: data.msg_timestamp };
  }

  async updateDirectMessage(
    msgId: string,
    content: string,
    opts?: { quote?: string; replyMsgId?: string },
  ): Promise<void> {
    const body: Record<string, unknown> = {
      msg_id: msgId,
      content,
    };
    if (opts?.quote) body.quote = opts.quote;
    if (opts?.replyMsgId) body.reply_msg_id = opts.replyMsgId;

    await this.post<void>("/direct-message/update", body);
  }

  async deleteDirectMessage(msgId: string): Promise<void> {
    await this.post<void>("/direct-message/delete", { msg_id: msgId });
  }

  // ---- Reactions ----

  async addReaction(msgId: string, emoji: string): Promise<void> {
    await this.post<void>("/message/add-reaction", {
      msg_id: msgId,
      emoji,
    });
  }

  async deleteReaction(msgId: string, emoji: string, userId?: string): Promise<void> {
    const body: Record<string, unknown> = { msg_id: msgId, emoji };
    if (userId) body.user_id = userId;
    await this.post<void>("/message/delete-reaction", body);
  }

  async addDirectReaction(msgId: string, emoji: string): Promise<void> {
    await this.post<void>("/direct-message/add-reaction", {
      msg_id: msgId,
      emoji,
    });
  }

  async deleteDirectReaction(msgId: string, emoji: string, userId?: string): Promise<void> {
    const body: Record<string, unknown> = { msg_id: msgId, emoji };
    if (userId) body.user_id = userId;
    await this.post<void>("/direct-message/delete-reaction", body);
  }

  // ---- Media ----

  async uploadAsset(buffer: Buffer, filename: string): Promise<{ url: string }> {
    const formData = new FormData();
    const blob = new Blob([new Uint8Array(buffer)]);
    formData.append("file", blob, filename);
    return this.postForm<{ url: string }>("/asset/create", formData);
  }

  // ---- User ----

  async getMe(): Promise<KookUser> {
    return this.get<KookUser>("/user/me");
  }

  async getUser(userId: string, guildId?: string): Promise<KookUser> {
    const params: Record<string, string> = { user_id: userId };
    if (guildId) params.guild_id = guildId;
    return this.get<KookUser>("/user/view", params);
  }

  // ---- Guild ----

  async listGuilds(): Promise<{ items: KookGuild[] }> {
    return this.get<{ items: KookGuild[] }>("/guild/list");
  }

  async getGuild(guildId: string): Promise<KookGuild> {
    return this.get<KookGuild>("/guild/view", { guild_id: guildId });
  }

  // ---- Channel ----

  async listChannels(guildId: string): Promise<{ items: KookChannel[] }> {
    return this.get<{ items: KookChannel[] }>("/channel/list", { guild_id: guildId });
  }

  // ---- Guild Members ----

  async listGuildMembers(
    guildId: string,
    opts?: { page?: number; pageSize?: number },
  ): Promise<{
    items: KookUser[];
    meta: { page: number; page_total: number; page_size: number; total: number };
  }> {
    const params: Record<string, string> = { guild_id: guildId };
    if (opts?.page) params.page = String(opts.page);
    if (opts?.pageSize) params.page_size = String(opts.pageSize);
    return this.get("/guild/user-list", params);
  }

  // ---- Message List ----

  async listMessages(
    channelId: string,
    opts?: { msgId?: string; pin?: number; flag?: string; pageSize?: number },
  ): Promise<{ items: unknown[] }> {
    const params: Record<string, string> = { target_id: channelId };
    if (opts?.msgId) params.msg_id = opts.msgId;
    if (opts?.pin !== undefined) params.pin = String(opts.pin);
    if (opts?.flag) params.flag = opts.flag;
    if (opts?.pageSize) params.page_size = String(opts.pageSize);
    return this.get("/message/list", params);
  }
}

// Factory function
export function createKookClient(cfg: KookConfig): KookClient;
export function createKookClient(token: string): KookClient;
export function createKookClient(cfgOrToken: KookConfig | string): KookClient {
  const token = typeof cfgOrToken === "string" ? cfgOrToken : cfgOrToken.token!;
  return new KookClient(token);
}
