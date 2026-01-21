'use client';

import React, { useState, useMemo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useTemplateProjectDetailsQuery } from '@/hooks/useTemplateProjects';
import {
    Loader2, ArrowLeft, Check, AlertCircle, Clock, Send, Trash2,
    RefreshCw, Filter, ChevronDown, CheckCircle, XCircle, AlertTriangle,
    Copy, CheckSquare, Square, Eye, Pencil, X
} from 'lucide-react';
import { toast } from 'sonner';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createClient } from '@/utils/supabase/client';
import { cn } from '@/lib/utils';
import { WhatsAppPhonePreview } from '@/components/ui/WhatsAppPhonePreview';
import { Page, PageActions, PageDescription, PageHeader, PageTitle } from '@/components/ui/page';

export default function TemplateProjectDetailsPage() {
    const params = useParams();
    const id = params.id as string;
    const router = useRouter();
    const queryClient = useQueryClient();
    const [selectedItems, setSelectedItems] = useState<string[]>([]);
    const [expandedSection, setExpandedSection] = useState<'APPROVED' | 'REJECTED' | 'PENDING' | 'DRAFT' | 'ALL'>('ALL');
    const [previewItem, setPreviewItem] = useState<any | null>(null);
    const [isEditingTitle, setIsEditingTitle] = useState(false);
    const [editedTitle, setEditedTitle] = useState('');

    const { data: project, isLoading, error, refetch } = useTemplateProjectDetailsQuery(id);

    // Rename Project Mutation
    const renameProjectMutation = useMutation({
        mutationFn: async (newTitle: string) => {
            const response = await fetch(`/api/template-projects/${id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ title: newTitle })
            });
            if (!response.ok) throw new Error('Falha ao renomear');
            return response.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['template_projects', id] });
            queryClient.invalidateQueries({ queryKey: ['template_projects'] });
            toast.success('Projeto renomeado!');
            setIsEditingTitle(false);
        },
        onError: () => {
            toast.error('Erro ao renomear projeto');
        }
    });

    const handleStartEdit = () => {
        setEditedTitle(project?.title || '');
        setIsEditingTitle(true);
    };

    const handleSaveTitle = () => {
        if (!editedTitle.trim()) return toast.error('Digite um nome');
        renameProjectMutation.mutate(editedTitle.trim());
    };

    const handleCancelEdit = () => {
        setIsEditingTitle(false);
        setEditedTitle('');
    };

    // DEBUG: Inspect loaded items
    React.useEffect(() => {
        if (project?.items) {
            console.log('[DEBUG] Loaded Items:', JSON.stringify(project.items.map((i: any) => ({ name: i.name, category: i.category })), null, 2));
        }
    }, [project]);

    // Toggle selection
    const toggleSelection = (itemId: string, e?: React.MouseEvent) => {
        e?.stopPropagation();
        setSelectedItems(prev =>
            prev.includes(itemId)
                ? prev.filter(id => id !== itemId)
                : [...prev, itemId]
        );
    };

    const toggleSelectAll = () => {
        if (!project?.items) return;
        const validItems = project.items.filter((i: any) => !i.meta_id); // Only select draft items

        if (selectedItems.length === validItems.length) {
            setSelectedItems([]);
        } else {
            setSelectedItems(validItems.map((i: any) => i.id));
        }
    };

    // Bulk Submit Mutation
    const bulkSubmitMutation = useMutation({
        mutationFn: async (itemIds: string[]) => {
            const itemsToSubmit = (project?.items || []).filter((i: any) => itemIds.includes(i.id));
            const successes: string[] = [];
            const errors: Array<{ name: string; error: string }> = [];

            for (const item of itemsToSubmit) {
                try {
                    // Converte sample_variables (Record<string, string>) para array ordenado
                    // Ex: {"1": "Maria", "2": "Pedido"} -> ["Maria", "Pedido"]
                    let exampleVariables: string[] = [];
                    if (item.sample_variables && typeof item.sample_variables === 'object') {
                        const sampleVars = item.sample_variables;
                        const keys = Object.keys(sampleVars)
                            .filter(k => /^\d+$/.test(k))
                            .sort((a, b) => Number(a) - Number(b));
                        exampleVariables = keys.map(k => sampleVars[k]);
                    }

                    const payload = {
                        itemId: item.id, // ID for server-side DB update
                        projectId: id,
                        name: item.name,
                        category: item.category || 'UTILITY', // Use item category (MARKETING/UTILITY)
                        language: item.language || 'pt_BR',
                        content: item.content,
                        header: item.header,
                        footer: item.footer,
                        buttons: item.buttons,
                        // Inclui variáveis de exemplo do item (necessário para Meta API)
                        exampleVariables
                    };

                    const response = await fetch('/api/templates/create', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(payload)
                    });

                    const result = await response.json();

                    // A API retorna erro com status 400/500 ou sucesso com objeto direto
                    if (!response.ok) {
                        // Erro retornado pela API (pode ter details ou error)
                        const errorMsg = result.details?.[0]?.error || result.error || 'Erro desconhecido';
                        throw new Error(errorMsg);
                    }

                    // Sucesso: API retorna objeto com success: true ou o template criado
                    if (result.success || result.id) {
                        successes.push(item.id);
                    } else {
                        throw new Error('Resposta inesperada da API');
                    }
                } catch (e: any) {
                    console.error(`Erro ao enviar item ${item.name}`, e);
                    errors.push({ name: item.name, error: e.message || 'Erro desconhecido' });
                }
            }
            return { successes, errors };
        },
        onSuccess: ({ successes, errors }) => {
            queryClient.invalidateQueries({ queryKey: ['template_projects', id] });
            setSelectedItems([]);

            if (errors.length > 0 && successes.length === 0) {
                // Todos falharam
                const errorDetails = errors.map(e => `• ${e.name}: ${e.error}`).join('\n');
                toast.error(`Falha ao enviar ${errors.length} template(s)`, {
                    description: errorDetails,
                    duration: 8000
                });
            } else if (errors.length > 0) {
                // Parcialmente sucesso
                const errorDetails = errors.map(e => `• ${e.name}: ${e.error}`).join('\n');
                toast.warning(`${successes.length} enviado(s), ${errors.length} falha(s)`, {
                    description: errorDetails,
                    duration: 8000
                });
            } else if (successes.length > 0) {
                // Todos sucesso
                toast.success(`${successes.length} template(s) enviado(s) com sucesso para a Meta!`);
            } else {
                // Nenhum item para enviar (edge case)
                toast.info('Nenhum template selecionado para envio.');
            }
        },
        onError: (error: any) => {
            toast.error('Erro inesperado ao enviar templates', {
                description: error.message || 'Verifique e tente novamente.'
            });
        }
    });

    // Delete Item Mutation
    const deleteItemMutation = useMutation({
        mutationFn: async (itemId: string) => {
            const response = await fetch(`/api/template-projects/items/${itemId}`, {
                method: 'DELETE',
            });
            if (!response.ok) throw new Error('Falha ao excluir item');
        },
        onSuccess: () => {
            // Invalidate list
            queryClient.invalidateQueries({ queryKey: ['template_projects', id] });
            toast.success('Rascunho excluído');
        },
        onError: () => {
            toast.error('Erro ao excluir rascunho');
        }
    });

    // Sync Project Mutation
    const syncProjectMutation = useMutation({
        mutationFn: async () => {
            const response = await fetch(`/api/template-projects/${id}/sync`, { method: 'POST' });
            if (!response.ok) throw new Error('Falha ao sincronizar');
            return response.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['template_projects', id] });
            toast.success('Status atualizados da Meta!');
        },
        onError: () => {
            toast.error('Erro ao sincronizar status.');
        }
    });

    // Grouping Logic
    const groups = useMemo(() => {
        if (!project?.items) return { APPROVED: [], REJECTED: [], PENDING: [], DRAFT: [] };
        return {
            APPROVED: project.items.filter((i: any) => i.meta_status === 'APPROVED'),
            REJECTED: project.items.filter((i: any) => i.meta_status === 'REJECTED'),
            PENDING: project.items.filter((i: any) => i.meta_status && i.meta_status !== 'APPROVED' && i.meta_status !== 'REJECTED'),
            DRAFT: project.items.filter((i: any) => !i.meta_status) // Strictly no status = Draft
        };
    }, [project?.items]);

    const sections = [
        { id: 'APPROVED', label: 'Aprovados', count: groups.APPROVED.length, color: 'emerald', icon: CheckCircle },
        { id: 'REJECTED', label: 'Rejeitados', count: groups.REJECTED.length, color: 'red', icon: XCircle },
        { id: 'PENDING', label: 'Em Análise', count: groups.PENDING.length, color: 'yellow', icon: Clock },
        { id: 'DRAFT', label: 'Rascunhos (Não Enviados)', count: groups.DRAFT.length, color: 'zinc', icon: Filter },
    ] as const;

    if (isLoading) {
        return (
            <div className="flex items-center justify-center h-full">
                <Loader2 className="w-8 h-8 animate-spin text-emerald-300" />
            </div>
        );
    }

    if (error || !project) {
        return (
            <div className="flex flex-col items-center justify-center h-full gap-4">
                <div className="p-4 bg-amber-500/10 text-amber-200 border border-amber-500/20 rounded-lg flex items-center gap-2">
                    <AlertCircle className="w-5 h-5 text-amber-300" />
                    <span>Erro ao carregar projeto ou projeto não encontrado.</span>
                </div>
                <button
                    onClick={() => router.push('/templates?tab=projects')}
                    className="flex items-center gap-2 text-gray-400 hover:text-white"
                >
                    <ArrowLeft className="w-4 h-4" />
                    Voltar para lista
                </button>
            </div>
        );
    }

    return (
        <Page className="flex flex-col h-full min-h-0">
            <PageHeader>
                <div className="min-w-0">
                    <div className="flex items-center gap-3">
                        <button
                            onClick={() => router.push('/templates?tab=projects')}
                            className="p-2 -ml-2 text-gray-400 hover:text-white hover:bg-white/5 rounded-lg transition-colors border border-white/10 bg-zinc-950/40"
                            aria-label="Voltar para projetos"
                        >
                            <ArrowLeft className="w-5 h-5" />
                        </button>

                        <div className="min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                                {isEditingTitle ? (
                                    <div className="flex items-center gap-2">
                                        <input
                                            type="text"
                                            value={editedTitle}
                                            onChange={(e) => setEditedTitle(e.target.value)}
                                            onKeyDown={(e) => {
                                                if (e.key === 'Enter') handleSaveTitle();
                                                if (e.key === 'Escape') handleCancelEdit();
                                            }}
                                            autoFocus
                                            className="text-2xl sm:text-3xl font-bold bg-transparent border-b-2 border-emerald-500 outline-none text-white min-w-[200px]"
                                        />
                                        <button
                                            onClick={handleSaveTitle}
                                            disabled={renameProjectMutation.isPending}
                                            className="p-1.5 text-emerald-400 hover:bg-emerald-500/20 rounded-lg transition-colors"
                                            title="Salvar"
                                        >
                                            {renameProjectMutation.isPending ? <Loader2 className="w-5 h-5 animate-spin" /> : <Check className="w-5 h-5" />}
                                        </button>
                                        <button
                                            onClick={handleCancelEdit}
                                            className="p-1.5 text-gray-400 hover:bg-white/10 rounded-lg transition-colors"
                                            title="Cancelar"
                                        >
                                            <X className="w-5 h-5" />
                                        </button>
                                    </div>
                                ) : (
                                    <>
                                        <PageTitle className="text-2xl sm:text-3xl truncate">{project.title}</PageTitle>
                                        <button
                                            onClick={handleStartEdit}
                                            className="p-1.5 text-gray-400 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
                                            title="Renomear projeto"
                                        >
                                            <Pencil className="w-4 h-4" />
                                        </button>
                                    </>
                                )}
                                <span className="px-2 py-0.5 text-xs rounded-full border bg-zinc-950/40 border-white/10 text-gray-400 shrink-0">
                                    {groups.DRAFT.length === 0 && groups.PENDING.length === 0 ? 'Concluído' : 'Em Progresso'}
                                </span>
                            </div>
                            <PageDescription className="text-sm">
                                Criado em {new Date(project.created_at).toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', hour: '2-digit', minute: '2-digit' })}
                            </PageDescription>
                        </div>
                    </div>
                </div>

                <PageActions className="flex-wrap justify-start sm:justify-end">
                    <button
                        onClick={() => syncProjectMutation.mutate()}
                        disabled={syncProjectMutation.isPending}
                        className="px-3 py-2 bg-zinc-950/40 border border-white/10 text-gray-200 rounded-lg hover:bg-white/5 transition-colors flex items-center gap-2 text-sm disabled:opacity-50"
                    >
                        <RefreshCw className={cn("w-4 h-4", syncProjectMutation.isPending && "animate-spin")} />
                        {syncProjectMutation.isPending ? 'Sincronizando...' : 'Sincronizar Meta'}
                    </button>

                    {groups.DRAFT.length > 0 && (
                        <button
                            onClick={toggleSelectAll}
                            className="px-3 py-2 bg-zinc-950/40 border border-white/10 text-gray-200 rounded-lg hover:bg-white/5 transition-colors flex items-center gap-2 text-sm"
                        >
                            {selectedItems.length === groups.DRAFT.length ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4" />}
                            Selecionar Tudo
                        </button>
                    )}

                    {selectedItems.length > 0 && (
                        <button
                            onClick={() => bulkSubmitMutation.mutate(selectedItems)}
                            disabled={bulkSubmitMutation.isPending}
                            className="px-4 py-2 bg-white text-black rounded-lg transition-colors flex items-center gap-2 text-sm font-semibold hover:bg-gray-200 disabled:opacity-50"
                        >
                            {bulkSubmitMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                            Enviar ({selectedItems.length}) para Meta
                        </button>
                    )}
                </PageActions>
            </PageHeader>

            <div className="grid grid-cols-12 flex-1 min-h-0 gap-6 overflow-hidden w-full">
                {/* --- LEFT SIDE: LIST & STATS --- */}
                <div className="col-span-12 lg:col-span-8 flex flex-col min-w-0 min-h-0">

                {/* Stats Grid */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6 shrink-0">
                    <StatCard
                        label="Aprovados"
                        count={groups.APPROVED.length}
                        total={project.items.length}
                        color="emerald"
                        icon={CheckCircle}
                    />
                    <StatCard
                        label="Em Análise"
                        count={groups.PENDING.length}
                        total={project.items.length}
                        color="yellow"
                        icon={Clock}
                    />
                    <StatCard
                        label="Rejeitados"
                        count={groups.REJECTED.length}
                        total={project.items.length}
                        color="red"
                        icon={XCircle}
                    />
                    <StatCard
                        label="Rascunhos"
                        count={groups.DRAFT.length}
                        total={project.items.length}
                        color="zinc"
                        icon={Filter}
                    />
                </div>

                {/* Template List */}
                <div className="flex-1 bg-zinc-900/60 border border-white/10 rounded-2xl overflow-y-auto shadow-[0_12px_30px_rgba(0,0,0,0.35)]">
                    {sections.map(section => {
                        if (section.count === 0) return null;

                        const isExpanded = expandedSection === 'ALL' || expandedSection === section.id;
                        // @ts-ignore
                        const sectionItems = groups[section.id];

                        return (
                            <div key={section.id} className="border-b border-white/10 last:border-0">
                                <button
                                    onClick={() => setExpandedSection(isExpanded && expandedSection !== 'ALL' ? 'ALL' : section.id)}
                                    className="w-full flex items-center justify-between p-4 hover:bg-white/5 transition-colors sticky top-0 bg-zinc-900/60 z-10"
                                >
                                    <div className="flex items-center gap-3">
                                        <section.icon className={cn("w-5 h-5", {
                                            'text-emerald-300': section.color === 'emerald',
                                            'text-red-300': section.color === 'red',
                                            'text-amber-300': section.color === 'yellow',
                                            'text-gray-400': section.color === 'zinc',
                                        })} />
                                        <span className="font-medium text-white">{section.label}</span>
                                        <span className="px-2 py-0.5 rounded-full bg-zinc-950/40 border border-white/10 text-xs text-gray-400">
                                            {section.count}
                                        </span>
                                    </div>
                                    <ChevronDown className={cn("w-4 h-4 text-gray-400 transition-transform", { "rotate-180": isExpanded })} />
                                </button>

                                {isExpanded && (
                                    <div className="px-4 pb-4 space-y-2">
                                        {/* Checkbox "Selecionar Tudo" para seção DRAFT */}
                                        {section.id === 'DRAFT' && sectionItems.length > 0 && (
                                            <div
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    toggleSelectAll();
                                                }}
                                                className="flex items-center gap-3 px-3 py-2 rounded-lg bg-zinc-950/60 border border-white/5 cursor-pointer hover:bg-white/5 transition-colors"
                                            >
                                                <div className={cn(
                                                    "w-5 h-5 rounded border flex items-center justify-center transition-colors shrink-0",
                                                    selectedItems.length === groups.DRAFT.length && groups.DRAFT.length > 0
                                                        ? "bg-emerald-500 border-emerald-500 text-black"
                                                        : "border-white/20 text-transparent hover:border-white/40"
                                                )}>
                                                    <Check className="w-3.5 h-3.5" />
                                                </div>
                                                <span className="text-sm text-gray-400">
                                                    {selectedItems.length === groups.DRAFT.length && groups.DRAFT.length > 0
                                                        ? 'Desmarcar tudo'
                                                        : `Selecionar tudo (${groups.DRAFT.length})`}
                                                </span>
                                            </div>
                                        )}
                                        {/* @ts-ignore */}
                                        {sectionItems.map((item: any) => {
                                            const isSelected = selectedItems.includes(item.id);
                                            const isDraft = !item.meta_id;
                                            const isActive = previewItem?.id === item.id;

                                            return (
                                                <div
                                                    key={item.id}
                                                    onClick={() => setPreviewItem(item)}
                                                    className={cn(
                                                        "p-3 rounded-lg border transition-all cursor-pointer flex gap-3 relative group",
                                                        isActive
                                                            ? "bg-emerald-500/10 border-emerald-500/30 ring-1 ring-emerald-500/40"
                                                            : "bg-zinc-950/40 border-white/10 hover:border-white/20 hover:bg-white/5"
                                                    )}
                                                >
                                                    {isDraft && (
                                                        <div
                                                            onClick={(e) => toggleSelection(item.id, e)}
                                                            className={cn(
                                                                "mt-1 w-5 h-5 rounded border flex items-center justify-center transition-colors shrink-0 z-10",
                                                                isSelected
                                                                    ? "bg-emerald-500 border-emerald-500 text-black"
                                                                    : "border-white/20 text-transparent hover:border-white/40"
                                                            )}
                                                        >
                                                            <Check className="w-3.5 h-3.5" />
                                                        </div>
                                                    )}

                                                    <div className="flex-1 min-w-0">
                                                        <div className="flex justify-between items-start mb-1">
                                                            <span className="text-sm font-medium flex items-center gap-2 truncate">
                                                                {item.name}
                                                            </span>
                                                            <div className="flex items-center gap-2">
                                                            <span className="text-xs text-gray-400 flex items-center gap-1 shrink-0">
                                                                <Copy className="w-3 h-3" />
                                                                {item.language}
                                                            </span>
                                                            {isDraft && (
                                                                <button
                                                                    onClick={(e) => {
                                                                        e.stopPropagation();
                                                                        if (confirm('Excluir este rascunho?')) {
                                                                            deleteItemMutation.mutate(item.id);
                                                                        }
                                                                    }}
                                                                    className="p-1 text-zinc-400 hover:text-amber-300 hover:bg-amber-500/10 rounded transition-colors opacity-0 group-hover:opacity-100"
                                                                    title="Excluir rascunho"
                                                                >
                                                                    <Trash2 className="w-3.5 h-3.5" />
                                                                </button>
                                                                )}
                                                            </div>
                                                        </div>
                                                        <p className="text-xs text-gray-400 line-clamp-2">
                                                            {item.content}
                                                        </p>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            </div>

                {/* --- RIGHT SIDE: PREVIEW --- */}
                <div className="hidden lg:flex col-span-4 border-l border-white/10 pl-6 flex-col min-h-0">
                {previewItem ? (
                    <div className="sticky top-6 w-full">
                        <h3 className="text-sm font-medium text-zinc-400 mb-4 text-center">
                            Pré-visualização
                        </h3>
                        <WhatsAppPhonePreview
                            components={[
                                previewItem.header ? { type: 'HEADER', ...previewItem.header } : null,
                                { type: 'BODY', text: previewItem.content },
                                previewItem.footer ? { type: 'FOOTER', ...previewItem.footer } : null,
                                previewItem.buttons?.length ? { type: 'BUTTONS', buttons: previewItem.buttons } : null
                            ].filter(Boolean)}
                            fallbackContent={previewItem.content}
                            variables={['Nome do Contato', 'Valor', 'Data']} // Placeholder
                            size="md"
                        />
                        <div className="mt-6 p-4 bg-zinc-900/60 border border-white/10 rounded-2xl shadow-[0_12px_30px_rgba(0,0,0,0.35)]">
                            <h4 className="text-sm font-medium text-white mb-2">Detalhes Técnicos</h4>
                            <div className="space-y-2 text-xs text-gray-400">
                                <div className="flex justify-between">
                                    <span>Status Meta:</span>
                                    <span className={cn(
                                        "font-medium",
                                        previewItem.meta_status === 'APPROVED' && "text-emerald-300",
                                        previewItem.meta_status === 'REJECTED' && "text-amber-300",
                                        previewItem.meta_status === 'PENDING' && "text-amber-300",
                                    )}>{previewItem.meta_status || 'Rascunho'}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span>ID:</span>
                                    <span className="font-mono">{previewItem.id.slice(0, 8)}...</span>
                                </div>
                            </div>
                        </div>
                    </div>
                ) : (
                    <div className="h-full flex flex-col items-center justify-center text-gray-400 border border-dashed border-white/10 rounded-2xl bg-zinc-900/60 shadow-[0_12px_30px_rgba(0,0,0,0.35)] w-full">
                        <Eye className="w-12 h-12 mb-4 opacity-50" />
                        <p className="text-sm">Selecione um template para visualizar</p>
                    </div>
                )}
                </div>
            </div>
        </Page>
    );
}

function StatCard({ label, count, total, color, icon: Icon }: any) {
    const percent = total > 0 ? Math.round((count / total) * 100) : 0;

    const colors: Record<string, string> = {
        emerald: 'text-emerald-300 bg-emerald-500/10 border-emerald-500/20',
        yellow: 'text-amber-300 bg-amber-500/10 border-amber-500/20',
        red: 'text-amber-200 bg-amber-500/10 border-amber-500/20',
        zinc: 'text-gray-400 bg-zinc-500/10 border-white/10',
    };

    return (
        <div className={cn("p-4 rounded-2xl border flex flex-col justify-between h-24 shadow-[0_12px_30px_rgba(0,0,0,0.35)]", colors[color])}>
            <div className="flex justify-between items-start">
                <Icon className="w-5 h-5 opacity-70" />
                <span className="text-2xl font-bold">{count}</span>
            </div>
            <div className="flex justify-between items-end">
                <span className="text-xs opacity-80 font-medium">{label}</span>
                <span className="text-xs opacity-60 font-mono">{percent}%</span>
            </div>
        </div>
    );
}
