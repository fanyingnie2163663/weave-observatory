/* client.template.js — Weave conversation view (build.mjs wraps this into a ModuleLoader bundle). */
const React = require('react')
const NS = 'weave'
const TARGET = 'weave'

const zh = {
  'view.weave': '织造',
  'view.weave.aria': 'Weave 多智能体协作观测台',
  'empty.title': '还没有可观测的协作数据',
  'empty.body': '开启团队协作或发起子代理后，这里会显示织造图、泳道与事件流。',
  'loading': '正在织造…',
  'error': 'Weave 视图加载失败',
}

const EMPTY_WEAVE_DATA = {
  meta: { runId: '', goal: '', shortGoal: '', duration: 0, playbackSeconds: 80, simulated: false, live: true },
  agents: [],
  tasks: [],
  events: [],
  messages: [],
}

const WEAVE_HTML = __WEAVE_HTML__;

function emptySource() {
  return {
    getSnapshot: function () { return EMPTY_WEAVE_DATA },
    subscribe: function () { return function () {} },
  }
}

/** Build one observable WEAVE_DATA source for a session (cached per session). */
function makeWeaveSource(ctx, sessionId) {
  var target = null
  var targetSubscription = null
  var bound = null
  // The Session binding can be recreated (reconnect/resync). Re-resolve the
  // target whenever the binding generation changes instead of pinning the
  // first one forever (a failed first lookup used to freeze the view empty).
  function bindTarget() {
    var next = null
    try { next = ctx.uiConversation.binding(sessionId) } catch (error) { next = null }
    if (next === null) return
    if (next === bound && target !== null) return
    if (targetSubscription !== null) { try { targetSubscription() } catch (error) {} ; targetSubscription = null }
    bound = next
    target = null
    try { target = next.target(TARGET) } catch (error) { target = null }
    if (target !== null && typeof target.subscribe === 'function') targetSubscription = target.subscribe(invalidate)
  }
  var sessionsList = ctx.sessions && ctx.sessions.list ? ctx.sessions.list : null
  var listeners = new Set()
  var cached = null
  var dirty = true
  var disposed = false
  var tick = null
  function invalidate() {
    if (disposed) return
    dirty = true
    listeners.forEach(function (listener) { listener() })
  }
  bindTarget()
  var disposers = []
  if (sessionsList !== null && typeof sessionsList.subscribe === 'function') disposers.push(sessionsList.subscribe(invalidate))
  var lastWeave = null
  var lastList = null
  var lastBucket = -1
  var hasCache = false
  function compute() {
    bindTarget()
    var weave = null
    if (target !== null) {
      try { weave = target.getSnapshot() || null } catch (error) { weave = null }
    }
    var list = null
    if (sessionsList !== null && typeof sessionsList.getSnapshot === 'function') {
      try { list = sessionsList.getSnapshot() } catch (error) { list = null }
    }
    // Conversation snapshots publish for every event (deltas included), but the
    // weave target and the session list often keep the same identities. Reuse
    // the mapped data then; only the second-bucketed clock may change elapsed.
    var bucket = Math.floor(Date.now() / 1000)
    if (hasCache && weave === lastWeave && list === lastList && bucket === lastBucket) return cached
    cached = buildWeaveData({ sessionId: sessionId, list: list, weave: weave, now: Date.now() })
    lastWeave = weave
    lastList = list
    lastBucket = bucket
    hasCache = true
    return cached
  }
  return {
    getSnapshot: function () {
      if (dirty || cached === null) {
        cached = compute()
        dirty = false
      }
      return cached
    },
    subscribe: function (listener) {
      listeners.add(listener)
      // A live Session can stay quiet between events (long model calls); refresh
      // the clock/elapsed fields periodically so the view still breathes.
      if (tick === null) tick = window.setInterval(invalidate, 1500)
      return function () {
        listeners.delete(listener)
        if (listeners.size === 0 && tick !== null) {
          window.clearInterval(tick)
          tick = null
        }
      }
    },
    dispose: function () {
      disposed = true
      if (tick !== null) { window.clearInterval(tick); tick = null }
      if (targetSubscription !== null) { try { targetSubscription() } catch (error) {} ; targetSubscription = null }
      disposers.forEach(function (dispose) { try { dispose() } catch (error) {} })
      listeners.clear()
    },
  }
}

