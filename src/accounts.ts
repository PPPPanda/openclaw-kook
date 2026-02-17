import type { OpenClawConfig } from "openclaw/plugin-sdk";
import { DEFAULT_ACCOUNT_ID } from "openclaw/plugin-sdk";
import type { KookConfig, ResolvedKookAccount } from "./types.js";

export function resolveKookToken(cfg?: KookConfig): string | null {
  const token = cfg?.token?.trim();
  return token || null;
}

export function resolveKookAccount(params: {
  cfg: OpenClawConfig;
  accountId?: string | null;
}): ResolvedKookAccount {
  const kookCfg = params.cfg.channels?.kook as KookConfig | undefined;
  const enabled = kookCfg?.enabled !== false;
  const token = resolveKookToken(kookCfg);

  return {
    accountId: params.accountId?.trim() || DEFAULT_ACCOUNT_ID,
    enabled,
    configured: Boolean(token),
  };
}

export function listKookAccountIds(_cfg: OpenClawConfig): string[] {
  return [DEFAULT_ACCOUNT_ID];
}

export function resolveDefaultKookAccountId(_cfg: OpenClawConfig): string {
  return DEFAULT_ACCOUNT_ID;
}

export function listEnabledKookAccounts(cfg: OpenClawConfig): ResolvedKookAccount[] {
  return listKookAccountIds(cfg)
    .map((accountId) => resolveKookAccount({ cfg, accountId }))
    .filter((account) => account.enabled && account.configured);
}
