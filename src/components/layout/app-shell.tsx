import { AppHeader } from "@/components/layout/app-header";
import { AppSidebar } from "@/components/layout/app-sidebar";

/**
 * Desktop-first application shell: a fixed dark sidebar on large screens and
 * a sticky header with a slide-in navigation drawer on smaller screens.
 */
export function AppShell({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-dvh bg-background">
      <div className="fixed inset-y-0 left-0 z-40 hidden lg:block">
        <AppSidebar />
      </div>

      <div className="lg:pl-[264px]">
        <AppHeader title={title} />
        <main className="mx-auto min-w-0 w-full max-w-[1600px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8 2xl:px-10">
          {children}
        </main>
      </div>
    </div>
  );
}
