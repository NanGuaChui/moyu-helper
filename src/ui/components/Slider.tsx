/**
 * Slider 组件
 */
import { JSX } from 'preact';

interface SliderProps {
  value: number;
  onChange?: (value: number) => void;
  onInput?: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  style?: JSX.CSSProperties;
  disabled?: boolean;
}

export function Slider({
  value,
  onChange,
  onInput,
  min = 0,
  max = 100,
  step = 1,
  style = {},
  disabled = false,
}: SliderProps) {
  const handleInput = (e: Event) => {
    const target = e.target as HTMLInputElement;
    const newValue = Number(target.value);
    onInput?.(newValue);
  };

  const handleChange = (e: Event) => {
    const target = e.target as HTMLInputElement;
    const newValue = Number(target.value);
    onChange?.(newValue);
  };

  return (
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      onInput={handleInput}
      onChange={handleChange}
      disabled={disabled}
      style={{
        width: '100%',
        cursor: disabled ? 'not-allowed' : 'pointer',
        ...style,
      }}
    />
  );
}
