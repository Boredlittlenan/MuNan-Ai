import { type Message } from "../modelConfig";

type AgentShellResult = {
  command: string;
  cwd: string;
  exit_code: number | null;
  stdout: string;
  stderr: string;
  timed_out: boolean;
};

type AgentShellPlan = {
  should_run: boolean;
  command: string;
  reason: string;
};

type AgentTavilyPlan = {
  should_search: boolean;
  query: string;
  reason: string;
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

export type AgentToolCall =
  | {
      kind: "shell";
      command: string;
    }
  | {
      kind: "tavily";
      query: string;
    };

type AgentQuickAction =
  | {
      kind: "open_url";
      category: "browser";
      skill: "browser.open";
      url: string;
      confirmText: string;
    }
  | {
      kind: "fetch_url_text";
      category: "browser";
      skill: "browser.extract_text";
      url: string;
      confirmText: string;
    }
  | {
      kind: "open_path";
      category: "system";
      skill: "system.open_path";
      path: string;
      confirmText: string;
    }
  | {
      kind: "copy_text";
      category: "system";
      skill: "system.copy_text";
      text: string;
      confirmText: string;
    }
  | {
      kind: "shell";
      category: "system";
      skill: "system.shell";
      command: string;
      cwd: string;
      confirmText: string;
    }
  | {
      kind: "unsupported";
      category: "browser";
      skill: "browser.open";
      confirmText: string;
    };

export const parseAgentQuickAction = (text: string): AgentQuickAction | null => {
  const trimmed = text.trim();

  if (!trimmed) {
    return null;
  }

  const createFolderCommand = extractCreateFolderCommand(trimmed);
  if (createFolderCommand) {
    return {
      kind: "shell",
      category: "system",
      skill: "system.shell",
      command: createFolderCommand,
      cwd: "",
      confirmText: `创建文件夹：${createFolderCommand}`,
    };
  }

  const shellCommand = extractShellCommand(trimmed);
  if (shellCommand) {
    return {
      kind: "shell",
      category: "system",
      skill: "system.shell",
      command: shellCommand,
      cwd: "",
      confirmText: `执行 Shell 命令：${shellCommand}`,
    };
  }

  const copyText = extractCopyText(trimmed);
  if (copyText) {
    return {
      kind: "copy_text",
      category: "system",
      skill: "system.copy_text",
      text: copyText,
      confirmText: "复制文本到剪贴板",
    };
  }

  const pageTextUrl = extractPageTextUrl(trimmed);
  if (pageTextUrl) {
    return {
      kind: "fetch_url_text",
      category: "browser",
      skill: "browser.extract_text",
      url: pageTextUrl,
      confirmText: `读取网页文本 ${pageTextUrl}`,
    };
  }

  const path = extractPathToOpen(trimmed);
  if (path) {
    return {
      kind: "open_path",
      category: "system",
      skill: "system.open_path",
      path,
      confirmText: `打开路径 ${path}`,
    };
  }

  const url = extractUrlToOpen(trimmed);
  if (url) {
    return {
      kind: "open_url",
      category: "browser",
      skill: "browser.open",
      url,
      confirmText: `打开网页 ${url}`,
    };
  }

  if (/截图|读取.*页面|提取.*页面|点击|填写|提交|浏览器|操作/.test(trimmed)) {
    return {
      kind: "unsupported",
      category: "browser",
      skill: "browser.open",
      confirmText: "暂未支持的 Agent 操作",
    };
  }

  return null;
};

export const extractAgentToolCalls = (
  text: string,
  includeShellCodeBlocks = false
): AgentToolCall[] => {
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
      continue;
    }

    const jsonCall = block.match(/\{[\s\S]*\}/);
    if (!jsonCall) {
      continue;
    }

    try {
      const parsed = JSON.parse(jsonCall[0]) as {
        function?: string;
        name?: string;
        arguments?: { command?: string; query?: string };
        parameters?: { command?: string; query?: string };
        command?: string;
        query?: string;
      };
      const jsonFunctionName = parsed.function || parsed.name;

      if (jsonFunctionName === "execute_shell") {
        const command =
          parsed.command || parsed.arguments?.command || parsed.parameters?.command || "";
        if (command.trim()) {
          calls.push({ kind: "shell", command: command.trim() });
        }
      }

      if (jsonFunctionName === "tavily_search") {
        const query = parsed.query || parsed.arguments?.query || parsed.parameters?.query || "";
        if (query.trim()) {
          calls.push({ kind: "tavily", query: query.trim() });
        }
      }
    } catch {
      continue;
    }
  }

  if (calls.length === 0 && includeShellCodeBlocks) {
    for (const command of extractShellCodeBlocks(text)) {
      calls.push({ kind: "shell", command });
    }
  }

  return calls;
};

