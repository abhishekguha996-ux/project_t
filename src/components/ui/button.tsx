import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils/cn";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 rounded-full text-[13px] font-semibold tracking-[0.02em] transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/25 disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default:
          "border border-[#4f46e5]/50 bg-[linear-gradient(135deg,#6366f1_0%,#4f46e5_55%,#4338ca_100%)] text-primary-foreground shadow-[0_1px_2px_rgba(16,24,40,0.06),0_12px_26px_-12px_rgba(79,70,229,0.65)] hover:-translate-y-[1px] hover:brightness-105",
        outline:
          "border border-border/90 bg-white/90 text-foreground shadow-[0_1px_2px_rgba(16,24,40,0.04)] hover:border-[#c7d2fe] hover:bg-[#f8faff]",
        ghost: "text-muted-foreground hover:bg-secondary/80 hover:text-foreground"
      },
      size: {
        default: "h-11 px-5",
        sm: "h-9 px-4 text-xs",
        lg: "h-12 px-6 text-sm"
      }
    },
    defaultVariants: {
      variant: "default",
      size: "default"
    }
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";

    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  }
);

Button.displayName = "Button";

export { Button, buttonVariants };
