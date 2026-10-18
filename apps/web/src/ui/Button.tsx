import type { ButtonHTMLAttributes, ReactNode } from 'react';

/** Icon-friendly button: the label doubles as tooltip and accessible name. */
export function Button({ label, children, active = false, className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string;
  children: ReactNode;
  active?: boolean;
}) {
  return (
    <button {...props} type="button" title={label} aria-label={label} className={`${active ? 'active ' : ''}${className}`}>
      {children}
    </button>
  );
}
