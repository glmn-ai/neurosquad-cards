import type { Catalog } from '@neurosquad/card-sdk'

/** The card's strings in the app's three languages (en is the fallback). */
export const catalog: Catalog = {
  en: {
    view: { label: 'View', requests: 'Requests', status: 'Status' },
    requests: {
      kpi: {
        requests: 'Requests',
        modelTime: 'Model time',
        median: 'Median request',
        longest: 'Longest'
      },
      window: { all: 'Run', '15m': '15m', '1h': '1h', '4h': '4h' },
      fit: 'Fit',
      zoomHint: 'Scroll to zoom, drag to pan',
      legend: {
        request: 'model request',
        working: 'working',
        prompt: 'prompt',
        finished: 'finished',
        subagent: 'subagent request'
      },
      notReported: 'not reported',
      noStart: 'start not logged',
      tip: {
        tokens: '{{input}} in · {{output}} out',
        cache: '{{count}} from cache',
        subagent: 'Subagent: {{name}}',
        subagentUnnamed: 'Subagent'
      },
      lane: {
        requests_one: '{{count}} request',
        requests_other: '{{count}} requests',
        inclSub_one: 'incl. {{count}} by subagents',
        inclSub_other: 'incl. {{count}} by subagents',
        model: '{{time}} model',
        median: 'median {{time}}',
        longest: 'max {{time}}',
        endOnly: 'completion times only',
        none: 'no usage log'
      },
      overview: {
        primary: '{{count}} requests · median {{median}}',
        secondary: 'Longest request {{time}}'
      },
      unsupported: {
        title: 'Update NeuroSquad',
        body: 'The request timeline needs NeuroSquad 0.1.257 or newer. The Status view works.'
      },
      empty: {
        title: 'Connect agents',
        body: 'Draw arrows between this card and the agents to compare — every model request of each shows up on its own lane.'
      },
      permission: {
        title: 'Allow token data',
        body: 'The request timeline reads the connected agents’ requests and tokens (optional "usage" permission).',
        allow: 'Allow'
      },
      error: { title: 'Could not read the requests' }
    },
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
    view: { label: 'Вид', requests: 'Запросы', status: 'Статусы' },
    requests: {
      kpi: {
        requests: 'Запросов',
        modelTime: 'Время модели',
        median: 'Медиана запроса',
        longest: 'Самый долгий'
      },
      window: { all: 'Прогон', '15m': '15 мин', '1h': '1 ч', '4h': '4 ч' },
      fit: 'Вписать',
      zoomHint: 'Колесо — масштаб, перетаскивание — сдвиг',
      legend: {
        request: 'запрос к модели',
        working: 'работает',
        prompt: 'промпт',
        finished: 'закончил',
        subagent: 'запрос субагента'
      },
      notReported: 'не сообщается',
      noStart: 'начало не записано',
      tip: {
        tokens: '{{input}} ввод · {{output}} вывод',
        cache: '{{count}} из кеша',
        subagent: 'Субагент: {{name}}',
        subagentUnnamed: 'Субагент'
      },
      lane: {
        requests_one: '{{count}} запрос',
        requests_few: '{{count}} запроса',
        requests_many: '{{count}} запросов',
        requests_other: '{{count}} запроса',
        inclSub_one: 'из них {{count}} у субагентов',
        inclSub_few: 'из них {{count}} у субагентов',
        inclSub_many: 'из них {{count}} у субагентов',
        inclSub_other: 'из них {{count}} у субагентов',
        model: 'модель {{time}}',
        median: 'медиана {{time}}',
        longest: 'макс. {{time}}',
        endOnly: 'только время завершения',
        none: 'нет журнала расхода'
      },
      overview: {
        primary: '{{count}} запр. · медиана {{median}}',
        secondary: 'Самый долгий запрос {{time}}'
      },
      unsupported: {
        title: 'Обновите NeuroSquad',
        body: 'Для шкалы запросов нужен NeuroSquad 0.1.257 или новее. Вид «Статусы» работает.'
      },
      empty: {
        title: 'Подключите агентов',
        body: 'Проведите стрелки между этой карточкой и агентами, которых хотите сравнить, — каждый запрос к модели появится на дорожке своего агента.'
      },
      permission: {
        title: 'Разрешите данные о токенах',
        body: 'Шкала запросов читает запросы и токены подключённых агентов (необязательное разрешение «расход»).',
        allow: 'Разрешить'
      },
      error: { title: 'Не удалось прочитать запросы' }
    },
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
    view: { label: '视图', requests: '请求', status: '状态' },
    requests: {
      kpi: { requests: '请求', modelTime: '模型时间', median: '请求中位数', longest: '最长' },
      window: { all: '本次运行', '15m': '15分', '1h': '1时', '4h': '4时' },
      fit: '适配',
      zoomHint: '滚轮缩放，拖动平移',
      legend: {
        request: '模型请求',
        working: '工作中',
        prompt: '提示',
        finished: '已完成',
        subagent: '子智能体请求'
      },
      notReported: '未报告',
      noStart: '未记录开始时间',
      tip: {
        tokens: '输入 {{input}} · 输出 {{output}}',
        cache: '{{count}} 来自缓存',
        subagent: '子智能体：{{name}}',
        subagentUnnamed: '子智能体'
      },
      lane: {
        requests_other: '{{count}} 次请求',
        inclSub_other: '含子智能体 {{count}} 次',
        model: '模型 {{time}}',
        median: '中位 {{time}}',
        longest: '最长 {{time}}',
        endOnly: '仅有完成时间',
        none: '无用量日志'
      },
      overview: { primary: '{{count}} 次请求 · 中位 {{median}}', secondary: '最长请求 {{time}}' },
      unsupported: {
        title: '请更新 NeuroSquad',
        body: '请求时间线需要 NeuroSquad 0.1.257 或更高版本。“状态”视图可正常使用。'
      },
      empty: {
        title: '连接智能体',
        body: '在此卡片与要比较的智能体之间画箭头——每个智能体的每次模型请求都会显示在它自己的泳道上。'
      },
      permission: {
        title: '允许读取词元数据',
        body: '请求时间线会读取已连接智能体的请求和词元（可选的“用量”权限）。',
        allow: '允许'
      },
      error: { title: '无法读取请求' }
    },
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
