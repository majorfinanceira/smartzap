'use client'

import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'

import { Page, PageActions, PageDescription, PageHeader, PageTitle } from '@/components/ui/page'
import { Button } from '@/components/ui/button'
import { FlowBuilderListView } from '@/components/features/flows/builder/FlowBuilderListView'
import { useFlowsBuilderController } from '@/hooks/useFlowsBuilder'

export default function FlowBuilderHomePage() {
  const controller = useFlowsBuilderController()

  return (
    <Page>
      <PageHeader>
        <div className="space-y-1">
          <PageTitle>Flow Builder</PageTitle>
          <PageDescription>
            Crie flows a partir de templates e edite o Flow JSON (Meta). O canvas é opcional e ajuda a organizar a lógica.
          </PageDescription>
        </div>
        <PageActions>
          <Link href="/templates?tab=flows">
            <Button variant="outline" className="border-white/10 bg-zinc-900 hover:bg-white/5">
              <ArrowLeft className="w-4 h-4" />
              Voltar
            </Button>
          </Link>
        </PageActions>
      </PageHeader>

      <FlowBuilderListView
        flows={controller.flows}
        isLoading={controller.isLoading}
        isFetching={controller.isFetching}
        search={controller.search}
        onSearchChange={controller.setSearch}
        onCreate={controller.createFlow}
        onCreateFromTemplate={controller.createFlowFromTemplate}
        onCreateWithAI={controller.createFlowWithAI}
        isCreating={controller.isCreating}
        isCreatingWithAI={controller.isCreatingWithAI}
        onDelete={controller.deleteFlow}
        isDeleting={controller.isDeleting}
        onRefresh={() => controller.refetch()}
      />
    </Page>
  )
}
