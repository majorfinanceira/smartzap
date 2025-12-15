/**
 * Serviço de IA unificado.
 *
 * Centraliza operações de IA na aplicação (geração e streaming), suportando
 * provedores como Google (Gemini), OpenAI (GPT) e Anthropic (Claude).
 *
 * Implementado sobre o Vercel AI SDK v6.
 *
 * Exemplo:
 * - `import { ai } from '@/lib/ai'`
 * - `const result = await ai.generateText({ prompt: 'Olá' })`
 */

import { generateText as vercelGenerateText, streamText as vercelStreamText } from 'ai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';

import { supabase } from '@/lib/supabase';
import { type AIProvider, getDefaultModel } from './providers';

// =============================================================================
// TYPES
// =============================================================================

export interface AISettings {
    provider: AIProvider;
    model: string;
    apiKey: string;
}

export interface ChatMessage {
    role: 'user' | 'assistant' | 'system';
    content: string;
}

export interface GenerateTextOptions {
    /** Prompt simples (mutuamente exclusivo com `messages`). */
    prompt?: string;
    /** Mensagens da conversa (mutuamente exclusivo com `prompt`). */
    messages?: ChatMessage[];
    /** Instrução de sistema (contexto) enviada ao modelo. */
    system?: string;
    /** Sobrescreve o provedor configurado nas settings. */
    provider?: AIProvider;
    /** Sobrescreve o modelo configurado nas settings. */
    model?: string;
    /** Máximo de tokens de saída. */
    maxOutputTokens?: number;
    /** Temperatura (geralmente 0-2). */
    temperature?: number;
}

export interface StreamTextOptions extends GenerateTextOptions {
    /** Callback chamado a cada chunk de texto recebido. */
    onChunk?: (chunk: string) => void;
    /** Callback chamado quando o streaming terminar, com o texto completo. */
    onComplete?: (text: string) => void;
}

export interface GenerateTextResult {
    text: string;
    provider: AIProvider;
    model: string;
}

// =============================================================================
// SETTINGS CACHE
// =============================================================================

let settingsCache: AISettings | null = null;
let settingsCacheTime = 0;
const CACHE_TTL = 60000; // 1 minute

async function getAISettings(): Promise<AISettings> {
    const now = Date.now();

    // Return cached if valid
    if (settingsCache && now - settingsCacheTime < CACHE_TTL) {
        return settingsCache;
    }

    // Default settings
    const defaultSettings: AISettings = {
        provider: 'google',
        model: 'gemini-2.5-flash',
        apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.GEMINI_API_KEY || '',
    };

    try {
        // Try to load from DB
        const { data: settings } = await supabase.admin
            ?.from('settings')
            .select('key, value')
            .in('key', [
                'ai_provider',
                'ai_model',
                'gemini_api_key',
                'openai_api_key',
                'anthropic_api_key'
            ]) || { data: null };

        if (settings && settings.length > 0) {
            const settingsMap = new Map(settings.map(s => [s.key, s.value as string]));

            const provider = (settingsMap.get('ai_provider') as AIProvider) || defaultSettings.provider;
            const model = settingsMap.get('ai_model') || getDefaultModel(provider)?.id || '';

            // Get the right API key for the provider
            let apiKey = '';
            switch (provider) {
                case 'google':
                    apiKey = settingsMap.get('gemini_api_key') || process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.GEMINI_API_KEY || '';
                    break;
                case 'openai':
                    apiKey = settingsMap.get('openai_api_key') || process.env.OPENAI_API_KEY || '';
                    break;
                case 'anthropic':
                    apiKey = settingsMap.get('anthropic_api_key') || process.env.ANTHROPIC_API_KEY || '';
                    break;
            }

            settingsCache = { provider, model, apiKey };
        } else {
            settingsCache = defaultSettings;
        }
    } catch (error) {
        console.warn('[AI Service] Failed to load settings from DB, using defaults:', error);
        settingsCache = defaultSettings;
    }

    settingsCacheTime = now;
    return settingsCache;
}

/**
 * Limpa o cache de settings de IA.
 *
 * Deve ser chamado após atualizar as configurações (ex.: via tela de settings)
 * para garantir que a próxima chamada busque os valores mais recentes.
 *
 * @returns Nada.
 */
export function clearSettingsCache() {
    settingsCache = null;
    settingsCacheTime = 0;
}

// =============================================================================
// PROVIDER FACTORY - AI SDK v6 uses direct provider functions
// =============================================================================

function getLanguageModel(providerId: AIProvider, modelId: string, apiKey: string) {
    if (!apiKey) {
        throw new Error(`API key not configured for provider: ${providerId}`);
    }

    switch (providerId) {
        case 'google': {
            const google = createGoogleGenerativeAI({ apiKey });
            return google(modelId);
        }
        case 'openai': {
            const openai = createOpenAI({ apiKey });
            return openai(modelId);
        }
        case 'anthropic': {
            const anthropic = createAnthropic({ apiKey });
            return anthropic(modelId);
        }
        default:
            throw new Error(`Unknown provider: ${providerId}`);
    }
}

// =============================================================================
// MAIN API
// =============================================================================

/**
 * Gera texto usando o provedor/modelo configurados (com opção de override).
 *
 * Você pode fornecer `prompt` (simples) ou `messages` (chat). Se ambos forem
 * fornecidos, `messages` tem precedência pela lógica atual.
 *
 * @param options Opções de geração (prompt/mensagens, system, temperatura, etc.).
 * @returns Objeto com `text` e metadados do provedor/modelo efetivamente usados.
 */
