import type { Catalog } from '@neurosquad/card-sdk'

/** The card's strings in the app's three languages (en is the fallback). */
export const catalog: Catalog = {
  en: {
    kpi: {
      working: 'Working',
      waiting: 'Waiting on you',
      turns: 'Turns',
      median: 'Median turn'
    },
    window: { label: 'Time window', '15m': '15m', '1h': '1h', '4h': '4h' },
    status: {
      working: 'working',
      'needs-input': 'waiting for you',
      finished: 'finished',
      idle: 'idle',
      exited: 'stopped'
    },
    busy: '{{percent}}% busy',
    turnsCount_one: '{{count}} turn',
    turnsCount_other: '{{count}} turns',
    footer: {
      waited: 'You kept agents waiting {{time}}',
      noWait: 'Nobody waited on you',
      longest: 'Longest turn {{time}} · {{agent}}'
    },
    empty: {
      title: 'No agents on this canvas yet',
      body: 'Add Claude Code, Codex or any other agent from the + menu — its pulse shows up here the moment it starts.'
    },
    loading: 'Listening for agents…',
    error: {
      title: 'Could not read the agents',
      retry: 'Try again'
    },
    read: 'Read by {{agent}}',
    overview: {
      primary: '{{working}} working · {{waiting}} waiting',
      idle_one: '{{count}} agent, all quiet',
      idle_other: '{{count}} agents, all quiet',
      none: 'No agents',
      secondary: 'Median turn {{time}}'
    },
    chip: {
      working_one: '{{count}} working',
      working_other: '{{count}} working',
      waiting_one: '{{count}} waiting',
      waiting_other: '{{count}} waiting'
    },
    nudge: '{{name}} has been waiting for you for {{time}}',
    menu: {
      report: 'Send report',
      clear: 'Clear history'
    },
    confirmClear: {
      title: 'Clear the pulse history?',
      message: 'Timelines and turn statistics of this card start over. Agents are not affected.',
      confirm: 'Clear'
    },
    sent_one: 'Report sent to {{count}} card',
    sent_other: 'Report sent to {{count}} cards',
    notConnected: 'Draw an arrow from this card to a note to send the report there',
    report: {
      title: 'Agent pulse — {{time}}',
      agent: 'Agent',
      status: 'Status',
      for: 'For',
      turns: 'Turns ({{window}})',
      busy: 'Busy',
      summary: 'Median turn {{median}} · longest {{longest}} · agents waited on you {{waited}}'
    },
    ago: 'now'
  },
  ru: {
    kpi: {
      working: 'Работают',
      waiting: 'Ждут вас',
      turns: 'Ходов',
      median: 'Медиана хода'
    },
    window: { label: 'Окно времени', '15m': '15м', '1h': '1ч', '4h': '4ч' },
    status: {
      working: 'работает',
      'needs-input': 'ждёт вас',
      finished: 'закончил',
      idle: 'свободен',
      exited: 'остановлен'
    },
    busy: 'занят {{percent}}%',
    turnsCount_one: '{{count}} ход',
    turnsCount_few: '{{count}} хода',
    turnsCount_many: '{{count}} ходов',
    turnsCount_other: '{{count}} хода',
    footer: {
      waited: 'Агенты ждали вас {{time}}',
      noWait: 'Никто вас не ждал',
      longest: 'Самый долгий ход {{time}} · {{agent}}'
    },
    empty: {
      title: 'На холсте пока нет агентов',
      body: 'Добавьте Claude Code, Codex или другого агента из меню + — его пульс появится здесь, как только он начнёт работу.'
    },
    loading: 'Слушаю агентов…',
    error: {
      title: 'Не удалось получить агентов',
      retry: 'Повторить'
    },
    read: 'Прочитал {{agent}}',
    overview: {
      primary: 'работают {{working}} · ждут {{waiting}}',
      idle_one: '{{count}} агент, всё тихо',
      idle_few: '{{count}} агента, всё тихо',
      idle_many: '{{count}} агентов, всё тихо',
      idle_other: '{{count}} агента, всё тихо',
      none: 'Нет агентов',
      secondary: 'Медиана хода {{time}}'
    },
    chip: {
      working_one: 'работает {{count}}',
      working_few: 'работают {{count}}',
      working_many: 'работают {{count}}',
      working_other: 'работают {{count}}',
      waiting_one: 'ждёт {{count}}',
      waiting_few: 'ждут {{count}}',
      waiting_many: 'ждут {{count}}',
      waiting_other: 'ждут {{count}}'
    },
    nudge: '{{name}} ждёт вас уже {{time}}',
    menu: {
      report: 'Отправить отчёт',
      clear: 'Очистить историю'
    },
    confirmClear: {
      title: 'Очистить историю пульса?',
      message: 'Шкалы и статистика ходов этой карточки начнутся заново. На агентов это не влияет.',
      confirm: 'Очистить'
    },
    sent_one: 'Отчёт отправлен в {{count}} карточку',
    sent_few: 'Отчёт отправлен в {{count}} карточки',
    sent_many: 'Отчёт отправлен в {{count}} карточек',
    sent_other: 'Отчёт отправлен в {{count}} карточки',
    notConnected: 'Проведите стрелку от этой карточки к заметке, чтобы отправить туда отчёт',
    report: {
      title: 'Пульс агентов — {{time}}',
      agent: 'Агент',
      status: 'Статус',
      for: 'Сколько',
      turns: 'Ходов ({{window}})',
      busy: 'Занят',
      summary: 'Медиана хода {{median}} · самый долгий {{longest}} · агенты ждали вас {{waited}}'
    },
    ago: 'сейчас'
  },
  zh: {
    kpi: {
      working: '工作中',
      waiting: '等你回复',
      turns: '轮次',
      median: '轮次中位数'
    },
    window: { label: '时间窗口', '15m': '15分', '1h': '1时', '4h': '4时' },
    status: {
      working: '工作中',
      'needs-input': '等你回复',
      finished: '已完成',
      idle: '空闲',
      exited: '已停止'
    },
    busy: '忙碌 {{percent}}%',
    turnsCount_other: '{{count}} 轮',
    footer: {
      waited: '智能体共等了你 {{time}}',
      noWait: '没有智能体在等你',
      longest: '最长一轮 {{time}} · {{agent}}'
    },
    empty: {
      title: '画布上还没有智能体',
      body: '从 + 菜单添加 Claude Code、Codex 或其他智能体——它一开始工作，脉搏就会出现在这里。'
    },
    loading: '正在监听智能体…',
    error: {
      title: '无法读取智能体',
      retry: '重试'
    },
    read: '{{agent}} 已读取',
    overview: {
      primary: '{{working}} 个工作中 · {{waiting}} 个在等待',
      idle_other: '{{count}} 个智能体，一切安静',
      none: '没有智能体',
      secondary: '轮次中位数 {{time}}'
    },
    chip: {
      working_other: '{{count}} 个工作中',
      waiting_other: '{{count}} 个在等待'
    },
    nudge: '{{name}} 已经等了你 {{time}}',
    menu: {
      report: '发送报告',
      clear: '清除历史'
    },
    confirmClear: {
      title: '清除脉搏历史？',
      message: '此卡片的时间线和轮次统计将重新开始，不影响智能体。',
      confirm: '清除'
    },
    sent_other: '报告已发送到 {{count}} 张卡片',
    notConnected: '从此卡片画一条箭头到笔记，即可把报告发送过去',
    report: {
      title: '智能体脉搏 — {{time}}',
      agent: '智能体',
      status: '状态',
      for: '持续',
      turns: '轮次（{{window}}）',
      busy: '忙碌',
      summary: '轮次中位数 {{median}} · 最长 {{longest}} · 智能体共等了你 {{waited}}'
    },
    ago: '刚刚'
  }
}
