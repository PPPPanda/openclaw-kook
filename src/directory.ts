import type { OpenClawConfig } from "openclaw/plugin-sdk";
import type { KookConfig } from "./types.js";
import { createKookClient } from "./client.js";

type DirectoryPeer = {
  id: string;
  name: string;
  displayName?: string;
};

type DirectoryGroup = {
  id: string;
  name: string;
  memberCount?: number;
};

/**
 * List guild members as directory peers.
 */
export async function listKookDirectoryPeers(params: {
  cfg: OpenClawConfig;
  query?: string;
  limit?: number;
}): Promise<DirectoryPeer[]> {
  const { cfg, query, limit } = params;
  const kookCfg = cfg.channels?.kook as KookConfig | undefined;
  if (!kookCfg?.token) return [];

  try {
    const client = createKookClient(kookCfg);
    const guildsResult = await client.listGuilds();
    const guilds = guildsResult.items ?? [];

    const peers: DirectoryPeer[] = [];
    const seen = new Set<string>();
    const maxPerGuild = 50;

    for (const guild of guilds) {
      if (limit && limit > 0 && peers.length >= limit) break;

      try {
        const membersResult = await client.listGuildMembers(guild.id, { pageSize: maxPerGuild });
        for (const member of membersResult.items ?? []) {
          if (seen.has(member.id)) continue;
          if (member.bot) continue;

          const name = member.nickname || member.username;
          if (query) {
            const q = query.toLowerCase();
            if (!name.toLowerCase().includes(q) && !member.id.includes(q)) continue;
          }

          seen.add(member.id);
          peers.push({
            id: member.id,
            name: member.username,
            displayName: member.nickname || undefined,
          });

          if (limit && limit > 0 && peers.length >= limit) break;
        }
      } catch {
        // Skip guild on error
      }
    }

    return peers;
  } catch {
    return [];
  }
}

/**
 * List guilds (servers) as directory groups.
 */
export async function listKookDirectoryGroups(params: {
  cfg: OpenClawConfig;
  query?: string;
  limit?: number;
}): Promise<DirectoryGroup[]> {
  const { cfg, query, limit } = params;
  const kookCfg = cfg.channels?.kook as KookConfig | undefined;
  if (!kookCfg?.token) return [];

  try {
    const client = createKookClient(kookCfg);
    const result = await client.listGuilds();
    let guilds = result.items ?? [];

    if (query) {
      const q = query.toLowerCase();
      guilds = guilds.filter((g) => g.name.toLowerCase().includes(q));
    }

    if (limit && limit > 0) {
      guilds = guilds.slice(0, limit);
    }

    return guilds.map((g) => ({
      id: g.id,
      name: g.name,
    }));
  } catch {
    return [];
  }
}

/**
 * Live peer lookup (not cached).
 */
export async function listKookDirectoryPeersLive(params: {
  cfg: OpenClawConfig;
  query?: string;
  limit?: number;
}): Promise<DirectoryPeer[]> {
  return listKookDirectoryPeers(params);
}

/**
 * Live group lookup (not cached).
 */
export async function listKookDirectoryGroupsLive(params: {
  cfg: OpenClawConfig;
  query?: string;
  limit?: number;
}): Promise<DirectoryGroup[]> {
  return listKookDirectoryGroups(params);
}
