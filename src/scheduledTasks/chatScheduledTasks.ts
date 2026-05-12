import {
  type AgentScheduledTask,
  type AgentScheduledTaskKind,
  type AgentScheduledTaskScheduleMode,
  type ModelType,
  createAgentScheduledTaskId,
  getNextAgentScheduledTaskRun,
  normalizeAgentTaskCustomIntervalDays,
  normalizeAgentTaskTimeOfDay,
} from "../modelConfig";

export type AgentScheduledTaskPlan = {
  should_create: boolean;
  tasks: AgentScheduledTaskPlanItem[];
  reason: string;
};

export type AgentScheduledTaskPlanItem = {
  title?: string;
  prompt?: string;
  kind?: string;
  schedule_mode?: string;
  scheduled_at?: string;
  time_of_day?: string;
  weekdays?: number[];
  month_day?: number | null;
  year_month?: number | null;
  year_month_day?: number | null;
  custom_interval_days?: number | null;
};

export type ScheduledTaskCreationResult = {
  tasks: AgentScheduledTask[];
  rejectedCount: number;
};

export const createScheduledTasksFromReply = (
  content: string,
  model: ModelType
): ScheduledTaskCreationResult => {
  const tasks: AgentScheduledTask[] = [];
  let rejectedCount = 0;
  const blockPattern = /<scheduled_task>([\s\S]*?)<\/scheduled_task>/gi;
  let match: RegExpExecArray | null;

  while ((match = blockPattern.exec(content))) {
    const block = match[1];
    const title = extractTagText(block, "title") || "计划任务";
    const prompt = extractTagText(block, "prompt");
    const scheduledAtText = extractTagText(block, "scheduled_at");
    const kindText = extractTagText(block, "kind")?.toLowerCase() ?? "";
    const scheduleModeText = extractTagText(block, "schedule_mode")?.toLowerCase() ?? "";
    const scheduleTypeText = extractTagText(block, "schedule_type")?.toLowerCase() ?? "";
    const recurrenceText = extractTagText(block, "recurrence")?.toLowerCase() ?? "";
    const timeOfDayText = extractTagText(block, "time_of_day") ?? "";
    const weekdaysText = extractTagText(block, "weekdays") ?? "";
    const monthDayText =
      extractTagText(block, "month_day") || extractTagText(block, "month_days") || "";
    const yearMonthText = extractTagText(block, "year_month") ?? "";
    const yearMonthDayText = extractTagText(block, "year_month_day") ?? "";
    const customIntervalDaysText = extractTagText(block, "custom_interval_days") ?? "";
    const scheduledAt = scheduledAtText ? Date.parse(scheduledAtText) : Number.NaN;

    const now = Date.now();
    const kind: AgentScheduledTaskKind =
      kindText.includes("reminder") || kindText.includes("提醒")
        ? "reminder"
        : "ai_prompt";
    const scheduleMode = parseScheduledTaskScheduleMode(
      scheduleModeText,
      scheduleTypeText,
      recurrenceText
    );
    const recurrence = scheduleMode === "once" ? undefined : scheduleMode;
    const timeOfDay = normalizeAgentTaskTimeOfDay(
      timeOfDayText,
      Number.isFinite(scheduledAt) ? scheduledAt : now
    );
    const weekdays = parseNumberList(weekdaysText, 1, 7);
    const monthDay = Number(monthDayText);
    const yearMonth = Number(yearMonthText);
    const yearMonthDay = Number(yearMonthDayText);
    const customIntervalDays = normalizeAgentTaskCustomIntervalDays(
      Number(customIntervalDaysText)
    );
    const baseScheduledAt =
      scheduleMode === "once"
        ? scheduledAt
        : buildInitialScheduledTaskAnchor(scheduleMode, timeOfDay, now);
    const timeOfDayValid = scheduleMode === "once" || isValidTimeOfDay(timeOfDayText);
    const scheduleDetailsValid =
      timeOfDayValid &&
      (scheduleMode !== "weekly" || weekdays.length > 0) &&
      (scheduleMode !== "monthly" || isValidScheduleDay(monthDay, 1, 31)) &&
      (scheduleMode !== "yearly" ||
        (isValidScheduleDay(yearMonth, 1, 12) &&
          isValidScheduleDay(
            yearMonthDay,
            1,
            getDaysInMonthForScheduledTask(2028, Math.round(yearMonth) - 1)
          ))) &&
      (scheduleMode !== "custom_days" ||
        (Boolean(customIntervalDaysText.trim()) &&
          Number.isFinite(Number(customIntervalDaysText)) &&
          Number(customIntervalDaysText) > 0));

    if (!prompt || !Number.isFinite(baseScheduledAt) || !scheduleDetailsValid) {
      rejectedCount += 1;
      continue;
    }

    if (scheduleMode === "once" && baseScheduledAt <= now) {
      rejectedCount += 1;
      continue;
    }

    const task: AgentScheduledTask = {
      id: createAgentScheduledTaskId(),
      title: title.trim(),
      prompt: prompt.trim(),
      scheduled_at: baseScheduledAt,
      enabled: true,
      kind,
      schedule_mode: scheduleMode,
      schedule_type: scheduleMode === "once" ? "once" : "recurring",
      recurrence,
      time_of_day: scheduleMode === "once" ? undefined : timeOfDay,
      weekdays: scheduleMode === "weekly" ? weekdays : undefined,
      month_days:
        scheduleMode === "monthly" && Number.isFinite(monthDay) && monthDay >= 1
          ? [Math.min(Math.max(Math.round(monthDay), 1), 31)]
          : undefined,
      year_month:
        scheduleMode === "yearly" && Number.isFinite(yearMonth)
          ? Math.min(Math.max(Math.round(yearMonth), 1), 12)
          : undefined,
      year_month_day:
        scheduleMode === "yearly" && Number.isFinite(yearMonthDay)
          ? Math.min(Math.max(Math.round(yearMonthDay), 1), 31)
          : undefined,
      custom_interval_days: scheduleMode === "custom_days" ? customIntervalDays : undefined,
      status: "pending",
      model,
      source: "chat",
      created_at: now,
      updated_at: now,
    };
    const nextRunAt =
      scheduleMode === "once" ? baseScheduledAt : getNextAgentScheduledTaskRun(task, now);

    if (!nextRunAt || nextRunAt <= now) {
      rejectedCount += 1;
      continue;
    }

    tasks.push({
      ...task,
      scheduled_at: nextRunAt,
    });
  }

  return { tasks, rejectedCount };
};

