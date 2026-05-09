import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  IoCopyOutline,
  IoCreateOutline,
  IoEyeOutline,
  IoSaveOutline,
  IoStopCircleOutline,
  IoSwapHorizontalOutline,
  IoVolumeHigh,
} from "react-icons/io5";

import { type Message } from "../modelConfig";

export type EditingReplyDraft = {
  messageKey: string;
  content: string;
  ttsText: string;
};

type ChatMessageBubbleProps = {
  message: Message;
  messageKey: string;
  messageIndex: number;
  modelLabel: string;
  ttsReady: boolean;
  isSpeaking: boolean;
  isOriginalExpanded: boolean;
  isCopied: boolean;
  editingReply: EditingReplyDraft | null;
  onCopy: (content: string, messageKey: string) => void;
  onToggleOriginal: (messageKey: string) => void;
  onStartEdit: (message: Message, messageKey: string) => void;
  onEditChange: (draft: EditingReplyDraft) => void;
  onCancelEdit: () => void;
  onSaveEdit: (messageIndex: number) => void;
  onSpeak: (message: Message, messageKey: string) => void;
};

type AiHtmlCardView = "simple" | "full";

type AiHtmlCardSpec = {
  title: string;
  simpleHtml: string;
  fullHtml: string;
  css: string;
  simpleWidth: number;
  fullWidth: number;
  simpleHeight: number;
  fullHeight: number;
};

type ChatContentSegment =
  | {
      kind: "text";
      text: string;
    }
  | {
      kind: "card";
      card: AiHtmlCardSpec;
    };

const AI_CARD_PATTERN = /<ai_card>([\s\S]*?)<\/ai_card>/gi;
const MAX_CARD_HTML_CHARS = 24_000;
const MAX_CARD_CSS_CHARS = 12_000;
const DEFAULT_SIMPLE_CARD_HEIGHT = 210;
const DEFAULT_FULL_CARD_HEIGHT = 390;
const MIN_CARD_HEIGHT = 80;
const MAX_CARD_HEIGHT = 1_600;
const DEFAULT_SIMPLE_CARD_WIDTH = 520;
const DEFAULT_FULL_CARD_WIDTH = 900;
const MIN_CARD_WIDTH = 220;
const MAX_CARD_WIDTH = 1040;

