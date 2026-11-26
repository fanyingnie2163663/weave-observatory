/**
 * Weave data mapping: DSH client snapshots -> window.WEAVE_DATA schema.
 * Pure, dependency-free; inlined into the client bundle by build.mjs.
 *
 * Timeline model:
 *  - The ribbon uses ACTIVITY time, not wall time. Blocks come from the main
 *    agent's turns plus every subagent work interval; any real gap longer than
 *    GAP_MERGE_SECONDS is compressed to GAP_KEEP_SECONDS. This keeps the
 *    main-agent scaffold as the basis and removes large idle blanks.
 *  - Task bars borrow their owner's mapped work window and are split into
 *    relative "small cells", so their length reads relative to the ribbon.
 */

const AGENT_PALETTE = ['#E7EFFA', '#64C4FF', '#FFB45C', '#B79CFF', '#5EE3B0', '#FF9FB2', '#9AA7FF', '#F2D06B']
// Circle seals follow the thirty-six Tiangang star characters; the label below
// the node keeps the agent's functional name/summary.
const GANG_SEALS = ['魁', '罡', '机', '闲', '勇', '雄', '猛', '威', '英', '贵', '富', '满', '孤', '伤', '立', '捷', '暗', '佑', '速', '异', '杀', '微', '究', '退', '寿', '剑', '平', '罪', '损', '败', '牢', '慧', '暴', '哭', '巧', '天']
const GAP_MERGE_SECONDS = 12
const GAP_KEEP_SECONDS = 3
const MIN_TIMELINE_SECONDS = 24

function computeRunStart(list, sessionId, now, weave) {
  // SessionSummary has no createdAt; updatedAt is the last durable message time,
  // so using it as the origin collapsed every earlier turn to t=0 and
  // re-anchored the ribbon on each new prompt. Anchor on the earliest loaded
  // turn/event instead, falling back to the summary only when nothing loaded.
  let earliest = null
  const note = (ms) => {
    if (typeof ms !== 'number' || !Number.isFinite(ms) || ms <= 0 || ms > now) return
    if (earliest === null || ms < earliest) earliest = ms
  }
  if (weave && Array.isArray(weave.turns)) for (const turn of weave.turns) note(turn && turn.startTime)
  if (weave && Array.isArray(weave.events)) for (const event of weave.events) note(event && event.time)
  if (earliest !== null) return earliest
  try {
    const summary = list && list.byId ? list.byId[sessionId] : undefined
    const candidate = summary ? summary.updatedAt : undefined
    if (typeof candidate === 'number' && candidate > 0 && candidate <= now) return candidate
  } catch (error) { /* fall through */ }
  return now
}

function realSeconds(ms, start) {
  return Math.max(0, (ms - start) / 1000)
}

function usageTotal(usage) {
  if (usage === null || typeof usage !== 'object') return 0
  let total = 0
  for (const key of ['uncachedInputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens']) {
    const value = usage[key]
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) total += value
  }
  if (total === 0 && typeof usage.totalTokens === 'number') total = usage.totalTokens
  return total
}

function displayNameOf(list, id) {
  const summary = list && list.byId ? list.byId[id] : undefined
  if (summary === undefined) return undefined
  if (typeof summary.displayTitle === 'string' && summary.displayTitle !== '') return summary.displayTitle
  if (typeof summary.title === 'string' && summary.title !== '') return summary.title
  return undefined
}

function clipName(value, max) {
  const text = String(value == null ? '' : value).replace(/\s+/g, ' ').trim()
  if (text.length <= max) return text
  return text.slice(0, max - 1) + '…'
}

// Timeline values are whole SECONDS: the iframe's clock formatter does not
// round fractional seconds, and activity-block arithmetic produces artifacts
// like 183.59999999999999 when it is fed raw floats.
function round1(value) {
  return Math.round(value)
}

/** Normalize one work segment to an ordered, non-negative interval. */
function normalizeSegment(seg) {
  const s = Math.max(0, typeof seg.s === 'number' && Number.isFinite(seg.s) ? seg.s : 0)
  const e = Math.max(s + 0.2, typeof seg.e === 'number' && Number.isFinite(seg.e) ? seg.e : s + 1)
  return { s: s, e: e, label: seg.label, activity: seg.activity, task: seg.task == null ? null : seg.task }
}

