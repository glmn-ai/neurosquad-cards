import type { Catalog } from '@neurosquad/card-sdk'

export const catalog: Catalog = {
  en: {
    status: { go: 'GO', nogo: 'NO-GO', pending: 'STANDBY' },
    phase: {
      empty: 'No checks',
      hold: 'HOLD',
      pending: 'Counting',
      go: 'All GO',
      launched: 'LAUNCH',
      scrubbed: 'Scrubbed'
    },
    noClock: 'No countdown',
    clock: {
      set: 'Set T−0',
      clear: 'Clear',
      plus15: '+15m',
      plus60: '+1h',
      label: 'Launch time'
    },
    goCount: '{{go}}/{{total}} GO',
    setBy: 'by {{who}}',
    you: 'you',
    fromPort: 'from {{who}}',
    add: {
      placeholder: 'Add a check — e.g. "Tests green"',
      button: 'Add'
    },
    empty: {
      title: 'Add your first check',
      body: 'Type one below — or connect an agent: it can add checks and call GO / NO-GO with the card’s tools.'
    },
    loading: 'Powering up the board…',
    error: { title: 'The board could not be loaded', retry: 'Try again' },
    cycle: 'Click to cycle GO → NO-GO → STANDBY',
    remove: 'Remove {{name}}',
    agentSet: '{{agent}} set “{{check}}” to {{status}}',
    attention: '{{agent}}: NO-GO on “{{check}}”',
    menu: {
      report: 'Send status report',
      reset: 'Reset all to standby',
      compact: 'Compact size',
      full: 'Full size'
    },
    confirmReset: {
      title: 'Reset every check?',
      message: 'All checks go back to STANDBY and their notes are cleared. The countdown keeps running.',
      confirm: 'Reset'
    },
    sent_one: 'Report sent to {{count}} card',
    sent_other: 'Report sent to {{count}} cards',
    notConnected: 'Draw an arrow from this card to a note to send the report there',
    goSent: 'GO signal sent',
    report: {
      title: '{{title}} — {{t}}',
      summary: '{{go}}/{{total}} GO · {{nogo}} NO-GO · {{pending}} standby'
    },
    overview: {
      noClock: '{{go}}/{{total}} GO',
      clock: '{{t}} · {{go}}/{{total}} GO',
      empty: 'No checks yet'
    },
    launchedAt: 'Launched',
    warning: 'Checks pending close to T−0'
  },
  ru: {
    status: { go: 'GO', nogo: 'NO-GO', pending: 'ОЖИДАНИЕ' },
    phase: {
      empty: 'Нет проверок',
      hold: 'СТОП',
      pending: 'Отсчёт',
      go: 'Всё GO',
      launched: 'ПУСК',
      scrubbed: 'Отменено'
    },
    noClock: 'Без отсчёта',
    clock: {
      set: 'Задать T−0',
      clear: 'Сбросить',
      plus15: '+15 мин',
      plus60: '+1 ч',
      label: 'Время запуска'
    },
    goCount: '{{go}}/{{total}} GO',
    setBy: '— {{who}}',
    you: 'вы',
    fromPort: 'из «{{who}}»',
    add: {
      placeholder: 'Добавьте проверку — например, «Тесты зелёные»',
      button: 'Добавить'
    },
    empty: {
      title: 'Добавьте первую проверку',
      body: 'Введите её ниже — или подключите агента: он сам добавит проверки и скажет GO / NO-GO инструментами карточки.'
    },
    loading: 'Включаю пульт…',
    error: { title: 'Не удалось загрузить доску', retry: 'Повторить' },
    cycle: 'Нажмите, чтобы переключить GO → NO-GO → ОЖИДАНИЕ',
    remove: 'Удалить «{{name}}»',
    agentSet: '{{agent}}: «{{check}}» — {{status}}',
    attention: '{{agent}}: NO-GO по «{{check}}»',
    menu: {
      report: 'Отправить отчёт',
      reset: 'Сбросить всё в ожидание',
      compact: 'Компактный размер',
      full: 'Полный размер'
    },
    confirmReset: {
      title: 'Сбросить все проверки?',
      message: 'Все проверки вернутся в ОЖИДАНИЕ, заметки удалятся. Отсчёт продолжится.',
      confirm: 'Сбросить'
    },
    sent_one: 'Отчёт отправлен в {{count}} карточку',
    sent_few: 'Отчёт отправлен в {{count}} карточки',
    sent_many: 'Отчёт отправлен в {{count}} карточек',
    sent_other: 'Отчёт отправлен в {{count}} карточки',
    notConnected: 'Проведите стрелку от этой карточки к заметке, чтобы отправить туда отчёт',
    goSent: 'Сигнал GO отправлен',
    report: {
      title: '{{title}} — {{t}}',
      summary: '{{go}}/{{total}} GO · {{nogo}} NO-GO · {{pending}} в ожидании'
    },
    overview: {
      noClock: '{{go}}/{{total}} GO',
      clock: '{{t}} · {{go}}/{{total}} GO',
      empty: 'Пока нет проверок'
    },
    launchedAt: 'Запущено',
    warning: 'Близко к T−0, а проверки не готовы'
  },
  zh: {
    status: { go: 'GO', nogo: 'NO-GO', pending: '待命' },
    phase: {
      empty: '没有检查项',
      hold: '暂停',
      pending: '倒计时中',
      go: '全部 GO',
      launched: '发射',
      scrubbed: '已取消'
    },
    noClock: '未设置倒计时',
    clock: {
      set: '设置 T−0',
      clear: '清除',
      plus15: '+15分',
      plus60: '+1时',
      label: '发射时间'
    },
    goCount: '{{go}}/{{total}} GO',
    setBy: '由 {{who}}',
    you: '你',
    fromPort: '来自 {{who}}',
    add: {
      placeholder: '添加检查项——例如“测试全部通过”',
      button: '添加'
    },
    empty: {
      title: '添加第一个检查项',
      body: '在下方输入——或连接一个智能体：它可以用卡片的工具添加检查项并给出 GO / NO-GO。'
    },
    loading: '正在启动控制台…',
    error: { title: '无法加载面板', retry: '重试' },
    cycle: '点击切换 GO → NO-GO → 待命',
    remove: '删除“{{name}}”',
    agentSet: '{{agent}} 将“{{check}}”设为 {{status}}',
    attention: '{{agent}}：“{{check}}” NO-GO',
    menu: {
      report: '发送状态报告',
      reset: '全部重置为待命',
      compact: '紧凑尺寸',
      full: '完整尺寸'
    },
    confirmReset: {
      title: '重置所有检查项？',
      message: '所有检查项恢复为待命，备注将被清除。倒计时继续。',
      confirm: '重置'
    },
    sent_other: '报告已发送到 {{count}} 张卡片',
    notConnected: '从此卡片画一条箭头到笔记，即可把报告发送过去',
    goSent: 'GO 信号已发送',
    report: {
      title: '{{title}} — {{t}}',
      summary: '{{go}}/{{total}} GO · {{nogo}} NO-GO · {{pending}} 待命'
    },
    overview: {
      noClock: '{{go}}/{{total}} GO',
      clock: '{{t}} · {{go}}/{{total}} GO',
      empty: '还没有检查项'
    },
    launchedAt: '已发射',
    warning: '临近 T−0，仍有检查项待定'
  }
}
