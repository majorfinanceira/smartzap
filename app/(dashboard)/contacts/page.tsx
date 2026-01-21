import { Suspense } from 'react'
import { getContactsInitialData } from './actions'
import { ContactsClientWrapper } from './ContactsClientWrapper'
import { ContactsSkeleton } from '@/components/features/contacts/ContactsSkeleton'

// ISR: revalida a cada 60 segundos
export const revalidate = 60

async function ContactsWithData() {
  const initialData = await getContactsInitialData()
  return <ContactsClientWrapper initialData={initialData} />
}

/**
 * Contacts Page - RSC Híbrido
 */
export default function ContactsPage() {
  return (
    <Suspense fallback={<ContactsSkeleton />}>
      <ContactsWithData />
    </Suspense>
  )
}
