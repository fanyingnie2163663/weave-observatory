/* Weave · 多智能体协作观测台 — 回放引擎与渲染层
 * 纯前端、无依赖。基于虚拟时间的确定性回放：
 * 任意时间点的状态（谁在做什么、消息在途、事件流、泳道进度）都由 t 推导。
 */
(function () {
  "use strict";

  var DATA = window.WEAVE_DATA;
  var META = DATA.meta;
  var END = META.duration;
  var RATE = END / META.playbackSeconds;
  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var NS = "http://www.w3.org/2000/svg";

  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };
  var clamp = function (v, a, b) { return Math.max(a, Math.min(b, v)); };
  var pad = function (n) { return n < 10 ? "0" + n : "" + n; };
  var fmt = function (sec) {
    sec = clamp(Math.round(sec), 0, END);
    return pad(Math.floor(sec / 60)) + ":" + pad(sec % 60);
  };
  var pct = function (n) { return Math.round(clamp(n, 0, 1) * 100); };
  var icon = function (id) {
    return '<svg class="icon" aria-hidden="true"><use href="#' + id + '"></use></svg>';
  };

  var agents = DATA.agents;
  var agentById = {};
  agents.forEach(function (a) { agentById[a.id] = a; });
  var EVENTS = DATA.events.slice().sort(function (a, b) { return a.t - b.t; });
  var MESSAGES = DATA.messages.slice().sort(function (a, b) { return a.t - b.t; });
  var TASKS = DATA.tasks.slice().sort(function (a, b) {
    return parseInt(a.id.slice(1), 10) - parseInt(b.id.slice(1), 10);
  });
  var BLOCKER = DATA.blocker || { from: Infinity, to: Infinity, title: "", detail: "" };

  var STATUS_TEXT = { active: "执行中", waiting: "等待中", queued: "待命", done: "已完成" };
  var TYPE_ICON = {
    delegate: "i-send", message: "i-message", tool: "i-terminal",
    decision: "i-branch", artifact: "i-file", insight: "i-spark", alert: "i-alert"
  };
  var TYPE_TONE = {
    delegate: "var(--sky)", message: "#8fa3bd", tool: "var(--amber)",
    decision: "var(--lime)", artifact: "var(--mint)", insight: "var(--violet)", alert: "var(--rose)"
  };
  var FEED_TYPES = [
    { id: "all", label: "全部" }, { id: "delegate", label: "委派" },
    { id: "message", label: "消息" }, { id: "tool", label: "工具" },
    { id: "decision", label: "决策" }, { id: "artifact", label: "产出" },
    { id: "insight", label: "发现" }, { id: "alert", label: "异常" }
  ];
  var WAIT_NOTES = {
    atlas: "等待上游结论与评审反馈",
    scout: "等待下一项任务分派",
    forge: "等待评审结论与修复指令",
    lens: "等待新的实现提交评审",
    quill: "等待其他智能体的结论同步"
  };
  var WAIT_ACTIVITY = {
    atlas: "研判评审反馈",
    scout: "待命 · 等待分派",
    forge: "等待评审结论",
    lens: "等待复核请求",
    quill: "等待结论合并"
  };

  var LEAD = agentById["atlas"] || agents[0] || null;
  function edgeKey(a, b) { return a < b ? a + "|" + b : b + "|" + a; }

  /* 根据实际数据推导协作关系：主编排者到所有成员 + 消息里出现的横向关系 */
  function buildEdgeDefs() {
    var defs = [];
    var seen = {};
    if (LEAD) {
      agents.forEach(function (a) {
        if (a.id === LEAD.id) return;
        /* 谱系边优先：子代理连到它的父代理，而不是全部连主智能体 */
        var parent = a.parent && agentById[a.parent] ? a.parent : LEAD.id;
        var k = edgeKey(parent, a.id);
        if (seen[k]) return;
        seen[k] = true;
        defs.push({ a: parent, b: a.id, peer: false });
      });
    }
    MESSAGES.forEach(function (m) {
      if (!agentById[m.from] || !agentById[m.to]) return;
      var k = edgeKey(m.from, m.to);
      if (seen[k]) return;
      seen[k] = true;
      defs.push({ a: m.from, b: m.to, peer: true });
    });
    return defs;
  }
  var EDGE_DEFS = buildEdgeDefs();
  if (typeof window !== "undefined") window.WEAVE_EDGES = EDGE_DEFS;

  /* 有谱系数据时按会话谱系树排布；无谱系的演示数据沿用菱形/环形。 */
  function treePositions(compact, stageWidth, lead) {
    var positions = {};
    var children = {};
    agents.forEach(function (a) {
      var parent = a.id !== lead.id && a.parent && agentById[a.parent] ? a.parent : null;
      if (parent === null) return;
      (children[parent] = children[parent] || []).push(a);
    });
    var levels = [[lead]];
    var seen = {};
    seen[lead.id] = true;
    while (true) {
      var prev = levels[levels.length - 1];
      var next = [];
      prev.forEach(function (node) {
        (children[node.id] || []).forEach(function (child) {
          if (seen[child.id]) return;
          seen[child.id] = true;
          next.push(child);
        });
      });
      if (!next.length) break;
      levels.push(next);
    }
    var orphans = agents.filter(function (a) { return !seen[a.id]; });
    if (orphans.length) levels[1] = (levels[1] || []).concat(orphans);
    var width = stageWidth || 1200;
    var perRow = Math.max(compact ? 3 : 4, Math.min(12, Math.floor(width / (compact ? 88 : 96))));
    var rowGap = compact ? 0.3 : 0.235;
    var baseY = compact ? 0.16 : 0.14;
    var row = 0;
    levels.forEach(function (nodes, depth) {
      if (depth === 0) { positions[lead.id] = { x: 0.5, y: baseY }; return; }
      var rowCount = Math.max(1, Math.ceil(nodes.length / perRow));
      var per = Math.ceil(nodes.length / rowCount);
      for (var i = 0; i < nodes.length; i += per) {
        var part = nodes.slice(i, i + per);
        var y = Math.min(0.86, baseY + (++row) * rowGap);
        part.forEach(function (node, index) {
          positions[node.id] = { x: (index + 1) / (part.length + 1), y: y };
        });
      }
    });
    agents.forEach(function (a) {
      if (!positions[a.id]) positions[a.id] = { x: 0.5, y: 0.86 };
    });
    return positions;
  }

  /* 自适应节点位置：1 位编排者 + 最多 4 位成员沿用菱形，更多成员排成环形 */
  function stagePositions(compact, stageWidth) {
    var positions = {};
    if (!agents.length) return positions;
    var lead = LEAD || agents[0];
    var hasLineage = agents.some(function (a) { return a.id !== lead.id && a.parent && agentById[a.parent]; });
    if (hasLineage) return treePositions(compact, stageWidth, lead);
    var others = agents.filter(function (a) { return a.id !== lead.id; });
    positions[lead.id] = compact ? { x: 0.5, y: 0.5 } : { x: 0.5, y: 0.44 };
    var n = others.length;
    if (!n) return positions;
    if (n <= 4) {
      var slots;
      if (n === 1) {
        slots = compact ? [{ x: 0.76, y: 0.5 }] : [{ x: 0.77, y: 0.48 }];
      } else if (n === 2) {
        slots = compact
          ? [{ x: 0.24, y: 0.48 }, { x: 0.76, y: 0.48 }]
          : [{ x: 0.2, y: 0.48 }, { x: 0.8, y: 0.48 }];
      } else if (n === 3) {
        slots = compact
          ? [{ x: 0.25, y: 0.24 }, { x: 0.75, y: 0.24 }, { x: 0.5, y: 0.79 }]
          : [{ x: 0.23, y: 0.2 }, { x: 0.77, y: 0.2 }, { x: 0.5, y: 0.8 }];
      } else {
        slots = compact
          ? [{ x: 0.23, y: 0.24 }, { x: 0.77, y: 0.24 }, { x: 0.23, y: 0.78 }, { x: 0.77, y: 0.78 }]
          : [{ x: 0.155, y: 0.21 }, { x: 0.845, y: 0.21 }, { x: 0.155, y: 0.775 }, { x: 0.845, y: 0.775 }];
      }
      others.forEach(function (a, i) { positions[a.id] = slots[i] || slots[slots.length - 1]; });
      return positions;
    }
    var rx = compact ? 0.34 : 0.37;
    var ry = compact ? 0.32 : 0.35;
    others.forEach(function (a, i) {
      var angle = -Math.PI / 2 + (i * Math.PI * 2) / n;
      positions[a.id] = {
        x: Math.max(0.12, Math.min(0.88, 0.5 + Math.cos(angle) * rx)),
        y: Math.max(0.12, Math.min(0.88, 0.5 + Math.sin(angle) * ry))
      };
    });
    return positions;
  }

  var state = {
    t: 0, playing: !reduceMotion, speed: 1,
    selected: agents[0] ? agents[0].id : "atlas", follow: true, focus: false,
    filter: "all", completed: false
  };

  var el = {};
  var nodeEls = {};
  var edgeList = [];
  var edgeByKey = {};
  var particleList = [];
  var segmentEls = [];
  var laneRowEls = {};
  var laneLinkEls = [];
  var taskEls = {};
  var renderedEvents = [];
  var stageW = 0;
  var stageH = 0;
  var lastHotSig = "";
  var lastNowIdx = -2;
  var lastUiStamp = 0;
  var lastInspectorStamp = 0;
  var lastPlaying = null;
  var lastCompleted = null;
  var forceInspector = true;
  var resizeQueued = false;
  var lastTimeText = "";

  /* ------------------------------------------------------------------ utils */
  function blockerActive(t) { return t >= BLOCKER.from && t < BLOCKER.to; }
  function workAt(agent, t) {
    for (var i = 0; i < agent.work.length; i++) {
      var w = agent.work[i];
      if (t >= w.s && t < w.e) return { work: w, index: i };
    }
    return null;
  }
  function agentStatus(agent, t) {
    var works = agent.work;
    if (t >= works[works.length - 1].e) return "done";
    if (workAt(agent, t)) return "active";
    if (t < works[0].s) return "queued";
    return "waiting";
  }
  function taskStatus(task, t) {
    if (t >= task.end) return "done";
    if (task.id === "T5" && blockerActive(t) && t < task.start) return "blocked";
    if (task.id === "T4" && blockerActive(t) && t >= task.start) return "alert";
    if (t < task.start) return "queued";
    return "running";
  }
  function activeTime(agent, t) {
    var sum = 0;
    agent.work.forEach(function (w) { sum += clamp(t - w.s, 0, w.e - w.s); });
    return sum;
  }
  function overallProgress(t) {
    var total = 0, done = 0;
    TASKS.forEach(function (task) {
      var dur = task.end - task.start;
      total += dur;
      done += clamp(t - task.start, 0, dur);
    });
    return total ? done / total : 0;
  }
  function latestEventIndex(t) {
    var idx = -1;
    for (var i = 0; i < EVENTS.length; i++) {
      if (EVENTS[i].t <= t + 0.001) idx = i; else break;
    }
    return idx;
  }
  function matchesFilter(ev) { return state.filter === "all" || ev.type === state.filter; }
  function currentVisibleEvents() {
    return EVENTS.filter(function (ev) { return ev.t <= state.t + 0.001 && matchesFilter(ev); });
  }
  function connectedSet() {
    var set = {};
    set[state.selected] = true;
    EDGE_DEFS.forEach(function (d) {
      if (d.a === state.selected) set[d.b] = true;
      if (d.b === state.selected) set[d.a] = true;
    });
    return set;
  }
  function agentName(id) {
    if (id === "all") return "全员";
    return agentById[id] ? agentById[id].name : id;
  }
  function spanMeta(ev) {
    var actor = agentById[ev.actor];
    var text = '<b class="actor-name" style="color:' + actor.color + ';--actor:' + actor.color + '">' + actor.name + "</b> " + ev.text;
    if (ev.target) text += ' <span class="to">→ ' + agentName(ev.target) + "</span>";
    if (ev.tag) text += ' <span class="feed-tag">' + ev.tag + "</span>";
    return text;
  }

  /* ------------------------------------------------------------------ build */
  function cacheEls() {
    el.app = $("#app");
    el.runState = $("#runState");
    el.runId = $("#runId");
    el.runGoalShort = $("#runGoalShort");
    el.runStarted = $("#runStarted");
    el.playBtn = $("#playBtn");
    el.playLabel = $("#playLabel");
    el.playIconUse = $("#playIconUse");
    el.restartBtn = $("#restartBtn");
    el.helpBtn = $("#helpBtn");
    el.timeNow = $("#timeNow");
    el.timeTotal = $("#timeTotal");
    el.goalTitle = $("#goalTitle");
    el.goalProject = $("#goalProject");
    el.goalBranch = $("#goalBranch");
    el.goalRing = $("#goalRing");
    el.goalPct = $("#goalPct");
    el.goalElapsed = $("#goalElapsed");
    el.goalEta = $("#goalEta");
    el.statActive = $("#statActive");
    el.statDone = $("#statDone");
    el.statCalls = $("#statCalls");
    el.statBlocked = $("#statBlocked");
    el.statBlockedCell = $("#statBlockedCell");
    el.taskCount = $("#taskCount");
    el.taskList = $("#taskList");
    el.focusBtn = $("#focusBtn");
    el.stage = $("#stage");
    el.orbits = $(".orbits", el.stage);
    el.edgeLayer = $("#edgeLayer");
    el.nodeLayer = $("#nodeLayer");
    el.nowTime = $("#nowTime");
    el.nowText = $("#nowText");
    el.laneLabels = $("#laneLabels");
    el.laneTracks = $("#laneTracks");
    el.laneRuler = $("#laneRuler");
    el.laneRows = $("#laneRows");
    el.laneLinks = $("#laneLinks");
    el.blockerBand = $("#blockerBand");
    el.blockerLabel = $("#blockerLabel");
    el.playhead = $("#playhead");
    el.laneTime = $("#laneTime");
    el.scrubInput = $("#scrubInput");
    el.inspector = $("#inspector");
    el.followBtn = $("#followBtn");
    el.feedFilters = $("#feedFilters");
    el.feedCount = $("#feedCount");
    el.feedScroll = $("#feedScroll");
    el.feedList = $("#feedList");
    el.feedJump = $("#feedJump");
    el.helpDialog = $("#helpDialog");
    el.tipToast = $("#tipToast");
  }

  function buildNodes() {
    el.nodeLayer.innerHTML = "";
    agents.forEach(function (a) {
      var node = document.createElement("div");
      node.className = "node is-queued";
      node.dataset.agent = a.id;
      node.style.setProperty("--c", a.color);
      node.innerHTML =
        '<button class="node-btn" type="button" aria-pressed="false">' +
          '<span class="node-icon">' + icon(a.icon) + '</span>' +
          '<svg class="node-ring" viewBox="0 0 78 78" aria-hidden="true">' +
            '<circle class="ring-track" cx="39" cy="39" r="36"></circle>' +
            '<circle class="ring-value" cx="39" cy="39" r="36"></circle>' +
          "</svg>" +
          '<span class="node-badge" aria-hidden="true"></span>' +
        "</button>" +
        '<div class="node-name">' + a.name + "</div>" +
        '<div class="node-role">' + a.roleEn + " · " + a.roleCn + "</div>" +
        '<div class="node-activity"><span class="mini" hidden></span><span class="node-activity-text">待命</span></div>';
      el.nodeLayer.appendChild(node);
      var btn = node.querySelector(".node-btn");
      btn.addEventListener("click", function () { selectAgent(a.id, true); });
      nodeEls[a.id] = {
        root: node, btn: btn,
        badge: node.querySelector(".node-badge"),
        activityText: node.querySelector(".node-activity-text"),
        mini: node.querySelector(".mini"),
        ringValue: node.querySelector(".ring-value")
      };
    });
  }

  function buildEdges() {
    el.edgeLayer.innerHTML = "";
    edgeList = [];
    edgeByKey = {};
    EDGE_DEFS.forEach(function (def) {
      var path = document.createElementNS(NS, "path");
      path.setAttribute("class", "edge" + (def.peer ? " is-link" : ""));
      el.edgeLayer.appendChild(path);
      var rec = { def: def, path: path, len: 0, key: edgeKey(def.a, def.b) };
      edgeList.push(rec);
      edgeByKey[rec.key] = rec;
    });
  }

  function buildParticles() {
    var old = el.edgeLayer.querySelectorAll(".msg-particle");
    Array.prototype.forEach.call(old, function (n) { n.parentNode.removeChild(n); });
    particleList = [];
    MESSAGES.forEach(function (m) {
      var from = agentById[m.from];
      var g = document.createElementNS(NS, "g");
      g.setAttribute("class", "msg-particle");
      g.style.display = "none";
      var glow = document.createElementNS(NS, "circle");
      glow.setAttribute("r", "7");
      glow.setAttribute("class", "msg-glow");
      glow.setAttribute("fill", from.color);
      var core = document.createElementNS(NS, "circle");
      core.setAttribute("r", "2.6");
      core.setAttribute("class", "msg-core");
      core.setAttribute("fill", from.color);
      g.appendChild(glow);
      g.appendChild(core);
      el.edgeLayer.appendChild(g);
      particleList.push({ msg: m, g: g, visible: false });
    });
  }

  function buildLanes() {
    el.laneLabels.innerHTML = "";
    el.laneRows.innerHTML = "";
    segmentEls = [];
    laneRowEls = {};
    agents.forEach(function (a) {
      var label = document.createElement("div");
      label.className = "lane-label";
      label.style.setProperty("--c", a.color);
      label.innerHTML = '<span class="lane-dot"></span><span>' + a.name + "</span>";
      el.laneLabels.appendChild(label);

      var row = document.createElement("div");
      row.className = "lane-row";
      row.dataset.agent = a.id;
      a.work.forEach(function (w, i) {
        var seg = document.createElement("div");
        seg.className = "seg is-upcoming";
        seg.style.setProperty("--c", a.color);
        seg.style.left = (w.s / END * 100).toFixed(3) + "%";
        seg.style.width = ((w.e - w.s) / END * 100).toFixed(3) + "%";
        seg.dataset.agent = a.id;
        seg.dataset.index = i;
        seg.title = w.label + " · " + fmt(w.s) + "–" + fmt(w.e);
        seg.innerHTML = '<span class="seg-fill"></span><span class="seg-label">' + w.label + "</span>";
        row.appendChild(seg);
        segmentEls.push({
          el: seg, fill: seg.querySelector(".seg-fill"), agentId: a.id, work: w, cls: "",
          tiny: ((w.e - w.s) / END * 100) < 2.8
        });
      });
      el.laneRows.appendChild(row);
      laneRowEls[a.id] = row;
    });
  }

  function buildTasks() {
    el.taskList.innerHTML = "";
    taskEls = {};
    TASKS.forEach(function (task) {
      var owner = agentById[task.owner];
      var li = document.createElement("li");
      li.className = "task-item is-queued";
      li.dataset.task = task.id;
      li.style.setProperty("--agent-color", owner.color);
      li.style.setProperty("--task-c", owner.color);
      li.innerHTML =
        '<span class="task-icon"></span>' +
        '<span class="task-main">' +
          '<span class="task-title">' + task.title + "</span>" +
          '<span class="task-sub"><span class="task-owner">' + owner.name + "</span><span>" + task.id + "</span>" +
            (task.deps.length ? '<span class="task-deps">← ' + task.deps.join(" ") + "</span>" : "") +
          "</span>" +
        "</span>" +
        '<span class="task-tail mono"></span>';
      li.tabIndex = 0;
      li.setAttribute("role", "button");
      li.setAttribute("aria-label", task.title + "，" + owner.name + "，" + task.id + "，跳转到开始时间");
      li.addEventListener("click", function () {
        pause();
        seek(task.start + 0.5);
        selectAgent(task.owner, true);
      });
      li.addEventListener("keydown", function (e) {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); li.click(); }
      });
      el.taskList.appendChild(li);
      taskEls[task.id] = {
        root: li, icon: li.querySelector(".task-icon"),
        tail: li.querySelector(".task-tail"), cls: "", iconId: "", tailTxt: ""
      };
    });
  }

  function buildFilters() {
    el.feedFilters.innerHTML = "";
    FEED_TYPES.forEach(function (ft) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "filter-chip";
      b.textContent = ft.label;
      b.dataset.filter = ft.id;
      b.setAttribute("aria-pressed", ft.id === state.filter ? "true" : "false");
      b.addEventListener("click", function () {
        state.filter = ft.id;
        $$(".filter-chip", el.feedFilters).forEach(function (x) {
          x.setAttribute("aria-pressed", x === b ? "true" : "false");
        });
        rebuildFeed(currentVisibleEvents());
      });
      el.feedFilters.appendChild(b);
    });
  }

  /* ------------------------------------------------------------------ layout */
  function layoutStage() {
    stageW = el.stage.clientWidth;
    stageH = el.stage.clientHeight;
    if (!stageW || !stageH) return;
    // 42px 底部「此刻」条 + 约 70px 节点标签空间，避免节点文字压到时间轴
    var graphH = Math.max(140, stageH - 42 - 70);
    var pos = stagePositions(stageW < 560, stageW);
    el.edgeLayer.setAttribute("viewBox", "0 0 " + stageW + " " + stageH);
    var pts = {};
    agents.forEach(function (a) {
      var p = pos[a.id];
      if (!p) return;
      var x = p.x * stageW;
      var y = 10 + p.y * graphH;
      var rec = nodeEls[a.id];
      var r = (rec.btn.offsetHeight || 62) / 2;
      pts[a.id] = { x: x, y: y, r: r };
      rec.root.style.left = x.toFixed(1) + "px";
      rec.root.style.top = (y - r).toFixed(1) + "px";
    });
    if (LEAD && pts[LEAD.id]) {
      el.orbits.style.left = pts[LEAD.id].x.toFixed(1) + "px";
      el.orbits.style.top = pts[LEAD.id].y.toFixed(1) + "px";
    }
    edgeList.forEach(function (edge) {
      var A = pts[edge.def.a];
      var B = pts[edge.def.b];
      if (!A || !B) return;
      var dx = B.x - A.x, dy = B.y - A.y;
      var len = Math.sqrt(dx * dx + dy * dy) || 1;
      var ux = dx / len, uy = dy / len;
      var padA = A.r + 10, padB = B.r + 10;
      var x1 = A.x + ux * padA, y1 = A.y + uy * padA;
      var x2 = B.x - ux * padB, y2 = B.y - uy * padB;
      var mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
      var nx = -uy, ny = ux;
      var bow = edge.def.peer ? 0.2 : 0.085;
      var cx = mx + nx * len * bow * 0.5;
      var cy = my + ny * len * bow * 0.5;
      edge.path.setAttribute("d",
        "M " + x1.toFixed(1) + " " + y1.toFixed(1) +
        " Q " + cx.toFixed(1) + " " + cy.toFixed(1) +
        " " + x2.toFixed(1) + " " + y2.toFixed(1));
      edge.len = edge.path.getTotalLength();
    });
  }

  function rebuildRuler() {
    var w = el.laneTracks.clientWidth;
    var step = w < 380 ? 240 : 120;
    el.laneRuler.innerHTML = "";
    var t = 0;
    while (t <= END) { addTick(t); t += step; }
    if (END % step !== 0) addTick(END);
    function addTick(time) {
      var d = document.createElement("span");
      d.className = "ruler-tick";
      d.style.left = (time / END * 100).toFixed(3) + "%";
      d.textContent = fmt(time);
      el.laneRuler.appendChild(d);
    }
  }

  function rebuildLaneLinks() {
    var tracksBox = el.laneTracks.getBoundingClientRect();
    var w = tracksBox.width;
    var h = tracksBox.height;
    if (!w || !h) return;
    el.laneLinks.setAttribute("viewBox", "0 0 " + w + " " + h);
    el.laneLinks.innerHTML = "";
    laneLinkEls = [];
    var rowY = {};
    agents.forEach(function (a) {
      var row = laneRowEls[a.id];
      if (!row) return;
      var box = row.getBoundingClientRect();
      rowY[a.id] = box.top + box.height / 2 - tracksBox.top;
    });
    MESSAGES.forEach(function (m) {
      var y1 = rowY[m.from], y2 = rowY[m.to];
      if (y1 == null || y2 == null) return;
      var x = m.t / END * w;
      var pathNode = document.createElementNS(NS, "path");
      pathNode.setAttribute("class", "lane-link");
      pathNode.setAttribute("d",
        "M " + x.toFixed(1) + " " + y1.toFixed(1) +
        " C " + (x + 14).toFixed(1) + " " + y1.toFixed(1) +
        ", " + (x + 14).toFixed(1) + " " + y2.toFixed(1) +
        ", " + (x + 3).toFixed(1) + " " + y2.toFixed(1));
      var dot = document.createElementNS(NS, "circle");
      dot.setAttribute("class", "lane-link-dot");
      dot.setAttribute("cx", (x + 3).toFixed(1));
      dot.setAttribute("cy", y2.toFixed(1));
      dot.setAttribute("r", "1.8");
      el.laneLinks.appendChild(pathNode);
      el.laneLinks.appendChild(dot);
      laneLinkEls.push({ msg: m, path: pathNode, dot: dot, visible: null, recent: null });
    });
  }

  function queueLayout() {
    if (resizeQueued) return;
    resizeQueued = true;
    requestAnimationFrame(function () {
      resizeQueued = false;
      layoutStage();
      rebuildRuler();
      rebuildLaneLinks();
      renderAll();
      if (state.playing || state.completed) scrollFeedToLatest();
    });
  }

  /* ------------------------------------------------------------------ selection */
  function selectAgent(id, userInitiated) {
    if (!agentById[id]) return;
    if (userInitiated) setFollow(false);
    if (state.selected === id) {
      forceInspector = true;
      return;
    }
    state.selected = id;
    forceInspector = true;
    updateSelectionClasses();
    renderStage();
    renderTasks();
    renderInspector(true);
  }

  function updateSelectionClasses() {
    el.stage.classList.toggle("has-focus", !!state.focus);
    edgeList.forEach(function (edge) {
      edge.path.classList.toggle("is-connected", edge.def.a === state.selected || edge.def.b === state.selected);
    });
    el.focusBtn.setAttribute("aria-pressed", state.focus ? "true" : "false");
  }

  function setFollow(on) {
    state.follow = !!on;
    el.followBtn.setAttribute("aria-pressed", state.follow ? "true" : "false");
    if (state.follow) {
      var idx = latestEventIndex(state.t);
      if (idx >= 0) selectAgent(EVENTS[idx].actor, false);
    }
  }

  function syncFollow() {
    if (!state.follow) return;
    var idx = latestEventIndex(state.t);
    if (idx < 0) return;
    var actor = EVENTS[idx].actor;
    if (agentById[actor] && actor !== state.selected) selectAgent(actor, false);
  }

  /* ------------------------------------------------------------------ playback */
  function applyPlayState() {
    var playing = state.playing;
    var completed = state.completed;
    if (lastPlaying !== playing || lastCompleted !== completed) {
      lastPlaying = playing;
      lastCompleted = completed;
      el.playIconUse.setAttribute("href", playing ? "#i-pause" : "#i-play");
      el.playLabel.textContent = playing ? "暂停" : (completed ? "重播" : "播放");
      el.playBtn.setAttribute("aria-label",
        playing ? "暂停回放" : (completed ? "重新播放" : "播放回放"));
      el.runState.textContent = completed ? "已完成" : (playing ? "回放中" : (state.t > 0 ? "已暂停" : "待播放"));
      el.app.classList.toggle("is-paused", !playing);
      el.app.classList.toggle("is-complete", !!completed);
    }
  }

  function setPlaying(play) {
    if (play && state.t >= END - 0.001) {
      state.t = 0;
      state.completed = false;
    }
    state.playing = !!play;
    if (!state.playing) state.completed = state.t >= END - 0.001;
    applyPlayState();
  }

  function pause() { setPlaying(false); }

  function togglePlay() {
    if (state.t >= END - 0.001) {
      state.t = 0;
      state.completed = false;
      state.playing = true;
      applyPlayState();
      return;
    }
    setPlaying(!state.playing);
  }

  function seek(t) {
    state.t = clamp(t, 0, END);
    if (state.t >= END - 0.001) {
      state.t = END;
      state.completed = true;
      state.playing = false;
    } else {
      state.completed = false;
    }
    forceInspector = true;
    applyPlayState();
    renderAll();
  }

  function seekFromClientX(clientX) {
    var box = el.laneTracks.getBoundingClientRect();
    var ratio = clamp((clientX - box.left) / box.width, 0, 1);
    seek(ratio * END);
  }

  /* ------------------------------------------------------------------ stage render */
  function renderStage() {
    var t = state.t;
    var connected = connectedSet();
    var alertAgent = blockerActive(t) ? "lens" : null;
    agents.forEach(function (a) {
      var rec = nodeEls[a.id];
      var st = agentStatus(a, t);
      var cur = workAt(a, t);
      var cls = "node is-" + st;
      if (alertAgent === a.id) cls += " is-alert";
      if (state.selected === a.id) cls += " is-selected";
      if (connected[a.id]) cls += " is-connected";
      if (rec.root.className !== cls) rec.root.className = cls;

      var badgeId = st === "active" ? "i-activity" : (st === "done" ? "i-check" : "i-clock");
      if (alertAgent === a.id && st !== "active") badgeId = "i-alert";
      if (rec.badge.__id !== badgeId) {
        rec.badge.__id = badgeId;
        rec.badge.innerHTML = icon(badgeId);
      }

      var activity = cur ? cur.work.activity
        : (st === "done" ? "工作已完成"
          : (st === "waiting" ? (WAIT_ACTIVITY[a.id] || "等待中") : "待命"));
      if (rec.activityText.textContent !== activity) rec.activityText.textContent = activity;
      rec.mini.hidden = st !== "active";

      if (st === "active" && cur) {
        var p = clamp((t - cur.work.s) / (cur.work.e - cur.work.s), 0, 1);
        rec.ringValue.style.strokeDashoffset = (226 * (1 - p)).toFixed(1);
      }

      var press = state.selected === a.id ? "true" : "false";
      if (rec.btn.getAttribute("aria-pressed") !== press) rec.btn.setAttribute("aria-pressed", press);
      var label = a.name + "，" + a.roleCn + "，" + STATUS_TEXT[st] + (cur ? "，" + cur.work.activity : "");
      if (rec.btn.getAttribute("aria-label") !== label) {
        rec.btn.setAttribute("aria-label", label);
        rec.btn.setAttribute("title", label);
      }
    });
    updateHotEdges(t);
    updateParticles(t);
  }

  function updateHotEdges(t) {
    var hot = {};
    MESSAGES.forEach(function (m) {
      if (t >= m.t && t <= m.t + m.travel) {
        hot[edgeKey(m.from, m.to)] = agentById[m.from].color;
      }
    });
    var sig = JSON.stringify(hot);
    if (sig === lastHotSig) return;
    lastHotSig = sig;
    edgeList.forEach(function (edge) {
      var color = hot[edge.key];
      if (color) {
        edge.path.classList.add("is-hot");
        edge.path.style.stroke = color;
        edge.path.style.opacity = "0.72";
      } else {
        edge.path.classList.remove("is-hot");
        edge.path.style.stroke = "";
        edge.path.style.opacity = "";
      }
    });
  }

  function updateParticles(t) {
    particleList.forEach(function (p) {
      var m = p.msg;
      var show = t >= m.t && t <= m.t + m.travel;
      if (p.visible !== show) {
        p.visible = show;
        p.g.style.display = show ? "" : "none";
      }
      if (!show) return;
      var edge = edgeByKey[edgeKey(m.from, m.to)];
      if (!edge || !edge.len) return;
      var ratio = (t - m.t) / m.travel;
      var dist = (m.from === edge.def.a ? ratio : 1 - ratio) * edge.len;
      var pt;
      try { pt = edge.path.getPointAtLength(dist); } catch (err) { return; }
      p.g.setAttribute("transform", "translate(" + pt.x.toFixed(2) + " " + pt.y.toFixed(2) + ")");
    });
  }

  /* ------------------------------------------------------------------ lanes render */
  function renderLanes() {
    var t = state.t;
    segmentEls.forEach(function (seg) {
      var w = seg.work;
      var started = t >= w.s;
      var ended = t >= w.e;
      var p = started ? clamp((t - w.s) / (w.e - w.s), 0, 1) : 0;
      seg.fill.style.width = (p * 100).toFixed(2) + "%";
      var cls = "seg";
      if (seg.agentId === state.selected) cls += " is-selected";
      if (started && !ended) cls += " is-running";
      if (!started) cls += " is-upcoming";
      if (seg.tiny) cls += " is-tiny";
      if (seg.cls !== cls) { seg.cls = cls; seg.el.className = cls; }
    });

    var ratio = t / END;
    el.playhead.style.left = (ratio * 100).toFixed(3) + "%";

    var showBlock = t >= BLOCKER.from;
    if (el.blockerBand.hidden === showBlock) el.blockerBand.hidden = !showBlock;
    if (showBlock) {
      var endT = Math.min(t, BLOCKER.to);
      var left = BLOCKER.from / END * 100;
      var width = Math.max(0.4, (endT - BLOCKER.from) / END * 100);
      el.blockerBand.style.left = left.toFixed(3) + "%";
      el.blockerBand.style.width = width.toFixed(3) + "%";
      var label = t < BLOCKER.to
        ? "阻塞 · " + fmt(t - BLOCKER.from)
        : "阻塞已解除 · " + fmt(BLOCKER.to - BLOCKER.from);
      if (el.blockerLabel.textContent !== label) el.blockerLabel.textContent = label;
    }

    laneLinkEls.forEach(function (link) {
      var visible = t >= link.msg.t;
      if (link.visible !== visible) {
        link.visible = visible;
        link.path.style.display = visible ? "" : "none";
        link.dot.style.display = visible ? "" : "none";
      }
      if (!visible) return;
      var recent = (t - link.msg.t) <= 10;
      if (link.recent !== recent) {
        link.recent = recent;
        link.path.classList.toggle("is-recent", recent);
        link.dot.classList.toggle("is-recent", recent);
      }
    });
  }

  /* ------------------------------------------------------------------ feed */
  function isFeedNearBottom() {
    var node = el.feedScroll;
    return node.scrollHeight - node.scrollTop - node.clientHeight < 36;
  }

  function feedItemEl(ev, animate) {
    var li = document.createElement("li");
    li.className = "feed-item t-" + ev.type;
    if (!animate) li.classList.add("no-anim");
    li.innerHTML =
      '<span class="feed-time">' + fmt(ev.t) + "</span>" +
      '<span class="feed-icon">' + icon(TYPE_ICON[ev.type] || "i-info") + "</span>" +
      '<span class="feed-text">' + spanMeta(ev) + "</span>";
    li.tabIndex = 0;
    li.setAttribute("role", "button");
    li.setAttribute("aria-label", fmt(ev.t) + " " + agentName(ev.actor) + " " + ev.text);
    li.addEventListener("click", function () {
      pause();
      seek(ev.t);
      selectAgent(ev.actor, true);
    });
    li.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); li.click(); }
    });
    return li;
  }

  function rebuildFeed(visible) {
    el.feedList.innerHTML = "";
    renderedEvents = visible;
    if (!visible.length) {
      var empty = document.createElement("li");
      empty.className = "feed-empty";
      empty.textContent = state.filter === "all" ? "回放开始后，事件会在这里出现" : "该类型暂无事件";
      el.feedList.appendChild(empty);
    } else {
      var frag = document.createDocumentFragment();
      visible.forEach(function (ev) { frag.appendChild(feedItemEl(ev, false)); });
      el.feedList.appendChild(frag);
    }
    updateFeedMeta(visible);
    el.feedScroll.scrollTop = el.feedScroll.scrollHeight;
    el.feedJump.hidden = true;
    requestAnimationFrame(function () {
      el.feedScroll.scrollTop = el.feedScroll.scrollHeight;
      el.feedJump.hidden = true;
    });
  }

  function appendFeed(items) {
    if (!items.length) return;
    var near = isFeedNearBottom();
    var frag = document.createDocumentFragment();
    items.forEach(function (ev) { frag.appendChild(feedItemEl(ev, true)); });
    var empty = el.feedList.querySelector(".feed-empty");
    if (empty) empty.parentNode.removeChild(empty);
    el.feedList.appendChild(frag);
    renderedEvents = renderedEvents.concat(items);
    updateFeedMeta(renderedEvents);
    if (near) {
      el.feedScroll.scrollTop = el.feedScroll.scrollHeight;
      el.feedJump.hidden = true;
    } else {
      el.feedJump.hidden = false;
    }
  }

  function updateFeedMeta(visible) {
    var total = EVENTS.filter(matchesFilter).length;
    var text = visible.length + " / " + total;
    if (el.feedCount.textContent !== text) el.feedCount.textContent = text;
  }

  function syncFeed() {
    var visible = currentVisibleEvents();
    var same = visible.length >= renderedEvents.length;
    if (same) {
      for (var i = 0; i < renderedEvents.length; i++) {
        if (visible[i] !== renderedEvents[i]) { same = false; break; }
      }
    }
    if (!same) { rebuildFeed(visible); return; }
    if (visible.length > renderedEvents.length) appendFeed(visible.slice(renderedEvents.length));
    else updateFeedMeta(visible);
  }

  function scrollFeedToLatest() {
    el.feedScroll.scrollTop = el.feedScroll.scrollHeight;
    el.feedJump.hidden = true;
  }

  /* ------------------------------------------------------------------ inspector */
  function renderInspector(force) {
    var now = performance.now();
    if (!force && now - lastInspectorStamp < 160) return;
    lastInspectorStamp = now;
    var t = state.t;
    var a = agentById[state.selected];
    if (!a) return;
    var st = agentStatus(a, t);
    var cur = workAt(a, t);
    var next = null;
    for (var i = 0; i < a.work.length; i++) {
      if (a.work[i].s > t) { next = a.work[i]; break; }
    }
    var involved = EVENTS.filter(function (ev) {
      return ev.t <= t + 0.001 && (ev.actor === a.id || ev.target === a.id);
    });
    var recent = involved.slice(-3).reverse();
    var tools = EVENTS.filter(function (ev) { return ev.type === "tool" && ev.actor === a.id && ev.t <= t + 0.001; });
    var artifacts = EVENTS.filter(function (ev) { return ev.type === "artifact" && ev.actor === a.id && ev.t <= t + 0.001; });
    var msgs = MESSAGES.filter(function (m) { return m.t <= t + 0.001 && (m.from === a.id || m.to === a.id); });
    var owned = TASKS.filter(function (task) { return task.owner === a.id; });
    var doneOwned = owned.filter(function (task) { return t >= task.end; }).length;
    var statusClass = st === "done" ? "is-done" : (st === "active" ? "is-active" : "");
    var statusLabel = STATUS_TEXT[st];
    if (blockerActive(t) && a.id === "lens") {
      statusClass = "is-alert";
      statusLabel = "发现阻塞";
    }

    var html = "";
    html += '<div class="insp-head">';
    html += '<span class="insp-avatar">' + icon(a.icon) + "</span>";
    html += '<div class="insp-id"><div class="insp-name">' + a.name +
      '<span class="role">' + a.roleEn + " · " + a.roleCn + "</span></div>";
    html += '<div class="insp-sub"><span>' + a.model + '</span><span>已活跃 ' + fmt(activeTime(a, t)) + "</span></div></div>";
    html += '<span class="insp-status ' + statusClass + '"><i></i>' + statusLabel + "</span>";
    html += "</div>";

    html += '<div class="insp-stats">';
    html += '<div class="insp-stat"><b>' + tools.length + "</b><span>工具调用</span></div>";
    html += '<div class="insp-stat"><b>' + msgs.length + "</b><span>协作消息</span></div>";
    html += '<div class="insp-stat"><b>' + artifacts.length + "</b><span>产出</span></div>";
    html += "</div>";

    html += '<div class="insp-section"><div class="insp-label"><span>当前工作</span><span>' +
      (cur ? (cur.work.task || "持续中") : "—") + "</span></div>";
    if (cur) {
      var p = clamp((t - cur.work.s) / (cur.work.e - cur.work.s), 0, 1);
      html += '<div class="work-card">';
      html += '<div class="work-title"><span class="dot"></span>' + cur.work.label + "</div>";
      html += '<div class="work-meta"><span>已进行 ' + fmt(t - cur.work.s) + "</span><span>段长 " + fmt(cur.work.e - cur.work.s) + "</span></div>";
      html += '<div class="progress"><span class="progress-fill" style="width:' + (p * 100).toFixed(1) + '%"></span></div>';
      html += "</div>";
    } else if (st === "done") {
      html += '<div class="wait-card">全部工作已完成。<br>最后动作：<b>' +
        (recent[0] ? recent[0].text : "—") + "</b></div>";
    } else {
      html += '<div class="wait-card">' + (WAIT_NOTES[a.id] || "等待中") +
        (next ? '。<br>下一项：<b>' + next.label + "</b> · 预计 " + fmt(next.s) + " 开始" : "") + "</div>";
    }
    html += "</div>";

    html += '<div class="insp-section"><div class="insp-label"><span>最近动作</span><span>' +
      (doneOwned + "/" + owned.length + " 工作项") + "</span></div>";
    if (recent.length) {
      html += '<div class="insp-events">';
      recent.forEach(function (ev) {
        html += '<div class="insp-event" style="--tone:' + (TYPE_TONE[ev.type] || "var(--text-3)") + '">';
        html += '<span class="t">' + fmt(ev.t) + "</span>";
        html += icon(TYPE_ICON[ev.type] || "i-info");
        html += "<span>" + ev.text + "</span>";
        html += "</div>";
      });
      html += "</div>";
    } else {
      html += '<div class="empty-note">尚未产生可直接观察的动作。</div>';
    }
    html += "</div>";

    if (artifacts.length) {
      html += '<div class="insp-section"><div class="insp-label"><span>产出</span><span>' + artifacts.length + "</span></div>";
      html += '<div class="artifacts">';
      artifacts.forEach(function (ev) {
        html += '<div class="artifact">' + icon("i-file") + "<span>" + ev.text + '</span><span class="t">' + fmt(ev.t) + "</span></div>";
      });
      html += "</div></div>";
    }

    el.inspector.style.setProperty("--c", a.color);
    var inspectorScroll = el.inspector.scrollTop;
    el.inspector.innerHTML = html;
    /* 保留检视面板滚动位置；renderInspector 每帧重写 innerHTML 会把它拉回顶部 */
    el.inspector.scrollTop = inspectorScroll;
  }

  /* ------------------------------------------------------------------ metrics */
  function renderMetrics() {
    var t = state.t;
    var progress = overallProgress(t);
    el.goalRing.style.strokeDashoffset = (188.5 * (1 - progress)).toFixed(1);
    var pctText = pct(progress);
    if (el.goalPct.__v !== pctText) {
      el.goalPct.__v = pctText;
      el.goalPct.innerHTML = pctText + '<span class="pct-sign">%</span>';
    }
    el.goalElapsed.textContent = fmt(t);
    el.goalEta.textContent = fmt(END);

    var activeCount = agents.filter(function (a) { return agentStatus(a, t) === "active"; }).length;
    var doneCount = TASKS.filter(function (task) { return t >= task.end; }).length;
    var toolCount = EVENTS.filter(function (ev) { return ev.type === "tool" && ev.t <= t + 0.001; }).length;
    var blocked = blockerActive(t) ? 1 : 0;

    setHTML(el.statActive, activeCount + "<i>/" + agents.length + "</i>");
    setHTML(el.statDone, doneCount + "<i>/" + TASKS.length + "</i>");
    setText(el.statCalls, String(toolCount));
    setText(el.statBlocked, String(blocked));
    el.statBlockedCell.classList.toggle("is-danger", !!blocked);
    setText(el.taskCount, doneCount + "/" + TASKS.length);

    if (lastTimeText !== fmt(t)) {
      lastTimeText = fmt(t);
      el.timeNow.textContent = lastTimeText;
      el.laneTime.textContent = lastTimeText;
      el.nowTime.textContent = lastTimeText;
      el.scrubInput.value = String(Math.round(t));
      el.scrubInput.setAttribute("aria-valuetext", lastTimeText);
    }

    renderTasks();
    renderNow();
  }

  function renderTasks() {
    var t = state.t;
    TASKS.forEach(function (task) {
      var item = taskEls[task.id];
      if (!item) return;
      var st = taskStatus(task, t);
      var cls = "task-item is-" + st;
      if (task.owner === state.selected && st === "running") cls += " is-selected";
      if (item.cls !== cls) { item.cls = cls; item.root.className = cls; }
      var iconId = st === "done" ? "i-check"
        : st === "running" ? "i-activity"
        : (st === "alert" || st === "blocked") ? "i-alert" : "i-clock";
      if (item.iconId !== iconId) { item.iconId = iconId; item.icon.innerHTML = icon(iconId); }
      var tail;
      if (st === "done") tail = fmt(task.end - task.start);
      else if (st === "running") tail = pct((t - task.start) / (task.end - task.start)) + "%";
      else if (st === "blocked") tail = "受阻";
      else if (st === "alert") tail = "发现问题";
      else tail = "等待";
      if (item.tailTxt !== tail) { item.tailTxt = tail; item.tail.textContent = tail; }
    });
  }

  function renderNow() {
    var idx = latestEventIndex(state.t);
    if (idx === lastNowIdx) return;
    lastNowIdx = idx;
    if (idx < 0) {
      el.nowText.textContent = "等待开始";
      return;
    }
    var ev = EVENTS[idx];
    var temp = document.createElement("span");
    temp.innerHTML = spanMeta(ev);
    el.nowText.innerHTML = temp.innerHTML;
  }

  function setText(node, text) { if (node.textContent !== text) node.textContent = text; }
  function setHTML(node, text) { if (node.__html !== text) { node.__html = text; node.innerHTML = text; } }

  function renderAll() {
    renderStage();
    renderLanes();
    syncFeed();
    renderMetrics();
    renderInspector(true);
    renderNow();
  }

  /* ------------------------------------------------------------------ loop */
  function frame(ts) {
    var dt = frame.last ? Math.min(0.06, (ts - frame.last) / 1000) : 0;
    frame.last = ts;
    if (state.playing) {
      state.t += dt * RATE * state.speed;
      if (state.t >= END) {
        state.t = END;
        state.playing = false;
        state.completed = true;
        applyPlayState();
      }
    }
    syncFollow();
    renderStage();
    renderLanes();
    syncFeed();
    if (ts - lastUiStamp > 100) {
      lastUiStamp = ts;
      renderMetrics();
    }
    if (forceInspector || ts - lastInspectorStamp > 160) {
      forceInspector = false;
      renderInspector(true);
    }
    requestAnimationFrame(frame);
  }

  /* ------------------------------------------------------------------ interactions */
  function bindControls() {
    el.playBtn.addEventListener("click", togglePlay);
    el.restartBtn.addEventListener("click", function () {
      seek(0);
      setPlaying(true);
    });
    el.helpBtn.addEventListener("click", function () { openHelp(); });
    $$(".speed-btn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        state.speed = parseFloat(btn.dataset.speed) || 1;
        $$(".speed-btn").forEach(function (x) {
          x.setAttribute("aria-pressed", x === btn ? "true" : "false");
        });
      });
    });
    el.focusBtn.addEventListener("click", function () {
      state.focus = !state.focus;
      updateSelectionClasses();
    });
    el.followBtn.addEventListener("click", function () { setFollow(!state.follow); });

    el.scrubInput.addEventListener("input", function () {
      pause();
      seek(parseFloat(el.scrubInput.value) || 0);
    });

    var scrubbing = false;
    el.laneTracks.addEventListener("pointerdown", function (e) {
      if (e.button !== 0) return;
      var seg = e.target.closest ? e.target.closest(".seg") : null;
      scrubbing = true;
      pause();
      try { el.laneTracks.setPointerCapture(e.pointerId); } catch (err) {}
      seekFromClientX(e.clientX);
      if (seg) selectAgent(seg.dataset.agent, true);
      e.preventDefault();
    });
    el.laneTracks.addEventListener("pointermove", function (e) {
      if (!scrubbing) return;
      seekFromClientX(e.clientX);
    });
    el.laneTracks.addEventListener("pointerup", function () { scrubbing = false; });
    el.laneTracks.addEventListener("pointercancel", function () { scrubbing = false; });

    el.feedScroll.addEventListener("scroll", function () {
      el.feedJump.hidden = isFeedNearBottom() || renderedEvents.length === 0;
    });
    el.feedJump.addEventListener("click", scrollFeedToLatest);

    el.helpDialog.addEventListener("click", function (e) {
      if (e.target === el.helpDialog) el.helpDialog.close();
    });
    $$("[data-close]", el.helpDialog).forEach(function (btn) {
      btn.addEventListener("click", function () { el.helpDialog.close(); });
    });

    document.addEventListener("keydown", onKeydown);

    window.addEventListener("resize", queueLayout);
    var ro = new ResizeObserver(queueLayout);
    ro.observe(el.stage);
    ro.observe(el.laneTracks);
  }

  function openHelp() {
    if (typeof el.helpDialog.showModal === "function") el.helpDialog.showModal();
    else el.helpDialog.setAttribute("open", "");
  }

  function onKeydown(e) {
    var tag = (e.target.tagName || "").toLowerCase();
    if (tag === "input" || tag === "textarea" || tag === "select" || e.target.isContentEditable) return;
    if (el.helpDialog.open) {
      if (e.key === "Escape") el.helpDialog.close();
      return;
    }
    var key = e.key;
    if (key === " " || key === "Spacebar" || e.code === "Space") {
      e.preventDefault();
      togglePlay();
    } else if (key === "ArrowLeft" || key === "ArrowRight") {
      e.preventDefault();
      pause();
      var delta = (e.shiftKey ? 60 : 10) * (key === "ArrowLeft" ? -1 : 1);
      seek(state.t + delta);
    } else if (key === "Home") {
      e.preventDefault();
      pause();
      seek(0);
    } else if (key === "End") {
      e.preventDefault();
      pause();
      seek(END);
    } else if (key === "r" || key === "R") {
      seek(0);
      setPlaying(true);
    } else if (key === "1" || key === "2" || key === "4") {
      state.speed = parseFloat(key);
      $$(".speed-btn").forEach(function (x) {
        x.setAttribute("aria-pressed", x.dataset.speed === key ? "true" : "false");
      });
    } else if (key === "f" || key === "F") {
      state.focus = !state.focus;
      updateSelectionClasses();
    } else if (key === "g" || key === "G") {
      setFollow(!state.follow);
    } else if (key === "?" || (key === "/" && e.shiftKey)) {
      openHelp();
    }
  }

  function scheduleTip() {
    el.tipToast.textContent = window.innerWidth < 760
      ? "点击节点检视 · 拖动时间轴回看"
      : "空格播放 / 暂停 · 点击节点检视 · 拖动泳道回看";
    window.setTimeout(function () {
      el.tipToast.classList.add("is-visible");
    }, 1000);
    window.setTimeout(function () {
      el.tipToast.classList.remove("is-visible");
    }, 8000);
    var hide = function () { el.tipToast.classList.remove("is-visible"); };
    window.addEventListener("pointerdown", hide, { once: true });
  }

  function hydrateStatic() {
    el.runId.textContent = META.runId;
    el.runGoalShort.textContent = META.shortGoal;
    el.runStarted.textContent = META.startedAt + " 启动";
    el.goalTitle.textContent = META.goal;
    el.goalProject.textContent = META.project;
    el.goalBranch.textContent = META.branch;
    el.timeTotal.textContent = fmt(END);
    el.goalEta.textContent = fmt(END);
    /* [EMBED] 不在这里把 elapsed 归零：reload 保留 state.t，归零会造成闪帧 */
    el.scrubInput.setAttribute("max", String(END));
    el.scrubInput.setAttribute("aria-valuemax", String(END));
    el.scrubInput.setAttribute("aria-valuenow", "0");
    el.scrubInput.setAttribute("aria-valuetext", "00:00");
    el.orbits.style.left = "50%";
    el.orbits.style.top = "44%";
  }

  function init() {
    cacheEls();
    el.app.classList.toggle("agents-many", agents.length > 5);
    el.app.classList.toggle("agents-crowded", agents.length > 7);
    el.app.classList.toggle("agents-swarm", agents.length > 9);
    el.app.classList.toggle("agents-hive", agents.length > 11);
    hydrateStatic();
    buildNodes();
    buildEdges();
    buildParticles();
    buildLanes();
    buildTasks();
    buildFilters();
    layoutStage();
    rebuildRuler();
    rebuildLaneLinks();
    bindControls();
    updateSelectionClasses();
    setFollow(true);
    applyPlayState();
    renderAll();
    if (state.playing) applyPlayState();
    requestAnimationFrame(frame);
    scheduleTip();
    window.WEAVE_DEBUG = {
      state: state,
      seek: seek,
      play: function () { setPlaying(true); },
      pause: pause,
      data: DATA
    };
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
