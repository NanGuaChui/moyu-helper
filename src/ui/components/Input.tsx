/**
 * Input 组件
 */
import { JSX } from 'preact';

interface InputProps {
  type?: 'text' | 'number';
  value: string | number;
  onChange?: (value: string) => void;
  onInput?: (value: string) => void;
  placeholder?: string;
  min?: number;
  max?: number;
  step?: number;
  style?: JSX.CSSProperties;
  className?: string;
  disabled?: boolean;
  prefix?: string | JSX.Element;
  suffix?: string | JSX.Element;
}

export function Input({
  type = 'text',
  value,
  onChange,
  onInput,
  placeholder,
  min,
  max,
  step,
  style = {},
  className = '',
  disabled = false,
  prefix,
  suffix,
}: InputProps) {
  const handleInput = (e: Event) => {
    const target = e.target as HTMLInputElement;
    const newValue = target.value;
    if (onInput) {
      onInput(newValue);
    }
    if (onChange) {
      onChange(newValue);
    }
  };

  const handleContainerFocus = (e: Event) => {
    const target = e.currentTarget as HTMLElement;
    target.style.borderColor = '#6366f1';
    target.style.boxShadow = '0 0 0 3px rgba(99, 102, 241, 0.1)';
  };

  const handleContainerBlur = (e: Event) => {
    const target = e.currentTarget as HTMLElement;
    target.style.borderColor = 'rgba(0, 0, 0, 0.12)';
    target.style.boxShadow = 'none';
  };

  const containerStyle: JSX.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '6px 8px',
    border: '1px solid rgba(0, 0, 0, 0.12)',
    borderRadius: '6px',
    fontSize: '13px',
    background: '#ffffff',
    transition: 'all 0.2s ease',
    boxSizing: 'border-box',
    ...style,
  };

  const inputStyle: JSX.CSSProperties = {
    flex: 1,
    border: 'none',
    outline: 'none',
    padding: 0,
    fontSize: '13px',
    color: '#1a1a1a',
    background: 'transparent',
    width: 'auto',
    minWidth: 0,
    WebkitAppearance: 'none',
    appearance: 'none',
  };

  const affixStyle: JSX.CSSProperties = {
    fontSize: '12px',
    color: '#666',
    whiteSpace: 'nowrap',
    userSelect: 'none',
    flexShrink: 0,
  };

  return (
    <div style={containerStyle} onFocusCapture={handleContainerFocus} onBlurCapture={handleContainerBlur}>
      {prefix && <span style={affixStyle}>{prefix}</span>}
      <input
        type={type}
        className={className}
        style={inputStyle}
        value={value}
        onInput={handleInput}
        onChange={handleInput}
        placeholder={placeholder}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
      />
      {suffix && <span style={affixStyle}>{suffix}</span>}
    </div>
  );
}
