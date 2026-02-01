/**
 * Row 组件
 */
import { JSX, ComponentChildren } from 'preact';

interface RowProps {
  label?: string;
  children: ComponentChildren;
  align?: 'start' | 'center' | 'end' | 'space-between';
  gap?: number;
  style?: JSX.CSSProperties;
  className?: string;
}

const ROW_STYLE: JSX.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  marginBottom: '8px',
};

const LABEL_STYLE: JSX.CSSProperties = {
  fontSize: '12px',
  color: '#666',
  minWidth: '80px',
};

export function Row({ label, children, align = 'space-between', gap = 8, style = {}, className = '' }: RowProps) {
  const rowStyle: JSX.CSSProperties = {
    ...ROW_STYLE,
    justifyContent: align,
    gap: `${gap}px`,
    ...style,
  };

  return (
    <div className={className} style={rowStyle}>
      {label && <span style={LABEL_STYLE}>{label}</span>}
      {children}
    </div>
  );
}