export async function generateText(options: GenerateTextOptions): Promise<GenerateTextResult> {
    const settings = await getAISettings();

    const providerId = options.provider || settings.provider;
    const modelId = options.model || settings.model;

    const model = getLanguageModel(providerId, modelId, settings.apiKey);

    console.log(`[AI Service] Generating with ${providerId}/${modelId}`);

    // Build call options based on prompt vs messages
    const baseOptions = {
        model,
        system: options.system,
        temperature: options.temperature ?? 0.7,
        ...(options.maxOutputTokens && { maxOutputTokens: options.maxOutputTokens }),
    };

    const result = options.messages
        ? await vercelGenerateText({ ...baseOptions, messages: options.messages })
        : await vercelGenerateText({ ...baseOptions, prompt: options.prompt || '' });

    return {
        text: result.text,
        provider: providerId,
        model: modelId,
    };
}

/**
 * Gera texto em streaming usando o provedor/modelo configurados.
 *
 * Durante o streaming, chama `onChunk` para cada pedaço de texto e `onComplete`
 * ao finalizar, além de retornar o texto completo.
 *
 * @param options Opções de streaming (inclui callbacks opcionais).
 * @returns Objeto com o texto completo e metadados do provedor/modelo.
 */
export async function streamText(options: StreamTextOptions): Promise<GenerateTextResult> {
    const settings = await getAISettings();

    const providerId = options.provider || settings.provider;
    const modelId = options.model || settings.model;

    const model = getLanguageModel(providerId, modelId, settings.apiKey);

    console.log(`[AI Service] Streaming with ${providerId}/${modelId}`);

    // Build call options based on prompt vs messages
    const baseOptions = {
        model,
        system: options.system,
        temperature: options.temperature ?? 0.7,
        ...(options.maxOutputTokens && { maxOutputTokens: options.maxOutputTokens }),
    };

    const result = options.messages
        ? vercelStreamText({ ...baseOptions, messages: options.messages })
        : vercelStreamText({ ...baseOptions, prompt: options.prompt || '' });

    // Collect full text
    let fullText = '';
    for await (const part of result.textStream) {
        fullText += part;
        options.onChunk?.(part);
    }

    options.onComplete?.(fullText);

    return {
        text: fullText,
        provider: providerId,
        model: modelId,
    };
}

/**
 * Gera uma resposta em JSON via IA.
 *
 * Este helper adiciona uma instrução de sistema para pedir **apenas JSON válido**,
 * e em seguida tenta fazer `JSON.parse`, removendo cercas de markdown se aparecerem.
 *
 * @typeParam T Tipo esperado do JSON retornado.
 * @param options Opções de geração (prompt/mensagens e instruções opcionais).
 * @returns Objeto JSON parseado, tipado como `T`.
 * @throws Erro se a resposta não puder ser parseada como JSON.
 */
export async function generateJSON<T = unknown>(options: GenerateTextOptions): Promise<T> {
    const result = await generateText({
        ...options,
        system: (options.system || '') + '\n\nRespond with valid JSON only, no markdown.',
    });

    try {
        // Clean markdown code blocks if present
        const cleanText = result.text
            .replace(/```json\n?/g, '')
            .replace(/```\n?/g, '')
            .trim();

        // 1) tentativa direta
        try {
            return JSON.parse(cleanText) as T;
        } catch {
            // 2) fallback: às vezes o modelo insiste em adicionar texto antes/depois.
            const extracted = extractFirstJsonValue(cleanText);
            if (extracted) {
                return JSON.parse(extracted) as T;
            }
            throw new Error('AI response was not valid JSON');
        }
    } catch {
        console.error('[AI Service] Failed to parse JSON response:', result.text);
        throw new Error('AI response was not valid JSON');
    }
}

// =============================================================================
// JSON EXTRACTION (fallback)
// =============================================================================

/**
 * Extrai o primeiro valor JSON (objeto/array) encontrado dentro de um texto.
 * Útil quando o modelo retorna algo como: "Aqui está o JSON: {...}".
 */
function extractFirstJsonValue(text: string): string | null {
    const start = Math.min(
        ...['{', '[']
            .map((c) => text.indexOf(c))
            .filter((i) => i >= 0)
    );

    if (!Number.isFinite(start) || start < 0) return null;

    const open = text[start];
    const close = open === '{' ? '}' : ']';

    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let i = start; i < text.length; i += 1) {
        const ch = text[i];

        if (inString) {
            if (escaped) {
                escaped = false;
                continue;
            }
            if (ch === '\\') {
                escaped = true;
                continue;
            }
            if (ch === '"') {
                inString = false;
            }
            continue;
        }

        if (ch === '"') {
            inString = true;
            continue;
        }

        if (ch === open) depth += 1;
        if (ch === close) depth -= 1;

        if (depth === 0) {
            return text.slice(start, i + 1).trim();
        }
    }

    return null;
}

// =============================================================================
// CONVENIENCE EXPORTS
// =============================================================================

/**
 * Facade (API amigável) para operações de IA.
 *
 * Inclui:
 * - `generateText`: geração simples.
 * - `streamText`: geração em streaming.
 * - `generateJSON`: geração com parse para JSON.
 * - `clearSettingsCache`: invalidação do cache.
 * - `getSettings`: leitura das settings efetivas (com cache).
 */
export const ai = {
    generateText,
    streamText,
    generateJSON,
    clearSettingsCache,
    getSettings: getAISettings,
};

export default ai;

// Re-export types and providers
export { AI_PROVIDERS, getProvider, getModel, getDefaultModel } from './providers';
export type { AIProvider, AIModel, AIProviderConfig } from './providers';