export function ChatMessageBubble({
  message,
  messageKey,
  messageIndex,
  modelLabel,
  ttsReady,
  isSpeaking,
  isOriginalExpanded,
  isCopied,
  editingReply,
  onCopy,
  onToggleOriginal,
  onStartEdit,
  onEditChange,
  onCancelEdit,
  onSaveEdit,
  onSpeak,
}: ChatMessageBubbleProps) {
  const isAiReply = message.role === "ai";
  const isEditing = editingReply?.messageKey === messageKey;
  const contentSegments = useMemo(
    () =>
      isAiReply
        ? parseChatContentSegments(message.content)
        : [
            {
              kind: "text" as const,
              text: message.content,
            },
          ],
    [isAiReply, message.content]
  );
  const hasCards = contentSegments.some((segment) => segment.kind === "card");
  const [cardView, setCardView] = useState<AiHtmlCardView>("simple");
  const isFullCardView = cardView === "full";
  const lineClassName = [
    "chat-line",
    message.role === "user" ? "chat-user" : "chat-ai",
    hasCards ? "chat-line--with-card" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const bubbleClassName = [
    "chat-bubble",
    isEditing ? "is-editing" : "",
    hasCards ? "chat-bubble--with-card" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={lineClassName}>
      <div className={bubbleClassName}>
        {isAiReply && (
          <div className="chat-bubble__topline">
            <span className="chat-role">{modelLabel}</span>

            <div className="chat-message-actions">
              <button
                type="button"
                className="chat-message-action"
                title={isCopied ? "已复制" : "复制回复"}
                aria-label="复制回复"
                onClick={() => onCopy(message.content, messageKey)}
              >
                <IoCopyOutline size={16} />
              </button>
              <button
                type="button"
                className="chat-message-action"
                title="显示原文"
                aria-label="显示原文"
                onClick={() => onToggleOriginal(messageKey)}
              >
                <IoEyeOutline size={16} />
              </button>
              <button
                type="button"
                className="chat-message-action"
                title="编辑回复"
                aria-label="编辑回复"
                onClick={() => onStartEdit(message, messageKey)}
              >
                <IoCreateOutline size={16} />
              </button>
              <button
                type="button"
                className="chat-message-action"
                title={isSpeaking ? "停止朗读" : "朗读回复"}
                aria-label={isSpeaking ? "停止朗读" : "朗读回复"}
                disabled={!ttsReady && !isSpeaking}
                onClick={() => onSpeak(message, messageKey)}
              >
                {isSpeaking ? <IoStopCircleOutline size={17} /> : <IoVolumeHigh size={17} />}
              </button>
              {hasCards && !isEditing && (
                <button
                  type="button"
                  className={`chat-message-action ${isFullCardView ? "is-active" : ""}`}
                  title={isFullCardView ? "切换到简版卡片" : "切换到完整卡片"}
                  aria-label={isFullCardView ? "切换到简版卡片" : "切换到完整卡片"}
                  aria-pressed={isFullCardView}
                  onClick={() => setCardView(isFullCardView ? "simple" : "full")}
                >
                  <IoSwapHorizontalOutline size={16} />
                </button>
              )}
            </div>
          </div>
        )}

        {isEditing && editingReply ? (
          <div className="reply-editor">
            <label htmlFor={`${messageKey}-content`}>显示文本</label>
            <textarea
              id={`${messageKey}-content`}
              className="reply-editor__textarea"
              value={editingReply.content}
              onChange={(event) =>
                onEditChange({ ...editingReply, content: event.target.value })
              }
            />

            <label htmlFor={`${messageKey}-tts`}>朗读文本</label>
            <textarea
              id={`${messageKey}-tts`}
              className="reply-editor__textarea"
              value={editingReply.ttsText}
              placeholder="可添加 (温柔 平静)、[轻笑]、[停顿] 等标签；留空时朗读显示文本。"
              onChange={(event) =>
                onEditChange({ ...editingReply, ttsText: event.target.value })
              }
            />

            <div className="reply-editor__actions">
              <button type="button" className="ghost-button" onClick={onCancelEdit}>
                取消
              </button>
              <button
                type="button"
                className="primary-button"
                onClick={() => onSaveEdit(messageIndex)}
              >
                <IoSaveOutline size={16} />
                保存
              </button>
            </div>
          </div>
        ) : (
          <>
            {contentSegments.map((segment, index) =>
              segment.kind === "card" ? (
                <AiHtmlCard
                  key={`${messageKey}-card-${index}`}
                  card={segment.card}
                  view={cardView}
                />
              ) : (
                segment.text.trim() && (
                  <p className="chat-message-text" key={`${messageKey}-text-${index}`}>
                    {segment.text.trim()}
                  </p>
                )
              )
            )}
            {message.attachments && message.attachments.length > 0 && (
              <div className="message-attachment-grid">
                {message.attachments.map((attachment) => (
                  <a
                    key={attachment.id}
                    className="message-image-link"
                    href={attachment.data_url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <img src={attachment.data_url} alt={attachment.name} />
                  </a>
                ))}
              </div>
            )}
          </>
        )}

        {isAiReply && isOriginalExpanded && (
          <div className="original-reply-panel">
            <span>原文</span>
            <p>{message.original_content ?? message.content}</p>
          </div>
        )}
      </div>
    </div>
  );
}

function AiHtmlCard({ card, view }: { card: AiHtmlCardSpec; view: AiHtmlCardView }) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const isSimple = view === "simple";
  const fallbackFrameSize = useMemo(
    () => ({
      width: isSimple ? card.simpleWidth : card.fullWidth,
      height: isSimple ? card.simpleHeight : card.fullHeight,
    }),
    [card.fullHeight, card.fullWidth, card.simpleHeight, card.simpleWidth, isSimple]
  );
  const [frameSize, setFrameSize] = useState<{
    width: number;
    height: number;
  }>({
    width: fallbackFrameSize.width,
    height: fallbackFrameSize.height,
  });
  const srcDoc = useMemo(() => buildCardSrcDoc(card, view), [card, view]);
  const measureFrame = useCallback(() => {
    const iframe = iframeRef.current;
    const doc = iframe?.contentDocument;

    if (!iframe || !doc) {
      return;
    }

    const root = doc.querySelector<HTMLElement>(".ai-card-root");

    if (!root) {
      return;
    }

    const { width, height } = measureCardContent(root);

    const nextFrameSize = {
      width: clampCardWidth(width || null, fallbackFrameSize.width),
      height: clampCardHeight(height || null, fallbackFrameSize.height),
    };

    setFrameSize((current) => {
      if (current.width === nextFrameSize.width && current.height === nextFrameSize.height) {
        return current;
      }

      return nextFrameSize;
    });
  }, [fallbackFrameSize.height, fallbackFrameSize.width]);

  useEffect(() => {
    setFrameSize({
      width: fallbackFrameSize.width,
      height: fallbackFrameSize.height,
    });
  }, [fallbackFrameSize.height, fallbackFrameSize.width, srcDoc]);

  useEffect(() => {
    if (frameSize.width) {
      window.setTimeout(measureFrame, 0);
    }
  }, [frameSize.width, measureFrame]);

  return (
    <div
      className={`ai-html-card ai-html-card--${view}`}
      style={{
        width: `${frameSize.width}px`,
      }}
    >
      <iframe
        key={view}
        ref={iframeRef}
        className="ai-html-card__frame"
        title={card.title || "AI 卡片"}
        sandbox="allow-same-origin"
        srcDoc={srcDoc}
        onLoad={measureFrame}
        style={{
          height: frameSize.height,
        }}
      />
    </div>
  );
}

function parseChatContentSegments(content: string): ChatContentSegment[] {
  if (!content.trim()) {
    return [];
  }

  const segments: ChatContentSegment[] = [];
  const matcher = new RegExp(AI_CARD_PATTERN);
  let cursor = 0;
  let cardIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = matcher.exec(content)) !== null) {
    if (match.index > cursor) {
      segments.push({
        kind: "text",
        text: content.slice(cursor, match.index),
      });
    }

    const card = parseAiHtmlCard(match[1], cardIndex);
    segments.push(
      card
        ? {
            kind: "card",
            card,
          }
        : {
            kind: "text",
            text: match[0],
          }
    );

    cursor = match.index + match[0].length;
    cardIndex += 1;
  }

  if (cursor < content.length) {
    segments.push({
      kind: "text",
      text: content.slice(cursor),
    });
  }

  return segments.length
    ? segments
    : [
        {
          kind: "text",
          text: content,
        },
      ];
}

