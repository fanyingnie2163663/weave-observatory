/**
 * Weave conversation target: Definitions that project session events into a
 * compact observatory log (turns, prompts, tool calls, assistant usage), plus
 * the target Builder consumed by the weave view source.
 * Pure module: inlined into the client bundle by build.mjs.
 */

const WEAVE_TARGET = 'weave'

function textOfContent(content) {
  if (!Array.isArray(content)) return ''
  const parts = []
  for (const block of content) {
    if (block !== null && typeof block === 'object' && block.type === 'text' && typeof block.text === 'string') parts.push(block.text)
  }
  return parts.join('\n')
}

function clipText(value, max) {
  if (typeof value !== 'string') return ''
  const text = value.trim().replace(/\s+/g, ' ')
  return text.length <= max ? text : text.slice(0, max - 1) + '…'
}

function anchorOf(context) {
  if (context.start !== undefined && context.start !== null) return context.start.event.seq
  const matches = context.matches
  if (Array.isArray(matches) && matches.length > 0) return matches[matches.length - 1].event.seq
  return 0
}

function locationOf(context) {
  if (context.start !== undefined && context.start !== null && context.start.location !== undefined) return context.start.location
  const matches = context.matches
  if (Array.isArray(matches) && matches.length > 0) {
    const last = matches[matches.length - 1]
    if (last !== undefined && last !== null && last.location !== undefined) return last.location
  }
  return { kind: 'unresolved' }
}

function weaveNode(context, data, anchorSeq) {
  return {
    key: context.key,
    kind: context.kind,
    id: context.id,
    target: WEAVE_TARGET,
    anchorSeq: typeof anchorSeq === 'number' ? anchorSeq : 0,
    location: locationOf(context),
    data: data,
  }
}

function senderOfMessage(message) {
  if (message === null || typeof message !== 'object') return null
  const source = message.source
  if (source === null || typeof source !== 'object') return null
  const kind = source.kind
  if (kind !== 'agent-message' && kind !== 'team-message') return null
  const text = textOfContent(message.content)
  const team = /^\s*\[team[^\]]*\]\s*([^\n:：]+)[:：]/.exec(text)
  if (team !== null) return team[1].trim()
  const agent = /^\s*\[agent[^\]]*\]\s*([^\n:：]+)[:：]/.exec(text)
  if (agent !== null) return agent[1].trim()
  // Real DSH relay messages identify the sender by session id, not by a
  // "[agent ...]" text prefix (that legacy format never appears in session logs).
  if (typeof source.senderSessionId === 'string' && source.senderSessionId !== '') return source.senderSessionId
  if (typeof source.sender === 'string' && source.sender !== '') return source.sender
  if (typeof source.from === 'string' && source.from !== '') return source.from
  return null
}

function usageOf(usage) {
  if (usage === null || typeof usage !== 'object') return null
  const result = {}
  let total = 0
  // Assistant-message usage uses inputTokens; the tokenUsage projection uses
  // uncachedInputTokens. Accept both without double-counting.
  const input = typeof usage.inputTokens === 'number' && usage.inputTokens > 0
    ? usage.inputTokens
    : (typeof usage.uncachedInputTokens === 'number' && usage.uncachedInputTokens > 0 ? usage.uncachedInputTokens : 0)
  if (input > 0) { result.inputTokens = input; total += input }
  for (const key of ['outputTokens', 'cacheReadTokens', 'cacheWriteTokens']) {
    const value = usage[key]
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) { result[key] = value; total += value }
  }
  if (total === 0 && typeof usage.totalTokens === 'number' && usage.totalTokens > 0) total = usage.totalTokens
  if (total === 0) return null
  result.total = total
  return result
}

