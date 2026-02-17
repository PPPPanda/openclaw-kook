/**
 * KOOK Card message builder.
 *
 * Card messages support rich content: sections, images, dividers, buttons, etc.
 * Limits: max 5 cards, each max 50 modules.
 *
 * Card JSON structure:
 * [{ type: "card", theme, size, modules: [...] }]
 */

export type KookCardTheme = "primary" | "success" | "danger" | "warning" | "info" | "secondary" | "none";
export type KookCardSize = "sm" | "lg";

export type KookCardModule =
  | { type: "header"; text: { type: "plain-text"; content: string } }
  | { type: "section"; text: { type: "kmarkdown" | "plain-text"; content: string }; accessory?: unknown; mode?: string }
  | { type: "divider" }
  | { type: "context"; elements: Array<{ type: "kmarkdown" | "plain-text"; content: string }> }
  | { type: "image-group"; elements: Array<{ type: "image"; src: string; alt?: string }> }
  | { type: "container"; elements: Array<{ type: "image"; src: string; alt?: string }> }
  | { type: "action-group"; elements: unknown[] }
  | { type: "file"; title: string; src: string; size?: number }
  | { type: "audio"; title: string; src: string; cover?: string }
  | { type: "video"; title: string; src: string }
  | { type: "countdown"; mode: "second" | "hour" | "day"; endTime: number; startTime?: number };

export type KookCard = {
  type: "card";
  theme?: KookCardTheme;
  size?: KookCardSize;
  color?: string;
  modules: KookCardModule[];
};

/**
 * Build a simple markdown card.
 */
export function buildMarkdownCard(text: string, opts?: { theme?: KookCardTheme }): KookCard[] {
  return [{
    type: "card",
    theme: opts?.theme ?? "secondary",
    size: "lg",
    modules: [{
      type: "section",
      text: {
        type: "kmarkdown",
        content: text,
      },
    }],
  }];
}

/**
 * Build a card with code block content.
 */
export function buildCodeCard(code: string, lang?: string): KookCard[] {
  return [{
    type: "card",
    theme: "secondary",
    size: "lg",
    modules: [{
      type: "section",
      text: {
        type: "kmarkdown",
        content: `\`\`\`${lang ?? ""}\n${code}\n\`\`\``,
      },
    }],
  }];
}

/**
 * Build a card with multiple sections separated by dividers.
 */
export function buildMultiSectionCard(sections: string[]): KookCard[] {
  const modules: KookCardModule[] = [];

  for (let i = 0; i < sections.length && modules.length < 50; i++) {
    modules.push({
      type: "section",
      text: { type: "kmarkdown", content: sections[i] },
    });
    if (i < sections.length - 1) {
      modules.push({ type: "divider" });
    }
  }

  return [{
    type: "card",
    theme: "secondary",
    size: "lg",
    modules,
  }];
}

/**
 * Serialize Card array to JSON string for KOOK message content.
 */
export function serializeCards(cards: KookCard[]): string {
  return JSON.stringify(cards);
}
