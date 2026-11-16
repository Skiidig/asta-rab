"use client";

import { Toaster as SonnerToaster } from "sonner";

import { useTheme } from "@/components/providers/theme-provider";

/**
 * App-wide toast host. Styled to match the product rather than Sonner's
 * defaults: token surface, subtle border, readable text in both themes.
 */
function Toaster() {
  const { resolvedTheme } = useTheme();

  return (
    <SonnerToaster
      theme={resolvedTheme}
      position="bottom-right"
      gap={8}
      toastOptions={{
        classNames: {
          toast:
            "!rounded-lg !border !border-border !bg-surface !text-foreground !shadow-overlay !text-[13px]",
          description: "!text-muted-foreground",
          actionButton: "!bg-action !text-action-foreground",
          cancelButton: "!bg-foreground/[0.06] !text-foreground",
        },
      }}
    />
  );
}

export { Toaster };