/** Merge intervals whose real gap is at most tolerance seconds. */
function mergeBlocks(intervals, tolerance) {
  const sorted = intervals
    .map(normalizeSegment)
    .sort((a, b) => a.s - b.s)
  const blocks = []
  for (const interval of sorted) {
    const last = blocks[blocks.length - 1]
    if (last !== undefined && interval.s - last.e <= tolerance) {
      if (interval.e > last.e) last.e = interval.e
    } else {
      blocks.push({ s: interval.s, e: interval.e })
    }
  }
  return blocks
}

/**
 * Build a real-seconds -> activity-seconds compressor. Each merged block keeps
 * its duration; larger gaps shrink to gapKeep. Times inside a compressed gap
 * snap to the boundary of the following block.
 */
function buildCompressor(intervals, tolerance, gapKeep) {
  const blocks = mergeBlocks(intervals, tolerance)
  const spans = []
  let cursor = 0
  for (const block of blocks) {
    const length = Math.max(0.2, block.e - block.s)
    const virtualStart = cursor
    cursor += length
    spans.push({ realStart: block.s, realEnd: block.e, virtualStart: virtualStart, virtualEnd: cursor })
    cursor += gapKeep
  }
  const total = spans.length === 0 ? 0 : Math.max(0, cursor - gapKeep)
  function map(time) {
    if (spans.length === 0) return 0
    if (time <= spans[0].realStart) return 0
    for (let index = 0; index < spans.length; index += 1) {
      const span = spans[index]
      if (time <= span.realEnd) return span.virtualStart + (time - span.realStart)
      const next = spans[index + 1]
      if (next !== undefined && time < next.realStart) return Math.max(span.virtualEnd, next.virtualStart - 0.01)
    }
    return total
  }
  return { map: map, total: total, blockCount: spans.length }
}

function clampSegment(seg, duration) {
  const s = Math.min(Math.max(0, Math.round(seg.s)), duration)
  const e = Math.min(Math.max(s + 1, Math.round(seg.e)), duration)
  return { s: round1(s), e: round1(e), label: seg.label, activity: seg.activity, task: seg.task == null ? null : seg.task }
}

function mapSegments(segments, compressor, scale, timeline) {
  const mapped = []
  for (const seg of segments) {
    const s = compressor.map(seg.s) * scale
    const e = compressor.map(seg.e) * scale
    mapped.push(clampSegment({ s: s, e: e, label: seg.label, activity: seg.activity, task: seg.task }, timeline))
  }
  return mapped
}

/** Raw (uncompressed) work segments from one subagent's timing projection. */
function rawTimingSegments(timing, start, now, updatedAt, createdMs) {
  if (timing === null || typeof timing !== 'object') return []
  const segments = []
  const nowReal = realSeconds(now, start)
  const active = timing.active
  if (active !== null && typeof active === 'object' && typeof active.since === 'number') {
    const s = realSeconds(active.since, start)
    const e = typeof active.through === 'number' ? realSeconds(active.through, start) : nowReal
    segments.push({ s: s, e: Math.max(e, s + 1), label: '执行中', activity: '模型/工具执行', task: null })
  }
  if (typeof timing.settledMs === 'number' && timing.settledMs > 0) {
    // settledMs is an accumulated DURATION that runs FORWARD from the subagent's
    // creation, not backwards from its last update. Using updatedAt (≈ creation
    // prompt time) pushed the band before the agent even existed.
    const settledSec = timing.settledMs / 1000
    const created = typeof createdMs === 'number' && createdMs > 0
      ? realSeconds(createdMs, start)
      : (typeof updatedAt === 'number' && updatedAt > 0 ? realSeconds(updatedAt, start) : nowReal)
    const begin = Math.max(0, created)
    const end = begin + settledSec
    segments.push({ s: begin, e: Math.max(end, begin + 0.5), label: '已结算', activity: '历史工作段（近似）', task: null })
  }
  return segments
}

