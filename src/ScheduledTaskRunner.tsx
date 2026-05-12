import { useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";

import {
  AGENT_SCHEDULED_TASKS_CHANGED_EVENT,
  CONVERSATIONS_CHANGED_EVENT,
  type AgentScheduledTask,
  type AppConfig,
  type Conversation,
  type Message,
  type ModelType,
  getModelConfig,
  getModelMeta,
  getNextAgentScheduledTaskRun,
  isAgentSkillEnabled,
  isModelConfigured,
  loadAgentScheduledTasks,
  normalizeAppConfig,
  normalizeConversations,
  saveAgentScheduledTasks,
} from "./modelConfig";

type ChatReplyResponse = {
  content: string;
  tts_text: string;
  original_content: string;
};

type AgentShellResult = {
  command: string;
  cwd: string;
  exit_code: number | null;
  stdout: string;
  stderr: string;
  timed_out: boolean;
};

type AgentTavilySearchResult = {
  query: string;
  answer: string;
  results: Array<{
    title: string;
    url: string;
    content: string;
    score?: number | null;
  }>;
};

type AgentToolCall =
  | {
      kind: "shell";
      command: string;
    }
  | {
      kind: "tavily";
      query: string;
    };

const SCHEDULED_TASK_CONVERSATION_ID = "agent-scheduled-tasks";
const globalRunningTaskIds = new Set<string>();

function ScheduledTaskRunner() {
  const runningTaskIdsRef = useRef<Set<string>>(globalRunningTaskIds);

  useEffect(() => {
    let disposed = false;

    const tick = () => {
      if (!disposed) {
        void runDueScheduledTasks(runningTaskIdsRef.current);
      }
    };

    tick();
    const timer = window.setInterval(tick, 15_000);
    window.addEventListener(AGENT_SCHEDULED_TASKS_CHANGED_EVENT, tick);
    window.addEventListener("storage", tick);

    return () => {
      disposed = true;
      window.clearInterval(timer);
      window.removeEventListener(AGENT_SCHEDULED_TASKS_CHANGED_EVENT, tick);
      window.removeEventListener("storage", tick);
    };
  }, []);

  return null;
}

const runDueScheduledTasks = async (runningTaskIds: Set<string>) => {
  const dueTasks = loadAgentScheduledTasks()
    .filter(
      (task) =>
        task.enabled &&
        task.status === "pending" &&
        task.scheduled_at <= Date.now() &&
        !runningTaskIds.has(task.id)
    )
    .sort((left, right) => left.scheduled_at - right.scheduled_at);

  dueTasks.forEach((task) => runningTaskIds.add(task.id));

  for (const task of dueTasks) {
    try {
      await runScheduledTask(task);
    } finally {
      runningTaskIds.delete(task.id);
    }
  }
};

const runScheduledTask = async (task: AgentScheduledTask) => {
  const userMessage: Message = {
    role: "user",
    content: buildScheduledTaskUserPrompt(task),
  };

  try {
    const config = await loadRuntimeConfig();

    if (task.kind === "reminder") {
      await appendScheduledTaskMessages(task, config, [
        userMessage,
        {
          role: "ai",
          content: `计划任务提醒：${task.title}\n\n${task.prompt}`,
          tts_text: `(清晰 温柔)计划任务提醒：${task.title}。${task.prompt}`,
        },
      ]);
      markScheduledTaskResult(task.id, "done");
      return;
    }

    if (!isModelConfigured(config, task.model)) {
      throw new Error(`模型 ${getModelMeta(config, task.model).label} 还没有配置完整。`);
    }

    const reply = await invoke<ChatReplyResponse>("chat_with_ai", {
      model: task.model,
      messages: [toApiMessage(userMessage)],
      conversationId: SCHEDULED_TASK_CONVERSATION_ID,
    });
    const finalReply = await resolveScheduledTaskToolCalls(
      config,
      task,
      reply,
      userMessage
    );

    await appendScheduledTaskMessages(task, config, [
      userMessage,
      createScheduledTaskReplyMessage(finalReply),
    ]);
    markScheduledTaskResult(task.id, "done");
  } catch (taskError) {
    const errorText = String(taskError);
    const fallbackConfig = await loadRuntimeConfig().catch(() => null);

    if (fallbackConfig) {
      await appendScheduledTaskMessages(task, fallbackConfig, [
        userMessage,
        {
          role: "ai",
          content: `计划任务执行失败：${task.title}\n\n${errorText}`,
          tts_text: `(平静)计划任务执行失败：${task.title}。请检查设置。`,
        },
      ]).catch(() => undefined);
    }

    markScheduledTaskResult(task.id, "failed", errorText);
  }
};

const loadRuntimeConfig = async (): Promise<AppConfig> => {
  return normalizeAppConfig(await invoke<AppConfig>("load_app_config"));
};

const appendScheduledTaskMessages = async (
  task: AgentScheduledTask,
  config: AppConfig,
  messages: Message[]
) => {
  const now = Date.now();
  const conversations = normalizeConversations(
    await invoke<Record<ModelType, Conversation[]>>("load_conversations")
  );
  const modelConversations = conversations[task.model] ?? [];
  const existingConversation = modelConversations.find(
    (conversation) => conversation.id === SCHEDULED_TASK_CONVERSATION_ID
  );
  const providerModel = getModelConfig(config, task.model).model;
  const nextConversation: Conversation = existingConversation
    ? {
        ...existingConversation,
        provider_model: providerModel || existingConversation.provider_model,
        updated_at: now,
        messages: [...existingConversation.messages, ...messages],
      }
    : {
        id: SCHEDULED_TASK_CONVERSATION_ID,
        model: task.model,
        provider_model: providerModel,
        name: `${getModelMeta(config, task.model).label} 计划任务`,
        created_at: now,
        updated_at: now,
        messages,
      };

  await invoke("save_conversations", {
    conversations: {
      ...conversations,
      [task.model]: [
        nextConversation,
        ...modelConversations.filter(
          (conversation) => conversation.id !== SCHEDULED_TASK_CONVERSATION_ID
        ),
      ],
    },
  });
  window.dispatchEvent(new CustomEvent(CONVERSATIONS_CHANGED_EVENT));
};

const markScheduledTaskResult = (
  taskId: string,
  status: "done" | "failed",
  lastError = ""
) => {
  const now = Date.now();
  const nextTasks = loadAgentScheduledTasks().map((task) => {
    if (task.id !== taskId) {
      return task;
    }

    if (status === "done" && task.schedule_mode !== "once") {
      const nextRunAt = getNextAgentScheduledTaskRun(task, now);
      const nextStatus: AgentScheduledTask["status"] = nextRunAt ? "pending" : "done";

      return {
        ...task,
        enabled: Boolean(nextRunAt),
        status: nextStatus,
        scheduled_at: nextRunAt ?? task.scheduled_at,
        updated_at: now,
        last_run_at: now,
        last_error: undefined,
      };
    }

    return {
      ...task,
      enabled: false,
      status,
      updated_at: now,
      last_run_at: now,
      last_error: lastError || undefined,
    };
  });

  saveAgentScheduledTasks(nextTasks);
};

const resolveScheduledTaskToolCalls = async (
  config: AppConfig,
  task: AgentScheduledTask,
  reply: ChatReplyResponse,
  userMessage: Message
): Promise<ChatReplyResponse> => {
  const rawReply = reply.original_content || reply.content;
  const toolCalls = extractAgentToolCalls(rawReply);
  const maxToolCalls = Math.min(Math.max(Math.round(config.agent.max_steps || 1), 1), 30);
  const scheduledToolCalls = toolCalls.slice(0, maxToolCalls);
  const toolContexts: string[] = [];

  if (toolCalls.length === 0) {
    return reply;
  }

  if (!config.agent.enabled) {
    return {
      content: "计划任务执行时模型请求调用 Agent 工具，但 Agent 总开关没有开启。请到设置页开启 Agent 后再试。",
      tts_text: "(平静)计划任务请求调用工具，但 Agent 总开关还没有开启。",
      original_content: rawReply,
    };
  }

  for (const toolCall of scheduledToolCalls) {
    if (toolCall.kind === "tavily") {
      if (
        !isAgentSkillEnabled(config.agent, "search.tavily") ||
        !config.agent.tavily_api_key.trim()
      ) {
        toolContexts.push("Tavily 搜索工具未启用或 API Key 为空。");
        continue;
      }

      const result = await invoke<AgentTavilySearchResult>("agent_tavily_search", {
        request: {
          query: toolCall.query,
          max_results: config.agent.tavily_max_results,
        },
      });
      toolContexts.push(buildTavilyToolContext(toolCall.query, result));
      continue;
    }

    if (!isAgentSkillEnabled(config.agent, "system.shell")) {
      toolContexts.push("Shell 工具未启用。");
      continue;
    }

    if (config.agent.require_confirmation) {
      toolContexts.push("后台计划任务请求执行 Shell，但当前开启了高风险确认，后台不会弹窗执行命令。");
      continue;
    }

    const result = await invoke<AgentShellResult>("agent_run_shell", {
      request: {
        command: toolCall.command,
        cwd: "",
        confirmed: true,
      },
    });
    toolContexts.push(buildShellToolContext(toolCall.command, result));
  }

  if (toolContexts.length === 0) {
    return reply;
  }

  const summary = await invoke<ChatReplyResponse>("chat_with_ai", {
    model: task.model,
    messages: [
      toApiMessage(userMessage),
      {
        role: "assistant",
        content: rawReply,
      },
      {
        role: "user",
        content: `你刚刚在计划任务里请求了工具。请基于下面的真实工具结果，直接给用户最终回复。\n\n${toolContexts.join("\n\n---\n\n")}`,
      },
    ],
    conversationId: SCHEDULED_TASK_CONVERSATION_ID,
  });

  return {
    ...summary,
    original_content: `${summary.original_content || summary.content}\n\n${toolContexts.join("\n\n---\n\n")}`,
  };
};

const createScheduledTaskReplyMessage = (reply: ChatReplyResponse): Message => {
  const cleanedContent = stripScheduledTaskBlocks(stripAgentToolCalls(reply.content));

  return {
    role: "ai",
    content: cleanedContent || reply.content,
    tts_text: reply.tts_text,
    original_content: reply.original_content || reply.content,
  };
};

const toApiMessage = (message: Message) => ({
  role: message.role === "ai" ? "assistant" : "user",
  content: message.content,
});

const buildScheduledTaskUserPrompt = (task: AgentScheduledTask): string => {
  const action =
    task.kind === "reminder"
      ? "请提醒用户下面这件事。"
      : "请现在执行这个计划任务，并把结果整理成适合直接阅读的回复。";

  return `这是一个到点触发的 Agent 计划任务。\n任务名称：${task.title}\n计划时间：${formatFullDateTime(task.scheduled_at)}\n调度方式：${task.schedule_mode !== "once" ? formatScheduledTaskRecurrence(task) : "单次任务"}\n任务类型：${task.kind === "reminder" ? "提醒" : "AI 执行"}\n\n${action}\n\n任务内容：\n${task.prompt}`;
};

const formatScheduledTaskRecurrence = (task: AgentScheduledTask): string => {
  switch (task.schedule_mode) {
    case "weekly":
      return `每周 ${formatScheduledTaskWeekdays(task.weekdays)} 重复`;
    case "monthly":
      return `每月 ${task.month_days?.[0] ?? 1} 号重复`;
    case "yearly":
      return `每年 ${task.year_month ?? 1} 月 ${task.year_month_day ?? 1} 号重复`;
    case "custom_days":
      return `每 ${task.custom_interval_days ?? 1} 天重复`;
    case "daily":
    default:
      return "每日重复";
  }
};

const formatScheduledTaskWeekdays = (weekdays: number[] | undefined): string => {
  const labels = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
  const selected = Array.isArray(weekdays) && weekdays.length ? weekdays : [1];
  return selected
    .slice()
    .sort((left, right) => left - right)
    .map((weekday) => labels[weekday - 1])
    .filter(Boolean)
    .join("、");
};

const formatFullDateTime = (timestamp: number): string => {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(timestamp));
};

