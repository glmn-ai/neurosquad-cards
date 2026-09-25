import type { CardLanguage } from '@neurosquad/card-sdk'

const UNITS: Record<CardLanguage, { s: string; m: string; h: string; sep: string }> = {
  en: { s: 's', m: 'm', h: 'h', sep: ' ' },
  ru: { s: ' с', m: ' мин', h: ' ч', sep: ' ' },
  zh: { s: '秒', m: '分', h: '小时', sep: '' }
}

/** Compact duration in the app language: "4m 05s" / "4 мин 05 с" / "4分05秒". */
export function duration(ms: number, language: CardLanguage): string {
  const u = UNITS[language] ?? UNITS.en
  const seconds = Math.max(0, Math.floor(ms / 1000))
  if (seconds < 60) return `${seconds}${u.s}`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}${u.m}${u.sep}${String(seconds % 60).padStart(2, '0')}${u.s}`
  const hours = Math.floor(minutes / 60)
  return `${hours}${u.h}${u.sep}${String(minutes % 60).padStart(2, '0')}${u.m}`
}

/** Clock time in the app locale. */
export function clock(at: number, locale: string): string {
  return new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(at)
}

const HARNESS_LABELS: Record<string, string> = {
  'claude-code': 'Claude Code',
  'codex-cli': 'Codex',
  opencode: 'OpenCode',
  'qwen-code': 'Qwen Code',
  'cursor-cli': 'Cursor',
  'kilo-code': 'Kilo',
  'hermes-agent': 'Hermes',
  pi: 'pi',
  omp: 'omp',
  crush: 'Crush',
  'shell-bash': 'bash',
  'shell-powershell': 'PowerShell',
  'shell-cmd': 'cmd'
}

export function harnessLabel(harness: string): string {
  return HARNESS_LABELS[harness] ?? harness
}
