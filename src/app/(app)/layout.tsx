import { auth } from "@/lib/auth";
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import Sidebar from "@/components/layout/Sidebar";
import Topbar from "@/components/layout/Topbar";
import PipelineSSEProvider from "@/components/pipeline/PipelineSSEProvider";
import OnboardingProvider from "@/components/providers/OnboardingProvider";
import { Toaster } from "sonner";

const SONNER_TOAST_CONFIG = {
  position: "bottom-right" as const,
  duration: 5000,
  richColors: true,
  closeButton: true,
};

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();

  return (
    <SidebarProvider>
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded focus:bg-background focus:px-4 focus:py-2 focus:text-sm focus:shadow"
      >
        Aller au contenu principal
      </a>
      <Sidebar role={session?.user?.role as "admin" | "editor" | "viewer" | undefined} />
      <SidebarInset>
        <Topbar
          companyName={session?.user?.company_id ?? ""}
          userEmail={session?.user?.email ?? undefined}
        />
        <main id="main-content" className="flex-1 p-6">
          <PipelineSSEProvider>
            <OnboardingProvider userId={session?.user?.user_id ?? ""}>
              {children}
            </OnboardingProvider>
          </PipelineSSEProvider>
        </main>
      </SidebarInset>
      <Toaster {...SONNER_TOAST_CONFIG} />
    </SidebarProvider>
  );
}