export const createScheduledTasksFromPlan = (
  plan: AgentScheduledTaskPlan,
  model: ModelType
): ScheduledTaskCreationResult => {
  if (!plan.should_create || plan.tasks.length === 0) {
    return { tasks: [], rejectedCount: 0 };
  }

  return createScheduledTasksFromReply(
    plan.tasks.map(planItemToScheduledTaskBlock).join("\n"),
    model
  );
};

export const createScheduledTasksFromUserRequest = (
  content: string,
  model: ModelType
): ScheduledTaskCreationResult => {
  const text = content.trim();
  if (!text || looksLikeRecurringScheduledTaskRequest(text) || !looksLikeScheduledTaskRequest(text)) {
    return { tasks: [], rejectedCount: 0 };
  }

  const now = Date.now();
  const scheduledAt = parseSingleScheduledTaskTime(text, now);
  if (!scheduledAt || scheduledAt <= now) {
    return { tasks: [], rejectedCount: 0 };
  }

  const kind = inferScheduledTaskKind(text);
  const task: AgentScheduledTask = {
    id: createAgentScheduledTaskId(),
    title: inferScheduledTaskTitle(text, kind),
    prompt:
      kind === "ai_prompt"
        ? `按用户原始请求执行，并直接给出结果：${text}`
        : stripScheduleTimePhrases(text) || text,
    scheduled_at: scheduledAt,
    enabled: true,
    kind,
    schedule_mode: "once",
    schedule_type: "once",
    status: "pending",
    model,
    source: "chat",
    created_at: now,
    updated_at: now,
  };

  return { tasks: [task], rejectedCount: 0 };
};

export const looksLikePotentialScheduledTaskRequest = (text: string): boolean => {
  const normalized = text.replace(/\s+/g, "");
  const hasScheduleSignal =
    /(提醒|通知|告诉|叫我|闹钟|日程|计划任务|定时|到点|以后|每天|每日|每周|每月|每年|每隔|分钟后|小时后|明天|后天|明早|明晚|今晚|早晨|早上|上午|中午|下午|晚上|[0-9零〇一二两三四五六七八九十]{1,3}(点|时))/.test(
      normalized
    );
  const hasTaskSignal =
    /(提醒|通知|告诉|叫我|执行|查询|播报|汇报|总结|整理|天气|闹钟|日程|任务|待办|会议|喝水|吃药)/.test(
      normalized
    );

  return hasScheduleSignal && hasTaskSignal;
};

