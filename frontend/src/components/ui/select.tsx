import * as PopoverPrimitive from "@radix-ui/react-popover";
import * as SelectPrimitive from "@radix-ui/react-select";
import { Check, ChevronDown, ChevronUp, X } from "lucide-react";
import { cn } from "../../lib/utils";
import { useOverlayContainer } from "./overlay-context";

const emptyOptionValue = "__after_life_empty_option__";

export interface SelectOption {
  value: string;
  label: string;
  description?: string;
  disabled?: boolean;
}

export interface SelectProps {
  value: string;
  options: SelectOption[];
  onValueChange: (value: string) => void;
  ariaLabel: string;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  id?: string;
  name?: string;
  required?: boolean;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
}

export function Select(props: SelectProps) {
  const container = useOverlayContainer();
  const hasEmptyOption = props.options.some((option) => option.value === "");
  const value = props.value === "" ? emptyOptionValue : props.value;

  return (
    <SelectPrimitive.Root
      value={value}
      disabled={props.disabled}
      name={props.name}
      required={props.required}
      onValueChange={(nextValue) =>
        props.onValueChange(nextValue === emptyOptionValue ? "" : nextValue)
      }
    >
      <SelectPrimitive.Trigger
        className={cn("ui-select-trigger", props.className)}
        aria-label={props.ariaLabel}
        id={props.id}
        aria-describedby={props["aria-describedby"]}
        aria-invalid={props["aria-invalid"]}
      >
        <SelectPrimitive.Value placeholder={props.placeholder} />
        <SelectPrimitive.Icon className="ui-select-chevron">
          <ChevronDown aria-hidden="true" size={17} strokeWidth={1.8} />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal container={container}>
        <SelectPrimitive.Content
          className="ui-select-content"
          position="popper"
          sideOffset={6}
          align="start"
        >
          <SelectPrimitive.ScrollUpButton className="ui-select-scroll-button">
            <ChevronUp aria-hidden="true" size={16} />
          </SelectPrimitive.ScrollUpButton>
          <SelectPrimitive.Viewport className="ui-select-viewport">
            {!hasEmptyOption && props.value === "" ? (
              <SelectPrimitive.Item className="ui-select-item" disabled value={emptyOptionValue}>
                <span className="ui-select-item-copy">
                  <SelectPrimitive.ItemText>
                    {props.placeholder || "请选择"}
                  </SelectPrimitive.ItemText>
                </span>
              </SelectPrimitive.Item>
            ) : null}
            {props.options.map((option) => (
              <SelectPrimitive.Item
                className="ui-select-item"
                disabled={option.disabled}
                key={option.value || emptyOptionValue}
                value={option.value || emptyOptionValue}
              >
                <span className="ui-select-item-copy">
                  <SelectPrimitive.ItemText>{option.label}</SelectPrimitive.ItemText>
                  {option.description ? <small>{option.description}</small> : null}
                </span>
                <SelectPrimitive.ItemIndicator className="ui-select-indicator">
                  <Check aria-hidden="true" size={16} strokeWidth={2.2} />
                </SelectPrimitive.ItemIndicator>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Viewport>
          <SelectPrimitive.ScrollDownButton className="ui-select-scroll-button">
            <ChevronDown aria-hidden="true" size={16} />
          </SelectPrimitive.ScrollDownButton>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}

export interface MultiSelectProps {
  value: string[];
  options: SelectOption[];
  onValueChange: (value: string[]) => void;
  ariaLabel: string;
  placeholder?: string;
  emptyText?: string;
  disabled?: boolean;
  className?: string;
  id?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
}

export function MultiSelect(props: MultiSelectProps) {
  const container = useOverlayContainer();
  const selectedOptions = props.options.filter((option) => props.value.includes(option.value));
  const summary = getSelectionSummary(selectedOptions, props.placeholder || "请选择");

  function toggleValue(value: string) {
    props.onValueChange(
      props.value.includes(value)
        ? props.value.filter((item) => item !== value)
        : [...props.value, value],
    );
  }

  return (
    <PopoverPrimitive.Root>
      <PopoverPrimitive.Trigger asChild>
        <button
          className={cn("ui-select-trigger ui-multiselect-trigger", props.className)}
          type="button"
          aria-label={props.ariaLabel}
          id={props.id}
          aria-describedby={props["aria-describedby"]}
          aria-invalid={props["aria-invalid"]}
          disabled={props.disabled}
        >
          <span className={cn("ui-multiselect-value", !selectedOptions.length && "is-placeholder")}>
            {summary}
          </span>
          {selectedOptions.length ? (
            <span className="ui-multiselect-count">{selectedOptions.length}</span>
          ) : null}
          <ChevronDown
            className="ui-select-chevron"
            aria-hidden="true"
            size={17}
            strokeWidth={1.8}
          />
        </button>
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal container={container}>
        <PopoverPrimitive.Content
          aria-label={props.ariaLabel}
          className="ui-multiselect-content"
          sideOffset={6}
          align="start"
          collisionPadding={12}
        >
          <div className="ui-multiselect-head">
            <span>已选择 {selectedOptions.length} 项</span>
            {selectedOptions.length ? (
              <button type="button" onClick={() => props.onValueChange([])}>
                <X aria-hidden="true" size={14} />
                清空
              </button>
            ) : null}
          </div>
          <div className="ui-multiselect-options" role="group" aria-label={props.ariaLabel}>
            {props.options.length ? (
              props.options.map((option) => (
                <label className="ui-multiselect-option" key={option.value}>
                  <input
                    type="checkbox"
                    checked={props.value.includes(option.value)}
                    disabled={option.disabled}
                    onChange={() => toggleValue(option.value)}
                  />
                  <span className="ui-multiselect-check" aria-hidden="true">
                    <Check size={14} strokeWidth={2.4} />
                  </span>
                  <span className="ui-multiselect-option-copy">
                    <strong>{option.label}</strong>
                    {option.description ? <small>{option.description}</small> : null}
                  </span>
                </label>
              ))
            ) : (
              <p className="ui-multiselect-empty">{props.emptyText || "暂无可选项"}</p>
            )}
          </div>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}

function getSelectionSummary(options: SelectOption[], placeholder: string) {
  if (!options.length) return placeholder;
  if (options.length <= 2) return options.map((option) => option.label).join("、");
  return `${options[0].label} 等 ${options.length} 项`;
}
