import type { Catalog } from '@neurosquad/card-sdk'

/** The card's strings in the app's three languages (en is the fallback). */
export const catalog: Catalog = {
  en: {
    ci: {
      success: 'passing',
      failure: 'failing',
      pending: 'running',
      none: 'no CI'
    },
    branchCi: '{{branch}} {{state}}',
    stars: '{{n}} stars',
    issues_one: '{{count}} open issue',
    issues_other: '{{count}} open issues',
    pulls: 'Pull requests',
    runs: 'Runs on {{branch}}',
    noPulls: 'No open pull requests',
    noRuns: 'No workflow runs yet',
    draft: 'draft',
    review_one: '{{count}} reviewer',
    review_other: '{{count}} reviewers',
    by: 'by {{author}}',
    refresh: 'Refresh',
    refreshing: 'Checking…',
    checked: 'checked {{ago}}',
    rate: '{{remaining}} of {{limit}} requests left',
    readBy: 'Checked by {{agent}}',
    openRun: 'Open run: {{name}}',
    empty: {
      title: 'Which repository?',
      body: 'Pull requests and CI of a GitHub repository, refreshed while you look at them.',
      placeholder: 'owner/repo',
      save: 'Watch',
      invalid: 'Use owner/repo or a github.com link',
      detect: 'Detect from this folder',
      settings: 'Settings…'
    },
    detect: {
      none: 'No GitHub remote in this folder’s .git/config',
      denied: 'Detecting needs permission to read the workspace folder',
      found: 'Watching {{repo}}'
    },
    loading: 'Asking GitHub…',
    error: {
      rateLimit: 'GitHub’s rate limit is used up',
      rateLimitBody: 'It resets at {{time}}. Add a token in the card settings for 5000 requests an hour.',
      notFound: 'Repository not found',
      notFoundBody: '{{repo}} does not exist, or it is private — add a token with access in the settings.',
      unauthorized: 'GitHub refused the token',
      unauthorizedBody: 'The token in the card settings is wrong or expired.',
      network: 'Could not reach GitHub',
      denied: 'The network permission was not granted',
      http: 'GitHub answered with an error',
      retry: 'Try again',
      settings: 'Settings…',
      stale: 'Showing data from {{ago}}'
    },
    overview: {
      primary_one: '{{count}} PR · {{branch}} {{state}}',
      primary_other: '{{count}} PRs · {{branch}} {{state}}',
      noRepo: 'No repository set'
    },
    attention: 'CI on {{branch}} is failing: {{run}}',
    badge: 'CI',
    menu: {
      refresh: 'Refresh',
      open: 'Open on GitHub',
      detect: 'Detect repository'
    }
  },
  ru: {
    ci: {
      success: 'проходит',
      failure: 'падает',
      pending: 'идёт',
      none: 'без CI'
    },
    branchCi: '{{branch}}: {{state}}',
    stars: 'звёзд: {{n}}',
    issues_one: '{{count}} открытая задача',
    issues_few: '{{count}} открытые задачи',
    issues_many: '{{count}} открытых задач',
    issues_other: '{{count}} открытой задачи',
    pulls: 'Пулл-реквесты',
    runs: 'Запуски в {{branch}}',
    noPulls: 'Открытых пулл-реквестов нет',
    noRuns: 'Запусков пока нет',
    draft: 'черновик',
    review_one: '{{count}} ревьюер',
    review_few: '{{count}} ревьюера',
    review_many: '{{count}} ревьюеров',
    review_other: '{{count}} ревьюера',
    by: '{{author}}',
    refresh: 'Обновить',
    refreshing: 'Проверяю…',
    checked: 'проверено {{ago}}',
    rate: 'осталось {{remaining}} из {{limit}} запросов',
    readBy: 'Проверил {{agent}}',
    openRun: 'Открыть запуск: {{name}}',
    empty: {
      title: 'Какой репозиторий?',
      body: 'Пулл-реквесты и CI репозитория GitHub — обновляются, пока вы на них смотрите.',
      placeholder: 'владелец/репозиторий',
      save: 'Следить',
      invalid: 'Нужно владелец/репозиторий или ссылка на github.com',
      detect: 'Взять из этой папки',
      settings: 'Настройки…'
    },
    detect: {
      none: 'В .git/config этой папки нет удалённого репозитория GitHub',
      denied: 'Чтобы определить репозиторий, нужно разрешение читать папку воркспейса',
      found: 'Слежу за {{repo}}'
    },
    loading: 'Спрашиваю GitHub…',
    error: {
      rateLimit: 'Лимит запросов GitHub исчерпан',
      rateLimitBody: 'Он сбросится в {{time}}. Добавьте токен в настройках карточки — будет 5000 запросов в час.',
      notFound: 'Репозиторий не найден',
      notFoundBody: '{{repo}} не существует или он приватный — добавьте токен с доступом в настройках.',
      unauthorized: 'GitHub отклонил токен',
      unauthorizedBody: 'Токен в настройках карточки неверный или истёк.',
      network: 'Не удалось связаться с GitHub',
      denied: 'Разрешение на сеть не выдано',
      http: 'GitHub ответил ошибкой',
      retry: 'Повторить',
      settings: 'Настройки…',
      stale: 'Данные {{ago}}'
    },
    overview: {
      primary_one: '{{count}} PR · {{branch}}: {{state}}',
      primary_few: '{{count}} PR · {{branch}}: {{state}}',
      primary_many: '{{count}} PR · {{branch}}: {{state}}',
      primary_other: '{{count}} PR · {{branch}}: {{state}}',
      noRepo: 'Репозиторий не выбран'
    },
    attention: 'CI в {{branch}} падает: {{run}}',
    badge: 'CI',
    menu: {
      refresh: 'Обновить',
      open: 'Открыть на GitHub',
      detect: 'Определить репозиторий'
    }
  },
  zh: {
    ci: {
      success: '通过',
      failure: '失败',
      pending: '运行中',
      none: '无 CI'
    },
    branchCi: '{{branch}} {{state}}',
    stars: '{{n}} 星',
    issues_other: '{{count}} 个未关闭议题',
    pulls: '拉取请求',
    runs: '{{branch}} 上的运行',
    noPulls: '没有未合并的拉取请求',
    noRuns: '还没有工作流运行',
    draft: '草稿',
    review_other: '{{count}} 位审阅者',
    by: '{{author}}',
    refresh: '刷新',
    refreshing: '检查中…',
    checked: '{{ago}}检查',
    rate: '剩余 {{remaining}} / {{limit}} 次请求',
    readBy: '{{agent}} 已查看',
    openRun: '打开运行：{{name}}',
    empty: {
      title: '要关注哪个仓库？',
      body: 'GitHub 仓库的拉取请求和 CI，在你查看时自动刷新。',
      placeholder: 'owner/repo',
      save: '关注',
      invalid: '请输入 owner/repo 或 github.com 链接',
      detect: '从此文件夹检测',
      settings: '设置…'
    },
    detect: {
      none: '此文件夹的 .git/config 中没有 GitHub 远程仓库',
      denied: '检测需要读取工作区文件夹的权限',
      found: '正在关注 {{repo}}'
    },
    loading: '正在询问 GitHub…',
    error: {
      rateLimit: 'GitHub 请求额度已用完',
      rateLimitBody: '将于 {{time}} 重置。在卡片设置中添加令牌可获得每小时 5000 次请求。',
      notFound: '找不到仓库',
      notFoundBody: '{{repo}} 不存在或为私有仓库——请在设置中添加有访问权限的令牌。',
      unauthorized: 'GitHub 拒绝了令牌',
      unauthorizedBody: '卡片设置中的令牌错误或已过期。',
      network: '无法连接 GitHub',
      denied: '未授予网络权限',
      http: 'GitHub 返回了错误',
      retry: '重试',
      settings: '设置…',
      stale: '显示 {{ago}}的数据'
    },
    overview: {
      primary_other: '{{count}} 个 PR · {{branch}} {{state}}',
      noRepo: '未设置仓库'
    },
    attention: '{{branch}} 上的 CI 失败：{{run}}',
    badge: 'CI',
    menu: {
      refresh: '刷新',
      open: '在 GitHub 上打开',
      detect: '检测仓库'
    }
  }
}
