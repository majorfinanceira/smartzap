import { PageLayoutScope } from '@/components/providers/PageLayoutProvider'

export default function NewCampaignLayout({ children }: { children: React.ReactNode }) {
  // Wizard em “app mode”: altura cheia + controle de scroll interno,
  // mas mantendo padding e largura semelhante ao Dashboard.
  return (
    <PageLayoutScope
      value={{
        width: 'content',
        padded: true,
        overflow: 'hidden',
        height: 'full',
        showAccountAlerts: false,
      }}
    >
      {children}
    </PageLayoutScope>
  )
}