function parseAiHtmlCard(rawCard: string, index: number): AiHtmlCardSpec | null {
  const jsonText = stripOptionalJsonFence(rawCard.trim());

  try {
    const parsed = JSON.parse(jsonText) as Record<string, unknown>;
    const simpleHtml = pickString(parsed, ["simple_html", "simpleHtml", "simple"]);
    const fullHtml = pickString(parsed, ["full_html", "fullHtml", "full"]);
    const title = pickString(parsed, ["title", "name"]) || `AI 卡片 ${index + 1}`;

    return createAiHtmlCardSpec({
      title,
      simpleHtml,
      fullHtml,
      css: pickString(parsed, ["css", "style", "styles"]),
      simpleWidth: clampCardWidth(
        pickNumber(parsed, ["simple_width", "simpleWidth"]),
        inferCardWidth(simpleHtml || fullHtml, DEFAULT_SIMPLE_CARD_WIDTH)
      ),
      fullWidth: clampCardWidth(
        pickNumber(parsed, ["full_width", "fullWidth"]),
        inferCardWidth(fullHtml || simpleHtml, DEFAULT_FULL_CARD_WIDTH)
      ),
      simpleHeight: clampCardHeight(
        pickNumber(parsed, ["simple_height", "simpleHeight"]),
        inferCardHeight(simpleHtml || fullHtml, DEFAULT_SIMPLE_CARD_HEIGHT)
      ),
      fullHeight: clampCardHeight(
        pickNumber(parsed, ["full_height", "fullHeight"]),
        inferCardHeight(fullHtml || simpleHtml, DEFAULT_FULL_CARD_HEIGHT)
      ),
    });
  } catch {
    return parseTaggedAiHtmlCard(rawCard, index);
  }
}

