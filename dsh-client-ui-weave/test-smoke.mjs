/** Smoke harness: materialize the built ModuleLoader bundle, run the weave target with simulated session events, and assert the view + snapshot. */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const bundlePath = path.join(here, 'lib', 'client.js')
const registrations = []
globalThis.window = {
  __ModuleLoader__: { load(reg) { registrations.push(reg) } },
  addEventListener() {}, removeEventListener() {}, setTimeout, clearTimeout,
  matchMedia() { return { matches: false } },
}
globalThis.document = { documentElement: { getAttribute() { return 'light' }, setAttribute() {} } }
globalThis.MutationObserver = class { observe() {} disconnect() {} }

const React = {
  createElement(...args) { return { __el: args[0], props: args[1] } },
  useRef(value) { return { current: value } },
  useState(value) { return [value, function () {}] },
  useEffect() {},
  useCallback(fn) { return fn },
  useMemo(fn) { return fn() },
}
const missing = []
function requireStub(id) {
  if (id === 'react') return React
  missing.push(id)
  throw new Error('missing module: ' + id)
}

await import(pathToFileURL(bundlePath).href)
if (registrations.length !== 1) { console.error('FAIL: expected 1 ModuleLoader registration, got', registrations.length); process.exit(1) }
const exports = registrations[0].factory(requireStub)

const registered = []
const targets = []
const definitions = []
const localeDictionaries = []
const t = (key) => ({ 'view.weave': '织造' }['view.weave'] && '织造')
const fakeCtx = {
  logger: { warn() {}, error() {}, info() {} },
  effect(fn) { try { fn() } catch (error) { console.error('effect failed', error) } },
  locale: {
    register(ns) { localeDictionaries.push(ns); return () => {} },
    bind() { return (key) => key },
  },
  slots: {
    inject(name, cb) { cb() },
    register(options, component) {
      registered.push({ name: options.name, id: options.id, label: typeof options.label === 'function' ? options.label() : options.label, component, options })
      return () => {}
    },
  },
  sessions: {
    binding() { return { session: fakeSession, target() { return targetStore } } },
    list: {
      getSnapshot() {
        return {
          ids: ['session-smoke'],
          byId: {
            'session-smoke': { id: 'session-smoke', displayTitle: '支付网关幂等层重构', createdAt: T0, updatedAt: T0 + 12000 },
            'child-1': { id: 'child-1', displayTitle: 'Forge', parentId: 'session-smoke', origin: 'subagent', createdAt: T0 + 500, updatedAt: T0 + 11000, projectionValues: { subagentTiming: { settledMs: 4000, active: { since: T0 + 2000, through: T0 + 6000 } }, tokenUsage: { uncachedInputTokens: 500, outputTokens: 200 } } },
            'child-2': { id: 'child-2', displayTitle: 'Lens', parentId: 'session-smoke', origin: 'subagent', createdAt: T0 + 1000, updatedAt: T0 + 11000, projectionValues: { subagentTiming: { settledMs: 9000 }, tokenUsage: { uncachedInputTokens: 100, outputTokens: 40 } } },
          },
          projectionsBySession: {
            'session-smoke': {
              state: 'ready',
              values: {
                subagentCatalog: [
                  { id: 'child-1', label: 'Forge', mode: 'continuable', activity: 'running' },
                  { id: 'child-2', label: 'Lens', mode: 'one-shot', activity: 'inactive' },
                ],
                agentTeam: {
                  enabled: true,
                  tasks: [
                    { id: 'task-a', subject: '事故取证', status: 'completed', ownerId: 'child-1', ready: true },
                    { id: 'task-b', subject: '幂等实现', status: 'in_progress', ownerId: 'child-1', ready: true },
                    { id: 'task-c', subject: '安全评审', status: 'pending', ownerId: 'ghost-agent', ready: false, description: '等待实现完成' },
                  ],
                },
                tokenUsage: { uncachedInputTokens: 1200, outputTokens: 800, cacheReadTokens: 400, cacheWriteTokens: 0 },
              },
            },
            'child-1': { state: 'ready', values: { tokenUsage: { uncachedInputTokens: 500, outputTokens: 200 } } },
            'child-2': { state: 'ready', values: { tokenUsage: { uncachedInputTokens: 100, outputTokens: 40 } } },
          },
        }
      },
      subscribe() { return () => {} },
    },
  },
  uiConversation: {
    views: { register(definition) { targets.push(definition) } },
    events: { register(definition) { definitions.push(definition) } },
    binding() { return { target() { return targetStore }, subscribe() { return () => {} } } },
  },
}

