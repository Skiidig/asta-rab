import type { Metadata } from "next";

import { ProjectDetailView } from "@/components/projects/project-detail-view";

/**
 * Project detail is rendered from Supabase through `DataProvider` on the
 * client, so the server cannot know the project name. Render in one pass and
 * let the view hydrate — the name is reflected in the app header once loaded.
 */
export const instant = false;

export const metadata: Metadata = {
  title: "Detail Proyek",
};

export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return <ProjectDetailView key={id} projectId={id} />;
}
