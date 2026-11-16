import type { Metadata } from "next";

import { RabEditor } from "@/components/rab/editor/rab-editor";

/**
 * The editor reads its document from Supabase through `DataProvider` on the
 * client, so the server cannot know the document title. Render the route in one
 * pass and let the editor hydrate — the title is reflected in the app header by
 * `useSetHeaderOverride` once the data arrives.
 */
export const instant = false;

export const metadata: Metadata = {
  title: "Dokumen RAB",
};

export default async function RabDetailPage({
  params,
}: PageProps<"/rab/[id]">) {
  const { id } = await params;

  return <RabEditor key={id} documentId={id} />;
}
