import { AppSidebar } from "@/components/app-sidebar"
import { AuthGuard } from "@/components/auth/auth-guard"
import { MobileNav } from "@/components/mobile-nav"
import { RouteGuard } from "@/components/route-guard"

export default function AppLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <AuthGuard>
      <div className="flex min-h-screen">
        <AppSidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <MobileNav />
          <main className="flex-1 px-4 pt-4 pb-12 sm:px-6 lg:px-12 lg:pt-10 lg:pb-16">
            {/* One content column on every page: 1120px wide at most, centred. */}
            <div className="mx-auto w-full max-w-[1120px]">
              <RouteGuard>{children}</RouteGuard>
            </div>
          </main>
        </div>
      </div>
    </AuthGuard>
  )
}
