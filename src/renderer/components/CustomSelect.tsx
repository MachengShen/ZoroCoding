import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
} from "react";

export interface CustomSelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

interface CustomSelectProps {
  label: string;
  value: string;
  options: readonly CustomSelectOption[];
  onChange(value: string): void;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
}

function availableOptionIndexes(
  options: readonly CustomSelectOption[],
): number[] {
  return options.flatMap((option, index) =>
    option.disabled ? [] : [index],
  );
}

export function CustomSelect({
  label,
  value,
  options,
  onChange,
  disabled = false,
  placeholder = "请选择",
  className,
}: CustomSelectProps) {
  const listboxId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const selectedIndex = options.findIndex((option) => option.value === value);
  const enabledIndexes = useMemo(
    () => availableOptionIndexes(options),
    [options],
  );
  const optionStateKey = options
    .map((option) => `${option.value}:${option.disabled === true ? "0" : "1"}`)
    .join("\u0001");
  const fallbackIndex = enabledIndexes[0] ?? -1;
  const normalizedActiveIndex =
    selectedIndex >= 0 && !options[selectedIndex]?.disabled
      ? selectedIndex
      : fallbackIndex;
  const [activeIndex, setActiveIndex] = useState(normalizedActiveIndex);
  const effectiveActiveIndex = enabledIndexes.includes(activeIndex)
    ? activeIndex
    : normalizedActiveIndex;
  const controlDisabled = disabled || enabledIndexes.length === 0;
  const selectedOption = selectedIndex >= 0 ? options[selectedIndex] : undefined;

  useEffect(() => {
    if (!open) {
      return;
    }

    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !rootRef.current?.contains(event.target)
      ) {
        setOpen(false);
      }
    };

    document.addEventListener("pointerdown", closeOnOutsidePointer);
    return () =>
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
  }, [open]);

  useEffect(() => {
    if (controlDisabled) {
      setOpen(false);
      setActiveIndex(-1);
      return;
    }
    setActiveIndex(normalizedActiveIndex);
  }, [
    controlDisabled,
    normalizedActiveIndex,
    optionStateKey,
    value,
  ]);

  const resetActiveOption = () => {
    setActiveIndex(
      selectedIndex >= 0 && !options[selectedIndex]?.disabled
        ? selectedIndex
        : fallbackIndex,
    );
  };

  const openListbox = () => {
    if (controlDisabled) {
      return;
    }
    resetActiveOption();
    setOpen(true);
  };

  const moveActiveOption = (direction: 1 | -1) => {
    if (enabledIndexes.length === 0) {
      return;
    }
    const currentPosition = enabledIndexes.indexOf(effectiveActiveIndex);
    const nextPosition =
      currentPosition < 0
        ? direction === 1
          ? 0
          : enabledIndexes.length - 1
        : (currentPosition + direction + enabledIndexes.length) %
          enabledIndexes.length;
    setActiveIndex(enabledIndexes[nextPosition]);
  };

  const selectOption = (index: number) => {
    const option = options[index];
    if (option === undefined || option.disabled) {
      return;
    }
    onChange(option.value);
    setActiveIndex(index);
    setOpen(false);
    triggerRef.current?.focus();
  };

  const onTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (controlDisabled) {
      return;
    }

    switch (event.key) {
      case "ArrowDown":
      case "ArrowUp": {
        event.preventDefault();
        if (!open) {
          openListbox();
        } else {
          moveActiveOption(event.key === "ArrowDown" ? 1 : -1);
        }
        break;
      }
      case "Enter":
      case " ": {
        event.preventDefault();
        if (open) {
          selectOption(effectiveActiveIndex);
        } else {
          openListbox();
        }
        break;
      }
      case "Home": {
        if (open && enabledIndexes.length > 0) {
          event.preventDefault();
          setActiveIndex(enabledIndexes[0]);
        }
        break;
      }
      case "End": {
        if (open && enabledIndexes.length > 0) {
          event.preventDefault();
          setActiveIndex(enabledIndexes[enabledIndexes.length - 1]);
        }
        break;
      }
      case "Escape": {
        if (open) {
          event.preventDefault();
          setOpen(false);
          triggerRef.current?.focus();
        }
        break;
      }
      case "Tab":
        setOpen(false);
        break;
    }
  };

  const onRootBlur = (event: FocusEvent<HTMLDivElement>) => {
    if (
      event.relatedTarget instanceof Node &&
      rootRef.current?.contains(event.relatedTarget)
    ) {
      return;
    }
    setOpen(false);
  };

  const rootClassName = ["custom-select", className]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={rootClassName} ref={rootRef} onBlur={onRootBlur}>
      <button
        ref={triggerRef}
        className="custom-select-trigger"
        type="button"
        role="combobox"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-disabled={controlDisabled}
        aria-activedescendant={
          open && !controlDisabled && effectiveActiveIndex >= 0
            ? `${listboxId}-option-${effectiveActiveIndex}`
            : undefined
        }
        disabled={controlDisabled}
        value={value}
        onClick={() => {
          if (open) {
            setOpen(false);
          } else {
            openListbox();
          }
        }}
        onKeyDown={onTriggerKeyDown}
      >
        <span>{selectedOption?.label ?? placeholder}</span>
        <span className="custom-select-indicator" aria-hidden="true">
          {open ? "▲" : "▼"}
        </span>
      </button>

      {open && !controlDisabled ? (
        <div
          className="custom-select-listbox"
          id={listboxId}
          role="listbox"
          aria-label={label}
        >
          {options.map((option, index) => (
            <button
              className="custom-select-option"
              id={`${listboxId}-option-${index}`}
              key={option.value}
              type="button"
              role="option"
              aria-selected={option.value === value}
              disabled={option.disabled}
              data-active={
                index === effectiveActiveIndex ? "true" : "false"
              }
              tabIndex={-1}
              onPointerMove={() => {
                if (!option.disabled) {
                  setActiveIndex(index);
                }
              }}
              onClick={() => selectOption(index)}
            >
              {option.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
