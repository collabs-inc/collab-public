import { createInlineContentSpec } from "@blocknote/core";

function createWikiLinkElement(target: string): HTMLSpanElement {
  const element = document.createElement("span");
  element.className = "wiki-link";
  element.dataset.target = target;
  element.contentEditable = "false";
  element.setAttribute("role", "link");
  element.tabIndex = 0;
  element.textContent = target;
  return element;
}

async function activateWikiLink(target: string): Promise<void> {
  const resolved = await window.api.resolveWikilink(target);
  if (resolved) {
    window.api.selectFile(resolved);
    return;
  }

  const config = await window.api.getConfig();
  const wsPath =
    config.workspaces?.[0];
  if (!wsPath) return;

  const newPath = `${wsPath}/${target}.md`;
  try {
    await window.api.writeFile(
      newPath,
      `---\ntype: note\n---\n`,
    );
    window.api.selectFile(newPath);
  } catch (err) {
    console.error("Failed to create file for dead link:", err);
  }
}

export const WikiLink = createInlineContentSpec(
  {
    type: "wikiLink" as const,
    propSchema: {
      target: { default: "" },
    },
    content: "none",
  },
  {
    render(inlineContent) {
      const target = inlineContent.props.target;
      const dom = createWikiLinkElement(target);
      let disposed = false;

      const syncDeadState = async () => {
        try {
          const resolved = await window.api.resolveWikilink(target);
          if (!disposed) {
            dom.classList.toggle("dead", resolved === null);
          }
        } catch {
          if (!disposed) {
            dom.classList.add("dead");
          }
        }
      };

      const onClick = (event: MouseEvent) => {
        event.preventDefault();
        event.stopPropagation();
        void activateWikiLink(target);
      };

      const onKeyDown = (event: KeyboardEvent) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        event.stopPropagation();
        void activateWikiLink(target);
      };

      dom.addEventListener("click", onClick);
      dom.addEventListener("keydown", onKeyDown);
      void syncDeadState();

      return {
        dom,
        destroy() {
          disposed = true;
          dom.removeEventListener("click", onClick);
          dom.removeEventListener("keydown", onKeyDown);
        },
      };
    },
    toExternalHTML(inlineContent) {
      const target = inlineContent.props.target;
      const dom = document.createElement("span");
      dom.dataset.wikiLink = target;
      dom.textContent = `[[${target}]]`;
      return { dom };
    },
  },
);

// Brackets are not escaped by BlockNote's markdown serializer because
// toExternalHTML wraps them in a <span>, and HTML content passes through
// the markdown converter without re-escaping.
const WIKILINK_RE = /\[\[([^\]]+)\]\]/g;

interface InlineItem {
  type: string;
  text?: string;
  props?: Record<string, string>;
  styles?: Record<string, boolean>;
  content?: InlineItem[];
}

interface BlockItem {
  type?: string;
  content?: InlineItem[];
  children?: BlockItem[];
}

function processInlineContent(
  content: InlineItem[],
): InlineItem[] {
  const result: InlineItem[] = [];

  for (const item of content) {
    if (item.type !== "text" || !item.text) {
      result.push(item);
      continue;
    }

    const text = item.text;
    let lastIndex = 0;
    WIKILINK_RE.lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = WIKILINK_RE.exec(text)) !== null) {
      if (match.index > lastIndex) {
        const textItem: InlineItem = {
          type: "text",
          text: text.slice(lastIndex, match.index),
        };
        if (item.styles) {
          textItem.styles = item.styles;
        }
        result.push(textItem);
      }

      const target = match[1]?.trim();
      if (!target) {
        lastIndex = match.index + match[0].length;
        continue;
      }

      result.push({
        type: "wikiLink",
        props: { target },
      });

      lastIndex = match.index + match[0].length;
    }

    if (lastIndex === 0) {
      result.push(item);
    } else if (lastIndex < text.length) {
      const textItem: InlineItem = {
        type: "text",
        text: text.slice(lastIndex),
      };
      if (item.styles) {
        textItem.styles = item.styles;
      }
      result.push(textItem);
    }
  }

  return result;
}

export function insertWikilinksIntoBlocks(
  blocks: BlockItem[],
): BlockItem[] {
  return blocks.map((block) => {
    const updated = { ...block };

    if (
      Array.isArray(updated.content) &&
      updated.content.length > 0
    ) {
      updated.content = processInlineContent(updated.content);
    }

    if (
      Array.isArray(updated.children) &&
      updated.children.length > 0
    ) {
      updated.children = insertWikilinksIntoBlocks(
        updated.children,
      );
    }

    return updated;
  });
}