function parseTaggedAiHtmlCard(rawCard: string, index: number): AiHtmlCardSpec | null {
  const simpleHeight = parseOptionalNumber(
    extractInnerTag(rawCard, "simple_height") || extractInnerTag(rawCard, "simpleHeight")
  );
  const fullHeight = parseOptionalNumber(
    extractInnerTag(rawCard, "full_height") || extractInnerTag(rawCard, "fullHeight")
  );
  const simpleWidth = parseOptionalNumber(
    extractInnerTag(rawCard, "simple_width") || extractInnerTag(rawCard, "simpleWidth")
  );
  const fullWidth = parseOptionalNumber(
    extractInnerTag(rawCard, "full_width") || extractInnerTag(rawCard, "fullWidth")
  );
  const simpleHtml =
    extractInnerTag(rawCard, "simple_html") ||
    extractInnerTag(rawCard, "simpleHtml") ||
    extractInnerTag(rawCard, "simple");
  const fullHtml =
    extractInnerTag(rawCard, "full_html") ||
    extractInnerTag(rawCard, "fullHtml") ||
    extractInnerTag(rawCard, "full");

  return createAiHtmlCardSpec({
    title: extractInnerTag(rawCard, "title") || `AI 卡片 ${index + 1}`,
    simpleHtml,
    fullHtml,
    css:
      extractInnerTag(rawCard, "css") ||
      extractInnerTag(rawCard, "style") ||
      extractInnerTag(rawCard, "styles"),
    simpleWidth: clampCardWidth(
      simpleWidth,
      inferCardWidth(simpleHtml || fullHtml, DEFAULT_SIMPLE_CARD_WIDTH)
    ),
    fullWidth: clampCardWidth(
      fullWidth,
      inferCardWidth(fullHtml || simpleHtml, DEFAULT_FULL_CARD_WIDTH)
    ),
    simpleHeight: clampCardHeight(
      simpleHeight,
      inferCardHeight(simpleHtml || fullHtml, DEFAULT_SIMPLE_CARD_HEIGHT)
    ),
    fullHeight: clampCardHeight(
      fullHeight,
      inferCardHeight(fullHtml || simpleHtml, DEFAULT_FULL_CARD_HEIGHT)
    ),
  });
}

function createAiHtmlCardSpec({
  title,
  simpleHtml,
  fullHtml,
  css,
  simpleWidth,
  fullWidth,
  simpleHeight,
  fullHeight,
}: {
  title: string;
  simpleHtml: string;
  fullHtml: string;
  css: string;
  simpleWidth: number;
  fullWidth: number;
  simpleHeight: number;
  fullHeight: number;
}): AiHtmlCardSpec | null {
  if (!simpleHtml && !fullHtml) {
    return null;
  }

  return {
    title: truncateText(title, 60),
    simpleHtml: sanitizeCardHtml(truncateText(simpleHtml || fullHtml, MAX_CARD_HTML_CHARS)),
    fullHtml: sanitizeCardHtml(truncateText(fullHtml || simpleHtml, MAX_CARD_HTML_CHARS)),
    css: sanitizeCardCss(truncateText(css, MAX_CARD_CSS_CHARS)),
    simpleWidth,
    fullWidth,
    simpleHeight,
    fullHeight,
  };
}

