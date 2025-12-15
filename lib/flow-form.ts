export type FlowFormFieldType =
  | 'short_text'
  | 'long_text'
  | 'email'
  | 'phone'
  | 'number'
  | 'date'
  | 'dropdown'
  | 'single_choice'
  | 'multi_choice'
  | 'optin'

export type FlowFormOption = { id: string; title: string }

export type FlowFormFieldV1 = {
  id: string
  name: string
  label: string
  type: FlowFormFieldType
  required: boolean
  placeholder?: string
  options?: FlowFormOption[]
  /** usado no opt-in */
  text?: string
}

export type FlowFormSpecV1 = {
  version: 1
  screenId: string
  title: string
  intro?: string
  submitLabel: string
  fields: FlowFormFieldV1[]
}

function safeString(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

export function normalizeFlowFieldName(input: string): string {
  return (input || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
}

function normalizeScreenId(input: string): string {
  const raw = (input || '').trim().toUpperCase()
  const cleaned = raw.replace(/[^A-Z0-9_]/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '')
  return cleaned || 'FORM'
}

export function normalizeFlowFormSpec(input: unknown, fallbackTitle?: string): FlowFormSpecV1 {
  const baseTitle = (fallbackTitle || 'Formulário').trim() || 'Formulário'

  const defaults: FlowFormSpecV1 = {
    version: 1,
    screenId: 'FORM',
    title: baseTitle,
    intro: 'Preencha os dados abaixo:',
    submitLabel: 'Enviar',
    fields: [],
  }

  if (!isPlainObject(input)) return defaults

  const fieldsRaw = Array.isArray(input.fields) ? input.fields : []

  const fields: FlowFormFieldV1[] = fieldsRaw
    .map((f: any, idx: number): FlowFormFieldV1 | null => {
      if (!f || typeof f !== 'object') return null
      const type = safeString(f.type) as FlowFormFieldType
      const allowed: FlowFormFieldType[] = [
        'short_text',
        'long_text',
        'email',
        'phone',
        'number',
        'date',
        'dropdown',
        'single_choice',
        'multi_choice',
        'optin',
      ]
      const normalizedType: FlowFormFieldType = allowed.includes(type) ? type : 'short_text'

      const label = safeString(f.label, `Pergunta ${idx + 1}`).trim() || `Pergunta ${idx + 1}`
      const rawName = safeString(f.name, normalizeFlowFieldName(label))
      const name = normalizeFlowFieldName(rawName) || `campo_${idx + 1}`
      const id = safeString(f.id, `q_${idx + 1}`) || `q_${idx + 1}`
      const required = typeof f.required === 'boolean' ? f.required : false

      const out: FlowFormFieldV1 = {
        id,
        name,
        label,
        type: normalizedType,
        required,
      }

      const placeholder = safeString(f.placeholder, '').trim()
      if (placeholder) out.placeholder = placeholder

      if (normalizedType === 'optin') {
        const text = safeString(f.text, label).trim() || label
        out.text = text
      }

      if (normalizedType === 'dropdown' || normalizedType === 'single_choice' || normalizedType === 'multi_choice') {
        const optionsRaw = Array.isArray(f.options) ? f.options : []
        const options: FlowFormOption[] = optionsRaw
          .map((o: any, oidx: number): FlowFormOption | null => {
            if (!o || typeof o !== 'object') return null
            const title = safeString(o.title, '').trim() || `Opção ${oidx + 1}`
            const id = safeString(o.id, normalizeFlowFieldName(title)).trim() || `${oidx + 1}`
            return { id, title }
          })
          .filter(Boolean) as FlowFormOption[]

        out.options = options.length > 0 ? options : [{ id: 'opcao_1', title: 'Opção 1' }]
      }

      return out
    })
    .filter(Boolean) as FlowFormFieldV1[]

  return {
    version: 1,
    screenId: normalizeScreenId(safeString(input.screenId, defaults.screenId)),
    title: safeString(input.title, defaults.title).trim() || defaults.title,
    intro: safeString(input.intro, defaults.intro).trim() || defaults.intro,
    submitLabel: safeString(input.submitLabel, defaults.submitLabel).trim() || defaults.submitLabel,
    fields,
  }
}

export function generateFlowJsonFromFormSpec(form: FlowFormSpecV1): Record<string, unknown> {
  const children: any[] = []

  if (form.intro && form.intro.trim()) {
    children.push({
      type: 'TextBody',
      text: form.intro.trim(),
    })
  }

  for (const field of form.fields) {
    if (field.type === 'optin') {
      children.push({
        type: 'OptIn',
        name: field.name,
        label: (field.text || field.label || '').trim() || 'Quero receber mensagens',
      })
      continue
    }

    if (field.type === 'dropdown') {
      children.push({
        type: 'Dropdown',
        name: field.name,
        label: field.label,
        required: !!field.required,
        'data-source': Array.isArray(field.options) ? field.options : [],
      })
      continue
    }

    if (field.type === 'single_choice') {
      children.push({
        type: 'RadioButtonsGroup',
        name: field.name,
        label: field.label,
        required: !!field.required,
        'data-source': Array.isArray(field.options) ? field.options : [],
      })
      continue
    }

    if (field.type === 'multi_choice') {
      children.push({
        type: 'CheckboxGroup',
        name: field.name,
        label: field.label,
        required: !!field.required,
        'data-source': Array.isArray(field.options) ? field.options : [],
      })
      continue
    }

    if (field.type === 'date') {
      children.push({
        type: 'DatePicker',
        name: field.name,
        label: field.label,
        required: !!field.required,
      })
      continue
    }

    if (field.type === 'number') {
      children.push({
        type: 'TextInput',
        name: field.name,
        label: field.label,
        required: !!field.required,
      })
      continue
    }

    if (field.type === 'long_text') {
      children.push({
        type: 'TextArea',
        name: field.name,
        label: field.label,
        required: !!field.required,
      })
      continue
    }

    // short_text, email, phone (e outros) como TextInput
    children.push({
      type: 'TextInput',
      name: field.name,
      label: field.label,
      required: !!field.required,
    })
  }

  children.push({
    type: 'Footer',
    label: form.submitLabel || 'Enviar',
    'on-click-action': { name: 'complete' },
  })

  return {
    version: '7.3',
    screens: [
      {
        id: form.screenId,
        title: form.title,
        terminal: true,
        layout: {
          type: 'SingleColumnLayout',
          children,
        },
      },
    ],
  }
}

export function validateFlowFormSpec(form: FlowFormSpecV1): string[] {
  const issues: string[] = []

  if (!form.title.trim()) issues.push('Defina um título para o formulário')
  if (!form.screenId.trim()) issues.push('Defina um ID de tela (screenId)')

  const names = new Set<string>()
  for (const f of form.fields) {
    if (!f.label.trim()) issues.push('Existe uma pergunta sem título')
    if (!f.name.trim()) issues.push(`A pergunta "${f.label}" está sem identificador (name)`) 

    if (f.name && !/^[a-z0-9_]+$/.test(f.name)) {
      issues.push(`Campo "${f.label}": name inválido (use apenas a-z, 0-9 e _)`)
    }
    if (names.has(f.name)) issues.push(`Identificador duplicado: ${f.name}`)
    names.add(f.name)

    if ((f.type === 'dropdown' || f.type === 'single_choice' || f.type === 'multi_choice') && (!f.options || f.options.length < 1)) {
      issues.push(`Campo "${f.label}": adicione pelo menos 1 opção`)
    }
  }

  // Máximo recomendado pela Meta: 50 componentes por tela.
  // Aqui: intro (0/1) + campos + footer.
  const componentCount = (form.intro?.trim() ? 1 : 0) + form.fields.length + 1
  if (componentCount > 50) issues.push(`Muitos campos para uma única tela (${componentCount}/50). Divida em mais de 1 tela.`)

  return issues
}
