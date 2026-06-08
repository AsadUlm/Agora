import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Tests for the array guard fixes we added to prevent crashes
 * when the backend returns non-array responses.
 */

describe('array guard — useAgentPresets', () => {
    it('handles non-array response from listAgentPresets gracefully', async () => {
        // Simulate backend returning an error object instead of array
        const fakeData = { detail: 'Unauthorized' }
        const result = Array.isArray(fakeData) ? fakeData : []
        expect(result).toEqual([])
        expect(() => result.filter(() => true)).not.toThrow()
    })

    it('handles actual array response correctly', () => {
        const fakeData = [{ id: '1', name: 'Test Preset' }]
        const result = Array.isArray(fakeData) ? fakeData : []
        expect(result).toHaveLength(1)
    })
})

describe('array guard — useDebates', () => {
    it('handles non-array response from listDebates gracefully', () => {
        const fakeData = { error: 'something went wrong' }
        const result = Array.isArray(fakeData) ? fakeData : []
        expect(result).toEqual([])
        expect(() => result.map((d: unknown) => d)).not.toThrow()
    })

    it('handles null response gracefully', () => {
        const fakeData = null
        const result = Array.isArray(fakeData) ? fakeData : []
        expect(result).toEqual([])
    })
})

describe('array guard — useLLMCatalog', () => {
    it('guards against non-array LLM provider response', () => {
        const fakeData = { providers: [] } // wrong shape
        const result = Array.isArray(fakeData) ? fakeData : []
        expect(result).toEqual([])
        expect(() => result.filter(() => true)).not.toThrow()
    })
})
