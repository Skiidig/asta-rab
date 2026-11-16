"use client";

import { Check, Monitor, Moon, Sun } from "lucide-react";

import { useTheme, type ThemeMode } from "@/components/providers/theme-provider";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

const OPTIONS: Array<{
  value: ThemeMode;
  label: string;
  Icon: typeof Sun;
}> = [
  { value: "light", label: "Terang", Icon: Sun },
  { value: "dark", label: "Gelap", Icon: Moon },
  { value: "system", label: "Ikuti sistem", Icon: Monitor },
];

/** Akses ringkas tema di header; pengaturan lengkap ada di Settings. */
export function ThemeMenu() {
  const { mode, resolvedTheme, setThemeMode } = useTheme();
  const CurrentIcon =
    mode === "system" ? Monitor : resolvedTheme === "dark" ? Moon : Sun;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`Tema tampilan: ${
          OPTIONS.find((option) => option.value === mode)?.label ?? "Ikuti sistem"
        }`}
        title="Tema tampilan"
        className="flex size-9 items-center justify-center rounded-lg text-muted-foreground transition-colors outline-none hover:bg-foreground/[0.05] hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary/40"
      >
        <CurrentIcon className="size-[18px]" strokeWidth={1.8} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuLabel>Tema tampilan</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {OPTIONS.map((option) => {
          const Icon = option.Icon;
          return (
            <DropdownMenuItem
              key={option.value}
              onClick={() => setThemeMode(option.value)}
            >
              <Icon />
              {option.label}
              <Check
                className={cn(
                  "ml-auto size-4",
                  mode === option.value ? "opacity-100" : "opacity-0",
                )}
              />
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
