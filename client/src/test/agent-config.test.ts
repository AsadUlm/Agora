import { describe, it, expect } from 'vitest'
import {
    agentConfigsToPayload,
    DEFAULT_AGENT_CONFIGS,
    createAgentConfig,
} from '@/features/debate/model/agent-config.types'

describe('agentConfigsToPayload', () => {
    it('only includes enabled agents', () => {
        const configs = DEFAULT_AGENT_CONFIGS.map((c, i) => ({
            ...c,
            enabled: i === 0, // only first enabled
        }))
        const payload = agentConfigsToPayload(configs)
        expect(payload).toHaveLength(1)
    })

    it('sends empty document_ids for shared_session_docs mode', () => {
        const configs = DEFAULT_AGENT_CONFIGS.map(c => ({
            ...c,
            enabled: true,
            knowledgeMode: 'shared_session_docs' as const,
            documentIds: ['some-doc-id'],
        }))
        const payload = agentConfigsToPayload(configs)
        // shared_session_docs should NOT send specific document IDs
        payload.forEach(p => expect(p.document_ids).toEqual([]))
    })

    it('sends document_ids for assigned_docs_only mode', () => {
        const config = {
            ...createAgentConfig(),
            enabled: true,
            knowledgeMode: 'assigned_docs_only' as const,
            documentIds: ['doc-1', 'doc-2'],
        }
        const payload = agentConfigsToPayload([config])
        expect(payload[0].document_ids).toEqual(['doc-1', 'doc-2'])
    })

    it('includes role and model config in payload', () => {
        const config = {
            ...createAgentConfig(),
            enabled: true,
            role: 'analyst',
            provider: 'openrouter',
            model: 'anthropic/claude-sonnet-4.5',
        }
        const payload = agentConfigsToPayload([config])
        expect(payload[0].role).toBe('analyst')
        expect(payload[0].config.model.provider).toBe('openrouter')
        expect(payload[0].config.model.model).toBe('anthropic/claude-sonnet-4.5')
    })

    it('returns empty array when no agents are enabled', () => {
        const configs = DEFAULT_AGENT_CONFIGS.map(c => ({ ...c, enabled: false }))
        const payload = agentConfigsToPayload(configs)
        expect(payload).toHaveLength(0)
    })
})