/** One node per turn: start time and (when seen) end time. */
const turnDefinition = {
  kind: 'weave-turn',
  target: WEAVE_TARGET,
  match: (event) => {
    // Turn nodes only need their boundaries. Matching every step/start &
    // step/end here re-upserted the same node ~350 times per session and drove
    // a pointless target flush (and parent re-render) for each step.
    if (event.type !== 'turn/start' && event.type !== 'turn/end') return null
    const turn = event.data.turn
    return { id: 'turn:' + String(turn), role: event.type === 'turn/start' ? 'start' : 'update' }
  },
  start: (_context, match) => ({ turn: match.event.data.turn, startTime: match.event.time, endTime: null }),
  update: (context, match) => (match.event.type === 'turn/end'
    ? { turn: context.state.turn, startTime: context.state.startTime, endTime: match.event.time }
    : context.state),
  publication: () => 'immediate',
  buildViewNode: (context) => {
    const state = context.state
    if (state === undefined || state === null) return null
    return weaveNode(context, { kind: 'turn', turn: state.turn, startTime: state.startTime, endTime: state.endTime }, anchorOf(context))
  },
}

/** One node per user prompt (the human or a teammate/agent trigger). */
const promptDefinition = {
  kind: 'weave-prompt',
  target: WEAVE_TARGET,
  match: (event) => (event.type === 'user/message' ? { id: 'user:' + String(event.seq), role: 'start' } : null),
  start: (_context, match) => {
    const message = match.event.data
    const sourceKind = message !== null && typeof message === 'object' && message.source !== null && typeof message.source === 'object' && typeof message.source.kind === 'string'
      ? message.source.kind
      : 'user'
    return {
      time: match.event.time,
      text: clipText(textOfContent(message !== null && message !== undefined ? message.content : undefined), 400),
      sourceKind: sourceKind,
      sender: senderOfMessage(message),
    }
  },
  update: (context) => context.state,
  publication: () => 'immediate',
  buildViewNode: (context) => {
    const state = context.state
    if (state === undefined || state === null) return null
    return weaveNode(context, { kind: 'prompt', time: state.time, text: state.text, sourceKind: state.sourceKind, sender: state.sender }, anchorOf(context))
  },
}

/** One node per tool call, completed by its result. */
const callDefinition = {
  kind: 'weave-call',
  target: WEAVE_TARGET,
  match: (event) => {
    if (event.type === 'tool/call') return { id: 'call:' + String(event.data.callId), role: 'start' }
    if (event.type === 'tool/result') {
      const source = event.data.message !== null && typeof event.data.message === 'object' ? event.data.message.source : null
      const callId = source !== null && typeof source === 'object' ? source.callId : null
      if (callId === null || callId === undefined) return null
      return { id: 'call:' + String(callId), role: 'update' }
    }
    return null
  },
  start: (_context, match) => {
    const data = match.event.data
    let args = ''
    if (typeof data.arguments === 'string') args = data.arguments
    else if (data.arguments !== null && data.arguments !== undefined) {
      try { args = JSON.stringify(data.arguments) } catch (error) { args = '' }
    }
    return { callId: String(data.callId), name: typeof data.name === 'string' ? data.name : 'tool', time: match.event.time, endTime: null, failed: false, args: clipText(args, 120) }
  },
  update: (context, match) => {
    const message = match.event.data.message
    const failed = message !== null && typeof message === 'object' && message.isError === true
    return { callId: context.state.callId, name: context.state.name, time: context.state.time, endTime: match.event.time, failed: failed, args: context.state.args }
  },
  publication: () => 'immediate',
  buildViewNode: (context) => {
    const state = context.state
    if (state === undefined || state === null) return null
    return weaveNode(context, { kind: 'call', callId: state.callId, name: state.name, time: state.time, endTime: state.endTime, failed: state.failed, args: state.args }, anchorOf(context))
  },
}

/** One node per settled assistant message, carrying usage and a short answer. */
const assistantDefinition = {
  kind: 'weave-assistant',
  target: WEAVE_TARGET,
  match: (event) => (event.type === 'assistant/message' ? { id: 'assistant:' + String(event.seq), role: 'start' } : null),
  start: (_context, match) => {
    const data = match.event.data
    const message = data.message
    return {
      time: match.event.time,
      turn: data.turn,
      usage: usageOf(data.usage),
      text: clipText(textOfContent(message !== null && message !== undefined ? message.content : undefined), 300),
    }
  },
  update: (context) => context.state,
  publication: () => 'immediate',
  buildViewNode: (context) => {
    const state = context.state
    if (state === undefined || state === null) return null
    return weaveNode(context, { kind: 'assistant', time: state.time, turn: state.turn, usage: state.usage, text: state.text }, anchorOf(context))
  },
}