function currentTheme() {
  try {
    var value = document.documentElement.getAttribute('data-theme')
    if (value === 'dark' || value === 'light') return value
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  } catch (error) {
    return 'light'
  }
}

function WeaveView(props) {
  var t = typeof props.t === 'function' ? props.t : function (key) { return key }
  var useWeave = props.useWeave
  var loadHistory = props.loadHistory
  var snapshot = typeof useWeave === 'function'
    ? useWeave(function (value) { return value })
    : EMPTY_WEAVE_DATA
  var data = snapshot || EMPTY_WEAVE_DATA
  var iframeRef = React.useRef(null)
  var ackedRef = React.useRef(false)
  var latestRef = React.useRef(data)
  latestRef.current = data
  var liveRef = React.useRef(true)
  var [theme, setTheme] = React.useState(currentTheme())
  var [acked, setAcked] = React.useState(false)
  var [status, setStatus] = React.useState('')
  var [histStatus, setHistStatus] = React.useState('')
  var [failed, setFailed] = React.useState(false)

  var post = React.useCallback(function (message) {
    var frame = iframeRef.current
    if (frame === null || frame === undefined || frame.contentWindow === null) return
    try { frame.contentWindow.postMessage(message, '*') } catch (error) {}
  }, [])

  var postInit = React.useCallback(function () {
    post({ type: 'weave:init', data: latestRef.current, theme: currentTheme(), live: liveRef.current })
  }, [post])

  var runHistory = React.useCallback(function () {
    if (typeof loadHistory !== 'function') {
      setHistStatus('当前会话不支持读取历史')
      return
    }
    setHistStatus('正在读取本地历史…')
    post({ type: 'weave:history-status', text: '正在读取本地历史…' })
    Promise.resolve(loadHistory(80)).then(function (result) {
      var ok = result !== null && result !== undefined && result.ok === true
      var text = ok
        ? ('已读取 ' + result.pages + ' 页历史' + (result.hasMore ? '（还有更早）' : ''))
        : ('读取历史失败：' + ((result && result.reason) || '未知原因'))
      setHistStatus(text)
      post({ type: 'weave:history-status', text: text, failed: !ok })
      window.setTimeout(function () {
        setHistStatus(function (current) { return current === text ? '' : current })
      }, 5000)
    }).catch(function (error) {
      var text = '读取历史失败：' + String((error && error.message) || error)
      setHistStatus(text)
      post({ type: 'weave:history-status', text: text, failed: true })
    })
  }, [loadHistory, post])

  React.useEffect(function () {
    function onMessage(event) {
      var frame = iframeRef.current
      if (frame === null || frame === undefined || event.source !== frame.contentWindow) return
      var message = event.data
      if (message === null || typeof message !== 'object') return
      if (message.type === 'weave:ready') {
        postInit()
        return
      }
      if (message.type === 'weave:request-history') {
        runHistory()
        return
      }
      if (message.type === 'weave:event') {
        if (!ackedRef.current) {
          ackedRef.current = true
          setAcked(true)
          setStatus('')
        }
        if (message.event === 'seek') {
          var seek = message.payload || {}
          // Only the explicit "回到最新" jump resumes live following. Any other
          // seek is a user scrub: keep it local or the next update pins to END.
          liveRef.current = seek.source === 'live-jump'
        }
        if (message.event === 'mode' && message.payload && typeof message.payload.live === 'boolean') {
          liveRef.current = message.payload.live
        }
        if (message.event === 'error' && message.payload && message.payload.message) {
          setStatus('Weave 运行时报错：' + String(message.payload.message).slice(0, 80))
        }
      }
    }
    window.addEventListener('message', onMessage)
    return function () { window.removeEventListener('message', onMessage) }
  }, [postInit, runHistory])

  React.useEffect(function () {
    // The iframe may announce ready before this component's listener attaches;
    // keep re-sending init until the runtime acknowledges with a event frame.
    var attempts = 0
    var timer = window.setInterval(function () {
      if (ackedRef.current) { window.clearInterval(timer); return }
      attempts += 1
      postInit()
      if (attempts === 3) setStatus('正在连接 Weave 运行时…')
      if (attempts >= 25) {
        setStatus('Weave 运行时未响应，请刷新页面或重启 DSH')
        window.clearInterval(timer)
      }
    }, 600)
    return function () { window.clearInterval(timer) }
  }, [postInit])

  var updateTimerRef = React.useRef(null)
  React.useEffect(function () {
    // Do NOT clear the pending timer on every snapshot: DSH publishes a
    // Conversation snapshot for every event (stream deltas included), often
    // faster than the delay, so a cancel-on-change debounce starves updates and
    // the iframe freezes at its last frame. Keep one trailing timer and read the
    // latest data when it fires.
    if (updateTimerRef.current !== null) return undefined
    updateTimerRef.current = window.setTimeout(function () {
      updateTimerRef.current = null
      post({ type: 'weave:update', data: latestRef.current, live: liveRef.current })
    }, 150)
    return undefined
  }, [data, acked, post])

  React.useEffect(function () {
    return function () {
      if (updateTimerRef.current !== null) {
        window.clearTimeout(updateTimerRef.current)
        updateTimerRef.current = null
      }
    }
  }, [])

  React.useEffect(function () {
    // DSH theme switches mutate data-theme on <html>; forward them so the
    // iframe does not keep the theme captured at mount.
    function push() {
      var next = currentTheme()
      setTheme(next)
      post({ type: 'weave:theme', theme: next })
    }
    var observer = new MutationObserver(push)
    try {
      observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    } catch (error) {}
    return function () { observer.disconnect() }
  }, [post])

  React.useEffect(function () {
    // DSH renders host "transcript width" handles ([data-width-handle]) beside
    // the content column. They resize the chat transcript, not this view's
    // columns, and inside Weave they read as a mystery drag box. Hide them only
    // while this view is mounted; chat keeps its own handles elsewhere.
    var existing = document.head.querySelector('style[data-weave-host-fix]')
    if (existing !== null) return function () {}
    var style = document.createElement('style')
    style.setAttribute('data-weave-host-fix', '')
    style.textContent = 'body:has([data-weave-view]) [data-width-handle] { display: none !important; }'
    document.head.appendChild(style)
    return function () {
      if (style.parentNode !== null) style.parentNode.removeChild(style)
    }
  }, [])

  React.useEffect(function () {
    if (acked) post({ type: 'weave:theme', theme: theme })
  }, [theme, acked, post])

  var children = []
  if (failed) {
    children.push(React.createElement('div', {
      key: 'error',
      style: { display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--dsw-alias-label-tertiary)', fontSize: '13px' },
    }, t('error')))
  }
  children.push(React.createElement('iframe', {
    key: 'frame',
    ref: iframeRef,
    title: t('view.weave.aria'),
    sandbox: 'allow-scripts',
    srcDoc: WEAVE_HTML,
    onLoad: function () { postInit() },
    onError: function () { setFailed(true) },
    style: { border: '0', width: '100%', height: '100%', display: 'block', background: 'transparent', colorScheme: 'normal' },
  }))
  if (status !== '' && !failed) {
    children.push(React.createElement('div', {
      key: 'status',
      style: {
        position: 'absolute', left: '10px', bottom: '10px', zIndex: 2, pointerEvents: 'none',
        padding: '4px 9px', borderRadius: '4px', background: 'rgba(20,17,13,0.82)',
        color: '#efe6d6', fontSize: '12px', lineHeight: '18px',
      },
    }, status))
  }
  var showHistoryChip = histStatus !== '' || (acked && data !== null && data !== undefined && Array.isArray(data.events) && data.events.length < 3)
  if (showHistoryChip && !failed) {
    children.push(React.createElement('button', {
      key: 'history',
      type: 'button',
      onClick: function () { runHistory() },
      title: '从本地会话历史补读更早的数据',
      style: {
        position: 'absolute', top: '48px', right: '8px', zIndex: 3,
        padding: '4px 10px', border: '1px solid rgba(178,58,38,0.5)', borderRadius: '4px',
        background: 'rgba(247,242,231,0.94)', color: '#8a2e1e',
        fontSize: '12px', lineHeight: '18px', cursor: 'pointer',
      },
    }, histStatus !== '' ? histStatus : '读取本地历史数据'))
  }
  return React.createElement('div', {
    'data-weave-view': '',
    style: { position: 'relative', display: 'flex', flexDirection: 'column', width: '100%', height: '100%', minHeight: '320px', overflow: 'hidden' },
  }, children)
}