export const getLatestUserText = (messages: Message[]): string => {
  return [...messages].reverse().find((message) => message.role === "user")?.content ?? "";
};

export const isLocalActionRequest = (text: string): boolean => {
  return /(桌面|文件夹|文件|目录|路径|新建|创建|删除|复制|移动|重命名|运行|执行|命令|构建|测试|检查|打开|保存)/.test(
    text
  );
};

export const stripAgentToolCalls = (text: string): string => {
  return text.replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, "").trim();
};

export const buildShellToolContext = (
  plan: AgentShellPlan,
  result: AgentShellResult
): string => {
  const exitStatus = result.timed_out ? "已超时" : `退出码 ${result.exit_code ?? "未知"}`;
  const stdout = escapeMarkdownFence(result.stdout.trim() || "(无)");
  const stderr = result.stderr.trim();
  const stderrBlock = stderr
    ? `\n\nstderr:\n\`\`\`\n${escapeMarkdownFence(stderr)}\n\`\`\``
    : "";

  return `你刚刚根据用户需求自动调用了本地 Shell。请基于下面的执行结果，直接回答用户刚才的问题，不要编造没有出现在输出里的事实。\n\n规划理由：${plan.reason || "未提供"}\n命令：\`${result.command}\`\n工作目录：\`${result.cwd || "."}\`\n状态：${exitStatus}\n\nstdout:\n\`\`\`\n${stdout}\n\`\`\`${stderrBlock}`;
};

export const buildTavilyToolContext = (
  plan: AgentTavilyPlan,
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

  return `你刚刚根据用户需求调用了 Tavily 联网搜索。请基于下面的真实搜索结果回答用户，尽量标注来源链接，不要编造没有出现在搜索结果里的事实。\n\n规划理由：${plan.reason || "未提供"}\n搜索词：${result.query || plan.query}\n\nTavily Answer:\n${answer || "(无)"}\n\n搜索结果:\n${results}`;
};

export const appendAgentToolOriginalContent = (
  originalContent: string,
  toolContexts: string[]
): string => {
  if (toolContexts.length === 0) {
    return originalContent;
  }

  return `${originalContent}\n\n--- Agent 工具原始结果 ---\n${toolContexts.join("\n\n---\n\n")}`;
};

const extractPageTextUrl = (text: string): string | null => {
  if (!/(读取|提取|总结|分析|查看).*(网页|页面|网站|URL|链接|内容)/i.test(text)) {
    return null;
  }

  return extractUrlFromText(text);
};

const extractUrlToOpen = (text: string): string | null => {
  if (!/(打开|访问|浏览|网页|网站|搜索)/.test(text)) {
    return null;
  }

  const explicitUrl = extractUrlFromText(text);
  if (explicitUrl) {
    return explicitUrl;
  }

  const commonSites: Array<[RegExp, string]> = [
    [/百度|baidu/i, "https://www.baidu.com"],
    [/哔哩哔哩|bilibili|b站/i, "https://www.bilibili.com"],
    [/github/i, "https://github.com"],
    [/google|谷歌/i, "https://www.google.com"],
    [/知乎|zhihu/i, "https://www.zhihu.com"],
  ];
  const matchedSite = commonSites.find(([pattern]) => pattern.test(text));

  return matchedSite?.[1] ?? null;
};

