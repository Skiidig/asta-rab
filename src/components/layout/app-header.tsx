"use client";

import { useState } from "react";
import Link from "next/link";
import { Bell, Menu, Search } from "lucide-react";
import { toast } from "sonner";

import { AppSidebar } from "@/components/layout/app-sidebar";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { ThemeMenu } from "@/components/layout/theme-menu";
import { useHeaderOverride } from "@/components/layout/header-context";
import { UserMenu } from "@/components/layout/user-menu";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";

export function AppHeader({ title }: { title: string }) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const override = useHeaderOverride();
  const displayTitle = override.title ?? title;

  return (
    <header className="sticky top-0 z-30 border-b border-border bg-surface/85 backdrop-blur-md">
      <div className="flex h-16 items-center gap-3 px-4 sm:px-6 lg:px-8">
        <Button
          id="mobile-nav-trigger"
          variant="ghost"
          size="icon"
          className="lg:hidden"
          aria-label="Buka navigasi"
          onClick={() => setMobileNavOpen(true)}
        >
          <Menu className="size-5" />
        </Button>

        <div className="min-w-0 flex-1">
          <h1 className="truncate text-[15px] font-semibold tracking-tight text-foreground">
            {displayTitle}
          </h1>
          <Breadcrumbs />
        </div>
        <Link
          href="/projects"
          aria-label="Buka daftar proyek untuk mencari"
          className="hidden h-9 items-center gap-2 rounded-lg border border-border bg-background/60 px-3 text-[13px] text-muted-foreground transition-colors hover:border-border-strong hover:text-foreground md:flex md:w-56"
        >
          <Search className="size-4" />
          <span>Cari proyek…</span>
        </Link>

        <ThemeMenu />

        <button
          type="button"
          aria-label="Notifikasi"
          onClick={() =>
            toast.info("Belum ada notifikasi", {
              description:
                "Notifikasi akan tersedia setelah autentikasi ditambahkan.",
            })
          }
          className="relative flex size-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-foreground/[0.05] hover:text-foreground"
        >
          <Bell className="size-[18px]" strokeWidth={1.8} />
          <span className="absolute top-2 right-2 size-2 rounded-full bg-primary ring-2 ring-surface" />
        </button>

        <div aria-hidden className="h-6 w-px bg-border" />

        <UserMenu />
      </div>

      {/* Mobile navigation drawer: satu area logo dari AppSidebar. */}
      <Dialog
        open={mobileNavOpen}
        onOpenChange={(open) => {
          setMobileNavOpen(open);
          if (!open) {
            // Kembalikan fokus ke tombol menu setelah drawer ditutup.
            requestAnimationFrame(() => {
              document.getElementById("mobile-nav-trigger")?.focus();
            });
          }
        }}
      >
        <DialogContent className="top-0 left-0 flex h-dvh max-h-none w-[280px] max-w-[85vw] translate-x-0 translate-y-0 flex-col rounded-none border-y-0 border-l-0 p-0 data-[starting-style]:scale-100 data-[starting-style]:-translate-x-full data-[ending-style]:scale-100 data-[ending-style]:-translate-x-full">
          <DialogTitle className="sr-only">Navigasi</DialogTitle>
          <div className="min-h-0 flex-1 bg-sidebar">
            <AppSidebar
              className="w-full"
              onNavigate={() => setMobileNavOpen(false)}
            />
          </div>
        </DialogContent>
      </Dialog>
    </header>
  );
}