export const stripScheduledTaskBlocks = (text: string): string => {
  return text.replace(/<scheduled_task>[\s\S]*?<\/scheduled_task>/gi, "").trim();
};

export const buildScheduledTaskCreationNotice = (
  tasks: AgentScheduledTask[]
): string => {
  if (tasks.length === 0) {
    return "";
  }

  const lines = tasks.map((task) => {
    const scheduleText =
      task.schedule_mode !== "once" ? `，${formatScheduledTaskRecurrence(task)}` : "";
    return `- ${task.title}：${formatFullDateTime(task.scheduled_at)}${scheduleText}`;
  });

  return `已创建计划任务：\n${lines.join("\n")}`;
};

const planItemToScheduledTaskBlock = (item: AgentScheduledTaskPlanItem): string => {
  const scheduleMode = normalizePlannedScheduleMode(item.schedule_mode);
  const kind = item.kind === "reminder" ? "reminder" : "ai_prompt";
  const lines = [
    "<scheduled_task>",
    `<title>${escapeTagText(item.title || "计划任务")}</title>`,
    `<schedule_mode>${scheduleMode}</schedule_mode>`,
    `<kind>${kind}</kind>`,
    `<prompt>${escapeTagText(item.prompt || item.title || "到点后执行计划任务。")}</prompt>`,
  ];

  if (scheduleMode === "once") {
    lines.push(`<scheduled_at>${escapeTagText(item.scheduled_at || "")}</scheduled_at>`);
  } else {
    lines.push(`<time_of_day>${escapeTagText(item.time_of_day || "")}</time_of_day>`);
  }

  if (scheduleMode === "weekly") {
    lines.push(`<weekdays>${escapeTagText((item.weekdays || []).join(","))}</weekdays>`);
  }

  if (scheduleMode === "monthly") {
    lines.push(`<month_day>${item.month_day ?? ""}</month_day>`);
  }

  if (scheduleMode === "yearly") {
    lines.push(`<year_month>${item.year_month ?? ""}</year_month>`);
    lines.push(`<year_month_day>${item.year_month_day ?? ""}</year_month_day>`);
  }

  if (scheduleMode === "custom_days") {
    lines.push(`<custom_interval_days>${item.custom_interval_days ?? ""}</custom_interval_days>`);
  }

  lines.push("</scheduled_task>");
  return lines.join("\n");
};

const normalizePlannedScheduleMode = (
  value: string | undefined
): AgentScheduledTaskScheduleMode => {
  const normalized = value?.trim().toLowerCase() ?? "";
  return isScheduledTaskScheduleMode(normalized)
    ? normalized
    : parseScheduledTaskScheduleMode(normalized, "", "");
};

const escapeTagText = (value: string): string => {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
};

const looksLikeRecurringScheduledTaskRequest = (text: string): boolean => {
  return /(每天|每日|每周|每月|每年|每隔|每[0-9零〇一二两三四五六七八九十百]+天)/.test(text);
};

const looksLikeScheduledTaskRequest = (text: string): boolean => {
  return (
    /(提醒|通知|告诉|叫我|闹钟|到点|执行|查询|播报|汇报|总结|整理)/.test(text) &&
    hasSingleScheduledTaskTime(text)
  );
};

const hasSingleScheduledTaskTime = (text: string): boolean => {
  return Boolean(parseSingleScheduledTaskTime(text, Date.now()));
};

const parseSingleScheduledTaskTime = (text: string, now: number): number | null => {
  const normalized = text.replace(/\s+/g, "");
  const relativeMinutes = parseRelativeDelayMinutes(normalized);
  if (relativeMinutes !== null) {
    return now + relativeMinutes * 60_000;
  }

  const dayOffset = parseRelativeDayOffset(normalized);
  const clock = parseClockTime(normalized);
  if (!clock) {
    return null;
  }

  const candidate = new Date(now);
  if (dayOffset !== null) {
    candidate.setDate(candidate.getDate() + dayOffset);
  }
  candidate.setHours(clock.hours, clock.minutes, 0, 0);

  if (dayOffset === null && candidate.getTime() <= now) {
    candidate.setDate(candidate.getDate() + 1);
  }

  return candidate.getTime();
};

