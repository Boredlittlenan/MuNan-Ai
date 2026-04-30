import { useEffect, useId, useMemo, useRef, useState } from "react";

export type CustomSelectOption = {
  value: string;
  label: string;
  disabled?: boolean;
};

type CustomSelectProps = {
  id?: string;
  className?: string;
  value: string;
  options: CustomSelectOption[];
  placeholder?: string;
  disabled?: boolean;
  onChange: (value: string) => void;
};

export function CustomSelect({
  id,
  className = "",
  value,
  options,
  placeholder = "请选择",
  disabled = false,
  onChange,
}: CustomSelectProps) {
  const generatedId = useId();
  const menuId = `${id ?? generatedId}-menu`;
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);

  const selectedOption = useMemo(
    () => options.find((option) => option.value === value),
    [options, value]
  );

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

  const handleOptionClick = (option: CustomSelectOption) => {
    if (option.disabled) {
      return;
    }

    onChange(option.value);
    setOpen(false);
  };

  return (
    <div className="custom-select" ref={rootRef}>
      <button
        id={id}
        type="button"
        className={`custom-select__button ${className}`}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((current) => !current)}
      >
        <span className={selectedOption ? "custom-select__label" : "custom-select__placeholder"}>
          {selectedOption?.label ?? placeholder}
        </span>
        <span className="custom-select__chevron" aria-hidden="true" />
      </button>

      {open && !disabled && (
        <div className="custom-select__menu" id={menuId} role="listbox" aria-labelledby={id}>
          {options.length === 0 ? (
            <div className="custom-select__empty">暂无可选项</div>
          ) : (
            options.map((option) => (
              <button
                key={option.value}
                type="button"
                className={`custom-select__option${
                  option.value === value ? " is-selected" : ""
                }${option.disabled ? " is-disabled" : ""}`}
                role="option"
                aria-selected={option.value === value}
                disabled={option.disabled}
                onClick={() => handleOptionClick(option)}
              >
                <span>{option.label}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
