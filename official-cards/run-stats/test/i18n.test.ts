import { createTranslator } from '@neurosquad/card-sdk'
import { describe, expect, it } from 'vitest'
import { catalog } from '../src/i18n'

describe('subagent strings', () => {
  it('has the same subagent keys in every language, with plural forms', () => {
    const t = createTranslator(catalog)
    t.setLanguage('en')
    expect(t('incl.value', { count: 2, value: '3' })).toBe('incl. 3 by 2 subagents')
    expect(t('incl.plain', { count: 1 })).toBe('incl. 1 subagent')
    expect(t('split.subagents', { count: 1 })).toBe('1 subagent')
    t.setLanguage('ru')
    expect(t('split.subagents', { count: 2 })).toBe('2 субагента')
    expect(t('split.subagents', { count: 5 })).toBe('5 субагентов')
    expect(t('incl.value', { count: 1, value: '3' })).toBe('из них 3 — у 1 субагента')
    expect(t('incl.value', { count: 2, value: '3' })).toBe('из них 3 — у 2 субагентов')
    expect(t('split.title')).toBe('Основной агент и субагенты')
    expect(t('incl.requests', { value: '11' })).toBe('11 — у субагентов')
    t.setLanguage('zh')
    expect(t('split.subagents', { count: 2 })).toBe('2 个子智能体')
    expect(t('incl.plain', { count: 2 })).toBe('含 2 个子智能体')
    expect(t('export.part')).toBe('部分')
  })
})