function buildCardSrcDoc(card: AiHtmlCardSpec, view: AiHtmlCardView): string {
  const html = view === "simple" ? card.simpleHtml : card.fullHtml;

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: https: http:; style-src 'unsafe-inline'; font-src data:;" />
<style>
*{box-sizing:border-box}
html,body{margin:0;background:transparent;color:#102033;font-family:Inter,Arial,"Microsoft YaHei",sans-serif}
body{display:block;min-width:0;padding:0;overflow:hidden}
.ai-card-root{display:block;width:max-content;max-width:none;min-width:0;padding:0}
.ai-card-root img{max-width:100%;height:auto}
.ai-card-root a{color:inherit}
${card.css}
</style>
</head>
<body>
<main class="ai-card-root">${html}</main>
</body>
</html>`;
}

function measureCardContent(root: HTMLElement): { width: number; height: number } {
  const rootRect = root.getBoundingClientRect();
  let width = Math.max(rootRect.width, root.scrollWidth, root.offsetWidth);
  let height = Math.max(rootRect.height, root.scrollHeight, root.offsetHeight);
  const pendingNodes = Array.from(root.children);

  while (pendingNodes.length > 0) {
    const node = pendingNodes.shift();

    if (!(node instanceof HTMLElement)) {
      continue;
    }

    pendingNodes.push(...Array.from(node.children));

    const childRect = node.getBoundingClientRect();
    const style = node.ownerDocument.defaultView?.getComputedStyle(node);
    const marginRight = Number.parseFloat(style?.marginRight ?? "0") || 0;
    const marginBottom = Number.parseFloat(style?.marginBottom ?? "0") || 0;

    width = Math.max(
      width,
      childRect.width + marginRight,
      node.scrollWidth + marginRight,
      node.offsetWidth + marginRight
    );
    height = Math.max(
      height,
      childRect.height + marginBottom,
      node.scrollHeight + marginBottom,
      node.offsetHeight + marginBottom
    );
  }

  return {
    width,
    height,
  };
}

function stripOptionalJsonFence(value: string): string {
  const trimmed = value.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1].trim() : trimmed;
}

function pickString(value: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const current = value[key];
    if (typeof current === "string") {
      return current.trim();
    }
  }

  return "";
}

function pickNumber(value: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const current = value[key];
    if (typeof current === "number" && Number.isFinite(current)) {
      return current;
    }

    if (typeof current === "string" && current.trim()) {
      const parsed = Number(current);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }

  return null;
}

function extractInnerTag(value: string, tag: string): string {
  const matcher = new RegExp(`<${tag}>\\s*([\\s\\S]*?)\\s*<\\/${tag}>`, "i");
  return matcher.exec(value)?.[1]?.trim() ?? "";
}

function parseOptionalNumber(value: string): number | null {
  if (!value.trim()) {
    return null;
  }

  const parsed = Number(value.trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function clampCardHeight(value: number | null, fallback: number): number {
  if (!Number.isFinite(value ?? NaN)) {
    return fallback;
  }

  return Math.min(Math.max(Math.ceil(value!), MIN_CARD_HEIGHT), MAX_CARD_HEIGHT);
}

function clampCardWidth(value: number | null, fallback: number): number {
  if (!Number.isFinite(value ?? NaN)) {
    return fallback;
  }

  return Math.min(Math.max(Math.ceil(value!), MIN_CARD_WIDTH), MAX_CARD_WIDTH);
}

function inferCardWidth(html: string, fallback: number): number {
  const textLength = stripHtmlTags(html).length;

  if (textLength > 900 || html.includes("<table")) {
    return Math.max(fallback, 980);
  }

  if (textLength > 520 || html.includes("<dl") || html.includes("<ul")) {
    return Math.max(fallback, 840);
  }

  if (textLength > 220) {
    return Math.max(fallback, 680);
  }

  return fallback;
}

function inferCardHeight(html: string, fallback: number): number {
  const textLength = stripHtmlTags(html).length;

  if (textLength > 1_000 || html.includes("<table")) {
    return Math.max(fallback, 560);
  }

  if (textLength > 620 || html.includes("<dl") || html.includes("<ul")) {
    return Math.max(fallback, 460);
  }

  if (textLength > 300) {
    return Math.max(fallback, 320);
  }

  return fallback;
}

function stripHtmlTags(value: string): string {
  return value.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
}

function truncateText(value: string, maxLength: number): string {
  return value.length > maxLength ? value.slice(0, maxLength) : value;
}

function sanitizeCardHtml(value: string): string {
  return value
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, "")
    .replace(/\son\w+\s*=\s*"[^"]*"/gi, "")
    .replace(/\son\w+\s*=\s*'[^']*'/gi, "")
    .replace(/\son\w+\s*=\s*[^\s>]+/gi, "");
}

function sanitizeCardCss(value: string): string {
  return value
    .replace(/<\/style/gi, "<\\/style")
    .replace(/@import\s+[^;]+;/gi, "")
    .replace(/javascript:/gi, "");
}