var historyLoads = new Map()

/** Page the local session history through the official session API. */
function loadHistoryFor(ctx, sessionId, maxPages) {
  var key = String(sessionId)
  var pending = historyLoads.get(key)
  if (pending !== undefined) return pending
  // Bound one click: official paging is one page per request with a loading
  // guard. A deep 80-200 page synchronous loop froze the host and fought the
  // Chat/Trajectory paging loops.
  var limit = typeof maxPages === 'number' && maxPages > 0 ? Math.min(Math.floor(maxPages), 16) : 12
  var task = (async function () {
    try {
      var binding = null
      try { binding = ctx.sessions.binding(sessionId) } catch (error) { binding = null }
      var session = binding !== null && binding !== undefined && binding.session !== undefined ? binding.session : null
      if (session === null) return { ok: false, reason: '会话尚未连接' }
      var pages = 0
      var spins = 0
      while (pages < limit && spins < 200) {
        spins += 1
        var snapshot = typeof session.getSnapshot === 'function' ? session.getSnapshot() : null
        if (snapshot !== null && snapshot.openState !== 'open') {
          if (snapshot.openState === 'error') return { ok: false, reason: '会话打开失败' }
          await new Promise(function (resolve) { window.setTimeout(resolve, 120) })
          continue
        }
        if (snapshot !== null && snapshot.hasMore === false) break
        if (snapshot !== null && snapshot.loadingOlder === true) {
          await new Promise(function (resolve) { window.setTimeout(resolve, 80) })
          continue
        }
        var before = snapshot
        await session.loadOlder()
        pages += 1
        var after = typeof session.getSnapshot === 'function' ? session.getSnapshot() : null
        if (after === before) break
        if (after !== null && after.hasMore === false) break
      }
      var finalSnapshot = typeof session.getSnapshot === 'function' ? session.getSnapshot() : null
      return { ok: true, pages: pages, hasMore: finalSnapshot !== null && finalSnapshot.hasMore === true }
    } catch (error) {
      return { ok: false, reason: String((error && error.message) || error) }
    }
  })()
  historyLoads.set(key, task)
  task.then(function () { historyLoads.delete(key) }, function () { historyLoads.delete(key) })
  return task
}

