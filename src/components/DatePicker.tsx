import { useEffect, useMemo, useRef, useState } from "react";

type DatePickerProps = {
  id?: string;
  className?: string;
  value: string;
  placeholder?: string;
  onChange: (value: string) => void;
};

const WEEKDAYS = ["一", "二", "三", "四", "五", "六", "日"];

function ChevronIcon({ direction }: { direction: "left" | "right" }) {
  return (
    <svg
      aria-hidden="true"
      className="custom-date__nav-icon"
      fill="none"
      viewBox="0 0 20 20"
    >
      <path
        d={direction === "left" ? "M12.5 15 7.5 10l5-5" : "m7.5 15 5-5-5-5"}
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      />
    </svg>
  );
}

function ClearIcon() {
  return (
    <svg
      aria-hidden="true"
      className="custom-date__action-icon"
      fill="none"
      viewBox="0 0 20 20"
    >
      <path
        d="m7 7 6 6m0-6-6 6"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.9"
      />
      <path
        d="M10 17.25a7.25 7.25 0 1 0 0-14.5 7.25 7.25 0 0 0 0 14.5Z"
        stroke="currentColor"
        strokeWidth="1.6"
      />
    </svg>
  );
}

function TodayIcon() {
  return (
    <svg
      aria-hidden="true"
      className="custom-date__action-icon"
      fill="none"
      viewBox="0 0 20 20"
    >
      <path
        d="M5.25 4.25h9.5a2 2 0 0 1 2 2v8.25a2 2 0 0 1-2 2h-9.5a2 2 0 0 1-2-2V6.25a2 2 0 0 1 2-2Z"
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth="1.6"
      />
      <path
        d="M6.5 2.75v3m7-3v3M3.75 7.75h12.5"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.6"
      />
      <path d="M7.25 10.4h5.5v3.35h-5.5z" fill="currentColor" opacity="0.18" />
    </svg>
  );
}

function parseDateValue(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);

  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);
  const date = new Date(year, month, day);

  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month ||
    date.getDate() !== day
  ) {
    return null;
  }

  return date;
}

function formatDateValue(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function getMonthGrid(viewDate: Date) {
  const firstDay = new Date(viewDate.getFullYear(), viewDate.getMonth(), 1);
  const mondayOffset = (firstDay.getDay() + 6) % 7;
  const gridStart = new Date(firstDay);
  gridStart.setDate(firstDay.getDate() - mondayOffset);

  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(gridStart);
    date.setDate(gridStart.getDate() + index);
    return date;
  });
}

export function DatePicker({
  id,
  className = "",
  value,
  placeholder = "选择日期",
  onChange,
}: DatePickerProps) {
  const selectedDate = useMemo(() => parseDateValue(value), [value]);
  const [open, setOpen] = useState(false);
  const [viewDate, setViewDate] = useState(() => selectedDate ?? new Date());
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (selectedDate) {
      setViewDate(selectedDate);
    }
  }, [selectedDate]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  const days = useMemo(() => getMonthGrid(viewDate), [viewDate]);
  const todayValue = formatDateValue(new Date());
  const selectedValue = selectedDate ? formatDateValue(selectedDate) : "";
  const displayValue = selectedDate
    ? `${selectedDate.getFullYear()}-${String(selectedDate.getMonth() + 1).padStart(2, "0")}-${String(
        selectedDate.getDate()
      ).padStart(2, "0")}`
    : placeholder;

  const changeMonth = (amount: number) => {
    setViewDate((current) => new Date(current.getFullYear(), current.getMonth() + amount, 1));
  };

  const selectDate = (date: Date) => {
    onChange(formatDateValue(date));
    setViewDate(date);
    setOpen(false);
  };

  return (
    <div className="custom-date" ref={rootRef}>
      <button
        id={id}
        type="button"
        className={`custom-date__button ${className}`}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((current) => !current)}
      >
        <span className={selectedDate ? "custom-date__label" : "custom-date__placeholder"}>
          {displayValue}
        </span>
        <span className="custom-date__icon" aria-hidden="true" />
      </button>

      {open && (
        <div className="custom-date__panel" role="dialog" aria-label="选择日期">
          <div className="custom-date__header">
            <button
              type="button"
              className="custom-date__nav"
              onClick={() => changeMonth(-1)}
              aria-label="上个月"
              title="上个月"
            >
              <ChevronIcon direction="left" />
            </button>
            <strong>
              {viewDate.getFullYear()}年{viewDate.getMonth() + 1}月
            </strong>
            <button
              type="button"
              className="custom-date__nav"
              onClick={() => changeMonth(1)}
              aria-label="下个月"
              title="下个月"
            >
              <ChevronIcon direction="right" />
            </button>
          </div>

          <div className="custom-date__weekdays">
            {WEEKDAYS.map((weekday) => (
              <span key={weekday}>{weekday}</span>
            ))}
          </div>

          <div className="custom-date__grid">
            {days.map((date) => {
              const dateValue = formatDateValue(date);
              const outsideMonth = date.getMonth() !== viewDate.getMonth();

              return (
                <button
                  key={dateValue}
                  type="button"
                  className={`custom-date__day${outsideMonth ? " is-muted" : ""}${
                    dateValue === todayValue ? " is-today" : ""
                  }${dateValue === selectedValue ? " is-selected" : ""}`}
                  onClick={() => selectDate(date)}
                >
                  {date.getDate()}
                </button>
              );
            })}
          </div>

          <div className="custom-date__footer">
            <button
              type="button"
              className="custom-date__text-button"
              onClick={() => {
                onChange("");
                setOpen(false);
              }}
            >
              <ClearIcon />
              <span>清空</span>
            </button>
            <button
              type="button"
              className="custom-date__text-button"
              onClick={() => selectDate(new Date())}
            >
              <TodayIcon />
              <span>今天</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
