import type { KookConfig, KookProbeResult } from "./types.js";
import { createKookClient } from "./client.js";
import { resolveKookToken } from "./accounts.js";

export async function probeKook(cfg?: KookConfig): Promise<KookProbeResult> {
  const token = resolveKookToken(cfg);
  if (!token) {
    return {
      ok: false,
      error: "missing token",
    };
  }

  try {
    const client = createKookClient(token);
    const me = await client.getMe();

    return {
      ok: true,
      botId: me.id,
      botName: me.username,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