// Minimal conversation engine: route simulated events through our Definitions.
const T0 = Date.UTC(2026, 10, 26, 0, 0, 0)
const contexts = new Map()
const nodes = new Map()
function locationFor(event) {
  const data = event.data || {}
  if (typeof data.turn !== 'number') return { kind: 'unresolved' }
  if (typeof data.step === 'number') return { kind: 'step', turn: { turn: data.turn, steps: [] }, step: { turn: data.turn, step: data.step } }
  return { kind: 'turn', turn: { turn: data.turn, steps: [] } }
}
function dispatch(event) {
  for (const definition of definitions) {
    let match = null
    try { match = definition.match(event) } catch (error) { throw new Error('match threw for ' + event.type + ': ' + error.message) }
    if (match === null || match === undefined) continue
    const key = definition.kind + '/' + match.id
    let context = contexts.get(key)
    const location = locationFor(event)
    if (match.role === 'start') {
      const start = { event, location }
      context = { key, kind: definition.kind, id: match.id, start, matches: [start] }
      context.state = definition.start(context, { event, role: 'start', location })
      contexts.set(key, context)
    } else {
      if (context === undefined) continue
      const update = { event, role: 'update', location }
      context.matches.push(update)
      context.state = definition.update(context, update)
    }
    const node = definition.buildViewNode(context)
    if (node !== null && node !== undefined) nodes.set(node.key, node)
  }
}
const targetStore = {
  getSnapshot() { return builder.replace({ nodes: Array.from(nodes.values()) }) },
  subscribe() { return () => {} },
}
let historyPages = 0
const fakeSession = {
  getSnapshot() { return { openState: 'open', hasMore: historyPages < 2 } },
  async loadOlder() { historyPages += 1 },
}
const builder = undefined
const weaveTarget = { create: null }

let applyError = null
try { exports.apply(fakeCtx) } catch (error) { applyError = error.stack }
const view = registered.find((entry) => entry.name === 'conversation.view' && entry.id === 'weave')
const targetDefinition = targets.find((definition) => definition.target === 'weave')
const weaveBuilder = targetDefinition !== undefined ? targetDefinition.create() : null
const builderRef = { current: weaveBuilder }

const seqEvents = [
  { type: 'turn/start', seq: 1, time: T0, data: { turn: 0 } },
  { type: 'user/message', seq: 2, time: T0 + 1000, data: { content: [{ type: 'text', text: '帮我重构支付网关幂等层' }], source: { kind: 'user' } } },
  { type: 'tool/call', seq: 3, time: T0 + 2000, data: { turn: 0, step: 0, callId: 'c1', name: 'run_code', arguments: '{"description":"inspect logs"}' } },
  { type: 'tool/result', seq: 4, time: T0 + 5000, data: { turn: 0, step: 0, message: { source: { callId: 'c1' }, isError: false, content: [{ type: 'text', text: 'ok' }] } } },
  { type: 'assistant/message', seq: 5, time: T0 + 6000, data: { turn: 0, step: 0, message: { content: [{ type: 'text', text: '已完成占位表改造' }] }, usage: { uncachedInputTokens: 100, outputTokens: 50 }, stream: null } },
  { type: 'turn/end', seq: 6, time: T0 + 7000, data: { turn: 0 } },
  { type: 'turn/start', seq: 7, time: T0 + 700000, data: { turn: 1 } },
  { type: 'user/message', seq: 8, time: T0 + 701000, data: { content: [{ type: 'text', text: '[team] Lens: 并发重试可覆盖幂等占位' }], source: { kind: 'team-message' } } },
  { type: 'tool/call', seq: 9, time: T0 + 702000, data: { turn: 1, step: 0, callId: 'c2', name: 'team_task_update', arguments: '{"task":"task-b"}' } },
  { type: 'tool/result', seq: 10, time: T0 + 703000, data: { turn: 1, step: 0, message: { source: { callId: 'c2' }, isError: true, content: [{ type: 'text', text: 'blocked' }] } } },
  { type: 'turn/end', seq: 11, time: T0 + 704000, data: { turn: 1 } },
  { type: 'user/message', seq: 12, time: T0 + 703500, data: { content: [{ type: 'text', text: 'Time sampled while preparing turn 2: internal context' }], source: { kind: 'time-context' } } },
]

const failures = []
if (applyError !== null) failures.push('apply threw: ' + applyError)
if (!Array.isArray(exports.inject)) failures.push('exports.inject missing')
if (view === undefined) failures.push('conversation.view id=weave not registered')
if (view !== undefined && typeof view.component !== 'function') failures.push('weave view component is not a function')
if (view !== undefined && view.label !== '织造' && view.label !== 'view.weave') failures.push('weave label mismatch: ' + view.label)
if (targetDefinition === undefined) failures.push('weave conversation target not registered')
if (definitions.length !== 5) failures.push('expected 5 weave definitions, got ' + definitions.length)
if (weaveBuilder === null) failures.push('weave builder could not be created')

if (weaveBuilder !== null) {
  for (const event of seqEvents) {
    try { dispatch(event) } catch (error) { failures.push('dispatch failed at seq ' + event.seq + ': ' + error.message); break }
  }
  // Re-point the fake target at the real builder for the injected source.
  targetStore.getSnapshot = () => weaveBuilder.replace({ nodes: Array.from(nodes.values()) })
}

