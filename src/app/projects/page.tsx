import type { Metadata } from "next";

import { ProjectsView } from "@/components/projects/projects-view";

// Ditahan AuthGate sampai sesi diketahui; opt-out validasi khusus segmen ini.
export const instant = false;

export const metadata: Metadata = {
  title: "Proyek",
};

export default function ProjectsPage() {
  return <ProjectsView />;
}
