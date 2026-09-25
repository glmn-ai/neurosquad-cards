import type { Catalog } from '@neurosquad/card-sdk'

/** The card's strings in the app's three languages (en is the fallback). */
export const catalog: Catalog = {
  en: {
    title: 'Decisions',
    count_one: '{{count}} decision',
    count_other: '{{count}} decisions',
    search: 'Search decisions',
    new: 'New',
    back: 'All decisions',
    filter: {
      all: 'All',
      proposed: 'To review',
      accepted: 'Accepted',
      rejected: 'Rejected',
      superseded: 'Superseded'
    },
    status: {
      proposed: 'proposed',
      accepted: 'accepted',
      rejected: 'rejected',
      superseded: 'superseded'
    },
    by: 'by {{name}}',
    agent: 'agent',
    section: {
      context: 'Context',
      decision: 'Decision',
      alternatives: 'Alternatives considered',
      consequences: 'Consequences',
      history: 'History'
    },
    supersededBy: 'Superseded by',
    supersedes: 'Replaces',
    edited: 'edited',
    action: {
      accept: 'Accept',
      reject: 'Reject',
      edit: 'Edit',
      supersede: 'Superseded by…',
      send: 'Send to connected cards',
      delete: 'Delete'
    },
    pick: 'Select a decision to read it',
    noMatch: 'Nothing matches',
    clearFilters: 'Clear filters',
    recordedBy: 'Recorded by {{agent}}',
    changedBy: 'Updated by {{agent}}',
    readBy: 'Read by {{agent}}',
    empty: {
      title: 'No decisions yet',
      body: 'Connect an agent with an arrow: it can record decisions here with the decision_log_record tool. Or write the first one yourself.',
      cta: 'Write a decision'
    },
    loading: 'Opening the log…',
    error: { title: 'Could not open the log', retry: 'Try again' },
    form: {
      titleNew: 'New decision',
      titleEdit: 'Edit {{id}}',
      title: 'Title',
      titlePh: 'Use SQLite for the local cache',
      decision: 'Decision',
      decisionPh: 'What was decided, and why',
      context: 'Context',
      alternatives: 'Alternatives (one per line)',
      consequences: 'Consequences',
      tags: 'Tags (comma separated)',
      status: 'Status',
      save: 'Save',
      cancel: 'Cancel'
    },
    supersedePick: 'Replaced by which decision?',
    overview: {
      primary_one: '{{count}} decision · {{review}} to review',
      primary_other: '{{count}} decisions · {{review}} to review',
      calm_one: '{{count}} decision',
      calm_other: '{{count}} decisions',
      none: 'No decisions yet'
    },
    attention: '{{agent}} proposed: {{title}}',
    attentionMany: '{{count}} decisions wait for your review',
    menu: { export: 'Export as ADR files', new: 'New decision' },
    exported_one: 'Wrote {{count}} file to {{folder}}',
    exported_other: 'Wrote {{count}} files to {{folder}}',
    exportNeedsPermission: 'Export needs permission to write files',
    exportEmpty: 'Nothing to export yet',
    sent_one: 'Sent to {{count}} card',
    sent_other: 'Sent to {{count}} cards',
    notConnected: 'Draw an arrow from this card to a note to send decisions there',
    confirmDelete: {
      title: 'Delete {{id}}?',
      message: 'The entry is removed from this log. Its number is not reused.',
      confirm: 'Delete'
    },
    saveFailed: 'Could not save: {{error}}'
  },
  ru: {
    title: 'Решения',
    count_one: '{{count}} решение',
    count_few: '{{count}} решения',
    count_many: '{{count}} решений',
    count_other: '{{count}} решения',
    search: 'Поиск по решениям',
    new: 'Новое',
    back: 'Все решения',
    filter: {
      all: 'Все',
      proposed: 'На проверку',
      accepted: 'Приняты',
      rejected: 'Отклонены',
      superseded: 'Заменены'
    },
    status: {
      proposed: 'предложено',
      accepted: 'принято',
      rejected: 'отклонено',
      superseded: 'заменено'
    },
    by: 'автор: {{name}}',
    agent: 'агент',
    section: {
      context: 'Контекст',
      decision: 'Решение',
      alternatives: 'Рассмотренные варианты',
      consequences: 'Последствия',
      history: 'История'
    },
    supersededBy: 'Заменено на',
    supersedes: 'Заменяет',
    edited: 'изменено',
    action: {
      accept: 'Принять',
      reject: 'Отклонить',
      edit: 'Изменить',
      supersede: 'Заменено на…',
      send: 'Отправить в подключённые карточки',
      delete: 'Удалить'
    },
    pick: 'Выберите решение, чтобы прочитать его',
    noMatch: 'Ничего не найдено',
    clearFilters: 'Сбросить фильтры',
    recordedBy: 'Записал {{agent}}',
    changedBy: 'Обновил {{agent}}',
    readBy: 'Прочитал {{agent}}',
    empty: {
      title: 'Решений пока нет',
      body: 'Соедините агента стрелкой: он сможет записывать сюда решения инструментом decision_log_record. Или напишите первое сами.',
      cta: 'Записать решение'
    },
    loading: 'Открываю журнал…',
    error: { title: 'Не удалось открыть журнал', retry: 'Повторить' },
    form: {
      titleNew: 'Новое решение',
      titleEdit: 'Правка {{id}}',
      title: 'Заголовок',
      titlePh: 'Использовать SQLite для локального кэша',
      decision: 'Решение',
      decisionPh: 'Что решили и почему',
      context: 'Контекст',
      alternatives: 'Варианты (по одному в строке)',
      consequences: 'Последствия',
      tags: 'Теги (через запятую)',
      status: 'Статус',
      save: 'Сохранить',
      cancel: 'Отмена'
    },
    supersedePick: 'Каким решением заменено?',
    overview: {
      primary_one: '{{count}} решение · на проверку {{review}}',
      primary_few: '{{count}} решения · на проверку {{review}}',
      primary_many: '{{count}} решений · на проверку {{review}}',
      primary_other: '{{count}} решения · на проверку {{review}}',
      calm_one: '{{count}} решение',
      calm_few: '{{count}} решения',
      calm_many: '{{count}} решений',
      calm_other: '{{count}} решения',
      none: 'Решений пока нет'
    },
    attention: '{{agent}} предлагает: {{title}}',
    attentionMany: 'Решений ждут вашей проверки: {{count}}',
    menu: { export: 'Выгрузить как файлы ADR', new: 'Новое решение' },
    exported_one: 'Записан {{count}} файл в {{folder}}',
    exported_few: 'Записано {{count}} файла в {{folder}}',
    exported_many: 'Записано {{count}} файлов в {{folder}}',
    exported_other: 'Записано {{count}} файла в {{folder}}',
    exportNeedsPermission: 'Для выгрузки нужно разрешение на запись файлов',
    exportEmpty: 'Выгружать пока нечего',
    sent_one: 'Отправлено в {{count}} карточку',
    sent_few: 'Отправлено в {{count}} карточки',
    sent_many: 'Отправлено в {{count}} карточек',
    sent_other: 'Отправлено в {{count}} карточки',
    notConnected: 'Проведите стрелку от этой карточки к заметке, чтобы отправлять туда решения',
    confirmDelete: {
      title: 'Удалить {{id}}?',
      message: 'Запись удалится из журнала. Её номер больше не будет использован.',
      confirm: 'Удалить'
    },
    saveFailed: 'Не удалось сохранить: {{error}}'
  },
  zh: {
    title: '决策',
    count_other: '{{count}} 条决策',
    search: '搜索决策',
    new: '新建',
    back: '全部决策',
    filter: {
      all: '全部',
      proposed: '待审阅',
      accepted: '已接受',
      rejected: '已拒绝',
      superseded: '已取代'
    },
    status: {
      proposed: '提议',
      accepted: '已接受',
      rejected: '已拒绝',
      superseded: '已取代'
    },
    by: '作者 {{name}}',
    agent: '智能体',
    section: {
      context: '背景',
      decision: '决策',
      alternatives: '考虑过的方案',
      consequences: '影响',
      history: '历史'
    },
    supersededBy: '被取代于',
    supersedes: '取代',
    edited: '已编辑',
    action: {
      accept: '接受',
      reject: '拒绝',
      edit: '编辑',
      supersede: '被取代于…',
      send: '发送到已连接的卡片',
      delete: '删除'
    },
    pick: '选择一条决策查看',
    noMatch: '没有匹配项',
    clearFilters: '清除筛选',
    recordedBy: '{{agent}} 已记录',
    changedBy: '{{agent}} 已更新',
    readBy: '{{agent}} 已读取',
    empty: {
      title: '还没有决策',
      body: '用箭头连接一个智能体：它可以用 decision_log_record 工具在这里记录决策。也可以由你写下第一条。',
      cta: '写一条决策'
    },
    loading: '正在打开日志…',
    error: { title: '无法打开日志', retry: '重试' },
    form: {
      titleNew: '新决策',
      titleEdit: '编辑 {{id}}',
      title: '标题',
      titlePh: '本地缓存使用 SQLite',
      decision: '决策',
      decisionPh: '决定了什么，为什么',
      context: '背景',
      alternatives: '备选方案（每行一个）',
      consequences: '影响',
      tags: '标签（逗号分隔）',
      status: '状态',
      save: '保存',
      cancel: '取消'
    },
    supersedePick: '被哪条决策取代？',
    overview: {
      primary_other: '{{count}} 条决策 · {{review}} 条待审阅',
      calm_other: '{{count}} 条决策',
      none: '还没有决策'
    },
    attention: '{{agent}} 提议：{{title}}',
    attentionMany: '{{count}} 条决策等待你审阅',
    menu: { export: '导出为 ADR 文件', new: '新决策' },
    exported_other: '已向 {{folder}} 写入 {{count}} 个文件',
    exportNeedsPermission: '导出需要写入文件的权限',
    exportEmpty: '还没有可导出的内容',
    sent_other: '已发送到 {{count}} 张卡片',
    notConnected: '从此卡片画一条箭头到笔记，即可把决策发送过去',
    confirmDelete: {
      title: '删除 {{id}}？',
      message: '该条目将从日志中删除，编号不会再被使用。',
      confirm: '删除'
    },
    saveFailed: '无法保存：{{error}}'
  }
}