function eventLabelOf(event) {
  if (event.kind === 'prompt') {
    if (event.sourceKind === 'agent-message' || event.sourceKind === 'team-message') return { type: 'message', tag: event.sender || '消息' }
    return { type: 'decision', tag: '目标' }
  }
  if (event.kind === 'call') return { type: event.failed ? 'alert' : 'tool', tag: event.name || 'tool' }
  return { type: 'artifact', tag: '产出' }
}

function eventTextOf(event) {
  if (event.kind === 'prompt') {
    const prefix = event.sender ? event.sender + '：' : ''
    return prefix + (event.text || '')
  }
  if (event.kind === 'call') return event.name + (event.args ? '(' + event.args + ')' : '()')
  return event.text || ''
}

/**
 * Map DSH client snapshots into the prototype's WEAVE_DATA schema.
 * @param {{sessionId:string, list?:object, weave?:object, now?:number}} input
 * @returns {object} WEAVE_DATA
 */
export function buildWeaveData(input) {
  const now = input !== null && input !== undefined && typeof input.now === 'number' ? input.now : Date.now()
  const sessionId = input !== null && input !== undefined ? String(input.sessionId || '') : ''
  const list = input !== null && input !== undefined ? input.list : undefined
  const weave = input !== null && input !== undefined ? input.weave : undefined
  const start = computeRunStart(list, sessionId, now, weave)
  const projection = list && list.projectionsBySession ? list.projectionsBySession[sessionId] : undefined
  const values = projection && projection.values ? projection.values : {}
  const catalog = Array.isArray(values.subagentCatalog) ? values.subagentCatalog : []
  const team = values.agentTeam
  const fullMainName = displayNameOf(list, sessionId) || '会话主代理'
  const mainName = clipName(fullMainName, 12) || '会话主代理'
  const rootId = sessionId || 'root'
  const snapshotTurns = weave && Array.isArray(weave.turns) ? weave.turns : []
  const snapshotEvents = weave && Array.isArray(weave.events) ? weave.events : []
  const rootSummary = list && list.byId ? list.byId[sessionId] : undefined

  /* ---- main agent raw work (the ribbon's basis) ------------------------- */
  const mainRaw = []
  for (const turn of snapshotTurns) {
    if (turn === null || typeof turn !== 'object') continue
    const s = typeof turn.startTime === 'number' ? realSeconds(turn.startTime, start) : null
    if (s === null) continue
    const e = typeof turn.endTime === 'number' ? realSeconds(turn.endTime, start) : realSeconds(now, start)
    mainRaw.push({ s: s, e: Math.max(e, s + 1), label: '第 ' + turn.turn + ' 轮', activity: '对话与工具执行', task: null })
  }
  if (mainRaw.length === 0) {
    // No turns in the loaded window: fall back to the observed event span or a
    // short placeholder block so the ribbon still has an honest skeleton.
    let first = null
    let last = null
    for (const event of snapshotEvents) {
      if (typeof event.time !== 'number') continue
      const t = realSeconds(event.time, start)
      if (first === null || t < first) first = t
      if (last === null || t > last) last = t
    }
    if (first !== null && last !== null && last > first) {
      mainRaw.push({ s: first, e: last, label: '会话活动', activity: '已读取的事件范围', task: null })
    }
  }

  /* ---- subagent raw work ------------------------------------------------ */
  const catalogRaw = []
  const catalogIds = new Set()
  const agentRaw = new Map()
  catalog.forEach((entry) => {
    if (entry === null || typeof entry !== 'object') return
    const id = String(entry.id || '')
    if (id === '') return
    catalogIds.add(id)
    const summary = list && list.byId ? list.byId[id] : undefined
    // Per-child projections live under projectionsBySession[id].values; the
    // parent's projectionValues only holds its own timing/tokenUsage.
    const childProjection = list && list.projectionsBySession ? list.projectionsBySession[id] : undefined
    const childValues = childProjection && childProjection.values ? childProjection.values : {}
    const timing = childValues.subagentTiming !== undefined
      ? childValues.subagentTiming
      : (summary && summary.projectionValues ? summary.projectionValues.subagentTiming : undefined)
    const usageProjection = childValues.tokenUsage !== undefined
      ? childValues.tokenUsage
      : (summary && summary.projectionValues ? summary.projectionValues.tokenUsage : undefined)
    const updatedAt = summary ? summary.updatedAt : undefined
    const segments = rawTimingSegments(timing, start, now, updatedAt, entry.createdAt)
    const running = (summary && summary.running === true) || (timing && timing.active !== null && timing.active !== undefined && timing.active !== false)
    catalogRaw.push({ entry: entry, id: id, summary: summary, segments: segments, usageProjection: usageProjection, running: running })
    agentRaw.set(id, segments)
  })

  /* ---- activity compression -------------------------------------------- */
  const intervals = []
  for (const segment of mainRaw) intervals.push(segment)
  for (const row of catalogRaw) for (const segment of row.segments) intervals.push(segment)
  let compressor = buildCompressor(intervals, GAP_MERGE_SECONDS, GAP_KEEP_SECONDS)
  let scale = 1
  if (compressor.total <= 0) {
    const fallback = Math.max(MIN_TIMELINE_SECONDS, 1)
    compressor = { map: function (time) { return Math.min(Math.max(0, time), fallback) }, total: fallback, blockCount: 0 }
    scale = 1
  } else if (compressor.total < MIN_TIMELINE_SECONDS) {
    scale = MIN_TIMELINE_SECONDS / compressor.total
  }
  const timeline = Math.max(1, round1(compressor.total * scale))

  function mapTimestamp(ms) {
    const value = compressor.map(realSeconds(ms, start)) * scale
    return round1(Math.min(Math.max(0, value), timeline))
  }

  /* ---- agents ----------------------------------------------------------- */
  const agents = []
  const agentWork = new Map()
  let mainWork = mapSegments(mainRaw, compressor, scale, timeline)
  if (mainWork.length === 0) mainWork = [{ s: 0, e: timeline, label: '会话进行中', activity: '编排与协调', task: null }]
  agentWork.set(rootId, mainWork)
  agents.push({
    id: rootId,
    name: mainName,
    roleCn: '编排者',
    roleEn: 'LEAD',
    icon: 'compass',
    color: AGENT_PALETTE[0],
    model: 'main agent',
    parent: null,
    seal: '编',
    running: true,
    work: mainWork,
  })

  const tokensByAgent = {}
  catalogRaw.forEach((row, index) => {
    const summary = row.summary
    const usage = row.usageProjection
    const total = usageTotal(usage)
    if (total > 0) tokensByAgent[row.id] = total
    let work = mapSegments(row.segments, compressor, scale, timeline)
    if (work.length === 0) {
      work = [clampSegment(row.running
        ? { s: 0, e: timeline, label: '执行中', activity: '子代理执行（近似）', task: null }
        : { s: 0, e: Math.min(timeline, 6), label: '曾参与', activity: '子代理历史（近似）', task: null }, timeline)]
    }
    agentWork.set(row.id, work)
    agents.push({
      id: row.id,
      name: clipName(row.entry.name || row.entry.label || (summary && summary.displayTitle) || row.id.slice(0, 8), 10),
      seal: GANG_SEALS[index % GANG_SEALS.length],
      running: row.running === true,
      title: clipName(row.entry.name || row.entry.label || (summary && summary.displayTitle) || row.id.slice(0, 8), 24),
      roleCn: row.entry.mode === 'one-shot' ? '子任务' : '子代理',
      roleEn: row.entry.mode === 'one-shot' ? 'TASK' : 'SUBAGENT',
      icon: row.running ? 'spark' : 'branch',
      color: AGENT_PALETTE[(index + 1) % AGENT_PALETTE.length],
      model: row.running ? 'subagent · running' : 'subagent',
      // Raw lineage candidate; resolved to an agent id once the roster exists.
      parentRaw: summary && typeof summary.parentSessionId === 'string' ? summary.parentSessionId : null,
      work: work,
    })
  })

  const agentIds = new Set()
  const agentAliases = new Map()
  for (const agent of agents) {
    agentIds.add(agent.id)
    if (typeof agent.name === 'string' && agent.name !== '') agentAliases.set(agent.name, agent.id)
  }
  for (const row of catalogRaw) {
    const alias = row.entry.name || row.entry.label || (row.summary && row.summary.displayTitle)
    if (typeof alias === 'string' && alias !== '' && agentIds.has(row.id)) agentAliases.set(alias, row.id)
  }
  // Resolve subagent lineage to real agent ids (root session id resolves to the
  // lead). Unknown parents fall back to the lead so the tree never loses a node.
  for (const agent of agents) {
    if (agent.id === rootId) { agent.parent = null; continue }
    agent.parent = agent.parentRaw ? resolveAgentId(String(agent.parentRaw)) : rootId
    delete agent.parentRaw
  }
  const nameById = new Map(agents.map((agent) => [agent.id, agent.name]))
  /** The Weave app reads agentById[owner].color: every reference must be a real agent id. */
  function resolveAgentId(value) {
    if (typeof value !== 'string' || value === '') return rootId
    if (agentIds.has(value)) return value
    if (agentAliases.has(value)) return agentAliases.get(value)
    const lower = value.toLowerCase()
    for (const pair of agentAliases) {
      if (pair[0].toLowerCase() === lower) return pair[1]
    }
    return rootId
  }

  /* ---- tasks: owner-relative small cells ------------------------------- */
  const rawTasks = team && Array.isArray(team.tasks) ? team.tasks : []
  const ownerCounts = new Map()
  for (const task of rawTasks) {
    if (task === null || typeof task !== 'object') continue
    // Count by the RESOLVED owner id: aliases/unknown names would otherwise
    // split one owner's cells across two buckets.
    const ownerId = resolveAgentId(task.ownerId !== null && task.ownerId !== undefined ? String(task.ownerId) : rootId)
    ownerCounts.set(ownerId, (ownerCounts.get(ownerId) || 0) + 1)
  }
  const taskIndexById = new Map()
  rawTasks.forEach((task, index) => {
    if (task !== null && typeof task === 'object' && task.id !== undefined) taskIndexById.set(String(task.id), index + 1)
  })
  const ownerSeen = new Map()
  const tasks = rawTasks.map((task, index) => {
    if (task === null || typeof task !== 'object') return null
    const ownerId = resolveAgentId(task.ownerId !== null && task.ownerId !== undefined ? String(task.ownerId) : rootId)
    const work = agentWork.get(ownerId) || mainWork
    let start = 0
    let end = 0
    if (work.length > 0) {
      start = work[0].s
      end = work[0].e
      for (const segment of work) {
        if (segment.s < start) start = segment.s
        if (segment.e > end) end = segment.e
      }
    }
    const count = ownerCounts.get(ownerId) || 1
    const seen = ownerSeen.get(ownerId) || 0
    ownerSeen.set(ownerId, seen + 1)
    const cell = Math.max(0.8, (end - start) / count)
    const taskStart = round1(Math.min(start + seen * cell, Math.max(0, timeline - 0.8)))
    const taskEnd = round1(Math.min(timeline, Math.max(taskStart + 0.8, start + (seen + 1) * cell)))
    return {
      id: 'T' + (index + 1),
      title: String(task.subject || task.description || task.id || ('任务 ' + (index + 1))),
      owner: ownerId,
      start: taskStart,
      end: taskEnd,
      deps: (Array.isArray(task.blockedBy) ? task.blockedBy : [])
        .map((id) => taskIndexById.get(String(id)))
        .filter((n) => typeof n === 'number')
        .map((n) => 'T' + n),
      status: typeof task.status === 'string' ? task.status : 'pending',
      ready: task.ready !== false,
    }
  }).filter((task) => task !== null)

  /* ---- events ----------------------------------------------------------- */
  const events = []
  for (const event of snapshotEvents) {
    if (typeof event.time !== 'number') continue
    if (event.kind === 'assistant') continue
    if (event.kind === 'prompt' && event.sourceKind !== 'user' && event.sourceKind !== 'agent-message' && event.sourceKind !== 'team-message' && event.sourceKind !== 'subagent-settled' && event.sourceKind !== 'compact-checkpoint') continue
    const actor = event.kind === 'prompt' && event.sender ? resolveAgentId(event.sender) : rootId
    const actorName = nameById.get(actor) || actor
    const displayEvent = event.kind === 'prompt' && event.sender ? { ...event, sender: actorName } : event
    const label = eventLabelOf(displayEvent)
    let text = eventTextOf(displayEvent)
    if (text === '') {
      if (event.kind !== 'prompt') continue
      // A settled teammate notice can carry no body; keep it as a marker row.
      text = (actorName || '子代理') + '：已完成'
    }
    events.push({
      t: mapTimestamp(event.time),
      type: label.type,
      actor: actor,
      text: String(text).slice(0, 180),
      tag: label.tag,
    })
  }
  // Bound the payload: long sessions accumulate thousands of rows and every
  // update posts the whole snapshot into the sandboxed iframe.
  const recentEvents = events.slice(-600)

  const blocked = rawTasks.filter((task) => task !== null && typeof task === 'object' && task.status !== 'completed' && task.ready === false)
  let blocker
  if (blocked.length > 0) {
    // Cover exactly the non-completed blocked tasks; never fall back to the
    // whole board (that band was both wrong and misleading).
    const blockedMapped = tasks.filter((task) => task !== null && task.status !== 'completed' && task.ready === false)
    let from = timeline
    let to = 0
    for (const task of blockedMapped) {
      if (task === null) continue
      if (from > task.start) from = task.start
      if (to < task.end) to = task.end
    }
    if (blockedMapped.length > 0) {
      const deps = Array.isArray(blocked[0].blockedBy) ? blocked[0].blockedBy.map(String).join('、') : ''
      blocker = {
        from: round1(Math.min(from, timeline)),
        to: round1(Math.max(to, 0.5)),
        title: String(blocked[0].subject || '任务阻塞'),
        detail: deps !== '' ? '等待依赖：' + deps : String(blocked[0].description || '依赖未就绪的任务'),
      }
    }
  }

  /* Collaboration messages: agent/team prompts are the only cross-agent
     traffic visible in the root session window. Synthesize the edges so the
     graph and dossier can show "who talked to whom" instead of 0 messages. */
  const messages = []
  for (const event of snapshotEvents) {
    if (event.kind !== 'prompt') continue
    if (event.sourceKind !== 'agent-message' && event.sourceKind !== 'team-message') continue
    const sender = resolveAgentId(event.sender)
    if (sender === rootId) continue
    messages.push({ from: sender, to: rootId, t: mapTimestamp(event.time), travel: 3 })
  }
  const recentMessages = messages.slice(-80)

  const tokenSegments = {}
  for (const key of Object.keys(tokensByAgent)) tokenSegments[key] = [tokensByAgent[key]]
  const mainTokens = usageTotal(values.tokenUsage)
  if (mainTokens > 0) tokenSegments[rootId] = [mainTokens]

  return {
    meta: {
      runId: (sessionId || 'session').replace(/^session-/, '').slice(0, 8).toUpperCase(),
      project: (() => {
        const cwd = rootSummary && typeof rootSummary.cwd === 'string' ? rootSummary.cwd : ''
        const name = cwd.replace(/[\\/]+$/, '').split(/[\\/]/).pop()
        return name || 'dsh-session'
      })(),
      branch: '',
      goal: fullMainName,
      shortGoal: mainName,
      startedAt: new Date(start).toTimeString().slice(0, 5),
      duration: timeline,
      // 1x playback: game the speed controls against the compressed timeline,
      // not a hardcoded 80s (43x fast-forward on long sessions).
      playbackSeconds: Math.max(1, Math.round(timeline)),
      simulated: false,
      live: true,
      activityCompressed: true,
      realDurationSeconds: round1(realSeconds(now, start)),
      tokens: {
        segments: tokenSegments,
        // True when at least one agent has no projection usage; the embed
        // falls back to a simulated series for those and labels it as such.
        simulated: catalogRaw.some((row) => usageTotal(row.usageProjection) <= 0),
      },
    },
    agents: agents,
    tasks: tasks,
    events: recentEvents,
    messages: recentMessages,
    ...(blocker === undefined ? {} : { blocker: blocker }),
    tokens: { segments: tokenSegments },
    source: { sessionId: sessionId, catalogCount: catalogIds.size, taskCount: tasks.length, eventCount: recentEvents.length, blocks: compressor.blockCount },
  }
}