/** One node per nested PTC dispatch (the real tool work behind run_code). */
const ptcDefinition = {
  kind: 'weave-ptc',
  target: WEAVE_TARGET,
  match: (event) => {
    if (event.type === 'tool/ptc-dispatch-start') return { id: 'ptc:' + String(event.data.subCallId), role: 'start' }
    if (event.type === 'tool/ptc-dispatch') return { id: 'ptc:' + String(event.data.subCallId), role: 'update' }
    return null
  },
  start: (_context, match) => {
    const data = match.event.data
    let args = ''
    if (data.arguments !== null && data.arguments !== undefined) {
      try { args = JSON.stringify(data.arguments) } catch (error) { args = '' }
    }
    return {
      callId: String(data.subCallId),
      name: typeof data.name === 'string' ? data.name : 'tool',
      time: match.event.time,
      endTime: null,
      failed: false,
      args: clipText(args, 120),
    }
  },
  update: (context, match) => ({
    callId: context.state.callId,
    name: context.state.name,
    time: context.state.time,
    endTime: match.event.time,
    failed: match.event.data.isError === true,
    args: context.state.args,
  }),
  publication: () => 'immediate',
  buildViewNode: (context) => {
    const state = context.state
    if (state === undefined || state === null) return null
    return weaveNode(context, { kind: 'call', callId: state.callId, name: state.name, time: state.time, endTime: state.endTime, failed: state.failed, args: state.args }, anchorOf(context))
  },
}

/** Incremental Builder: project target nodes into the weave observatory snapshot. */
class WeaveSnapshotBuilder {
  constructor() {
    this.nodes = new Map()
    this.empty = { events: [], turns: [], usage: null }
    this.current = this.empty
  }
  replace(input) {
    this.nodes.clear()
    for (const node of input.nodes) this.nodes.set(node.key, node)
    return this.snapshot()
  }
  apply(input) {
    if (input.upserts.length === 0) return this.current
    for (const node of input.upserts) this.nodes.set(node.key, node)
    return this.snapshot()
  }
  snapshot() {
    const events = []
    const turns = []
    let total = 0
    for (const node of this.nodes.values()) {
      const data = node.data
      if (data === null || typeof data !== 'object') continue
      if (data.kind === 'turn') {
        turns.push({ turn: data.turn, startTime: data.startTime, endTime: data.endTime })
        continue
      }
      const event = { seq: node.anchorSeq, kind: data.kind }
      if (data.kind === 'prompt') {
        event.time = data.time; event.text = data.text; event.sourceKind = data.sourceKind; event.sender = data.sender
      } else if (data.kind === 'call') {
        event.time = data.time; event.endTime = data.endTime; event.name = data.name; event.callId = data.callId; event.failed = data.failed; event.args = data.args
      } else if (data.kind === 'assistant') {
        event.time = data.time; event.turn = data.turn; event.text = data.text; event.usage = data.usage
        if (data.usage !== null && typeof data.usage === 'object') total += data.usage.total
      }
      events.push(event)
    }
    events.sort((a, b) => a.seq - b.seq)
    turns.sort((a, b) => a.turn - b.turn)
    this.current = { events: events, turns: turns, usage: total > 0 ? { total: total } : null }
    return this.current
  }
}

/** Register the weave target builder (rides the caller's fiber effect). */
function registerWeaveTarget(ctx) {
  ctx.uiConversation.views.register({ target: WEAVE_TARGET, create: () => new WeaveSnapshotBuilder() })
}

/** Register the weave event Definitions (rides the caller's fiber effect). */
function registerWeaveDefinitions(ctx) {
  ctx.uiConversation.events.register(turnDefinition)
  ctx.uiConversation.events.register(promptDefinition)
  ctx.uiConversation.events.register(callDefinition)
  ctx.uiConversation.events.register(ptcDefinition)
  ctx.uiConversation.events.register(assistantDefinition)
}
