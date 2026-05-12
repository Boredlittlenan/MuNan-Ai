import {
  IoAdd,
  IoAlarmOutline,
  IoCalendarOutline,
  IoRefresh,
  IoTrashOutline,
} from "react-icons/io5";

import { CustomSelect } from "../components/CustomSelect";
import {
  type AgentScheduledTask,
  type AgentScheduledTaskKind,
  type AgentScheduledTaskScheduleMode,
  type AppConfig,
  type ModelOption,
  type ModelType,
  getModelMeta,
  normalizeAgentTaskTimeOfDay,
} from "../modelConfig";

export type AgentScheduleForm = {
  title: string;
  prompt: string;
  kind: AgentScheduledTaskKind;
  scheduleMode: AgentScheduledTaskScheduleMode;
  scheduledAt: string;
  timeOfDay: string;
  weekdays: number[];
  monthDay: string;
  yearMonth: string;
  yearMonthDay: string;
  customIntervalDays: string;
  model: ModelType;
};

const WEEKDAY_OPTIONS = [
  { value: 1, label: "周一" },
  { value: 2, label: "周二" },
  { value: 3, label: "周三" },
  { value: 4, label: "周四" },
  { value: 5, label: "周五" },
  { value: 6, label: "周六" },
  { value: 7, label: "周日" },
];

const MONTH_OPTIONS = Array.from({ length: 12 }, (_, index) => ({
  value: String(index + 1),
  label: `${index + 1} 月`,
}));

const DAY_OF_MONTH_OPTIONS = buildDayOptions(31);

type ScheduledTaskSettingsPanelProps = {
  pendingScheduledTaskCount: number;
  scheduleForm: AgentScheduleForm;
  modelOptions: ModelOption[];
  scheduleError: string;
  scheduledTasks: AgentScheduledTask[];
  config: AppConfig;
  updateScheduleFormField: <K extends keyof AgentScheduleForm>(
    field: K,
    value: AgentScheduleForm[K]
  ) => void;
  addScheduledTask: () => void;
  toggleScheduledTask: (taskId: string) => void;
  resetScheduledTask: (taskId: string) => void;
  deleteScheduledTask: (taskId: string) => void;
};

