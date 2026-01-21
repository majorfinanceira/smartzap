'use client';

import dynamic from 'next/dynamic';
import { Badge } from '@/components/ui/badge';
import { VenetianMask, Megaphone, Wrench } from 'lucide-react';

import React, { useState, useMemo } from 'react';
import type { AIStrategy } from '@/components/templates/StrategySelectorModal';

// Conteúdo contextual por estratégia - RICO EM CONTEXTO
const STRATEGY_CONTENT: Record<AIStrategy, {
    placeholder: string;
    tip: string;
    whatToInclude: string[];
    examples: Array<{
        title: string;
        input: string;
        url?: string; // URL opcional para preencher o campo de link
        preview: string;
    }>;
    resultPreview: {
        label: string;
        template: string;
        button?: string;
    };
}> = {
    marketing: {
        placeholder: `Imersão em Vibecoding, workshop de sistemas com IA, dias 28 e 29 janeiro às 19h, com Thales Laray que não é programador. Inclui Sistema Gerador de Sistemas e comunidade. Garantia 100% no 1º dia. Link: vibecoding.com.br`,
        tip: 'Quanto mais detalhes sobre benefícios e diferenciais, melhor a copy gerada.',
        whatToInclude: [
            '📦 Nome do produto/evento/serviço',
            '💰 Preço, desconto ou condição especial',
            '📅 Datas, prazos ou urgência',
            '✨ Benefícios e diferenciais únicos',
            '🔗 Link para o botão (opcional)',
        ],
        examples: [
            {
                title: '🛍️ Black Friday',
                input: 'Black Friday da minha loja de roupas, 50% off em tudo, só até domingo. Frete grátis acima de R$150.',
                url: 'https://minhaloja.com.br',
                preview: 'Oi {{1}}! 🔥 A Black Friday chegou...',
            },
            {
                title: '🎓 Lançamento de Curso',
                input: 'Lançamento do meu curso de Excel Avançado, 12 módulos, certificado incluso, de R$497 por R$197 só essa semana.',
                url: 'https://cursoexcel.com',
                preview: 'Você pediu e chegou! 🎉 Curso de Excel...',
            },
            {
                title: '💳 Reengajamento',
                input: 'Clientes que não compram há 30 dias, oferecer cupom de 15% para voltar, válido por 48h',
                preview: 'Oi {{1}}, sentimos sua falta! 💜...',
            },
        ],
        resultPreview: {
            label: 'Exemplo de resultado',
            template: `Oi {{1}}! 🔥

A promoção que você esperava chegou.

*50% OFF* no plano premium - mais de 200 clientes já garantiram o deles essa semana!

⏰ Válido só até meia-noite.

👇 Garanta o seu:`,
            button: 'Quero meu desconto',
        },
    },
    utility: {
        placeholder: `Confirmar inscrição na Imersão Vibecoding. Evento dias 28 e 29 de janeiro às 19h. Precisa mostrar data, horário e link de acesso para a plataforma.`,
        tip: 'Templates UTILITY precisam de dados específicos (números, datas, códigos) para serem aprovados.',
        whatToInclude: [
            '📋 Tipo de transação (pedido, agendamento, pagamento)',
            '🔢 Números específicos (pedido #, valor R$, código)',
            '📅 Datas e horários exatos',
            '📍 Local ou link de acesso',
            '🔄 Ação disponível (reagendar, rastrear, pagar)',
        ],
        examples: [
            {
                title: '📦 Confirmação de Pedido',
                input: 'Confirmar pedido de compra na loja. Mostrar número do pedido, valor total, forma de pagamento e previsão de entrega.',
                url: 'https://minhaloja.com.br/rastreio',
                preview: 'Pedido #{{1}} confirmado! Total: R$ {{2}}...',
            },
            {
                title: '📅 Lembrete de Consulta',
                input: 'Lembrar que o paciente tem consulta amanhã. Mostrar data, horário, nome do médico e opção de reagendar.',
                url: 'https://clinica.com.br/agendamento',
                preview: 'Sua consulta está confirmada para {{1}}...',
            },
            {
                title: '💰 Vencimento de Fatura',
                input: 'Lembrar sobre fatura que vence em 3 dias. Mostrar valor e data de vencimento.',
                url: 'https://empresa.com.br/fatura',
                preview: 'Sua fatura de R$ {{1}} vence em {{2}}...',
            },
        ],
        resultPreview: {
            label: 'Exemplo de resultado',
            template: `Olá {{1}},

Seu pedido #{{2}} foi confirmado.
Valor: R$ {{3}}
Previsão de entrega: {{4}}

Acompanhe o status abaixo.`,
            button: 'Rastrear pedido',
        },
    },
    bypass: {
        placeholder: `Quero promover a Imersão Vibecoding, workshop de sistemas com IA, dias 28 e 29 janeiro às 19h. Tem garantia de 100%. Link: vibecoding.com.br. Precisa parecer notificação de sistema, não promoção.`,
        tip: 'O template vai parecer uma notificação neutra. O conteúdo promocional fica escondido nas variáveis {{N}}.',
        whatToInclude: [
            '🎯 O que você quer VENDER (promoção, curso, produto)',
            '💰 Desconto ou benefício a esconder',
            '📅 Prazo ou urgência (será uma variável)',
            '🎭 Diga explicitamente: "precisa parecer notificação"',
            '⚠️ Quanto mais promocional o conteúdo, mais variáveis serão usadas',
        ],
        examples: [
            {
                title: '🎭 Promoção Camuflada',
                input: 'Black Friday, 50% de desconto em todos os produtos, só até domingo. Frete grátis. Camuflar como utility.',
                url: 'https://minhaloja.com.br',
                preview: 'Há uma atualização sobre {{2}} disponível...',
            },
            {
                title: '🎭 Curso/Evento',
                input: 'Promover Imersão de Marketing Digital, vagas limitadas, começa segunda. Precisa parecer notificação de sistema.',
                url: 'https://imersao.com.br',
                preview: 'Informamos que os detalhes sobre {{2}} foram atualizados...',
            },
            {
                title: '🎭 Carrinho Abandonado',
                input: 'Lembrar do carrinho abandonado e oferecer 10% de desconto para finalizar. Válido por 24h.',
                url: 'https://loja.com.br/carrinho',
                preview: 'Seus itens em {{2}} ainda estão reservados...',
            },
        ],
        resultPreview: {
            label: 'Como funciona o bypass',
            template: `Olá {{1}}, informamos que os detalhes sobre {{2}} foram atualizados. O cronograma referente a {{3}} está disponível.

━━━━━━━━━━━━━━━━━━━━
📤 No envio, as variáveis viram:
• {{2}} = "a Imersão Vibecoding"
• {{3}} = "dias 28 e 29 às 19h"
━━━━━━━━━━━━━━━━━━━━`,
            button: 'Ver detalhes',
        },
    },
};