const extractAgentToolCalls = (text: string): AgentToolCall[] => {
  const calls: AgentToolCall[] = [];
  const blockPattern = /<tool_call>([\s\S]*?)<\/tool_call>/gi;
  let match: RegExpExecArray | null;

  while ((match = blockPattern.exec(text))) {
    const block = match[1];
    const xmlFunction = block.match(/<function\s*=\s*["']?([a-zA-Z0-9_-]+)["']?\s*>/i);
    const functionName = xmlFunction?.[1]?.trim();

    if (functionName === "execute_shell") {
      const command = extractXmlParameter(block, "command");
      if (command) {
        calls.push({ kind: "shell", command });
      }
      continue;
    }

    if (functionName === "tavily_search") {
      const query = extractXmlParameter(block, "query");
      if (query) {
        calls.push({ kind: "tavily", query });
      }
    }
  }

  return calls;
};

const extractXmlParameter = (block: string, name: string): string | null => {
  const pattern = new RegExp(
    `<parameter\\s*=\\s*["']?${name}["']?\\s*>([\\s\\S]*?)<\\/parameter>`,
    "i"
  );
  const value = block.match(pattern)?.[1]?.trim();

  return value ? decodeBasicHtmlEntities(value) : null;
};

const buildTavilyToolContext = (
  query: string,
  result: AgentTavilySearchResult
): string => {
  const answer = result.answer.trim();
  const results = result.results.length
    ? result.results
        .map(
          (item, index) =>
            `${index + 1}. ${item.title || "未命名结果"}\nURL: ${item.url}\n摘要: ${item.content || "(无摘要)"}`
        )
        .join("\n\n")
    : "(没有返回搜索结果)";

  return `Tavily 搜索已完成。\n查询：${query || result.query}\n回答摘要：${answer || "(无)"}\n\n搜索结果：\n${results}`;
};

const buildShellToolContext = (command: string, result: AgentShellResult): string => {
  const exitStatus = result.timed_out ? "已超时" : `退出码 ${result.exit_code ?? "未知"}`;
  const stderr = result.stderr.trim();
  const stderrBlock = stderr
    ? `\n\nstderr:\n\`\`\`\n${escapeMarkdownFence(stderr)}\n\`\`\``
    : "";

  return `Shell 已执行。\n命令：\`${command || result.command}\`\n工作目录：\`${result.cwd || "."}\`\n状态：${exitStatus}\n\nstdout:\n\`\`\`\n${escapeMarkdownFence(result.stdout.trim() || "(无)")}\n\`\`\`${stderrBlock}`;
};

const stripAgentToolCalls = (text: string): string => {
  return text.replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, "").trim();
};

const stripScheduledTaskBlocks = (text: string): string => {
  return text.replace(/<scheduled_task>[\s\S]*?<\/scheduled_task>/gi, "").trim();
};

const decodeBasicHtmlEntities = (text: string): string => {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
};

const escapeMarkdownFence = (value: string): string => {
  return value.replace(/```/g, "`\u200b``");
};

export default ScheduledTaskRunner;