export function ScheduledTaskSettingsPanel({
  pendingScheduledTaskCount,
  scheduleForm,
  modelOptions,
  scheduleError,
  scheduledTasks,
  config,
  updateScheduleFormField,
  addScheduledTask,
  toggleScheduledTask,
  resetScheduledTask,
  deleteScheduledTask,
}: ScheduledTaskSettingsPanelProps) {
  return (
    <div className="settings-field settings-field--wide agent-schedule-panel">
      <div className="settings-field__header">
        <div className="agent-setting-title">
          <IoAlarmOutline size={20} />
          <div>
            <p className="section-kicker">Schedule</p>
            <h3>计划任务</h3>
          </div>
        </div>
        <span className="status-chip">{pendingScheduledTaskCount} 个待执行</span>
      </div>
      <p className="settings-help-text">
        可以在这里设置某个日期和时间点自动提醒，或让 AI 到点后按任务内容生成回复。聊天里说“明早 8 点提醒我看天气”时，也会自动创建到这里。
      </p>

      <div className="agent-schedule-form">
        <div className="agent-schedule-form__field">
          <label htmlFor="agent-schedule-title">任务名称</label>
          <input
            id="agent-schedule-title"
            className="settings-input"
            type="text"
            value={scheduleForm.title}
            placeholder="例如 天气提醒"
            onChange={(event) => updateScheduleFormField("title", event.target.value)}
          />
        </div>

        <div className="agent-schedule-form__field">
          <label htmlFor="agent-schedule-mode">调度方式</label>
          <CustomSelect
            id="agent-schedule-mode"
            className="settings-input"
            value={scheduleForm.scheduleMode}
            options={[
              { value: "once", label: "单次任务" },
              { value: "daily", label: "每日" },
              { value: "weekly", label: "每周" },
              { value: "monthly", label: "每月" },
              { value: "yearly", label: "每年" },
              { value: "custom_days", label: "自定义天数" },
            ]}
            onChange={(value) =>
              updateScheduleFormField(
                "scheduleMode",
                value as AgentScheduledTaskScheduleMode
              )
            }
          />
        </div>

        {scheduleForm.scheduleMode === "once" ? (
          <div className="agent-schedule-form__field">
            <label htmlFor="agent-schedule-time">执行时间</label>
            <input
              id="agent-schedule-time"
              className="settings-input"
              type="datetime-local"
              value={scheduleForm.scheduledAt}
              onChange={(event) =>
                updateScheduleFormField("scheduledAt", event.target.value)
              }
            />
          </div>
        ) : (
          <div className="agent-schedule-form__field">
            <label htmlFor="agent-schedule-clock">执行时间</label>
            <input
              id="agent-schedule-clock"
              className="settings-input"
              type="time"
              value={scheduleForm.timeOfDay}
              onChange={(event) =>
                updateScheduleFormField("timeOfDay", event.target.value)
              }
            />
          </div>
        )}

        {scheduleForm.scheduleMode === "weekly" && (
          <div className="agent-schedule-form__field agent-schedule-form__field--wide">
            <label>选择星期</label>
            <div className="agent-schedule-weekday-grid">
              {WEEKDAY_OPTIONS.map((weekday) => {
                const checked = scheduleForm.weekdays.includes(weekday.value);

                return (
                  <button
                    type="button"
                    className={`agent-schedule-choice ${checked ? "is-selected" : ""}`}
                    key={weekday.value}
                    onClick={() =>
                      updateScheduleFormField(
                        "weekdays",
                        checked
                          ? scheduleForm.weekdays.filter((item) => item !== weekday.value)
                          : [...scheduleForm.weekdays, weekday.value].sort(
                              (left, right) => left - right
                            )
                      )
                    }
                  >
                    {weekday.label}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {scheduleForm.scheduleMode === "monthly" && (
          <div className="agent-schedule-form__field">
            <label htmlFor="agent-schedule-month-day">每月日期</label>
            <CustomSelect
              id="agent-schedule-month-day"
              className="settings-input"
              value={scheduleForm.monthDay}
              options={DAY_OF_MONTH_OPTIONS}
              onChange={(value) => updateScheduleFormField("monthDay", value)}
            />
          </div>
        )}

        {scheduleForm.scheduleMode === "yearly" && (
          <>
            <div className="agent-schedule-form__field">
              <label htmlFor="agent-schedule-year-month">月份</label>
              <CustomSelect
                id="agent-schedule-year-month"
                className="settings-input"
                value={scheduleForm.yearMonth}
                options={MONTH_OPTIONS}
                onChange={(value) => {
                  updateScheduleFormField("yearMonth", value);
                  const maxDay = getDaysInMonthForSettings(2028, Number(value) - 1);
                  if (Number(scheduleForm.yearMonthDay) > maxDay) {
                    updateScheduleFormField("yearMonthDay", String(maxDay));
                  }
                }}
              />
            </div>

            <div className="agent-schedule-form__field">
              <label htmlFor="agent-schedule-year-day">日期</label>
              <CustomSelect
                id="agent-schedule-year-day"
                className="settings-input"
                value={scheduleForm.yearMonthDay}
                options={buildDayOptions(
                  getDaysInMonthForSettings(2028, Number(scheduleForm.yearMonth) - 1)
                )}
                onChange={(value) => updateScheduleFormField("yearMonthDay", value)}
              />
            </div>
          </>
        )}

        {scheduleForm.scheduleMode === "custom_days" && (
          <div className="agent-schedule-form__field">
            <label htmlFor="agent-schedule-custom-days">间隔天数</label>
            <input
              id="agent-schedule-custom-days"
              className="settings-input"
              type="number"
              min={1}
              max={3650}
              value={scheduleForm.customIntervalDays}
              onChange={(event) =>
                updateScheduleFormField("customIntervalDays", event.target.value)
              }
            />
          </div>
        )}

        <div className="agent-schedule-form__field">
          <label htmlFor="agent-schedule-kind">任务类型</label>
          <CustomSelect
            id="agent-schedule-kind"
            className="settings-input"
            value={scheduleForm.kind}
            options={[
              { value: "reminder", label: "提醒" },
              { value: "ai_prompt", label: "AI 执行" },
            ]}
            onChange={(value) =>
              updateScheduleFormField("kind", value as AgentScheduledTaskKind)
            }
          />
        </div>

        <div className="agent-schedule-form__field">
          <label htmlFor="agent-schedule-model">执行模型</label>
          <CustomSelect
            id="agent-schedule-model"
            className="settings-input"
            value={scheduleForm.model}
            options={modelOptions.map((option) => ({
              value: option.id,
              label: `${option.label} · ${option.provider}`,
            }))}
            onChange={(value) => updateScheduleFormField("model", value as ModelType)}
          />
        </div>

        <div className="agent-schedule-form__field agent-schedule-form__field--wide">
          <label htmlFor="agent-schedule-prompt">任务内容</label>
          <textarea
            id="agent-schedule-prompt"
            className="settings-input settings-textarea"
            value={scheduleForm.prompt}
            placeholder="例如 到点提醒我看李沧区天气，并给出出门建议。"
            onChange={(event) => updateScheduleFormField("prompt", event.target.value)}
          />
        </div>

        <div className="agent-schedule-form__actions">
          <button type="button" className="primary-button" onClick={addScheduledTask}>
            <IoAdd size={18} />
            添加计划任务
          </button>
        </div>
      </div>

      {scheduleError && (
        <p className="settings-help-text settings-help-text--danger">{scheduleError}</p>
      )}

      <div className="agent-schedule-list">
        {scheduledTasks.length > 0 ? (
          scheduledTasks.map((task) => (
            <article
              className={`agent-schedule-card ${
                task.enabled && task.status === "pending" ? "is-enabled" : ""
              }`}
              key={task.id}
            >
              <div className="agent-schedule-card__body">
                <div className="agent-schedule-card__title">
                  <strong>{task.title}</strong>
                  <span className={`status-chip ${task.status === "failed" ? "is-danger" : ""}`}>
                    {formatScheduledTaskStatus(task)}
                  </span>
                </div>
                <div className="agent-schedule-meta">
                  <span>
                    <IoCalendarOutline size={14} />
                    {task.schedule_mode !== "once" ? "下次 " : ""}
                    {formatScheduledTaskTime(task.scheduled_at)}
                  </span>
                  <span>{formatScheduledTaskSchedule(task)}</span>
                  <span>{formatScheduledTaskKind(task.kind)}</span>
                  <span>{getModelMeta(config, task.model).label}</span>
                  <span>{task.source === "chat" ? "聊天创建" : "手动创建"}</span>
                </div>
                <p>{task.prompt}</p>
                {task.last_error && (
                  <p className="settings-help-text settings-help-text--danger">
                    上次执行失败：{task.last_error}
                  </p>
                )}
              </div>

              <div className="agent-schedule-card__actions">
                {task.status === "pending" ? (
                  <label className="settings-switch" title={task.enabled ? "暂停任务" : "启用任务"}>
                    <input
                      type="checkbox"
                      checked={task.enabled}
                      onChange={() => toggleScheduledTask(task.id)}
                    />
                    <span />
                  </label>
                ) : (
                  <button
                    type="button"
                    className="ghost-button"
                    onClick={() => resetScheduledTask(task.id)}
                  >
                    <IoRefresh size={16} />
                    重置
                  </button>
                )}
                <button
                  type="button"
                  className="ghost-button danger-button"
                  onClick={() => deleteScheduledTask(task.id)}
                >
                  <IoTrashOutline size={16} />
                  删除
                </button>
              </div>
            </article>
          ))
        ) : (
          <div className="agent-schedule-empty">
            暂无计划任务。可以先添加一个天气提醒、闹钟提醒或日程提醒。
          </div>
        )}
      </div>
    </div>
  );
}

export function createDefaultAgentScheduleForm(model: ModelType): AgentScheduleForm {
  const nextHour = Date.now() + 60 * 60 * 1000;
  return {
    title: "",
    prompt: "",
    scheduledAt: toLocalDateTimeInputValue(nextHour),
    timeOfDay: toLocalTimeInputValue(nextHour),
    kind: "reminder",
    scheduleMode: "once",
    weekdays: [getChineseWeekdayForSettings(nextHour)],
    monthDay: String(new Date(nextHour).getDate()),
    yearMonth: String(new Date(nextHour).getMonth() + 1),
    yearMonthDay: String(new Date(nextHour).getDate()),
    customIntervalDays: "2",
    model,
  };
}

export function buildInitialScheduleAnchor(timeOfDay: string, fromTime: number): number {
  const [hours, minutes] = normalizeAgentTaskTimeOfDay(timeOfDay, fromTime)
    .split(":")
    .map(Number);
  const candidate = new Date(fromTime);
  candidate.setHours(hours, minutes, 0, 0);

  if (candidate.getTime() <= fromTime) {
    candidate.setDate(candidate.getDate() + 1);
  }

  return candidate.getTime();
}

export function getDaysInMonthForSettings(year: number, monthIndex: number): number {
  return new Date(year, monthIndex + 1, 0).getDate();
}

export function scheduleModeToRecurrence(
  mode: AgentScheduledTaskScheduleMode
): AgentScheduledTask["recurrence"] {
  return mode === "once" ? undefined : mode;
}

function toLocalDateTimeInputValue(timestamp: number): string {
  const date = new Date(timestamp);
  const parts = [
    date.getFullYear(),
    padDatePart(date.getMonth() + 1),
    padDatePart(date.getDate()),
    padDatePart(date.getHours()),
    padDatePart(date.getMinutes()),
  ];

  return `${parts[0]}-${parts[1]}-${parts[2]}T${parts[3]}:${parts[4]}`;
}

function padDatePart(value: number): string {
  return String(value).padStart(2, "0");
}

function toLocalTimeInputValue(timestamp: number): string {
  const date = new Date(timestamp);
  return `${padDatePart(date.getHours())}:${padDatePart(date.getMinutes())}`;
}

function formatScheduledTaskTime(timestamp: number): string {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(timestamp));
}

function formatScheduledTaskKind(kind: AgentScheduledTaskKind): string {
  return kind === "reminder" ? "提醒" : "AI 执行";
}

function formatScheduledTaskSchedule(task: AgentScheduledTask): string {
  switch (task.schedule_mode) {
    case "once":
      return "单次";
    case "daily":
      return "每日";
    case "weekly":
      return `每周 ${formatWeekdays(task.weekdays)}`;
    case "monthly":
      return `每月 ${task.month_days?.[0] ?? 1} 号`;
    case "yearly":
      return `每年 ${task.year_month ?? 1} 月 ${task.year_month_day ?? 1} 号`;
    case "custom_days":
      return `每 ${task.custom_interval_days ?? 1} 天`;
    default:
      return "单次";
  }
}

function formatScheduledTaskStatus(task: AgentScheduledTask): string {
  if (task.status === "done") {
    return "已完成";
  }

  if (task.status === "failed") {
    return "执行失败";
  }

  return task.enabled ? "待执行" : "已暂停";
}

function buildDayOptions(maxDay: number) {
  return Array.from({ length: maxDay }, (_, index) => ({
    value: String(index + 1),
    label: `${index + 1} 号`,
  }));
}

function getChineseWeekdayForSettings(timestamp: number): number {
  const day = new Date(timestamp).getDay();
  return day === 0 ? 7 : day;
}

function formatWeekdays(weekdays: number[] | undefined): string {
  const selected = Array.isArray(weekdays) && weekdays.length ? weekdays : [1];
  return selected
    .slice()
    .sort((left, right) => left - right)
    .map((value) => WEEKDAY_OPTIONS.find((weekday) => weekday.value === value)?.label)
    .filter(Boolean)
    .join("、");
}
