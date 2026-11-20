import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "md" | "lg";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  icon?: ReactNode;
}

const base =
  "inline-flex items-center justify-center gap-2 rounded-ctl font-semibold whitespace-nowrap select-none " +
  "transition-[background-color,box-shadow,transform,color] duration-150 active:scale-[0.98] " +
  "disabled:pointer-events-none disabled:opacity-50";

const variants: Record<Variant, string> = {
  primary: "bg-accent-strong text-white shadow-soft hover:bg-[#1765cc] hover:shadow-lift",
  secondary: "bg-surface text-ink shadow-soft ring-1 ring-line hover:bg-subtle",
  ghost: "text-muted hover:bg-subtle hover:text-ink",
  danger: "bg-bad-soft text-[#b3261e] hover:bg-[#f9d9d5]",
};

const sizes: Record<Size, string> = {
  md: "h-10 px-4 text-body",
  lg: "h-12 px-6 text-body",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", icon, className = "", children, ...rest },
  ref,
) {
  return (
    <button ref={ref} className={`${base} ${variants[variant]} ${sizes[size]} ${className}`} {...rest}>
      {icon}
      {children}
    </button>
  );
});
