import type { Catalog } from '@neurosquad/card-sdk'

/** The card's strings in the app's three languages (en is the fallback). */
export const catalog: Catalog = {
  en: {
    title: 'Run stats',
    metric: {
      prompts: 'Prompts',
      requests: 'Model requests',
      input: 'Input',
      output: 'Output',
      cacheRead: 'Cache read',
      cacheWrite: 'Cache write',
      total: 'Total tokens',
      elapsed: 'Elapsed',
      working: 'Working time',
      cost: 'Cost'
    },
    hint: {
      prompts: 'Turns the agent was given. Answering a permission prompt continues the same turn.',
      requests: 'API round-trips the agent made, from its own log.',
      input: 'Uncached input (prompt) tokens.',
      output: 'Output tokens, reasoning included.',
      cacheRead: 'Input tokens served from the cache.',
      cacheWrite: 'Input tokens written to the cache.',
      total: 'Input + output + cache read + cache write.',
      elapsed: 'From the first prompt to the last finish.',
      working: 'Time the agent was working — waiting on you excluded.',
      cost: 'At the provider’s list price, or what the harness itself recorded.'
    },
    notReported: 'not reported',
    noPrice: 'no price',
    reasoning: '{{count}} reasoning',
    status: {
      working: 'working',
      'needs-input': 'waiting for you',
      finished: 'finished',
      idle: 'idle',
      exited: 'stopped'
    },
    phase: {
      armed: 'Ready — measuring from the next prompt',
      measuring: 'Measuring',
      frozen: 'Frozen at the finish',
      frozenManual: 'Frozen'
    },
    since: 'since {{time}}',
    workingAgain: 'The agent is working again — these numbers stay frozen.',
    partial: 'NeuroSquad was not watching this agent for the whole run (the app or the agent started later): timing covers only what it saw.',
    action: {
      start: 'Start measuring now',
      reset: 'New run',
      freeze: 'Freeze',
      unfreeze: 'Unfreeze',
      copyMd: 'Copy Markdown',
      copyJson: 'Copy JSON',
      send: 'Send to note',
      autoFreeze: 'Freeze at finish'
    },
    copied: 'Copied',
    copyDenied: 'Allow clipboard access to copy the results',
    sent_one: 'Sent to {{count}} card',
    sent_other: 'Sent to {{count}} cards',
    noNote: 'Draw an arrow from this card to a note to send the results there',
    empty: {
      title: 'Connect an agent',
      body: 'Draw an arrow between this card and Claude Code, Codex, OpenCode or any other agent — its run shows up here.'
    },
    choose: {
      title: 'Which agent?',
      body: 'Several agents are connected. Pick the one to measure:'
    },
    unsupported: {
      title: 'Update NeuroSquad',
      body: 'Run stats needs NeuroSquad 0.1.254 or newer (the agents.usage API).'
    },
    loading: 'Reading the run…',
    error: {
      title: 'Could not read the run',
      retry: 'Try again'
    },
    unreadable: 'This agent keeps no usage log NeuroSquad can read — only prompts and time are measured.',
    overview: {
      primary: '{{tokens}} tokens · {{elapsed}}',
      armed: 'Ready',
      none: 'Connect an agent',
      secondary: '{{requests}} requests · {{harness}}',
      secondaryNoRequests: '{{prompts}} prompts · {{harness}}'
    },
    export: {
      title: 'Run stats',
      metric: 'Metric',
      value: 'Value',
      agent: 'Agent',
      model: 'Model',
      provider: 'Provider',
      window: 'Run'
    }
  },
  ru: {
    title: 'Статистика прогона',
    metric: {
      prompts: 'Промпты',
      requests: 'Запросы к модели',
      input: 'Ввод',
      output: 'Вывод',
      cacheRead: 'Чтение кеша',
      cacheWrite: 'Запись в кеш',
      total: 'Всего токенов',
      elapsed: 'Прошло',
      working: 'Время работы',
      cost: 'Стоимость'
    },
    hint: {
      prompts: 'Сколько ходов дали агенту. Ответ на запрос разрешения продолжает тот же ход.',
      requests: 'Обращения агента к API модели — из его собственного журнала.',
      input: 'Некешированные входные токены (промпт).',
      output: 'Выходные токены, включая рассуждения.',
      cacheRead: 'Входные токены, прочитанные из кеша.',
      cacheWrite: 'Входные токены, записанные в кеш.',
      total: 'Ввод + вывод + чтение кеша + запись в кеш.',
      elapsed: 'От первого промпта до последнего завершения.',
      working: 'Сколько агент работал — без ожидания вас.',
      cost: 'По прайсу провайдера или как записал сам харнесс.'
    },
    notReported: 'не сообщается',
    noPrice: 'нет цены',
    reasoning: 'рассуждения: {{count}}',
    status: {
      working: 'работает',
      'needs-input': 'ждёт вас',
      finished: 'закончил',
      idle: 'простаивает',
      exited: 'остановлен'
    },
    phase: {
      armed: 'Готово — замер начнётся со следующего промпта',
      measuring: 'Идёт замер',
      frozen: 'Заморожено на финише',
      frozenManual: 'Заморожено'
    },
    since: 'с {{time}}',
    workingAgain: 'Агент снова работает — эти цифры заморожены.',
    partial: 'NeuroSquad следил за агентом не весь прогон (приложение или агент запущены позже): время учитывает только то, что оно видело.',
    action: {
      start: 'Начать замер',
      reset: 'Новый прогон',
      freeze: 'Заморозить',
      unfreeze: 'Разморозить',
      copyMd: 'Копировать Markdown',
      copyJson: 'Копировать JSON',
      send: 'Отправить в заметку',
      autoFreeze: 'Замораживать на финише'
    },
    copied: 'Скопировано',
    copyDenied: 'Разрешите доступ к буферу обмена, чтобы скопировать результаты',
    sent_one: 'Отправлено в {{count}} карточку',
    sent_few: 'Отправлено в {{count}} карточки',
    sent_many: 'Отправлено в {{count}} карточек',
    sent_other: 'Отправлено в {{count}} карточки',
    noNote: 'Проведите стрелку от этой карточки к заметке, чтобы отправлять туда результаты',
    empty: {
      title: 'Подключите агента',
      body: 'Проведите стрелку между этой карточкой и Claude Code, Codex, OpenCode или любым другим агентом — здесь появится его прогон.'
    },
    choose: {
      title: 'Какой агент?',
      body: 'Подключено несколько агентов. Выберите, кого замерять:'
    },
    unsupported: {
      title: 'Обновите NeuroSquad',
      body: 'Для статистики прогона нужен NeuroSquad 0.1.254 или новее (API agents.usage).'
    },
    loading: 'Читаю прогон…',
    error: {
      title: 'Не удалось прочитать прогон',
      retry: 'Повторить'
    },
    unreadable: 'Этот агент не ведёт журнал расхода, который умеет читать NeuroSquad, — замеряются только промпты и время.',
    overview: {
      primary: '{{tokens}} токенов · {{elapsed}}',
      armed: 'Готово',
      none: 'Подключите агента',
      secondary: 'запросов: {{requests}} · {{harness}}',
      secondaryNoRequests: 'промптов: {{prompts}} · {{harness}}'
    },
    export: {
      title: 'Статистика прогона',
      metric: 'Показатель',
      value: 'Значение',
      agent: 'Агент',
      model: 'Модель',
      provider: 'Провайдер',
      window: 'Прогон'
    }
  },
  zh: {
    title: '运行统计',
    metric: {
      prompts: '提示',
      requests: '模型请求',
      input: '输入',
      output: '输出',
      cacheRead: '缓存读取',
      cacheWrite: '缓存写入',
      total: '词元总数',
      elapsed: '总用时',
      working: '工作时间',
      cost: '费用'
    },
    hint: {
      prompts: '交给智能体的回合数。回答权限请求属于同一回合。',
      requests: '智能体对模型 API 的调用次数，来自其自身日志。',
      input: '未缓存的输入（提示）词元。',
      output: '输出词元，含推理。',
      cacheRead: '从缓存读取的输入词元。',
      cacheWrite: '写入缓存的输入词元。',
      total: '输入 + 输出 + 缓存读取 + 缓存写入。',
      elapsed: '从第一个提示到最后一次完成。',
      working: '智能体实际工作的时间——不含等你的时间。',
      cost: '按服务商标价，或按工具自身记录的费用。'
    },
    notReported: '未报告',
    noPrice: '无价格',
    reasoning: '其中推理 {{count}}',
    status: {
      working: '工作中',
      'needs-input': '等你处理',
      finished: '已完成',
      idle: '空闲',
      exited: '已停止'
    },
    phase: {
      armed: '就绪——从下一个提示开始测量',
      measuring: '测量中',
      frozen: '已在完成时冻结',
      frozenManual: '已冻结'
    },
    since: '自 {{time}}',
    workingAgain: '智能体又开始工作了——这些数字保持冻结。',
    partial: 'NeuroSquad 并未全程观察该智能体（应用或智能体启动较晚）：用时只统计它看到的部分。',
    action: {
      start: '立即开始测量',
      reset: '新的运行',
      freeze: '冻结',
      unfreeze: '解除冻结',
      copyMd: '复制 Markdown',
      copyJson: '复制 JSON',
      send: '发送到笔记',
      autoFreeze: '完成时冻结'
    },
    copied: '已复制',
    copyDenied: '允许访问剪贴板才能复制结果',
    sent_other: '已发送到 {{count}} 张卡片',
    noNote: '从此卡片画一条箭头到笔记，即可把结果发送过去',
    empty: {
      title: '连接一个智能体',
      body: '在此卡片与 Claude Code、Codex、OpenCode 或任意智能体之间画一条箭头——它的运行数据会显示在这里。'
    },
    choose: {
      title: '测量哪个智能体？',
      body: '已连接多个智能体。请选择要测量的一个：'
    },
    unsupported: {
      title: '请更新 NeuroSquad',
      body: '运行统计需要 NeuroSquad 0.1.254 或更高版本（agents.usage API）。'
    },
    loading: '正在读取运行数据…',
    error: {
      title: '无法读取运行数据',
      retry: '重试'
    },
    unreadable: '该智能体没有 NeuroSquad 可读取的用量日志——只测量提示数和时间。',
    overview: {
      primary: '{{tokens}} 词元 · {{elapsed}}',
      armed: '就绪',
      none: '连接一个智能体',
      secondary: '{{requests}} 次请求 · {{harness}}',
      secondaryNoRequests: '{{prompts}} 个提示 · {{harness}}'
    },
    export: {
      title: '运行统计',
      metric: '指标',
      value: '数值',
      agent: '智能体',
      model: '模型',
      provider: '服务商',
      window: '运行'
    }
  }
}
