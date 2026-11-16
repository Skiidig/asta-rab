import type { Metadata } from "next";

import { AhspEditor } from "@/components/ahsp/ahsp-editor";

/**
 * Editor AHSP membaca datanya dari Supabase lewat provider klien, sehingga
 * judul sebenarnya baru diketahui setelah data dimuat. Render satu kali dan
 * biarkan klien mengisi header aplikasi.
 */
export const instant = false;

export const metadata: Metadata = {
  title: "Analisis AHSP",
};

export default async function AhspDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return <AhspEditor key={id} analysisId={id} />;
}
