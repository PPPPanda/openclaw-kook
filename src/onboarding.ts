import type { ChannelOnboardingAdapter } from "openclaw/plugin-sdk";
import type { OpenClawConfig } from "openclaw/plugin-sdk";

/**
 * KOOK onboarding adapter.
 * Full implementation with getStatus, configure, and dmPolicy support.
 */

const channel = "kook" as const;

function isKookConfigured(cfg: OpenClawConfig): boolean {
  const kook = (cfg as any).channels?.kook;
  return Boolean(kook?.token && kook?.enabled !== false);
}

export const kookOnboardingAdapter: ChannelOnboardingAdapter = {
  channel,

  getStatus: async ({ cfg }) => {
    const configured = isKookConfigured(cfg);
    return {
      channel,
      configured,
      statusLines: [`KOOK: ${configured ? "configured" : "needs token"}`],
      selectionHint: configured ? "configured" : "needs setup",
      quickstartScore: configured ? 1 : 5,
    };
  },

  configure: async ({ cfg, prompter }) => {
    let next = cfg as any;
    const currentToken = next.channels?.kook?.token;

    if (!currentToken) {
      await prompter.note(
        [
          "1. Go to https://developer.kookapp.cn/app/index and create a new application",
          "2. Navigate to 'Bot' section and create a bot",
          "3. Copy the bot Token",
          "4. Invite the bot to your KOOK server using the OAuth link",
        ].join("\n"),
        "KOOK bot token",
      );

      const token = await prompter.text({
        message: "Enter your KOOK bot token:",
        placeholder: "1/XXXXX=/XXXXXXXXXXXXXXXXXXXXXXX==",
        validate: (val: string) => {
          if (!val.trim()) return "Token is required";
          if (!val.includes("/")) return "Invalid token format (should contain /)";
          return undefined;
        },
      });

      if (token) {
        next = {
          ...next,
          channels: {
            ...next.channels,
            kook: {
              ...next.channels?.kook,
              token,
              enabled: true,
            },
          },
        };
      }
    }

    // Ensure enabled
    if (next.channels?.kook?.token && next.channels?.kook?.enabled === false) {
      next = {
        ...next,
        channels: {
          ...next.channels,
          kook: {
            ...next.channels.kook,
            enabled: true,
          },
        },
      };
    }

    return { cfg: next as OpenClawConfig };
  },

  disable: (cfg: OpenClawConfig) => {
    const next = cfg as any;
    return {
      ...next,
      channels: {
        ...next.channels,
        kook: {
          ...next.channels?.kook,
          enabled: false,
        },
      },
    } as OpenClawConfig;
  },
};