var sources = new Map()

function sourceFor(ctx, sessionId) {
  var key = String(sessionId)
  var existing = sources.get(key)
  if (existing !== undefined) return existing
  var source = makeWeaveSource(ctx, sessionId)
  sources.set(key, source)
  return source
}

function apply(ctx) {
  ctx.effect(function () { return ctx.locale.register(NS, { zh: zh, en: { 'view.weave': 'Weave', 'view.weave.aria': 'Weave multi-agent observatory' } }) }, 'client-ui-weave: dictionaries')
  var t = ctx.locale.bind(NS)
  try {
    registerWeaveTarget(ctx)
  } catch (error) {
    if (ctx.logger !== undefined) ctx.logger.warn('weave: target registration failed: %s', error)
  }
  try {
    registerWeaveDefinitions(ctx)
  } catch (error) {
    if (ctx.logger !== undefined) ctx.logger.warn('weave: definition registration failed: %s', error)
  }
  ctx.effect(function () {
    return function () {
      sources.forEach(function (source) { source.dispose() })
      sources.clear()
    }
  }, 'client-ui-weave: sources')
  ctx.slots.inject('conversation.view', function () {
    return ctx.slots.register({
      name: 'conversation.view',
      id: 'weave',
      order: 50,
      locale: NS,
      label: function () { return t('view.weave') },
      inject: function (sessionId) {
        return {
          sessionId: sessionId,
          hooks: { weave: sourceFor(ctx, sessionId) },
          loadHistory: function (maxPages) { return loadHistoryFor(ctx, sessionId, maxPages) },
        }
      },
    }, WeaveView)
  })
}

const inject = ['slots', 'sessions', 'uiConversation', 'locale']

exports.apply = apply
exports.inject = inject