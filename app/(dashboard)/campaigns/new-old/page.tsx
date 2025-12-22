'use client'

import { useCampaignWizardController } from '@/hooks/useCampaignWizard'
import { CampaignWizardView } from '@/components/features/campaigns/CampaignWizardView'

export default function NewCampaignPage() {
  const controller = useCampaignWizardController()

  return (
    <CampaignWizardView
      step={controller.step}
      setStep={controller.setStep}
      name={controller.name}
      setName={controller.setName}
      selectedTemplateId={controller.selectedTemplateId}
      setSelectedTemplateId={controller.setSelectedTemplateId}
      recipientSource={controller.recipientSource}
      setRecipientSource={controller.setRecipientSource}
      totalContacts={controller.totalContacts}
      recipientCount={controller.recipientCount}
      allContacts={controller.allContacts}
      filteredContacts={controller.filteredContacts}
      contactSearchTerm={controller.contactSearchTerm}
      setContactSearchTerm={controller.setContactSearchTerm}
      selectedContacts={controller.selectedContacts}
      selectedContactIds={controller.selectedContactIds}
      toggleContact={controller.toggleContact}
      audiencePreset={controller.audiencePreset}
      audienceCriteria={controller.audienceCriteria}
      topTag={controller.topTag}
      applyAudienceCriteria={controller.applyAudienceCriteria}
      selectAudiencePreset={controller.selectAudiencePreset}
      audienceStats={controller.audienceStats}
      availableTemplates={controller.availableTemplates}
      selectedTemplate={controller.selectedTemplate}
      handleNext={controller.handleNext}
      handleBack={controller.handleBack}
      handlePrecheck={controller.handlePrecheck}
      handleSend={controller.handleSend}
      isCreating={controller.isCreating}
      testContact={controller.testContact}
      isEnsuringTestContact={controller.isEnsuringTestContact}
      precheckResult={controller.precheckResult}
      isPrechecking={controller.isPrechecking}
      // Template Variables
      templateVariables={controller.templateVariables}
      setTemplateVariables={controller.setTemplateVariables}
      templateVariableCount={controller.templateVariableCount}
      templateVariableInfo={controller.templateVariableInfo}
      // Account Limits
      accountLimits={controller.accountLimits}
      isBlockModalOpen={controller.isBlockModalOpen}
      setIsBlockModalOpen={controller.setIsBlockModalOpen}
      blockReason={controller.blockReason}
      liveValidation={controller.liveValidation}
      isOverLimit={controller.isOverLimit}
      currentLimit={controller.currentLimit}
    />
  )
}