const parseRelativeDelayMinutes = (text: string): number | null => {
  if (/半(个)?小时后/.test(text)) {
    return 30;
  }

  const minuteMatch = text.match(/([0-9]+|[零〇一二两三四五六七八九十百]+)(?:个)?(?:分钟|分)后/);
  if (minuteMatch) {
    return parseChineseNumber(minuteMatch[1]);
  }

  const hourMatch = text.match(/([0-9]+|[零〇一二两三四五六七八九十百]+)(?:个)?(?:小时|钟头)后/);
  if (hourMatch) {
    return parseChineseNumber(hourMatch[1]) * 60;
  }

  return null;
};

const parseRelativeDayOffset = (text: string): number | null => {
  if (/后天/.test(text)) {
    return 2;
  }

  if (/明天|明早|明晚/.test(text)) {
    return 1;
  }

  if (/今天|今晚|今早|稍后/.test(text)) {
    return 0;
  }

  return null;
};

const parseClockTime = (
  text: string
): { hours: number; minutes: number } | null => {
  const period = text.match(/(凌晨|早上|上午|中午|下午|晚上|今晚|明早|明晚)/)?.[1] ?? "";
  const colonMatch = text.match(/([01]?\d|2[0-3])[:：]([0-5]\d)/);
  const hourMatch =
    colonMatch ??
    text.match(/([0-9]{1,2}|[零〇一二两三四五六七八九十]{1,3})(?:点|时)(半|[0-9]{1,2}|[零〇一二两三四五六七八九十]{1,3})?/);

  if (!hourMatch) {
    return null;
  }

  let hours = parseChineseNumber(hourMatch[1]);
  let minutes = 0;

  if (colonMatch) {
    minutes = Number(colonMatch[2]);
  } else if (hourMatch[2] === "半") {
    minutes = 30;
  } else if (hourMatch[2]) {
    minutes = parseChineseNumber(hourMatch[2]);
  }

  if ((period.includes("下午") || period.includes("晚上") || period.includes("晚")) && hours < 12) {
    hours += 12;
  }

  if (period.includes("中午") && hours < 11) {
    hours += 12;
  }

  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) {
    return null;
  }

  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    return null;
  }

  return { hours, minutes };
};

const parseChineseNumber = (value: string): number => {
  if (/^\d+$/.test(value)) {
    return Number(value);
  }

  const digitMap: Record<string, number> = {
    零: 0,
    "〇": 0,
    一: 1,
    二: 2,
    两: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
  };

  if (value === "十") {
    return 10;
  }

  if (value.includes("百")) {
    const [hundredsText, restText = ""] = value.split("百");
    return (digitMap[hundredsText] || 1) * 100 + (restText ? parseChineseNumber(restText) : 0);
  }

  if (value.includes("十")) {
    const [tensText, onesText = ""] = value.split("十");
    return (tensText ? digitMap[tensText] || 0 : 1) * 10 + (onesText ? digitMap[onesText] || 0 : 0);
  }

  return digitMap[value] ?? Number.NaN;
};

const inferScheduledTaskKind = (text: string): AgentScheduledTaskKind => {
  return /(天气|查询|搜索|联网|告诉|播报|汇报|总结|整理|检查|生成|执行)/.test(text)
    ? "ai_prompt"
    : "reminder";
};

const inferScheduledTaskTitle = (
  text: string,
  kind: AgentScheduledTaskKind
): string => {
  if (/天气/.test(text)) {
    return "天气提醒";
  }

  if (/闹钟/.test(text)) {
    return "闹钟提醒";
  }

  const action = stripScheduleTimePhrases(text)
    .replace(/^(请|帮我|麻烦|记得|到时候|然后)/, "")
    .trim();
  const fallback = kind === "ai_prompt" ? "AI 定时任务" : "提醒任务";

  return action ? action.slice(0, 24) : fallback;
};

