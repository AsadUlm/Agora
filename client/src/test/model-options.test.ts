import { describe, it, expect } from 'vitest'
import { MODEL_OPTIONS } from '@/features/debate/model/agent-config.types'

describe('MODEL_OPTIONS', () => {
    it('does not contain invalid gemini model ID', () => {
        const openrouterModels = MODEL_OPTIONS.openrouter
        expect(openrouterModels).not.toContain('google/gemini-3.1-pro')
    })

    it('contains the correct gemini model ID', () => {
        const openrouterModels = MODEL_OPTIONS.openrouter
        expect(openrouterModels).toContain('google/gemini-3.1-pro-preview')
    })

    it('all model IDs follow provider/model-name format', () => {
        const openrouterModels = MODEL_OPTIONS.openrouter
        openrouterModels.forEach(model => {
            expect(model).toMatch(/^[a-z0-9_-]+\/[a-z0-9._-]+$/)
        })
    })

    it('contains at least one anthropic model', () => {
        const openrouterModels = MODEL_OPTIONS.openrouter
        const anthropicModels = openrouterModels.filter(m => m.startsWith('anthropic/'))
        expect(anthropicModels.length).toBeGreaterThan(0)
    })
})