let snapshot = null
let injected = null
if (view !== undefined && typeof view.options.inject === 'function') {
  try {
    injected = view.options.inject('session-smoke')
    snapshot = injected.hooks.weave.getSnapshot()
  } catch (error) {
    failures.push('inject/getSnapshot threw: ' + error.stack)
  }
}
if (snapshot === null) failures.push('weave source returned no snapshot')
else {
  if (snapshot.agents.length < 3) failures.push('expected main + 2 subagent nodes, got ' + snapshot.agents.length)
  if (snapshot.tasks.length !== 3) failures.push('expected 3 tasks, got ' + snapshot.tasks.length)
  if (snapshot.events.length < 3) failures.push('expected >=3 weave events, got ' + snapshot.events.length)
  if (snapshot.blocker === undefined) failures.push('expected a blocker from the blocked task')
  if (!snapshot.events.some((event) => event.type === 'tool')) failures.push('no tool events mapped')
  if (!snapshot.events.some((event) => event.type === 'alert')) failures.push('failed tool call did not map to an alert event')
  if (!snapshot.events.some((event) => event.type === 'message')) failures.push('team message prompt did not map to a message event')
  if (snapshot.agents[0].work.length < 1) failures.push('main agent has no work intervals')
  const agentIds = new Set(snapshot.agents.map((agent) => agent.id))
  if (!snapshot.tasks.every((task) => agentIds.has(task.owner))) failures.push('task owner is not a known agent id')
  if (!snapshot.events.every((event) => agentIds.has(event.actor))) failures.push('event actor is not a known agent id')
  if (snapshot.meta.duration >= 600) failures.push('timeline was not activity-compressed: ' + snapshot.meta.duration)
  if (snapshot.meta.duration > 80) failures.push('compressed timeline too long: ' + snapshot.meta.duration)
  if (!snapshot.tasks.every((task) => task.start >= 0 && task.end <= snapshot.meta.duration + 0.01 && task.end > task.start)) failures.push('task cell outside timeline')
  if (!Number.isInteger(snapshot.meta.duration)) failures.push('timeline duration is not an integer: ' + snapshot.meta.duration)
  if (!snapshot.agents.every((agent) => agent.work.every((w) => Number.isInteger(w.s) && Number.isInteger(w.e)))) failures.push('work segment times are not integers')
  if (!snapshot.tasks.every((task) => Number.isInteger(task.start) && Number.isInteger(task.end))) failures.push('task times are not integers')
  if (!snapshot.events.every((event) => Number.isInteger(event.t))) failures.push('event times are not integers')
  if (!snapshot.agents.every((agent) => agent.work.every((w) => w.s >= 0 && w.e <= snapshot.meta.duration + 0.01 && w.e > w.s))) failures.push('work segment outside the timeline')
  if (snapshot.events.some((event) => String(event.text).includes('Time sampled'))) failures.push('internal context prompt leaked into weave events')
}

let historyResult = null
if (injected !== null && injected !== undefined && typeof injected.loadHistory === 'function') {
  try { historyResult = await injected.loadHistory(10) } catch (error) { failures.push('loadHistory threw: ' + error.message) }
  if (historyResult === null || historyResult.ok !== true || historyResult.pages < 1) failures.push('loadHistory did not page history: ' + JSON.stringify(historyResult))
}

let validation = null
try {
  const samplePath = path.join(here, '..', 'tools', 'weave-data-sample.mjs')
  const mod = await import(pathToFileURL(samplePath).href)
  if (typeof mod.validateWeaveData === 'function') {
    validation = mod.validateWeaveData(snapshot)
    const valid = validation === null || validation === undefined || validation.ok !== false
    if (!valid) failures.push('WEAVE_DATA validation failed: ' + JSON.stringify(validation).slice(0, 800))
  } else {
    validation = { ok: true, skipped: 'validateWeaveData not exported' }
  }
} catch (error) {
  validation = { ok: false, error: String((error && error.message) || error) }
  failures.push('WEAVE_DATA validator unavailable: ' + String((error && error.message) || error))
}

let rendered = null
if (view !== undefined && typeof view.component === 'function') {
  try { rendered = view.component({ t, sessionId: 'session-smoke', useWeave: (selector) => selector(snapshot) }) } catch (error) { failures.push('component render threw: ' + error.stack) }
}

console.log(JSON.stringify({
  ok: failures.length === 0,
  failures,
  registered: registered.map((entry) => ({ name: entry.name, id: entry.id, label: entry.label })),
  targets: targets.map((definition) => definition.target),
  definitions: definitions.map((definition) => definition.kind),
  injectDeclared: exports.inject,
  locales: localeDictionaries,
  snapshot: snapshot === null ? null : {
    keys: Object.keys(snapshot),
    agents: snapshot.agents.map((agent) => ({ id: agent.id, name: agent.name, work: agent.work.length })),
    tasks: snapshot.tasks.length,
    events: snapshot.events.map((event) => event.type + ':' + event.tag),
    blocker: snapshot.blocker === undefined ? null : snapshot.blocker.title,
  },
  timeline: snapshot === null ? null : snapshot.meta.duration,
  workSegments: snapshot === null ? null : snapshot.agents.map((agent) => agent.work),
  historyResult: historyResult,
  componentRendered: rendered !== null,
  validation: validation,
  missingModules: missing,
}, null, 2))
process.exit(failures.length === 0 ? 0 : 1)
