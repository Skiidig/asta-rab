"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronsUpDown, LogOut, Settings, UserRound } from "lucide-react";
import { toast } from "sonner";

import { useAuth } from "@/components/providers/auth-provider";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toErrorMessage } from "@/lib/errors";
import { getInitials } from "@/lib/format";

/** Identitas pengguna yang sedang masuk, beserta aksi keluar. */
export function UserMenu() {
  const router = useRouter();
  const { user, displayName, signOut } = useAuth();
  const [signingOut, setSigningOut] = useState(false);

  const email = user?.email ?? "Pengguna";

  async function handleSignOut() {
    setSigningOut(true);

    try {
      await signOut();
      router.replace("/login");
    } catch (caught) {
      toast.error("Gagal keluar", { description: toErrorMessage(caught) });
    } finally {
      setSigningOut(false);
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Menu akun"
        className="flex items-center gap-2.5 rounded-lg py-1 pr-1.5 pl-1 transition-colors outline-none hover:bg-foreground/[0.04] data-[popup-open]:bg-foreground/[0.04]"
      >
        <span className="flex size-8 items-center justify-center rounded-full bg-primary-soft text-[11px] font-semibold text-primary ring-1 ring-primary/10">
          {getInitials(displayName)}
        </span>
        <span className="hidden max-w-[160px] text-left leading-tight sm:flex sm:flex-col">
          <span className="truncate text-[13px] font-medium text-foreground">
            {displayName}
          </span>
          <span className="truncate text-[11px] text-muted-foreground">
            {email}
          </span>
        </span>
        <ChevronsUpDown className="hidden size-3.5 text-muted-foreground sm:block" />
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="pb-2">
          <span className="block truncate text-[13px] font-medium text-foreground">
            {displayName}
          </span>
          <span className="block truncate text-xs font-normal text-muted-foreground">
            {email}
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem render={<Link href="/settings" />}>
          <UserRound />
          Profil saya
        </DropdownMenuItem>
        <DropdownMenuItem render={<Link href="/settings" />}>
          <Settings />
          Pengaturan
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant="destructive"
          disabled={signingOut}
          onClick={() => void handleSignOut()}
        >
          <LogOut />
          {signingOut ? "Keluar…" : "Keluar"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
