import { Page, PageActions, PageDescription, PageHeader, PageTitle } from '@/components/ui/page'
import { Container } from '@/components/ui/container'

/**
 * Skeleton do Dashboard para Suspense/Streaming.
 * Exibido enquanto os dados estão sendo carregados no servidor.
 */
export function DashboardSkeleton() {
  return (
    <Page>
      <PageHeader>
        <div>
          <PageTitle>Dashboard</PageTitle>
          <PageDescription>Visão geral da performance de mensagens</PageDescription>
        </div>
        <PageActions>
          <div className="h-10 w-36 bg-zinc-800 rounded-lg animate-pulse" />
        </PageActions>
      </PageHeader>

      {/* Stats Grid Skeleton */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        {[...Array(4)].map((_, i) => (
          <div
            key={i}
            className="h-28 bg-zinc-800/50 rounded-2xl animate-pulse border border-white/5"
          />
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Chart Skeleton */}
        <Container variant="glass" padding="lg" className="lg:col-span-2">
          <div className="flex items-center justify-between mb-8">
            <div className="h-6 w-40 bg-zinc-800 rounded animate-pulse" />
            <div className="flex gap-2">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="h-7 w-10 bg-zinc-800 rounded-lg animate-pulse" />
              ))}
            </div>
          </div>
          <div className="h-72 w-full bg-zinc-800/30 rounded-xl animate-pulse" />
        </Container>

        {/* Recent Campaigns Skeleton */}
        <Container variant="glass" padding="none" className="flex flex-col overflow-hidden">
          <div className="p-6 border-b border-white/5 flex justify-between items-center">
            <div className="h-6 w-44 bg-zinc-800 rounded animate-pulse" />
            <div className="h-5 w-5 bg-zinc-800 rounded animate-pulse" />
          </div>
          <div className="flex-1 bg-zinc-900/50">
            {[...Array(5)].map((_, i) => (
              <div
                key={i}
                className="px-6 py-5 border-b border-white/5 flex justify-between items-center"
              >
                <div className="space-y-2">
                  <div className="h-4 w-32 bg-zinc-800 rounded animate-pulse" />
                  <div className="h-3 w-20 bg-zinc-800/60 rounded animate-pulse" />
                </div>
                <div className="h-6 w-20 bg-zinc-800 rounded-full animate-pulse" />
              </div>
            ))}
          </div>
          <div className="p-4 border-t border-white/5">
            <div className="h-4 w-24 bg-zinc-800 rounded animate-pulse mx-auto" />
          </div>
        </Container>
      </div>
    </Page>
  )
}
