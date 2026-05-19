"use client";

import * as React from "react";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

/**
 * DescriptionField — the project-wide reusable "Description / Notes"
 * input. Always renders a textarea (never a one-line input) so users get
 * room to type and the field auto-grows with content.
 *
 * Drop-in replacement anywhere a `Description`, `Notes`, or free-form
 * text field exists: pass `value`, `onChange(next)`, and an optional
 * `label`, `placeholder`, `hint`, `maxLength`, `rows`.
 */
export function DescriptionField({
  value,
  onChange,
  label = "Description",
  placeholder = "Optional notes…",
  hint,
  maxLength,
  rows = 3,
  required = false,
  disabled = false,
  autoFocus = false,
  id,
  className,
  textareaClassName,
}: {
  value: string;
  onChange: (next: string) => void;
  label?: React.ReactNode | null;
  placeholder?: string;
  hint?: React.ReactNode;
  maxLength?: number;
  rows?: number;
  required?: boolean;
  disabled?: boolean;
  autoFocus?: boolean;
  id?: string;
  className?: string;
  textareaClassName?: string;
}) {
  const reactId = React.useId();
  const fieldId = id ?? reactId;
  const showCounter = typeof maxLength === "number";
  const overLimit = showCounter && value.length > maxLength;

  return (
    <div className={cn("block space-y-1", className)}>
      {label !== null && (
        <div className="flex items-baseline justify-between gap-2">
          <label
            htmlFor={fieldId}
            className="text-xs font-medium"
          >
            {label}
            {required && <span className="ml-0.5 text-destructive">*</span>}
          </label>
          {showCounter && (
            <span
              className={cn(
                "text-[10px] tabular-nums",
                overLimit ? "text-destructive" : "text-muted-foreground",
              )}
            >
              {value.length}/{maxLength}
            </span>
          )}
        </div>
      )}
      <Textarea
        id={fieldId}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={rows}
        disabled={disabled}
        autoFocus={autoFocus}
        aria-invalid={overLimit || undefined}
        maxLength={maxLength}
        className={cn(
          "min-h-[72px] text-sm leading-snug",
          textareaClassName,
        )}
      />
      {hint && (
        <p className="text-[10px] text-muted-foreground">{hint}</p>
      )}
    </div>
  );
}