const stripScheduleTimePhrases = (text: string): string => {
  return text
    .replace(/半(个)?小时后/g, "")
    .replace(/([0-9]+|[零〇一二两三四五六七八九十百]+)(?:个)?(?:分钟|分|小时|钟头)后/g, "")
    .replace(/(今天|明天|后天|今晚|明早|明晚|今早|稍后)/g, "")
    .replace(/(凌晨|早上|上午|中午|下午|晚上)?([0-9]{1,2}|[零〇一二两三四五六七八九十]{1,3})([:：][0-5]\d|(?:点|时)(半|[0-9]{1,2}|[零〇一二两三四五六七八九十]{1,3})?)?/g, "")
    .replace(/^(提醒我|通知我|告诉我|叫我)/, "")
    .trim();
};

const parseScheduledTaskScheduleMode = (
  modeValue: string,
  scheduleTypeValue: string,
  recurrenceValue: string
): AgentScheduledTaskScheduleMode => {
  if (isScheduledTaskScheduleMode(modeValue)) {
    return modeValue;
  }

  const normalized = `${modeValue} ${scheduleTypeValue} ${recurrenceValue}`.toLowerCase();
  if (
    normalized.includes("custom_days") ||
    normalized.includes("custom") ||
    normalized.includes("interval") ||
    normalized.includes("自定义") ||
    normalized.includes("间隔")
  ) {
    return "custom_days";
  }

  if (
    normalized.includes("weekly") ||
    normalized.includes("week") ||
    normalized.includes("按周") ||
    normalized.includes("每周")
  ) {
    return "weekly";
  }

  if (
    normalized.includes("monthly") ||
    normalized.includes("month") ||
    normalized.includes("按月") ||
    normalized.includes("每月")
  ) {
    return "monthly";
  }

  if (
    normalized.includes("yearly") ||
    normalized.includes("annual") ||
    normalized.includes("按年") ||
    normalized.includes("每年")
  ) {
    return "yearly";
  }

  if (
    normalized.includes("daily") ||
    normalized.includes("everyday") ||
    normalized.includes("按日") ||
    normalized.includes("每日") ||
    normalized.includes("每天")
  ) {
    return "daily";
  }

  if (
    scheduleTypeValue.includes("recurring") ||
    scheduleTypeValue.includes("repeat") ||
    scheduleTypeValue.includes("重复")
  ) {
    return "daily";
  }

  return "once";
};

const isScheduledTaskScheduleMode = (value: string): value is AgentScheduledTaskScheduleMode => {
  return (
    value === "once" ||
    value === "daily" ||
    value === "weekly" ||
    value === "monthly" ||
    value === "yearly" ||
    value === "custom_days"
  );
};

const isValidScheduleDay = (value: number, min: number, max: number): boolean => {
  return Number.isFinite(value) && value >= min && value <= max;
};

const isValidTimeOfDay = (value: string): boolean => {
  return /^([01]\d|2[0-3]):([0-5]\d)$/.test(value.trim());
};

const getDaysInMonthForScheduledTask = (year: number, monthIndex: number): number => {
  return new Date(year, monthIndex + 1, 0).getDate();
};

const parseNumberList = (value: string, min: number, max: number): number[] => {
  const normalized = value
    .replace(/[，、;；]/g, ",")
    .replace(/星期天|星期日|周天|周日|礼拜天|礼拜日/g, "7")
    .replace(/星期一|周一|礼拜一/g, "1")
    .replace(/星期二|周二|礼拜二/g, "2")
    .replace(/星期三|周三|礼拜三/g, "3")
    .replace(/星期四|周四|礼拜四/g, "4")
    .replace(/星期五|周五|礼拜五/g, "5")
    .replace(/星期六|周六|礼拜六/g, "6");
  const numbers = normalized
    .split(/[,\s]+/)
    .map((item) => Math.round(Number(item.trim())))
    .filter((item) => Number.isFinite(item) && item >= min && item <= max);

  return Array.from(new Set(numbers)).sort((left, right) => left - right);
};

const buildInitialScheduledTaskAnchor = (
  mode: AgentScheduledTaskScheduleMode,
  timeOfDay: string,
  fromTime: number
): number => {
  if (mode === "once") {
    return fromTime;
  }

  const [hours, minutes] = normalizeAgentTaskTimeOfDay(timeOfDay, fromTime)
    .split(":")
    .map(Number);
  const candidate = new Date(fromTime);
  candidate.setHours(hours, minutes, 0, 0);

  if (candidate.getTime() <= fromTime) {
    candidate.setDate(candidate.getDate() + 1);
  }

  return candidate.getTime();
};

const extractTagText = (block: string, tag: string): string | null => {
  const pattern = new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, "i");
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
