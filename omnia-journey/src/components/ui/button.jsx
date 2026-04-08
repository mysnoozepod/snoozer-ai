import * as React from "react";
import { cva } from "class-variance-authority";
import { cn } from "@/lib/utils"; // ⚠️ make sure this exists

// Tailwind style variants
const buttonVariants = cva(
  "inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50 disabled:pointer-events-none ring-offset-background",
  {
    variants: {
      variant: {
        default: "bg-indigo-600 text-white hover:bg-indigo-500",
        outline:
          "border border-gray-300 bg-transparent hover:bg-gray-100 text-gray-900",
        ghost:
          "bg-transparent hover:bg-gray-100 text-gray-700 hover:text-gray-900",
        destructive: "bg-red-600 text-white hover:bg-red-500",
        link: "underline-offset-4 hover:underline text-indigo-600",
      },
      size: {
        sm: "h-8 px-3 text-xs",
        md: "h-10 px-4 text-sm",
        lg: "h-12 px-6 text-base",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "md",
    },
  }
);

const Button = React.forwardRef(
  ({ className, variant, size, ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={cn(buttonVariants({ variant, size }), className)}
        {...props}
      />
    );
  }
);

Button.displayName = "Button";

export { Button, buttonVariants };
