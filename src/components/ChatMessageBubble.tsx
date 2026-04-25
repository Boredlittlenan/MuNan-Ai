import {
  IoCopyOutline,
  IoCreateOutline,
  IoEyeOutline,
  IoSaveOutline,
  IoStopCircleOutline,
  IoVolumeHigh,
} from "react-icons/io5";

import { type Message, type ModelType, MODEL_META } from "../modelConfig";

export type EditingReplyDraft = {
  messageKey: string;
  content: string;
  ttsText: string;
};

type ChatMessageBubbleProps = {
  message: Message;
  messageKey: string;
  messageIndex: number;
  model: ModelType;
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

export function ChatMessageBubble({
  message,
  messageKey,
  messageIndex,
  model,
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

  return (
    <div className={`chat-line ${message.role === "user" ? "chat-user" : "chat-ai"}`}>
      <div className={`chat-bubble ${isEditing ? "is-editing" : ""}`}>
        <div className="chat-bubble__topline">
          <span className="chat-role">
            {message.role === "user" ? "你" : MODEL_META[model].label}
          </span>

          {isAiReply && (
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
            </div>
          )}
        </div>

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
          <p>{message.content}</p>
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