const extractUrlFromText = (text: string): string | null => {
  const urlMatch = text.match(/https?:\/\/[^\s，。；、)）]+/i);
  if (urlMatch) {
    return urlMatch[0];
  }

  const wwwMatch = text.match(/www\.[^\s，。；、)）]+/i);
  if (wwwMatch) {
    return `https://${wwwMatch[0]}`;
  }

  return null;
};

const extractPathToOpen = (text: string): string | null => {
  if (!/(打开|访问|定位|查看).*(文件|文件夹|目录|路径|盘|[A-Za-z]:\\|[A-Za-z]:\/)/.test(text)) {
    return null;
  }

  const windowsPath = text.match(/[A-Za-z]:[\\/][^\n\r]+/);
  if (windowsPath) {
    return windowsPath[0].trim().replace(/[，。；]+$/, "");
  }

  const quotedPath = text.match(/[“"']([^“"']+[\\/][^“"']+)[”"']/);
  return quotedPath?.[1]?.trim() ?? null;
};

const extractCopyText = (text: string): string | null => {
  const match = text.match(/^(?:帮我)?复制(?:一下|到剪贴板)?[：:\s]+([\s\S]+)$/);
  const value = match?.[1]?.trim();

  return value || null;
};

const extractShellCommand = (text: string): string | null => {
  const patterns = [
    /^(?:帮我)?(?:执行|运行)\s*(?:一下)?\s*(?:shell|命令|终端|powershell)\s*[：:\s]+([\s\S]+)$/i,
    /^(?:shell|powershell|pwsh|终端)\s*[：:\s]+([\s\S]+)$/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    const command = match?.[1]?.trim();

    if (command) {
      return command;
    }
  }

  return null;
};

const extractCreateFolderCommand = (text: string): string | null => {
  if (!/(新建|创建|建立).*(文件夹|目录)/.test(text)) {
    return null;
  }

  const folderName =
    text.match(/(?:叫|名为|名称为|名字叫)\s*[「“"']?([^」”"'\s，。；]+)[」”"']?/i)?.[1]?.trim() ||
    text.match(/(?:文件夹|目录)\s*[「“"']([^」”"']+)[」”"']/i)?.[1]?.trim() ||
    text.match(/(?:文件夹|目录)\s+([^\s，。；]+)/i)?.[1]?.trim();

  if (!folderName) {
    return null;
  }

  const escapedFolderName = escapePowerShellSingleQuotedString(folderName);
  const targetExpression = /桌面|desktop/i.test(text)
    ? `Join-Path $env:USERPROFILE 'Desktop\\${escapedFolderName}'`
    : `'${escapedFolderName}'`;

  return `$target = ${targetExpression}; New-Item -ItemType Directory -Path $target -Force | Select-Object FullName`;
};

const escapePowerShellSingleQuotedString = (value: string): string => {
  return value.replace(/'/g, "''").replace(/[\\/:*?"<>|]/g, "_");
};

const extractShellCodeBlocks = (text: string): string[] => {
  const commands: string[] = [];
  const codeBlockPattern = /```(?:powershell|pwsh|shell|bash|sh|ps1)?\s*([\s\S]*?)```/gi;
  let match: RegExpExecArray | null;

  while ((match = codeBlockPattern.exec(text))) {
    const command = match[1].trim();

    if (command && looksLikeShellCommand(command)) {
      commands.push(command);
    }
  }

  return commands;
};

const looksLikeShellCommand = (command: string): boolean => {
  return /(^|\n)\s*(New-Item|Remove-Item|Copy-Item|Move-Item|Rename-Item|Set-Item|Get-ChildItem|Test-Path|mkdir|md|ni|cargo|pnpm|npm|git|powershell|pwsh)\b/i.test(
    command
  );
};

const extractXmlParameter = (block: string, name: string): string | null => {
  const pattern = new RegExp(
    `<parameter\\s*=\\s*["']?${name}["']?\\s*>([\\s\\S]*?)<\\/parameter>`,
    "i"
  );
  const value = block.match(pattern)?.[1]?.trim();

  return value ? decodeBasicHtmlEntities(value) : null;
};

const decodeBasicHtmlEntities = (text: string): string => {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
};

const escapeMarkdownFence = (text: string): string => {
  return text.replace(/```/g, "`\u200b``");
};
