import * as React from "react";
import Link from "next/link";
import { cva, type VariantProps } from "class-variance-authority";
import { useRender } from "@base-ui/react/use-render";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium transition-colors duration-150 outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default:
          "bg-action text-action-foreground shadow-xs hover:bg-action-hover active:bg-action-hover",
        secondary:
          "border border-border bg-surface text-foreground shadow-xs hover:border-border-strong hover:bg-background active:bg-background",
        ghost: "text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground",
        outline:
          "border border-border-strong bg-transparent text-foreground hover:bg-foreground/[0.03]",
        destructive:
          "bg-danger text-danger-foreground shadow-xs hover:bg-danger/90 focus-visible:ring-danger/40",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 px-3.5",
        sm: "h-8 rounded-md px-3 text-[13px]",
        lg: "h-10 px-5",
        icon: "size-9",
        "icon-sm": "size-8 rounded-md",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

type ButtonVariantProps = VariantProps<typeof buttonVariants>;

export interface ButtonProps
  extends React.ComponentPropsWithRef<"button">,
    ButtonVariantProps {
  /**
   * Render as a different element, e.g. `render={<Link href="/rab" />}`.
   * Keeps link semantics (middle-click, prefetch) while looking like a button.
   */
  render?: React.ReactElement;
}

function Button({
  className,
  variant,
  size,
  type = "button",
  render,
  ...props
}: ButtonProps) {
  return useRender({
    defaultTagName: "button",
    render,
    props: {
      type: render ? undefined : type,
      "data-slot": "button",
      className: cn(buttonVariants({ variant, size }), className),
      ...props,
    },
  });
}

/** A link styled as a button — the common case for navigation actions. */
function ButtonLink({
  className,
  variant,
  size,
  href,
  ...props
}: React.ComponentProps<typeof Link> & ButtonVariantProps) {
  return (
    <Link
      href={href}
      data-slot="button"
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  );
}

export { Button, ButtonLink, buttonVariants };
