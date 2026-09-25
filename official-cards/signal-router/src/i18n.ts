import type { Catalog } from '@neurosquad/card-sdk'

export const catalog: Catalog = {
  en: {
    tabs: { rules: 'Rules', inspector: 'Inspector' },
    counters: { routed: 'routed', dropped: 'dropped' },
    sources: 'In',
    targets: 'Out',
    noSources: 'Draw an arrow into this card',
    noTargets: 'Draw an arrow from this card',
    mode: { first: 'First match', all: 'All matches', label: 'When several rules match' },
    rule: {
      add: 'Add rule',
      edit: 'Edit',
      save: 'Save',
      cancel: 'Cancel',
      delete: 'Delete',
      name: 'Name',
      unnamed: 'Rule {{n}}',
      match: 'When',
      target: 'Send to',
      input: 'Input',
      autoInput: 'auto ({{input}})',
      format: 'As',
      template: 'Template',
      templateHint: '{{.}} is the whole message, {{data.agent}} a field',
      eventType: 'Event type',
      perMinute: 'At most / min',
      enabled: 'On',
      hits_one: '{{count}} sent',
      hits_other: '{{count}} sent',
      disconnected: 'not connected',
      incompatible: 'no input takes {{type}}',
      needsPermission: 'needs permission',
      grant: 'Allow'
    },
    match: {
      any: 'anything arrives',
      contains: 'text contains',
      field: 'field',
      source: 'comes from',
      type: 'sender type is',
      fieldPath: 'path, e.g. data.agent',
      fieldValue: 'equals / contains (empty = exists)',
      text: 'text',
      summary: {
        any: 'anything',
        contains: 'contains “{{text}}”',
        field: '{{path}} ~ “{{text}}”',
        fieldExists: 'has {{path}}',
        source: 'from {{source}}',
        type: 'type {{type}}'
      }
    },
    format: { text: 'Text', json: 'JSON', event: 'Event' },
    kind: {
      agent: 'agent',
      terminal: 'terminal',
      note: 'note',
      todo: 'checklist',
      kanban: 'board',
      sticky: 'sticky',
      custom: 'card',
      other: 'card'
    },
    msg: {
      from: 'from {{name}}',
      routedTo: '→ {{name}}',
      dropped: {
        'no-rule': 'dropped: no rule matched',
        disabled: 'dropped: routing paused'
      },
      reason: {
        disconnected: 'not connected',
        loop: 'skipped: would echo back to the sender',
        'rate-limited': 'dropped: over the rule’s limit',
        permission: 'dropped: permission not granted',
        incompatible: 'dropped: no compatible input'
      },
      shape: 'Shape',
      value: 'Value',
      size: '{{size}}'
    },
    empty: {
      title: 'Nothing has flowed yet',
      body: 'Connect cards into the router with arrows, and out of it to where messages should go. Then add a rule.',
      inspector: 'Messages that arrive show up here, with their shape.'
    },
    loading: 'Loading rules…',
    error: { title: 'Could not load the router', retry: 'Try again' },
    paused: 'Routing paused',
    menu: { pause: 'Pause routing', resume: 'Resume routing', clear: 'Clear inspector' },
    overview: {
      primary_one: '{{count}} routed · {{rules}} rules',
      primary_other: '{{count}} routed · {{rules}} rules',
      dropped_one: '{{count}} dropped',
      dropped_other: '{{count}} dropped',
      idle: 'Waiting for signals'
    },
    status: { paused: 'paused' },
    permissionAsked: 'Allow it so the rule can deliver'
  },
  ru: {
    tabs: { rules: 'Правила', inspector: 'Инспектор' },
    counters: { routed: 'отправлено', dropped: 'отброшено' },
    sources: 'Вход',
    targets: 'Выход',
    noSources: 'Проведите стрелку в эту карточку',
    noTargets: 'Проведите стрелку из этой карточки',
    mode: { first: 'Первое совпадение', all: 'Все совпадения', label: 'Если подходит несколько правил' },
    rule: {
      add: 'Добавить правило',
      edit: 'Изменить',
      save: 'Сохранить',
      cancel: 'Отмена',
      delete: 'Удалить',
      name: 'Название',
      unnamed: 'Правило {{n}}',
      match: 'Когда',
      target: 'Отправить в',
      input: 'Вход',
      autoInput: 'авто ({{input}})',
      format: 'Как',
      template: 'Шаблон',
      templateHint: '{{.}} — всё сообщение, {{data.agent}} — поле',
      eventType: 'Тип события',
      perMinute: 'Не чаще / мин',
      enabled: 'Вкл',
      hits_one: 'отправлено {{count}}',
      hits_few: 'отправлено {{count}}',
      hits_many: 'отправлено {{count}}',
      hits_other: 'отправлено {{count}}',
      disconnected: 'не подключено',
      incompatible: 'нет входа для {{type}}',
      needsPermission: 'нужно разрешение',
      grant: 'Разрешить'
    },
    match: {
      any: 'приходит что угодно',
      contains: 'текст содержит',
      field: 'поле',
      source: 'приходит от',
      type: 'тип отправителя',
      fieldPath: 'путь, напр. data.agent',
      fieldValue: 'равно / содержит (пусто — есть поле)',
      text: 'текст',
      summary: {
        any: 'что угодно',
        contains: 'содержит «{{text}}»',
        field: '{{path}} ~ «{{text}}»',
        fieldExists: 'есть {{path}}',
        source: 'от {{source}}',
        type: 'тип {{type}}'
      }
    },
    format: { text: 'Текст', json: 'JSON', event: 'Событие' },
    kind: {
      agent: 'агент',
      terminal: 'терминал',
      note: 'заметка',
      todo: 'список',
      kanban: 'доска',
      sticky: 'стикер',
      custom: 'карточка',
      other: 'карточка'
    },
    msg: {
      from: 'от {{name}}',
      routedTo: '→ {{name}}',
      dropped: {
        'no-rule': 'отброшено: ни одно правило не подошло',
        disabled: 'отброшено: маршрутизация на паузе'
      },
      reason: {
        disconnected: 'не подключено',
        loop: 'пропущено: вернулось бы отправителю',
        'rate-limited': 'отброшено: превышен лимит правила',
        permission: 'отброшено: нет разрешения',
        incompatible: 'отброшено: нет подходящего входа'
      },
      shape: 'Структура',
      value: 'Значение',
      size: '{{size}}'
    },
    empty: {
      title: 'Пока ничего не приходило',
      body: 'Проведите стрелки от карточек в маршрутизатор и из него — туда, куда должны идти сообщения. Затем добавьте правило.',
      inspector: 'Пришедшие сообщения появятся здесь вместе со своей структурой.'
    },
    loading: 'Загружаю правила…',
    error: { title: 'Не удалось загрузить маршрутизатор', retry: 'Повторить' },
    paused: 'Маршрутизация на паузе',
    menu: { pause: 'Приостановить', resume: 'Возобновить', clear: 'Очистить инспектор' },
    overview: {
      primary_one: 'отправлено {{count}} · правил {{rules}}',
      primary_few: 'отправлено {{count}} · правил {{rules}}',
      primary_many: 'отправлено {{count}} · правил {{rules}}',
      primary_other: 'отправлено {{count}} · правил {{rules}}',
      dropped_one: 'отброшено {{count}}',
      dropped_few: 'отброшено {{count}}',
      dropped_many: 'отброшено {{count}}',
      dropped_other: 'отброшено {{count}}',
      idle: 'Жду сигналов'
    },
    status: { paused: 'пауза' },
    permissionAsked: 'Разрешите, чтобы правило могло доставлять'
  },
  zh: {
    tabs: { rules: '规则', inspector: '检查器' },
    counters: { routed: '已转发', dropped: '已丢弃' },
    sources: '输入',
    targets: '输出',
    noSources: '画一条箭头指向此卡片',
    noTargets: '从此卡片画一条箭头出去',
    mode: { first: '首个匹配', all: '全部匹配', label: '多条规则匹配时' },
    rule: {
      add: '添加规则',
      edit: '编辑',
      save: '保存',
      cancel: '取消',
      delete: '删除',
      name: '名称',
      unnamed: '规则 {{n}}',
      match: '当',
      target: '发送到',
      input: '输入端口',
      autoInput: '自动（{{input}}）',
      format: '格式',
      template: '模板',
      templateHint: '{{.}} 表示整条消息，{{data.agent}} 表示字段',
      eventType: '事件类型',
      perMinute: '每分钟最多',
      enabled: '启用',
      hits_other: '已发送 {{count}}',
      disconnected: '未连接',
      incompatible: '没有接受 {{type}} 的输入',
      needsPermission: '需要权限',
      grant: '允许'
    },
    match: {
      any: '收到任意消息',
      contains: '文本包含',
      field: '字段',
      source: '来自',
      type: '发送方类型为',
      fieldPath: '路径，如 data.agent',
      fieldValue: '等于 / 包含（留空 = 存在）',
      text: '文本',
      summary: {
        any: '任意',
        contains: '包含“{{text}}”',
        field: '{{path}} ~ “{{text}}”',
        fieldExists: '含有 {{path}}',
        source: '来自 {{source}}',
        type: '类型 {{type}}'
      }
    },
    format: { text: '文本', json: 'JSON', event: '事件' },
    kind: {
      agent: '智能体',
      terminal: '终端',
      note: '笔记',
      todo: '清单',
      kanban: '看板',
      sticky: '便签',
      custom: '卡片',
      other: '卡片'
    },
    msg: {
      from: '来自 {{name}}',
      routedTo: '→ {{name}}',
      dropped: {
        'no-rule': '已丢弃：没有匹配的规则',
        disabled: '已丢弃：路由已暂停'
      },
      reason: {
        disconnected: '未连接',
        loop: '已跳过：会回传给发送方',
        'rate-limited': '已丢弃：超出规则频率限制',
        permission: '已丢弃：未授予权限',
        incompatible: '已丢弃：没有兼容的输入'
      },
      shape: '结构',
      value: '值',
      size: '{{size}}'
    },
    empty: {
      title: '还没有任何数据流过',
      body: '用箭头把卡片连入路由器，再从路由器连到消息应去的地方，然后添加规则。',
      inspector: '收到的消息及其结构会显示在这里。'
    },
    loading: '正在加载规则…',
    error: { title: '无法加载路由器', retry: '重试' },
    paused: '路由已暂停',
    menu: { pause: '暂停路由', resume: '恢复路由', clear: '清空检查器' },
    overview: {
      primary_other: '已转发 {{count}} · {{rules}} 条规则',
      dropped_other: '已丢弃 {{count}}',
      idle: '等待信号'
    },
    status: { paused: '已暂停' },
    permissionAsked: '允许后规则才能投递'
  }
}