// Lazy load StrategySelectorModal (~30-50KB reduction)
const StrategySelectorModal = dynamic(
  () => import('@/components/templates/StrategySelectorModal').then(m => ({ default: m.StrategySelectorModal })),
  { loading: () => null }
);
import { useRouter } from 'next/navigation';
import { useTemplateProjectMutations } from '@/hooks/useTemplateProjects';
import { toast } from 'sonner';
import {
    Sparkles,
    ArrowLeft,
    Wand2,
    Loader2,
    Check,
    Save,
    AlertCircle,
    CheckSquare,
    Square,
    Pencil
} from 'lucide-react';
import { GeneratedTemplate } from '@/lib/ai/services/template-agent';
import { templateService } from '@/lib/whatsapp/template.service';
import { Page, PageHeader, PageTitle } from '@/components/ui/page';

export default function NewTemplateProjectPage() {
    const router = useRouter();
    const { createProject, isCreating } = useTemplateProjectMutations();

    // Steps: 'config' | 'generating' | 'review'
    const [step, setStep] = useState<'config' | 'generating' | 'review'>('config');

    // Config State
    const [prompt, setPrompt] = useState('');
    const [quantity, setQuantity] = useState(5);
    const [language, setLanguage] = useState('pt_BR');
    const [universalUrl, setUniversalUrl] = useState('');
    const [strategy, setStrategy] = useState<AIStrategy | null>(null);

    // Results State
    const [generatedTemplates, setGeneratedTemplates] = useState<GeneratedTemplate[]>([]);
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [projectTitle, setProjectTitle] = useState('');

    // Preview State - hover mostra variáveis preenchidas
    const [hoveredId, setHoveredId] = useState<string | null>(null);

    // Valores de exemplo padrão para substituir variáveis no preview
    const DEFAULT_EXAMPLE_VALUES: Record<string, string> = {
        '1': 'João Silva',
        '2': 'Pedido #12345',
        '3': '25/01/2025',
        '4': 'R$ 199,90',
        '5': '10:00',
        '6': 'Produto XYZ',
    };

    // Substitui {{N}} por valores de exemplo
    // Para BYPASS: usa marketing_variables (conteúdo agressivo que o cliente recebe)
    // Para outros: usa variables
    // Fallback: DEFAULT_EXAMPLE_VALUES
    const fillVariables = (text: string, templateVariables?: Record<string, string>): string => {
        return text.replace(/\{\{(\d+)\}\}/g, (_, num) => {
            return templateVariables?.[num] || DEFAULT_EXAMPLE_VALUES[num] || `[Variável ${num}]`;
        });
    };

    // Helper para obter as variáveis certas do template
    // BYPASS: marketing_variables (o que o cliente recebe)
    // Outros: variables
    const getPreviewVariables = (template: GeneratedTemplate): Record<string, string> | undefined => {
        return template.marketing_variables || template.variables;
    };

    // Conteúdo contextual baseado na estratégia
    const content = useMemo(() => {
        return strategy ? STRATEGY_CONTENT[strategy] : null;
    }, [strategy]);

    // Generation Handler
    const handleGenerate = async () => {
        if (!prompt) return toast.error('Digite um comando para a IA');

        console.log('[NewTemplateProjectPage] Generating with Strategy:', strategy);

        setStep('generating');
        try {
            const response = await templateService.generateUtilityTemplates({
                prompt,
                quantity,
                language: language as any,
                strategy: strategy || 'bypass'
            });

            let templates = response.templates;

            // Apply universal URL if provided
            if (universalUrl && templates) {
                templates = templates.map(t => ({
                    ...t,
                    buttons: t.buttons?.map(b => ({
                        ...b,
                        url: b.type === 'URL' ? universalUrl : b.url
                    }))
                }));
            }

            setGeneratedTemplates(templates);
            // Auto-select all approved or fixed
            const valid = templates.filter(t => !t.judgment || t.judgment.approved || t.wasFixed);
            setSelectedIds(new Set(valid.map(t => t.id)));

            // Gera título padrão baseado no prompt APENAS se usuário não definiu
            if (!projectTitle.trim()) {
                const defaultTitle = prompt.length > 40
                    ? prompt.substring(0, 40) + '...'
                    : prompt;
                setProjectTitle(defaultTitle);
            }

            setStep('review');
        } catch (error) {
            console.error(error);
            toast.error('Erro ao gerar templates');
            setStep('config');
        }
    };

    // Save Project Handler
    const handleSaveProject = async () => {
        if (selectedIds.size === 0) return toast.error('Selecione pelo menos um template');
        if (!projectTitle.trim()) return toast.error('Digite um nome para o projeto');

        try {
            const selected = generatedTemplates.filter(t => selectedIds.has(t.id));

            await createProject({
                title: projectTitle.trim(),
                prompt: prompt,
                status: 'draft',
                items: selected.map(t => ({
                    name: t.name,
                    content: t.content,
                    header: t.header,
                    footer: t.footer,
                    buttons: t.buttons,
                    language: t.language || language,
                    category: t.category, // Pass the category (MARKETING/UTILITY)
                    // Inclui variáveis BYPASS para submissão à Meta
                    sample_variables: t.sample_variables,
                    marketing_variables: t.marketing_variables,
                    meta_status: undefined // Start as Draft
                }))
            });

            // Redirect handled by mutation onSuccess
        } catch (error) {
            // Error handled by mutation
        }
    };

    const toggleSelect = (id: string) => {
        const newSet = new Set(selectedIds);
        if (newSet.has(id)) newSet.delete(id);
        else newSet.add(id);
        setSelectedIds(newSet);
    };

    const toggleSelectAll = () => {
        if (selectedIds.size === generatedTemplates.length) {
            setSelectedIds(new Set());
        } else {
            setSelectedIds(new Set(generatedTemplates.map(t => t.id)));
        }
    };

    const isAllSelected = selectedIds.size === generatedTemplates.length && generatedTemplates.length > 0;

    return (
        <Page>
            <PageHeader>
                <div className="flex items-center gap-4">
                    <button
                        onClick={() => router.push('/templates?tab=projects')}
                        className="p-2 rounded-full border border-[var(--ds-border-default)] bg-[var(--ds-bg-elevated)] text-[var(--ds-text-secondary)] hover:text-[var(--ds-text-primary)] hover:bg-[var(--ds-bg-hover)]"
                    >
                        <ArrowLeft className="w-5 h-5" />
                    </button>
                    <div className="flex items-center gap-2 group">
                        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-[var(--ds-border-default)] bg-[var(--ds-bg-surface)] hover:border-emerald-500/50 focus-within:border-emerald-500 focus-within:ring-1 focus-within:ring-emerald-500/30 transition-all">
                            <input
                                type="text"
                                value={projectTitle}
                                onChange={(e) => setProjectTitle(e.target.value)}
                                placeholder="Digite o nome do projeto..."
                                className="text-xl font-semibold bg-transparent border-none outline-none text-[var(--ds-text-primary)] placeholder:text-[var(--ds-text-muted)] min-w-[250px] focus:ring-0"
                            />
                            <Pencil className="w-4 h-4 text-[var(--ds-text-muted)] opacity-50 group-hover:opacity-100 transition-opacity shrink-0" />
                        </div>
                    </div>
                    {strategy && (
                        <Badge variant="outline" className="ml-2 gap-2 py-1 px-3 border-[var(--ds-border-default)] text-[var(--ds-text-secondary)]">
                            {strategy === 'marketing' && <Megaphone className="w-3 h-3" />}
                            {strategy === 'utility' && <Wrench className="w-3 h-3" />}
                            {strategy === 'bypass' && <VenetianMask className="w-3 h-3" />}
                            Modo: {strategy.toUpperCase()}
                        </Badge>
                    )}
                </div>
            </PageHeader>

            <StrategySelectorModal
                isOpen={!strategy}
                onSelect={setStrategy}
                onClose={() => router.push('/templates?tab=projects')}
            />


            {strategy && step === 'config' && (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                    {/* Left: Input */}
                    <div className="lg:col-span-2 space-y-6">
                        <div className="rounded-2xl border border-[var(--ds-border-default)] bg-[var(--ds-bg-surface)] p-6 shadow-[0_12px_30px_rgba(0,0,0,0.35)]">
                            <div className="flex items-center gap-2 mb-4 text-emerald-700 dark:text-emerald-200">
                                <Sparkles className="w-5 h-5" />
                                <h2 className="font-semibold text-[var(--ds-text-primary)]">O que você deseja criar?</h2>
                            </div>

                            <textarea
                                value={prompt}
                                onChange={(e) => setPrompt(e.target.value)}
                                placeholder={content?.placeholder || 'Descreva o que você quer criar...'}
                                className="w-full h-40 p-4 rounded-xl border border-[var(--ds-border-default)] bg-[var(--ds-bg-elevated)] focus:ring-2 focus:ring-emerald-500/30 outline-none resize-none text-base text-[var(--ds-text-primary)] placeholder:text-[var(--ds-text-muted)]"
                            />

                            <div className="flex items-center justify-between mt-4 text-xs text-[var(--ds-text-muted)]">
                                <span>💡 {content?.tip || 'Seja específico sobre o objetivo e tom de voz.'}</span>
                                <span>{prompt.length} caracteres</span>
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div className="rounded-2xl border border-[var(--ds-border-default)] bg-[var(--ds-bg-surface)] p-4 shadow-[0_12px_30px_rgba(0,0,0,0.35)]">
                                <label className="block text-xs uppercase tracking-widest text-[var(--ds-text-muted)] mb-2">Quantidade</label>
                                <select
                                    value={quantity}
                                    onChange={(e) => setQuantity(Number(e.target.value))}
                                    className="w-full h-11 rounded-xl bg-[var(--ds-bg-elevated)] border border-[var(--ds-border-default)] px-3 text-[var(--ds-text-primary)]"
                                >
                                    <option value={3}>3 Opções</option>
                                    <option value={5}>5 Opções</option>
                                    <option value={10}>10 Opções</option>
                                </select>
                            </div>

                            <div className="rounded-2xl border border-[var(--ds-border-default)] bg-[var(--ds-bg-surface)] p-4 shadow-[0_12px_30px_rgba(0,0,0,0.35)]">
                                <label className="block text-xs uppercase tracking-widest text-[var(--ds-text-muted)] mb-2">Idioma</label>
                                <select
                                    value={language}
                                    onChange={(e) => setLanguage(e.target.value)}
                                    className="w-full h-11 rounded-xl bg-[var(--ds-bg-elevated)] border border-[var(--ds-border-default)] px-3 text-[var(--ds-text-primary)]"
                                >
                                    <option value="pt_BR">Português (Brasil)</option>
                                    <option value="en_US">Inglês (EUA)</option>
                                    <option value="es_ES">Espanhol</option>
                                </select>
                            </div>
                        </div>

                        <div className="rounded-2xl border border-[var(--ds-border-default)] bg-[var(--ds-bg-surface)] p-4 shadow-[0_12px_30px_rgba(0,0,0,0.35)]">
                            <label className="block text-xs uppercase tracking-widest text-[var(--ds-text-muted)] mb-2">URL Padrão (Opcional)</label>
                            <input
                                type="url"
                                value={universalUrl}
                                onChange={(e) => setUniversalUrl(e.target.value)}
                                placeholder="https://seu-site.com"
                                className="w-full h-11 rounded-xl bg-[var(--ds-bg-elevated)] border border-[var(--ds-border-default)] px-3 text-[var(--ds-text-primary)] placeholder:text-[var(--ds-text-muted)]"
                            />
                            <p className="text-xs text-[var(--ds-text-muted)] mt-1">Será usada nos botões dos templates gerados.</p>
                        </div>

                        <button
                            onClick={handleGenerate}
                            disabled={!prompt}
                            className="w-full py-4 bg-primary-600 text-white dark:bg-white dark:text-black rounded-xl font-semibold flex items-center justify-center gap-2 transition-colors hover:bg-primary-700 dark:hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            <Wand2 className="w-5 h-5" />
                            Gerar Templates com IA
                        </button>
                    </div>

                    {/* Right: Info - Rico em contexto */}
                    <div className="space-y-4">
                        {/* O que incluir no prompt */}
                        <div className="rounded-2xl border border-emerald-400 dark:border-emerald-400/20 bg-emerald-100 dark:bg-emerald-500/10 p-5 shadow-[0_12px_30px_rgba(0,0,0,0.35)]">
                            <h3 className="font-semibold text-emerald-700 dark:text-emerald-200 mb-3">O que incluir no prompt?</h3>
                            <ul className="space-y-2 text-sm text-[var(--ds-text-secondary)]">
                                {content?.whatToInclude.map((item, i) => (
                                    <li key={i} className="flex items-start gap-2">
                                        {item}
                                    </li>
                                ))}
                            </ul>
                        </div>

                        {/* Exemplos de uso - clicáveis com preview */}
                        <div className="rounded-2xl border border-[var(--ds-border-default)] bg-[var(--ds-bg-surface)] p-5 shadow-[0_12px_30px_rgba(0,0,0,0.35)]">
                            <h3 className="font-semibold text-[var(--ds-text-primary)] mb-3">Exemplos de uso</h3>
                            <div className="space-y-3">
                                {content?.examples.map((example, i) => (
                                    <button
                                        key={i}
                                        onClick={() => {
                                            setPrompt(example.input);
                                            if (example.url) setUniversalUrl(example.url);
                                        }}
                                        className="w-full text-left p-3 rounded-xl bg-[var(--ds-bg-elevated)] hover:bg-[var(--ds-bg-hover)] border border-transparent hover:border-emerald-500/30 transition-all group"
                                    >
                                        <div className="font-medium text-sm text-[var(--ds-text-primary)] mb-1.5 group-hover:text-emerald-400">
                                            {example.title}
                                        </div>
                                        <div className="text-xs text-[var(--ds-text-muted)] mb-2 line-clamp-2">
                                            "{example.input}"
                                        </div>
                                        {example.url && (
                                            <div className="text-xs text-blue-400 mb-2 truncate">
                                                🔗 {example.url}
                                            </div>
                                        )}
                                        <div className="text-xs text-emerald-600 dark:text-emerald-400 font-mono">
                                            → {example.preview}
                                        </div>
                                    </button>
                                ))}
                            </div>
                            <p className="text-xs text-[var(--ds-text-muted)] mt-3 text-center">
                                👆 Clique para usar como base
                            </p>
                        </div>

                        {/* Preview de resultado */}
                        {content?.resultPreview && (
                            <div className="rounded-2xl border border-[var(--ds-border-default)] bg-[var(--ds-bg-surface)] p-5 shadow-[0_12px_30px_rgba(0,0,0,0.35)]">
                                <h3 className="font-semibold text-[var(--ds-text-primary)] mb-3">{content.resultPreview.label}</h3>
                                <div className="bg-[var(--ds-bg-elevated)] rounded-xl p-4 border border-[var(--ds-border-default)]">
                                    <div className="text-sm text-[var(--ds-text-secondary)] whitespace-pre-wrap mb-3">
                                        {content.resultPreview.template}
                                    </div>
                                    {content.resultPreview.button && (
                                        <div className="w-full py-2 px-3 bg-emerald-600/20 text-center text-emerald-400 text-sm rounded-lg font-medium border border-emerald-500/30">
                                            🔗 {content.resultPreview.button}
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {step === 'generating' && (
                <div className="flex flex-col items-center justify-center min-h-100">
                    <Loader2 className="w-12 h-12 text-emerald-300 animate-spin mb-4" />
                    <h2 className="text-xl font-semibold text-[var(--ds-text-primary)] mb-2">Criando seus templates...</h2>
                    <p className="text-[var(--ds-text-muted)]">O Agente está consultando as diretrizes da Meta e gerando variações.</p>
                </div>
            )}

            {step === 'review' && (
                <div className="space-y-6">
                    <div className="flex items-center justify-between">
                        <h2 className="text-xl font-semibold text-[var(--ds-text-primary)]">Revise os Templates Gerados</h2>
                        <div className="flex items-center gap-3">
                            <span className="text-sm text-[var(--ds-text-muted)]">{selectedIds.size} selecionados</span>
                            <button
                                onClick={toggleSelectAll}
                                className="px-3 py-2 bg-[var(--ds-bg-elevated)] border border-[var(--ds-border-default)] text-[var(--ds-text-secondary)] rounded-lg hover:bg-[var(--ds-bg-hover)] transition-colors flex items-center gap-2 text-sm"
                            >
                                {isAllSelected ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4" />}
                                {isAllSelected ? 'Desmarcar Tudo' : 'Selecionar Tudo'}
                            </button>
                            <button
                                onClick={handleSaveProject}
                                disabled={isCreating || selectedIds.size === 0}
                                className="px-6 py-2 bg-primary-600 text-white dark:bg-white dark:text-black rounded-lg font-semibold flex items-center gap-2 hover:bg-primary-700 dark:hover:bg-gray-200 disabled:opacity-50"
                            >
                                {isCreating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                                Salvar Projeto
                            </button>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {generatedTemplates.map((t) => {
                            const isHovered = hoveredId === t.id;
                            return (
                            <div
                                key={t.id}
                                onClick={() => toggleSelect(t.id)}
                                onMouseEnter={() => setHoveredId(t.id)}
                                onMouseLeave={() => setHoveredId(null)}
                                className={`
                  relative p-4 rounded-2xl border cursor-pointer transition-all hover:shadow-[0_12px_30px_rgba(0,0,0,0.35)]
                  ${selectedIds.has(t.id)
                                        ? 'border-emerald-600 dark:border-emerald-400/40 bg-emerald-100 dark:bg-emerald-500/10'
                                        : 'border-[var(--ds-border-default)] bg-[var(--ds-bg-surface)]'}
                `}
                            >
                                {/* Check de seleção + indicador de preview */}
                                <div className="absolute top-2 right-2 flex items-center gap-1">
                                    {isHovered && (
                                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 font-medium">
                                            Preview
                                        </span>
                                    )}
                                    {selectedIds.has(t.id) && (
                                        <div className="p-1 bg-emerald-500 text-black rounded-full">
                                            <Check className="w-3 h-3" />
                                        </div>
                                    )}
                                </div>

                                {/* Header */}
                                <div className="mb-3">
                                    <span className="text-xs font-mono text-[var(--ds-text-muted)]">{t.name}</span>
                                    {t.header && (
                                        <div className="mt-1 font-semibold text-sm text-[var(--ds-text-primary)]">
                                            {t.header.text
                                                ? (isHovered ? fillVariables(t.header.text, getPreviewVariables(t)) : t.header.text)
                                                : `[Mídia: ${t.header.format}]`}
                                        </div>
                                    )}
                                </div>

                                {/* Body */}
                                <div className={`text-sm whitespace-pre-wrap mb-4 transition-colors ${isHovered ? 'text-emerald-300' : 'text-[var(--ds-text-secondary)]'}`}>
                                    {isHovered ? fillVariables(t.content, getPreviewVariables(t)) : t.content}
                                </div>

                                {/* Footer */}
                                {t.footer && (
                                    <div className="mb-3 text-xs text-[var(--ds-text-muted)]">
                                        {t.footer.text}
                                    </div>
                                )}

                                {/* Buttons */}
                                {t.buttons && t.buttons.length > 0 && (
                                    <div className="space-y-2">
                                        {t.buttons.map((btn, i) => (
                                            <div key={i} className="w-full py-2 px-3 bg-[var(--ds-bg-elevated)] text-center text-emerald-700 dark:text-emerald-200 text-sm rounded font-medium border border-[var(--ds-border-default)]">
                                                {btn.type === 'URL' && <span className="mr-1">🔗</span>}
                                                {btn.text}
                                            </div>
                                        ))}
                                    </div>
                                )}

                                {/* AI Judgment Badge */}
                                {t.judgment && !t.judgment.approved && (
                                    <div className="mt-4 p-2 bg-amber-100 dark:bg-amber-500/10 text-amber-700 dark:text-amber-200 text-xs rounded border border-amber-400 dark:border-amber-500/20 flex items-start gap-1">
                                        <AlertCircle className="w-3 h-3 shrink-0 mt-0.5" />
                                        <div>
                                            <span className="font-bold">Atenção:</span> {t.judgment.issues[0]?.reason || 'Problemas detectados'}
                                        </div>
                                    </div>
                                )}
                                {t.wasFixed && (
                                    <div className="mt-4 p-2 bg-emerald-100 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-200 text-xs rounded border border-emerald-400 dark:border-emerald-500/20 flex items-start gap-1">
                                        <Sparkles className="w-3 h-3 shrink-0 mt-0.5 text-emerald-300" />
                                        <div>
                                            Corrigido automaticamente pelo AI Judge
                                        </div>
                                    </div>
                                )}
                            </div>
                        );
                        })}
                    </div>
                </div>
            )}
        </Page>
    );
}
