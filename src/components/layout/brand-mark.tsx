import Image from "next/image";

import darkFull from "@/assets/branding/astaworks-full.png";
import lightFull from "@/assets/branding/astaworks-full-light.png";
import arrow from "@/assets/branding/astaworks-arrow.png";
import darkWordmark from "@/assets/branding/astaworks-wordmark.png";
import lightWordmark from "@/assets/branding/astaworks-wordmark-light.png";
import { cn } from "@/lib/utils";

type BrandVariant = "wordmark" | "full" | "arrow";

/**
 * Logo Astaworks dari aset sumber terbaru di `src/assets/branding/rev/`.
 *
 * Varian:
 * - `wordmark` (default): wordmark tanpa tagline, untuk sidebar/drawer.
 * - `full`: wordmark + tagline, untuk login dan pratinjau identitas.
 * - `arrow`: area ringkas/mobile.
 *
 * Dua versi warna dirender berdampingan dan dipilih lewat `[data-theme]`:
 * tema terang memakai aset gelap, tema gelap memakai varian krem dengan aksen
 * biru tetap. Tidak ada kotak putih, invert, peregangan, atau object-cover.
 */
export function BrandMark({
  className,
  variant = "wordmark",
  width,
  priority = false,
}: {
  className?: string;
  variant?: BrandVariant;
  width?: number;
  priority?: boolean;
}) {
  const defaultWidth =
    variant === "arrow" ? 28 : variant === "full" ? 220 : 168;
  const resolvedWidth = width ?? defaultWidth;

  return (
    <span
      role="img"
      aria-label="Astaworks"
      className={cn("inline-flex shrink-0 items-center", className)}
      style={{ width: resolvedWidth }}
    >
      {variant === "arrow" ? (
        <Image
          src={arrow}
          alt=""
          aria-hidden
          priority={priority}
          className="h-auto w-full"
        />
      ) : (
        <>
          <Image
            src={variant === "full" ? darkFull : darkWordmark}
            alt=""
            aria-hidden
            priority={priority}
            className="brand-logo-light h-auto w-full"
          />
          <Image
            src={variant === "full" ? lightFull : lightWordmark}
            alt=""
            aria-hidden
            priority={priority}
            className="brand-logo-dark h-auto w-full"
          />
        </>
      )}
    </span>
  );
}
