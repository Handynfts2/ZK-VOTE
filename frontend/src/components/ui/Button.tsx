import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none min-h-[48px] sm:min-h-[36px] touch-manipulation active:scale-[0.98]",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground hover:bg-primary/90 disabled:bg-muted disabled:text-muted-foreground",
        destructive:
          "bg-destructive text-destructive-foreground hover:bg-destructive/90 disabled:opacity-50",
        outline:
          "border border-input bg-background hover:bg-accent hover:text-accent-foreground disabled:opacity-50",
        secondary:
          "border border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80 disabled:opacity-50",
        ghost:
          "hover:bg-accent hover:text-accent-foreground disabled:opacity-50",
        link: "text-primary underline-offset-4 hover:underline disabled:opacity-50",
      },
      size: {
        default: "min-h-[44px] h-11 px-4 py-2 sm:h-10 sm:min-h-0",
        sm: "min-h-[44px] h-10 rounded-md px-3 sm:h-9 sm:min-h-0",
        lg: "min-h-[48px] h-12 rounded-md px-8 sm:h-11",
        icon: "min-h-[44px] min-w-[44px] h-11 w-11 sm:h-10 sm:w-10 sm:min-h-0 sm:min-w-0",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends
    React.ButtonHTMLAttributes<HTMLButtonElement>,
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
  },
);
Button.displayName = "Button";

// eslint-disable-next-line react-refresh/only-export-components -- Standard shadcn pattern
export { Button, buttonVariants };
