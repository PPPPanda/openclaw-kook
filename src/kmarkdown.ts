/**
 * Markdown → KMarkdown conversion.
 *
 * KMarkdown is largely compatible with standard Markdown:
 * - **bold**, *italic*, ~~strikethrough~~, `code`, ```code block```, > quote, --- all work natively
 * - [text](url) links work natively
 *
 * Differences:
 * - No HTML tags support → strip them
 * - No native table support → convert to code block
 * - <u>underline</u> → (ins)underline(ins)
 * - Images ![alt](url) → link fallback in KMarkdown (images need Card messages)
 * - Nested lists → flatten (KMarkdown supports basic lists but not deep nesting)
 *
 * Special KMarkdown syntax:
 * - (met)userId(met) — @mention user
 * - (met)all(met) — @everyone
 * - (met)here(met) — @online users
 * - (chn)channelId(chn) — channel reference
 * - (rol)roleId(rol) — role reference
 * - (emj)name(emj)[id] — custom emoji
 * - (ins)text(ins) — underline
 * - (spl)text(spl) — spoiler
 */

import type { KookConfig } from "./types.js";

/**
 * Convert standard Markdown to KMarkdown.
 * Most syntax passes through unchanged; we only handle incompatible elements.
 */
export function markdownToKMarkdown(text: string): string {
  let result = text;

  // Convert HTML underline to KMarkdown underline
  result = result.replace(/<u>([\s\S]*?)<\/u>/gi, "(ins)$1(ins)");
  result = result.replace(/<ins>([\s\S]*?)<\/ins>/gi, "(ins)$1(ins)");

  // Convert HTML spoiler
  result = result.replace(/<spoiler>([\s\S]*?)<\/spoiler>/gi, "(spl)$1(spl)");

  // Strip remaining HTML tags (KMarkdown doesn't support them)
  result = result.replace(/<br\s*\/?>/gi, "\n");
  result = result.replace(/<\/?[^>]+(>|$)/g, "");

  // Convert inline images to links (images need Card messages for proper rendering)
  // ![alt](url) → [alt](url) or just [🖼 image](url)
  result = result.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_, alt, url) => {
    const label = alt || "🖼 image";
    return `[${label}](${url})`;
  });

  // Convert tables to code blocks
  // Detect markdown table pattern: | ... | ... | with separator row
  result = convertTablesToCodeBlocks(result);

  return result;
}

/**
 * Convert markdown tables to code blocks since KMarkdown doesn't support tables.
 */
function convertTablesToCodeBlocks(text: string): string {
  // Match table blocks: lines starting with | that have at least header + separator
  const lines = text.split("\n");
  const result: string[] = [];
  let tableLines: string[] = [];
  let inTable = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const isTableLine = /^\|.+\|/.test(line.trim());
    const isSeparator = /^\|[-:| ]+\|/.test(line.trim());

    if (isTableLine || (inTable && isSeparator)) {
      if (!inTable) {
        inTable = true;
      }
      tableLines.push(line);
    } else {
      if (inTable && tableLines.length >= 2) {
        // Flush table as code block
        result.push("```");
        result.push(...tableLines);
        result.push("```");
      } else if (inTable) {
        // Not enough lines for a table, output as-is
        result.push(...tableLines);
      }
      tableLines = [];
      inTable = false;
      result.push(line);
    }
  }

  // Flush remaining table
  if (inTable && tableLines.length >= 2) {
    result.push("```");
    result.push(...tableLines);
    result.push("```");
  } else if (inTable) {
    result.push(...tableLines);
  }

  return result.join("\n");
}

/**
 * Strip KMarkdown mention/channel/emoji syntax to get plain text.
 */
export function stripKMarkdownSyntax(text: string): string {
  let result = text;
  // Strip mentions: (met)userId(met) → @userId
  result = result.replace(/\(met\)(.+?)\(met\)/g, "@$1");
  // Strip channel refs: (chn)channelId(chn) → #channelId
  result = result.replace(/\(chn\)(.+?)\(chn\)/g, "#$1");
  // Strip role refs: (rol)roleId(rol) → @roleId
  result = result.replace(/\(rol\)(.+?)\(rol\)/g, "@role:$1");
  // Strip custom emoji: (emj)name(emj)[id] → :name:
  result = result.replace(/\(emj\)(.+?)\(emj\)\[[^\]]*\]/g, ":$1:");
  // Strip underline: (ins)text(ins) → text
  result = result.replace(/\(ins\)([\s\S]*?)\(ins\)/g, "$1");
  // Strip spoiler: (spl)text(spl) → text
  result = result.replace(/\(spl\)([\s\S]*?)\(spl\)/g, "$1");
  return result;
}

/**
 * Extract plain text content from KMarkdown, stripping all formatting.
 */
export function kmarkdownToPlainText(text: string): string {
  let result = stripKMarkdownSyntax(text);
  // Strip markdown formatting
  result = result.replace(/\*\*(.+?)\*\*/g, "$1");  // bold
  result = result.replace(/\*(.+?)\*/g, "$1");       // italic
  result = result.replace(/~~(.+?)~~/g, "$1");       // strikethrough
  result = result.replace(/`([^`]+)`/g, "$1");       // inline code
  result = result.replace(/```[\s\S]*?```/g, "[code]"); // code block
  result = result.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1"); // links
  result = result.replace(/^>\s?/gm, "");            // quotes
  return result.trim();
}

/**
 * Render text for KOOK output, applying renderMode configuration.
 */
export function renderForKook(text: string, cfg?: KookConfig): string {
  const renderMode = cfg?.renderMode ?? "auto";

  if (renderMode === "card") {
    // Card rendering is handled in send.ts / card-builder.ts
    return text;
  }

  // Both "auto" and "kmarkdown" modes convert to KMarkdown
  return markdownToKMarkdown(text);
}

/**
 * Parse inbound KMarkdown content to extract plain text for agent consumption.
 * For type=9 (KMarkdown) messages, extra.kmarkdown.raw_content provides the plain text.
 */
export function parseInboundKMarkdown(
  content: string,
  rawContent?: string,
): string {
  // Prefer raw_content from extra.kmarkdown if available
  if (rawContent) return rawContent;
  // Otherwise strip KMarkdown syntax
  return stripKMarkdownSyntax(content);
}
