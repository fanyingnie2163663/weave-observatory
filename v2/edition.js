/* Weave · Silk Edition — interaction chrome layered over ../app.js */
(function () {
  "use strict";

  var SEALS = { atlas: "编", scout: "研", forge: "造", lens: "审", quill: "撰" };
  var SEAL_POOL = ["策", "纲", "测", "记", "译", "衡", "集", "验", "构", "勘"];

  var sealAssignments = null;
  function ensureSeals() {
    if (sealAssignments) return;
    sealAssignments = {};
    var used = {};
    (DATA.agents || []).forEach(function (a) {
      if (SEALS[a.id]) { sealAssignments[a.id] = SEALS[a.id]; used[SEALS[a.id]] = true; }
    });
    (DATA.agents || []).forEach(function (a, i) {
      if (sealAssignments[a.id]) return;
      var ch = a.seal || (a.roleCn ? a.roleCn.charAt(0) : "");
      /* 数据侧给的朱印优先（子代理用天罡三十六星字，主代理用「编」） */
      if (!ch || used[ch]) {
        ch = "";
        for (var j = 0; j < SEAL_POOL.length; j++) {
          if (!used[SEAL_POOL[j]]) { ch = SEAL_POOL[j]; break; }
        }
      }
      if (!ch) ch = String.fromCharCode(0x4e00 + ((i * 37) % 180));
      sealAssignments[a.id] = ch;
      used[ch] = true;
    });
  }
  function sealFor(agent, index) {
    ensureSeals();
    return agent && sealAssignments[agent.id] ? sealAssignments[agent.id] : "";
  }

  function agentById(id) {
    return (DATA.agents || []).filter(function (a) { return a.id === id; })[0] || null;
  }
  var DATA = window.WEAVE_DATA || { agents: [], tasks: [], meta: { duration: 700 } };
  var END = (DATA.meta && DATA.meta.duration) || 700;

  /* 真实 token：优先使用 WEAVE_DATA.meta.tokens.segments（会话投影），
     仅原型演示数据没有该字段时退回模拟模型。真实值按工作段时长分摊，
     这样时间轴上的累计曲线仍然成立，但总量与来源真实。 */
  function realTokenTotal(agent) {
    var segs = DATA.meta && DATA.meta.tokens && DATA.meta.tokens.segments;
    if (!segs || typeof segs !== "object") return null;
    var arr = segs[agent.id];
    if (!Array.isArray(arr)) return null;
    var total = 0;
    for (var i = 0; i < arr.length; i++) {
      var value = Number(arr[i]);
      if (Number.isFinite(value) && value > 0) total += value;
    }
    return total;
  }

  /* 模拟的 token 消耗模型：与 agents[].work 的工作段一一对应 */
  var TOKEN_SEGMENTS = {
    atlas: [12400, 84000, 256000, 46000, 188000, 74000],
    scout: [146000, 62000, 28000],
    forge: [312000, 96000, 34000],
    lens: [118000, 52000],
    quill: [96000, 18000, 74000]
  };

  function fmtTok(n) {
    if (n >= 1000000) return (n / 1000000).toFixed(2) + "M";
    if (n >= 1000) return Math.round(n / 1000) + "k";
    return String(Math.round(n));
  }

  var generatedTokens = {};
  function tokenSegmentsFor(agent) {
    if (!agent) return [];
    var real = realTokenTotal(agent);
    if (real !== null) {
      var work = agent.work || [];
      if (!work.length) return [real];
      var weights = work.map(function (w) { return Math.max(1, w.e - w.s); });
      var weightSum = weights.reduce(function (a, b) { return a + b; }, 0) || 1;
      return weights.map(function (w) { return real * w / weightSum; });
    }
    if (TOKEN_SEGMENTS[agent.id]) return TOKEN_SEGMENTS[agent.id];
    if (generatedTokens[agent.id]) return generatedTokens[agent.id];
    var hash = 0;
    String(agent.id).split("").forEach(function (ch) { hash = (hash * 31 + ch.charCodeAt(0)) % 997; });
    var arr = (agent.work || []).map(function (w, i) {
      var rate = 620 + ((hash + i * 137) % 320);
      return Math.round((w.e - w.s) * rate);
    });
    generatedTokens[agent.id] = arr;
    return arr;
  }

  function tokenUsage(t) {
    var per = {};
    var total = 0;
    (DATA.agents || []).forEach(function (agent) {
      var arr = tokenSegmentsFor(agent);
      var sum = 0;
      (agent.work || []).forEach(function (w, i) {
        var tok = arr[i] || 0;
        if (t >= w.e) sum += tok;
        else if (t > w.s) sum += tok * (t - w.s) / (w.e - w.s);
      });
      per[agent.id] = sum;
      total += sum;
    });
    return { per: per, total: total };
  }

  function setText(id, text) {
    var el = document.getElementById(id);
    if (el && el.textContent !== text) el.textContent = text;
  }

  var lastTokenTick = 0;
  function syncTokens() {
    var now = performance.now();
    if (now - lastTokenTick < 140) return;
    lastTokenTick = now;
    var state = window.WEAVE_DEBUG && window.WEAVE_DEBUG.state;
    if (!state) return;
    var usage = tokenUsage(state.t);
    var totalText = fmtTok(usage.total);
    setText("tokenHead", totalText);
    setText("wcToken", totalText + " TOK");
    var head = document.getElementById("tokenHead");
    var real = !!(DATA.meta && DATA.meta.tokens && DATA.meta.tokens.simulated !== true);
    if (head) head.setAttribute("title", Math.round(usage.total).toLocaleString() + (real ? " tokens（来自会话投影）" : " tokens（模拟）"));
    var selected = state.selected;
    var agentTok = usage.per[selected] || 0;
    setText("agentToken", fmtTok(agentTok));
    var share = usage.total > 0 ? Math.round(agentTok / usage.total * 100) : 0;
    setText("agentTokenShare", "占全局 " + share + "%");
    var bar = document.getElementById("agentTokenBar");
    if (bar) bar.style.width = share + "%";
  }

  function decorateTokenLabels() {
    document.querySelectorAll(".seg[data-agent]").forEach(function (seg) {
      var id = seg.getAttribute("data-agent");
      var idx = parseInt(seg.getAttribute("data-index"), 10);
      var agent = agentById(id);
      var tok = tokenSegmentsFor(agent)[idx];
      if (!tok) return;
      var base = seg.getAttribute("title") || "";
      if (base.indexOf("tok") >= 0) return;
      seg.setAttribute("title", base + " · " + fmtTok(tok) + " tok");
    });
    document.querySelectorAll(".lane-label").forEach(function (label, i) {
      var agentId = label.getAttribute("data-agent");
      var agent = agentId ? agentById(agentId) : (DATA.agents || [])[i];
      if (!agent) return;
      var arr = tokenSegmentsFor(agent);
      var sum = arr.reduce(function (a, b) { return a + b; }, 0);
      label.setAttribute("title", agent.name + " · 全程 " + fmtTok(sum) + " tokens");
    });
  }

  var EDGE_PAIRS = [];
  function readEdgePairs() {
    if (window.WEAVE_EDGES && window.WEAVE_EDGES.length) {
      EDGE_PAIRS = window.WEAVE_EDGES.map(function (e) { return [e.a, e.b]; });
    } else {
      EDGE_PAIRS = [];
    }
  }
  var hoverPair = null;
  var WEAVE_KEY = "weave.v2.weave";
  var LEFT_KEY = "weave.v2.left";
  var RIGHT_KEY = "weave.v2.right";

  function store(key, value) {
    try { window.localStorage.setItem(key, value); } catch (e) {}
  }
  function readStore(key) {
    try { return window.localStorage.getItem(key); } catch (e) { return null; }
  }
  function fmt(sec) {
    sec = Math.max(0, Math.min(END, Math.round(sec)));
    var m = Math.floor(sec / 60);
    var s = sec % 60;
    return (m < 10 ? "0" + m : "" + m) + ":" + (s < 10 ? "0" + s : "" + s);
  }
  function agentSeal(id) { return SEALS[id] || ""; }
  function agentColor(id) {
    var found = (DATA.agents || []).filter(function (a) { return a.id === id; })[0];
    return found ? found.color : "#6b6150";
  }

  /* ---------------------------------------------------------- node decor */

  function decorateNodes() {
    document.querySelectorAll(".node[data-agent]").forEach(function (node) {
      var id = node.getAttribute("data-agent");
      var btn = node.querySelector(".node-btn");
      var agent = agentById(id);
      if (btn) btn.setAttribute("data-seal", sealFor(agent, (DATA.agents || []).indexOf(agent)));
      var role = node.querySelector(".node-role");
      if (role && agent && agent.roleCn) role.textContent = agent.roleCn;
    });
  }

  function decorateInspector() {
    var insp = document.getElementById("inspector");
    if (!insp) return;
    var nameEl = insp.querySelector(".insp-name");
    var avatar = insp.querySelector(".insp-avatar");
    if (!nameEl || !avatar) return;
    var text = nameEl.textContent || "";
    var agent = (DATA.agents || []).filter(function (a) { return text.indexOf(a.name) === 0; })[0];
    if (agent) avatar.setAttribute("data-seal", sealFor(agent, (DATA.agents || []).indexOf(agent)));
    insp.querySelectorAll(".insp-section").forEach(function (sec) {
      sec.classList.toggle("insp-section--recent", !!sec.querySelector(".insp-events"));
      sec.classList.toggle("insp-section--artifacts", !!sec.querySelector(".artifacts"));
    });
  }

  /* ---------------------------------------------------------- weave fold */

  function setupWeave() {
    var plate = document.querySelector(".plate-weave");
    var toggle = document.getElementById("weaveToggle");
    if (!plate || !toggle) return;

    var stored = readStore(WEAVE_KEY);
    // 默认收起：一根进度条；展开态由用户点击「展开织带」或按 T 决定并记忆
    var open = stored ? stored === "open" : false;

    function apply(next, persist) {
      open = !!next;
      plate.classList.toggle("is-collapsed", !open);
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
      var label = toggle.querySelector("span");
      if (label) label.textContent = open ? "收起织带" : "展开织带";
      toggle.setAttribute("title", open ? "收起完整织带（T）" : "展开完整织带（T）");
      if (persist) store(WEAVE_KEY, open ? "open" : "closed");
      // 让 app.js 的舞台布局与泳道连线重新测量
      requestAnimationFrame(function () { window.dispatchEvent(new Event("resize")); });
      updateCompact(true);
    }

    toggle.addEventListener("click", function () { apply(!open, true); });

    /* compact progress bar */
    var fill = document.getElementById("wcFill");
    var head = document.getElementById("wcHead");
    var ticks = document.getElementById("wcTicks");
    var track = document.getElementById("wcTrack");
    var timeEl = document.getElementById("wcTime");
    var statEl = document.getElementById("wcStat");

    if (ticks) {
      ticks.innerHTML = "";
      (DATA.tasks || []).forEach(function (task) {
        var i = document.createElement("i");
        i.style.left = (task.start / END * 100).toFixed(3) + "%";
        i.style.setProperty("--c", agentColor(task.owner));
        ticks.appendChild(i);
      });
    }

    var lastT = -1;
    function updateCompact(force) {
      if (open) return; // 收起时（compact 可见）才更新
      var state = window.WEAVE_DEBUG && window.WEAVE_DEBUG.state;
      var t = state ? state.t : 0;
      if (!force && Math.abs(t - lastT) < 0.2) return;
      lastT = t;
      var pct = Math.max(0, Math.min(1, t / END));
      if (fill) fill.style.width = (pct * 100).toFixed(2) + "%";
      if (head) head.style.left = (pct * 100).toFixed(2) + "%";
      if (timeEl) timeEl.textContent = fmt(t);
      var done = (DATA.tasks || []).filter(function (task) { return t >= task.end; }).length;
      if (statEl) statEl.textContent = done + " / " + (DATA.tasks || []).length + " 完成";
      if (track) {
        track.setAttribute("aria-valuenow", String(Math.round(t)));
        track.setAttribute("aria-valuetext", fmt(t));
      }
    }

    if (track) {
      var dragging = false;
      function seekFromX(clientX) {
        var box = track.getBoundingClientRect();
        var ratio = Math.max(0, Math.min(1, (clientX - box.left) / box.width));
        if (window.WEAVE_LIVE && window.WEAVE_LIVE.isLive()) {
          window.WEAVE_LIVE.seekTo(ratio * END);
          return;
        }
        if (window.WEAVE_DEBUG) {
          window.WEAVE_DEBUG.pause();
          window.WEAVE_DEBUG.seek(ratio * END);
        }
      }
      track.addEventListener("pointerdown", function (e) {
        if (e.button !== 0) return;
        dragging = true;
        try { track.setPointerCapture(e.pointerId); } catch (err) {}
        seekFromX(e.clientX);
        e.preventDefault();
      });
      track.addEventListener("pointermove", function (e) {
        if (!dragging) return;
        seekFromX(e.clientX);
      });
      track.addEventListener("pointerup", function () { dragging = false; });
      track.addEventListener("pointercancel", function () { dragging = false; });
      track.addEventListener("keydown", function (e) {
        var t = window.WEAVE_DEBUG ? window.WEAVE_DEBUG.state.t : 0;
        var next = null;
        if (e.key === "ArrowLeft") next = t - 10;
        else if (e.key === "ArrowRight") next = t + 10;
        else if (e.key === "Home") next = 0;
        else if (e.key === "End") next = END;
        if (next !== null) {
          e.preventDefault();
          if (window.WEAVE_LIVE && window.WEAVE_LIVE.isLive()) {
            if (e.key === "End") window.WEAVE_LIVE.returnLive();
            else window.WEAVE_LIVE.seekTo(next);
            return;
          }
          window.WEAVE_DEBUG.pause();
          window.WEAVE_DEBUG.seek(next);
        }
      });
    }

    (function raf() {
      updateCompact(false);
      syncTokens();
      requestAnimationFrame(raf);
    })();

    apply(open, false);

    document.addEventListener("keydown", function (e) {
      var tag = (e.target.tagName || "").toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select" || e.target.isContentEditable) return;
      var dialog = document.getElementById("helpDialog");
      if (dialog && dialog.open) return;
      if (e.key === "t" || e.key === "T") {
        e.preventDefault();
        apply(!open, true);
      }
    });
  }

  /* ---------------------------------------------------------- resizable rails */

  function setupSplitters() {
    var ws = document.querySelector(".workspace");
    var left = document.getElementById("splitLeft");
    var right = document.getElementById("splitRight");
    if (!ws || !left || !right) return;

    var MIN_LEFT = 196, MAX_LEFT = 430;
    var MIN_RIGHT = 248, MAX_RIGHT = 470;
    var MIN_CENTER = 360;
    var SPLITTERS = 20;

    function cssWidth(prop) {
      var v = getComputedStyle(ws).getPropertyValue(prop).trim();
      return parseFloat(v) || 0;
    }
    function bounds(which) {
      var total = ws.clientWidth - SPLITTERS;
      var lw = cssWidth("--left-w");
      var rw = cssWidth("--right-w");
      if (which === "left") {
        var max = Math.min(MAX_LEFT, total - MIN_CENTER - rw);
        left.setAttribute("aria-valuemin", String(MIN_LEFT));
        left.setAttribute("aria-valuemax", String(Math.max(MIN_LEFT, Math.round(max))));
        left.setAttribute("aria-valuenow", String(Math.round(lw)));
      } else {
        var max2 = Math.min(MAX_RIGHT, total - MIN_CENTER - lw);
        right.setAttribute("aria-valuemin", String(MIN_RIGHT));
        right.setAttribute("aria-valuemax", String(Math.max(MIN_RIGHT, Math.round(max2))));
        right.setAttribute("aria-valuenow", String(Math.round(rw)));
      }
    }
    function clampSide(which, value) {
      var total = ws.clientWidth - SPLITTERS;
      var lw = which === "left" ? value : cssWidth("--left-w");
      var rw = which === "right" ? value : cssWidth("--right-w");
      // 先保证中心区，再夹在自身范围内
      var others = which === "left" ? rw : lw;
      var max = Math.min(which === "left" ? MAX_LEFT : MAX_RIGHT, total - MIN_CENTER - others);
      var min = which === "left" ? MIN_LEFT : MIN_RIGHT;
      return Math.max(min, Math.min(Math.max(min, max), value));
    }
    function applyWidth(which, value, persist) {
      ws.style.setProperty(which === "left" ? "--left-w" : "--right-w", Math.round(value) + "px");
      if (persist) store(which === "left" ? LEFT_KEY : RIGHT_KEY, String(Math.round(value)));
      bounds("left");
      bounds("right");
      requestAnimationFrame(function () { window.dispatchEvent(new Event("resize")); });
    }
    function reset(which) {
      ws.style.removeProperty(which === "left" ? "--left-w" : "--right-w");
      try { window.localStorage.removeItem(which === "left" ? LEFT_KEY : RIGHT_KEY); } catch (e) {}
      bounds("left");
      bounds("right");
      requestAnimationFrame(function () { window.dispatchEvent(new Event("resize")); });
    }

    // restore persisted widths
    var savedLeft = readStore(LEFT_KEY);
    var savedRight = readStore(RIGHT_KEY);
    if (savedLeft) ws.style.setProperty("--left-w", parseFloat(savedLeft) + "px");
    if (savedRight) ws.style.setProperty("--right-w", parseFloat(savedRight) + "px");
    bounds("left");
    bounds("right");

    var resizeTotal = function () { bounds("left"); bounds("right"); };
    window.addEventListener("resize", resizeTotal);

    var drag = null;
    function onDown(e, which) {
      if (e.button !== 0) return;
      drag = {
        which: which,
        x: e.clientX,
        left: cssWidth("--left-w"),
        right: cssWidth("--right-w")
      };
      (which === "left" ? left : right).classList.add("is-active");
      document.body.classList.add("is-resizing");
      e.preventDefault();
    }
    function onMove(e) {
      if (!drag) return;
      var dx = e.clientX - drag.x;
      if (drag.which === "left") applyWidth("left", clampSide("left", drag.left + dx), false);
      else applyWidth("right", clampSide("right", drag.right - dx), false);
    }
    function onUp() {
      if (!drag) return;
      var target = drag.which === "left" ? left : right;
      target.classList.remove("is-active");
      document.body.classList.remove("is-resizing");
      var value = cssWidth(drag.which === "left" ? "--left-w" : "--right-w");
      store(drag.which === "left" ? LEFT_KEY : RIGHT_KEY, String(Math.round(value)));
      drag = null;
    }
    left.addEventListener("pointerdown", function (e) { onDown(e, "left"); try { left.setPointerCapture(e.pointerId); } catch (err) {} });
    right.addEventListener("pointerdown", function (e) { onDown(e, "right"); try { right.setPointerCapture(e.pointerId); } catch (err) {} });
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);

    left.addEventListener("dblclick", function () { reset("left"); });
    right.addEventListener("dblclick", function () { reset("right"); });

    function keyHandle(which, e) {
      var delta = e.shiftKey ? 32 : 8;
      var two = which === "left" ? 1 : -1;
      var base = cssWidth(which === "left" ? "--left-w" : "--right-w");
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault();
        var step = (e.key === "ArrowLeft" ? -1 : 1) * delta * (which === "left" ? 1 : -1) * two;
        // simplify: left handle: left arrow narrows, right arrow widens
        var next = which === "left"
          ? base + (e.key === "ArrowLeft" ? -delta : delta)
          : base + (e.key === "ArrowLeft" ? delta : -delta);
        applyWidth(which, clampSide(which, next), true);
      } else if (e.key === "Home") {
        e.preventDefault();
        reset(which);
      }
    }
    left.addEventListener("keydown", function (e) { keyHandle("left", e); });
    right.addEventListener("keydown", function (e) { keyHandle("right", e); });
  }

  /* ---------------------------------------------------------- edge ↔ weave hover */

  function setupEdgeHover() {
    var layer = document.getElementById("edgeLayer");
    if (!layer) return;
    var SVGNS = "http://www.w3.org/2000/svg";
    var PAIRS = EDGE_PAIRS;
    var messages = (DATA.messages || []).slice().sort(function (a, b) { return a.t - b.t; });

    function key(a, b) { return a < b ? a + "|" + b : b + "|" + a; }
    function pairOfMsg(m) { return key(m.from, m.to); }
    function pairLabel(pair) {
      var ids = pair.split("|");
      return ids.map(function (id) {
        var a = (DATA.agents || []).filter(function (x) { return x.id === id; })[0];
        return a ? a.name : id;
      }).join(" ⇄ ");
    }

    var hits = [];
    var activePair = null;

    function clearHover() {
      document.querySelectorAll(".is-edge-hover").forEach(function (el) { el.classList.remove("is-edge-hover"); });
      var stage = document.getElementById("stage");
      if (stage) stage.classList.remove("has-edge-hover");
      var plate = document.querySelector(".plate-weave");
      if (plate) plate.classList.remove("is-edge-focus");
      var wcEdge = document.getElementById("wcEdge");
      if (wcEdge) wcEdge.innerHTML = "";
      var laneMarks = document.getElementById("laneEdgeMarks");
      if (laneMarks) laneMarks.innerHTML = "";
      activePair = null;
      hoverPair = null;
    }

    function applyHover(pair) {
      if (activePair === pair) return;
      clearHover();
      activePair = pair;
      hoverPair = pair;
      if (!pair) return;

      var ids = pair.split("|");
      var stage = document.getElementById("stage");
      if (stage) stage.classList.add("has-edge-hover");
      var plate = document.querySelector(".plate-weave");
      if (plate) plate.classList.add("is-edge-focus");

      // 1. the thread itself
      hits.forEach(function (rec) {
        if (rec.pair === pair) rec.path.classList.add("is-edge-hover");
      });

      // 2. agent seals; segments / labels are synced by syncTimelineState()
      ids.forEach(function (id) {
        var node = document.querySelector('.node[data-agent="' + id + '"]');
        if (node) node.classList.add("is-edge-hover");
      });

      // 3. expanded weave: the message threads between this pair
      var paths = document.querySelectorAll("#laneLinks .lane-link");
      var dots = document.querySelectorAll("#laneLinks .lane-link-dot");
      messages.forEach(function (m, i) {
        if (pairOfMsg(m) !== pair) return;
        if (paths[i]) paths[i].classList.add("is-edge-hover");
        if (dots[i]) dots[i].classList.add("is-edge-hover");
      });

      // 4. collapsed weave: light up exact message moments on the one-line progress
      var times = messages.filter(function (m) { return pairOfMsg(m) === pair; }).map(function (m) { return m.t; });
      var wcEdge = document.getElementById("wcEdge");
      if (wcEdge) {
        wcEdge.innerHTML = "";
        (DATA.agents || []).forEach(function (agent) {
          if (ids.indexOf(agent.id) < 0) return;
          (agent.work || []).forEach(function (w) {
            var band = document.createElement("span");
            band.className = "wc-edge-work";
            band.style.left = (w.s / END * 100).toFixed(3) + "%";
            band.style.width = ((w.e - w.s) / END * 100).toFixed(3) + "%";
            band.style.setProperty("--c", agent.color);
            wcEdge.appendChild(band);
          });
        });
        times.forEach(function (t) {
          var mark = document.createElement("span");
          mark.className = "wc-edge-mark";
          mark.style.left = (t / END * 100).toFixed(3) + "%";
          wcEdge.appendChild(mark);
        });
        var head = document.getElementById("wcHead");
        if (head) head.setAttribute("title", pairLabel(pair));
      }

      // 5. expanded weave: vertical time marks across all lanes
      var laneMarks = document.getElementById("laneEdgeMarks");
      if (laneMarks) {
        laneMarks.innerHTML = "";
        times.forEach(function (t) {
          var mark = document.createElement("span");
          mark.className = "lane-edge-mark";
          mark.style.left = (t / END * 100).toFixed(3) + "%";
          laneMarks.appendChild(mark);
        });
      }
    }

    var lastBandSel = null;
    function renderSelectedBands(selected) {
      if (lastBandSel === selected) return;
      lastBandSel = selected;
      var box = document.getElementById("wcSelected");
      if (!box) return;
      box.innerHTML = "";
      if (!selected) return;
      var agent = (DATA.agents || []).filter(function (a) { return a.id === selected; })[0];
      if (!agent) return;
      (agent.work || []).forEach(function (w) {
        var band = document.createElement("span");
        band.className = "wc-selected-seg";
        band.style.left = (w.s / END * 100).toFixed(3) + "%";
        band.style.width = ((w.e - w.s) / END * 100).toFixed(3) + "%";
        band.style.setProperty("--c", agent.color);
        box.appendChild(band);
      });
    }

    function syncTimelineState() {
      var state = window.WEAVE_DEBUG && window.WEAVE_DEBUG.state;
      if (!state) return;
      var selected = state.selected;
      var focus = state.focus;
      var connected = {};
      if (selected) {
        connected[selected] = true;
        EDGE_PAIRS.forEach(function (pair) {
          if (pair[0] === selected) connected[pair[1]] = true;
          if (pair[1] === selected) connected[pair[0]] = true;
        });
      }
      var hoverIds = hoverPair ? hoverPair.split("|") : [];
      document.querySelectorAll(".seg").forEach(function (seg) {
        var agent = seg.getAttribute("data-agent");
        seg.classList.toggle("is-edge-hover", hoverIds.indexOf(agent) >= 0);
        seg.classList.toggle("is-weave-dim", !!focus && !connected[agent]);
      });
      document.querySelectorAll(".lane-label").forEach(function (label) {
        var agentId = label.getAttribute("data-agent");
        if (!agentId) return;
        label.classList.toggle("is-edge-hover", hoverIds.indexOf(agentId) >= 0);
        label.classList.toggle("is-agent-selected", agentId === selected);
        label.classList.toggle("is-weave-dim", !!focus && !connected[agentId]);
      });
      renderSelectedBands(selected);
    }

    function syncHits() {
      hits.forEach(function (rec) {
        var d = rec.path.getAttribute("d");
        if (d && rec.hit.getAttribute("d") !== d) rec.hit.setAttribute("d", d);
      });
      // app.js 每帧重写节点 class；悬停期间把朱印高亮补回去
      if (activePair) {
        activePair.split("|").forEach(function (id) {
          var node = document.querySelector('.node[data-agent="' + id + '"]');
          if (node && !node.classList.contains("is-edge-hover")) node.classList.add("is-edge-hover");
        });
      }
      syncTimelineState();
      requestAnimationFrame(syncHits);
    }

    function buildHits() {
      layer.querySelectorAll(".edge-hit").forEach(function (n) { n.remove(); });
      hits = [];
      var edges = Array.from(layer.querySelectorAll("path.edge"));
      edges.forEach(function (path, i) {
        if (!PAIRS[i]) return;
        var hit = document.createElementNS(SVGNS, "path");
        hit.setAttribute("class", "edge-hit");
        hit.setAttribute("d", path.getAttribute("d") || "");
        layer.appendChild(hit);
        var rec = { hit: hit, path: path, pair: key(PAIRS[i][0], PAIRS[i][1]) };
        hits.push(rec);
        hit.addEventListener("pointerenter", function () { applyHover(rec.pair); });
        hit.addEventListener("pointerleave", function () { if (activePair === rec.pair) clearHover(); });
        hit.addEventListener("pointercancel", clearHover);
      });
      requestAnimationFrame(syncHits);
    }

    buildHits();
    var stage = document.getElementById("stage");
    if (stage) {
      stage.addEventListener("pointerleave", clearHover);
      stage.addEventListener("click", function (e) {
        if (e.target && e.target.classList && e.target.classList.contains("edge-hit")) clearHover();
      });
    }
  }

  /* ---------------------------------------------------------- blockers */

  function tagLaneLabels() {
    var labels = Array.from(document.querySelectorAll("#laneLabels .lane-label"));
    labels.forEach(function (label, i) {
      if (label.classList.contains("lane-label--blocker")) return;
      var agent = (DATA.agents || [])[i];
      if (agent && !label.getAttribute("data-agent")) label.setAttribute("data-agent", agent.id);
    });
  }

  function syncTightStage() {
    var stage = document.getElementById("stage");
    if (!stage) return;
    var many = (DATA.agents || []).length > 5;
    var tight = many && stage.clientHeight > 0 && stage.clientHeight < 385;
    stage.classList.toggle("is-tight", tight);
  }

  function setupTightStage() {
    var stage = document.getElementById("stage");
    if (!stage) return;
    syncTightStage();
    if (window.ResizeObserver) new ResizeObserver(syncTightStage).observe(stage);
  }

  function setupTheme() {
    var root = document.documentElement;
    var btn = document.getElementById("themeSwitch");
    var meta = document.getElementById("themeColor");

    function current() {
      return root.getAttribute("data-theme") === "dark" ? "dark" : "light";
    }
    function sync() {
      var dark = current() === "dark";
      if (btn) {
        var label = dark ? "明暗主题：夜色，切换到纸本" : "明暗主题：纸本，切换到夜色";
        btn.setAttribute("aria-checked", dark ? "true" : "false");
        btn.setAttribute("aria-label", label);
        btn.setAttribute("title", label);
      }
      if (meta) meta.setAttribute("content", dark ? "#14110d" : "#f1ead9");
    }
    function set(theme, persist) {
      root.setAttribute("data-theme", theme === "dark" ? "dark" : "light");
      if (persist) {
        try { window.localStorage.setItem("weave.v2.theme", theme); } catch (e) {}
      }
      sync();
    }
    sync();

    function switchTheme() {
      var next = current() === "dark" ? "light" : "dark";
      var reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (!reduced && document.startViewTransition) {
        try {
          document.startViewTransition(function () { set(next, true); });
          return;
        } catch (e) {}
      }
      // fallback: temporarily cross-fade all themed surfaces
      document.documentElement.classList.add("theme-transition");
      set(next, true);
      setTimeout(function () {
        document.documentElement.classList.remove("theme-transition");
      }, reduced ? 0 : 1100);
    }

    if (btn) btn.addEventListener("click", switchTheme);
    window.WEAVE_THEME = { get: current, set: set, switch: switchTheme };
  }

  function setupGraphZoom() {
    var stage = document.getElementById("stage");
    var wrapper = document.getElementById("stageZoom");
    if (!stage || !wrapper) return;
    var zoomInBtn = document.getElementById("zoomIn");
    var zoomOutBtn = document.getElementById("zoomOut");
    var pctEl = document.getElementById("zoomPct");
    var resetBtn = document.getElementById("zoomReset");
    var MIN = 0.75, MAX = 2.6;
    var scale = 1, tx = 0, ty = 0;
    var drag = null;

    function clampScale(v) { return Math.max(MIN, Math.min(MAX, v)); }
    function clampPan() {
      var W = stage.clientWidth, H = stage.clientHeight;
      if (!W || !H) return;
      if (scale <= 1) {
        tx = (W - W * scale) / 2;
        ty = (H - H * scale) / 2;
      } else {
        tx = Math.min(0, Math.max(W - W * scale, tx));
        ty = Math.min(0, Math.max(H - H * scale, ty));
      }
    }
    var stageLabel = "多智能体协作织造图：" + (DATA.agents || []).map(function (a) { return a.name; }).join("、") + "；可用滚轮缩放、拖动平移";
    stage.setAttribute("aria-label", stageLabel);

    function update() {
      clampPan();
      // 2D transform, and no will-change: the stage repaints at the final zoom
      // instead of upscaling a composited bitmap (keeps HTML text / SVG crisp).
      wrapper.style.transform = "translate(" + tx.toFixed(2) + "px," + ty.toFixed(2) + "px) scale(" + scale.toFixed(4) + ")";
      stage.classList.toggle("can-pan", scale > 1.001);
      if (pctEl) pctEl.textContent = Math.round(scale * 100) + "%";
      if (zoomInBtn) zoomInBtn.disabled = scale >= MAX - 0.001;
      if (zoomOutBtn) zoomOutBtn.disabled = scale <= MIN + 0.001;
    }
    function reset() { scale = 1; tx = 0; ty = 0; update(); }
    function zoomAt(factor, cx, cy) {
      var old = scale;
      var next = clampScale(scale * factor);
      if (Math.abs(next - old) < 0.0001) return;
      var W = stage.clientWidth, H = stage.clientHeight;
      var px = (typeof cx === "number") ? cx : W / 2;
      var py = (typeof cy === "number") ? cy : H / 2;
      var ratio = next / old;
      tx = px - (px - tx) * ratio;
      ty = py - (py - ty) * ratio;
      scale = next;
      update();
    }
    function zoomCenter(factor) { zoomAt(factor, stage.clientWidth / 2, stage.clientHeight / 2); }

    if (zoomInBtn) zoomInBtn.addEventListener("click", function () { zoomCenter(1.2); });
    if (zoomOutBtn) zoomOutBtn.addEventListener("click", function () { zoomCenter(1 / 1.2); });
    if (resetBtn) resetBtn.addEventListener("click", reset);

    stage.addEventListener("wheel", function (e) {
      if (e.target.closest && e.target.closest(".stage-now")) return;
      e.preventDefault();
      var factor = Math.exp(-e.deltaY * 0.0015);
      factor = Math.max(0.77, Math.min(1.3, factor));
      var rect = stage.getBoundingClientRect();
      zoomAt(factor, e.clientX - rect.left, e.clientY - rect.top);
    }, { passive: false });

    stage.addEventListener("pointerdown", function (e) {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      if (scale <= 1.001) return;
      if (e.target.closest && e.target.closest(".node-btn, .stage-now, .graph-zoom, button, a, input, textarea, select")) return;
      drag = { id: e.pointerId, x: e.clientX, y: e.clientY, tx: tx, ty: ty };
      stage.classList.add("is-panning");
      try { stage.setPointerCapture(e.pointerId); } catch (err) {}
      e.preventDefault();
    });
    stage.addEventListener("pointermove", function (e) {
      if (!drag || e.pointerId !== drag.id) return;
      tx = drag.tx + (e.clientX - drag.x);
      ty = drag.ty + (e.clientY - drag.y);
      update();
      e.preventDefault();
    });
    function endDrag(e) {
      if (!drag || (e && e.pointerId !== drag.id)) return;
      try { stage.releasePointerCapture(drag.id); } catch (err) {}
      drag = null;
      stage.classList.remove("is-panning");
    }
    stage.addEventListener("pointerup", endDrag);
    stage.addEventListener("pointercancel", endDrag);

    stage.addEventListener("dblclick", function (e) {
      if (e.target.closest && e.target.closest(".node-btn, .stage-now")) return;
      reset();
    });

    document.addEventListener("keydown", function (e) {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      var tag = (e.target && e.target.tagName || "").toUpperCase();
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || (e.target && e.target.isContentEditable)) return;
      if (e.key === "+" || e.key === "=") { e.preventDefault(); zoomCenter(1.2); }
      else if (e.key === "-" || e.key === "_") { e.preventDefault(); zoomCenter(1 / 1.2); }
      else if (e.key === "0") { e.preventDefault(); reset(); }
    });

    if (window.ResizeObserver) new ResizeObserver(update).observe(stage);
    window.addEventListener("resize", update);
    window.WEAVE_ZOOM = {
      state: function () { return { scale: scale, tx: tx, ty: ty }; },
      zoom: zoomCenter,
      zoomAt: zoomAt,
      reset: reset
    };
    update();
  }

  function setupLive() {
    var app = document.getElementById("app");
    var replayBtn = document.getElementById("replayMode");
    var liveBtn = document.getElementById("liveMode");
    var jumpBtn = document.getElementById("liveJump");
    var laneMarker = document.getElementById("liveEdgeLane");
    var compactMarker = document.getElementById("liveEdgeCompact");
    var scrub = document.getElementById("scrubInput");
    var wcTrack = document.getElementById("wcTrack");
    var laneTracks = document.getElementById("laneTracks");
    var END = (DATA.meta && DATA.meta.duration) || 700;
    var PLAYBACK = (DATA.meta && DATA.meta.playbackSeconds) || 80;
    var RATE = END / PLAYBACK;
    var live = { mode: "replay", following: false, base: 0, epoch: 0, edge: 0 };
    var lastRangeMax = -1;

    function getState() { return window.WEAVE_DEBUG && window.WEAVE_DEBUG.state; }
    function now() { return performance.now(); }
    function currentEdge(ts) {
      if (live.mode !== "live") return 0;
      if (live.following) return getState() ? getState().t : 0;
      return Math.min(END, live.base + ((ts - live.epoch) / 1000) * RATE);
    }
    function setRangeMax(value) {
      var max = Math.max(1, Math.ceil(value));
      if (max === lastRangeMax) return;
      lastRangeMax = max;
      if (scrub) {
        scrub.setAttribute("max", String(max));
        scrub.setAttribute("aria-valuemax", String(max));
      }
      if (wcTrack) wcTrack.setAttribute("aria-valuemax", String(max));
    }
    function syncModeButtons() {
      if (replayBtn) replayBtn.setAttribute("aria-pressed", live.mode === "replay" ? "true" : "false");
      if (liveBtn) liveBtn.setAttribute("aria-pressed", live.mode === "live" ? "true" : "false");
    }
    function restoreRunState() {
      var st = getState();
      var runState = document.getElementById("runState");
      if (!st || !runState) return;
      runState.textContent = st.completed ? "已完成" : (st.playing ? "回放中" : (st.t > 0 ? "已暂停" : "待播放"));
    }
    function updateUi(ts) {
      var st = getState();
      if (!st) return;
      ts = typeof ts === "number" ? ts : now();
      var edge = live.mode === "live" ? (live.following ? st.t : Math.min(END, live.base + ((ts - live.epoch) / 1000) * RATE)) : END;
      live.edge = edge;
      var behind = live.mode === "live" && st.t < edge - 0.35;
      if (laneMarker) {
        laneMarker.hidden = !behind;
        if (behind) laneMarker.style.left = (edge / END * 100).toFixed(3) + "%";
      }
      if (compactMarker) {
        compactMarker.hidden = !behind;
        if (behind) compactMarker.style.left = (edge / END * 100).toFixed(3) + "%";
      }
      if (jumpBtn) {
        jumpBtn.hidden = !behind;
        if (behind) jumpBtn.title = "跳到直播最新位置 · " + fmt(edge);
      }
      syncModeButtons();
      if (app) {
        app.classList.toggle("is-live", live.mode === "live");
        app.classList.toggle("is-live-following", live.mode === "live" && live.following);
        app.classList.toggle("is-live-behind", behind);
      }
      setRangeMax(live.mode === "live" ? edge : END);
      if (live.mode === "live") {
        var runState = document.getElementById("runState");
        if (runState) runState.textContent = st.t >= END - 0.001 ? "直播结束" : (behind ? "回看中" : "直播中");
      }
    }
    function startBehind(anchor) {
      if (live.mode !== "live" || !live.following) return;
      var edge = typeof anchor === "number" ? anchor : live.edge;
      live.following = false;
      live.base = Math.max(0, Math.min(END, edge));
      live.epoch = now();
      live.edge = live.base;
      updateUi(live.epoch);
    }
    function enterLive() {
      var st = getState();
      if (!st) return;
      if (live.mode === "live") {
        if (!live.following) returnLive();
        return;
      }
      var start = st.t >= END - 0.001 ? 0 : st.t;
      live.mode = "live";
      live.following = true;
      live.base = start;
      live.edge = start;
      live.epoch = now();
      st.speed = 1;
      document.querySelectorAll(".speed-btn").forEach(function (b) {
        b.setAttribute("aria-pressed", b.dataset.speed === "1" ? "true" : "false");
      });
      window.WEAVE_DEBUG.seek(start);
      if (start < END - 0.001) window.WEAVE_DEBUG.play();
      updateUi(now());
    }
    function exitLive() {
      if (live.mode !== "live") return;
      live.mode = "replay";
      live.following = false;
      window.WEAVE_DEBUG.pause();
      if (app) app.classList.remove("is-live", "is-live-following", "is-live-behind");
      if (laneMarker) laneMarker.hidden = true;
      if (compactMarker) compactMarker.hidden = true;
      if (jumpBtn) jumpBtn.hidden = true;
      setRangeMax(END);
      syncModeButtons();
      restoreRunState();
    }
    function returnLive() {
      if (live.mode !== "live") return;
      var st = getState();
      if (!st) return;
      var edge = live.following ? st.t : Math.min(END, live.base + ((now() - live.epoch) / 1000) * RATE);
      live.following = true;
      live.base = edge;
      live.edge = edge;
      live.epoch = now();
      window.WEAVE_DEBUG.seek(edge);
      if (edge < END - 0.001) window.WEAVE_DEBUG.play();
      else window.WEAVE_DEBUG.pause();
      updateUi(now());
    }
    function seekTo(target) {
      if (live.mode !== "live") {
        if (window.WEAVE_DEBUG) {
          window.WEAVE_DEBUG.pause();
          window.WEAVE_DEBUG.seek(target);
        }
        return;
      }
      var st = getState();
      if (!st) return;
      var ts = now();
      var edge = live.following ? st.t : Math.min(END, live.base + ((ts - live.epoch) / 1000) * RATE);
      target = Math.max(0, Math.min(edge, target));
      if (target >= edge - 0.75) {
        returnLive();
        return;
      }
      if (live.following) startBehind(edge);
      window.WEAVE_DEBUG.pause();
      window.WEAVE_DEBUG.seek(target);
      updateUi(ts);
    }

    if (replayBtn) replayBtn.addEventListener("click", function () { if (live.mode === "live") exitLive(); });
    if (liveBtn) liveBtn.addEventListener("click", function () {
      if (live.mode === "replay") enterLive();
      else if (!live.following) returnLive();
    });
    if (jumpBtn) jumpBtn.addEventListener("click", returnLive);

    if (scrub) {
      scrub.addEventListener("pointerdown", function () {
        if (live.mode === "live" && live.following) startBehind(live.edge);
      }, true);
      scrub.addEventListener("input", function (e) {
        if (live.mode !== "live") return;
        e.stopImmediatePropagation();
        seekTo(parseFloat(scrub.value) || 0);
      }, true);
    }

    if (laneTracks) {
      laneTracks.addEventListener("pointerdown", function (e) {
        if (live.mode !== "live" || e.button !== 0) return;
        if (e.target.closest && e.target.closest(".seg")) return;
        e.preventDefault();
        e.stopPropagation();
        var rect = laneTracks.getBoundingClientRect();
        var startEdge = live.following ? (getState() ? getState().t : 0) : Math.min(END, live.base + ((now() - live.epoch) / 1000) * RATE);
        if (live.following) startBehind(startEdge);
        function at(clientX) {
          var ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
          seekTo(ratio * startEdge);
        }
        function move(ev) { at(ev.clientX); }
        function up() {
          window.removeEventListener("pointermove", move);
          window.removeEventListener("pointerup", up);
        }
        at(e.clientX);
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
      }, true);
    }

    document.addEventListener("keydown", function (e) {
      if (live.mode !== "live") return;
      var help = document.getElementById("helpDialog");
      if (help && help.open) return;
      var tag = (e.target && e.target.tagName || "").toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") return;
      if (e.key === "1" || e.key === "2" || e.key === "4") {
        e.preventDefault();
        e.stopImmediatePropagation();
        return;
      }
      if (e.key === "ArrowLeft" || e.key === "ArrowRight" || e.key === "Home" || e.key === "End") {
        e.preventDefault();
        e.stopImmediatePropagation();
        var st = getState();
        if (!st) return;
        if (e.key === "End") { returnLive(); return; }
        var delta = (e.shiftKey ? 60 : 10) * (e.key === "ArrowLeft" ? -1 : 1);
        seekTo(e.key === "Home" ? 0 : st.t + delta);
      }
    }, true);

    window.WEAVE_LIVE = {
      isLive: function () { return live.mode === "live"; },
      seekTo: seekTo,
      returnLive: returnLive,
      enter: enterLive,
      exit: exitLive,
      state: live
    };

    function tick(ts) {
      var st = getState();
      if (st && live.mode === "live") {
        if (live.following) {
          if (st.playing) {
            live.edge = st.t;
            live.base = st.t;
            live.epoch = ts;
          } else if (st.t < END - 0.001) {
            startBehind(live.edge || st.t);
          } else {
            live.edge = END;
            live.following = false;
          }
        } else {
          var edge = Math.min(END, live.base + ((ts - live.epoch) / 1000) * RATE);
          live.edge = edge;
          if (st.playing && st.t >= edge - 0.2) {
            live.following = true;
            live.edge = st.t;
            live.base = st.t;
            live.epoch = ts;
          }
        }
        // a segment/task click must never jump into the unstreamed future
        if (live.edge < END - 0.001 && st.t > live.edge + 0.75) {
          window.WEAVE_DEBUG.pause();
          window.WEAVE_DEBUG.seek(live.edge);
          live.following = true;
          live.base = live.edge;
          live.epoch = ts;
          window.WEAVE_DEBUG.play();
        }
        updateUi(ts);
      }
      requestAnimationFrame(tick);
    }
    updateUi(now());
    requestAnimationFrame(tick);
  }

  function setupBlocker() {
    var blocker = DATA.blocker;
    var labels = document.getElementById("laneLabels");
    var rows = document.getElementById("laneRows");
    if (!blocker || !labels || !rows) return;
    tagLaneLabels();

    // separate blocker row in the expanded weave
    var label = document.createElement("div");
    label.className = "lane-label lane-label--blocker";
    label.innerHTML = '<span class="lane-blocker-dot"></span><span>阻塞</span>';
    label.title = "查看阻塞详情";
    label.setAttribute("role", "button");
    label.tabIndex = 0;
    label.hidden = true;

    var row = document.createElement("div");
    row.className = "lane-row lane-row--blocker";
    var laneBand = document.createElement("button");
    laneBand.type = "button";
    laneBand.className = "lane-blocker-band";
    laneBand.hidden = true;
    laneBand.setAttribute("aria-haspopup", "dialog");
    laneBand.setAttribute("aria-controls", "blockerPop");
    laneBand.setAttribute("aria-label", "查看阻塞详情");
    var laneFill = document.createElement("span");
    laneFill.className = "lane-blocker-fill";
    var laneText = document.createElement("span");
    laneText.className = "lane-blocker-text";
    laneText.textContent = "阻塞";
    laneBand.appendChild(laneFill);
    laneBand.appendChild(laneText);
    row.appendChild(laneBand);
    row.hidden = true;

    labels.insertBefore(label, labels.firstChild);
    rows.insertBefore(row, rows.firstChild);
    requestAnimationFrame(function () { window.dispatchEvent(new Event("resize")); });

    // collapsed weave: notice strip above the one-line progress
    var wcWrap = document.getElementById("wcBlockerWrap");
    var wcBand = document.getElementById("wcBlockerBand");
    var wcFill = document.getElementById("wcBlockerFill");
    var wcText = document.getElementById("wcBlockerText");

    var pop = document.getElementById("blockerPop");
    var closeBtn = document.getElementById("blockerPopClose");
    var popTitle = document.getElementById("blockerPopTitle");
    var popDetail = document.getElementById("blockerPopDetail");
    var popWindow = document.getElementById("bpWindow");
    var jumpBtn = document.getElementById("bpJump");
    var lensBtn = document.getElementById("bpLens");

    var duration = blocker.to - blocker.from;
    var outsideBound = false;

    function fillPopover() {
      if (popTitle) popTitle.textContent = blocker.title || "阻塞";
      if (popDetail) popDetail.textContent = blocker.detail || "";
      if (popWindow) popWindow.textContent = fmt(blocker.from) + " – " + fmt(blocker.to) + " · " + fmt(duration);
    }
    function onOutside(e) {
      if (pop && !pop.contains(e.target)) closePopover();
    }
    function onEsc(e) {
      if (e.key === "Escape") closePopover();
    }
    function closePopover() {
      if (!pop) return;
      pop.hidden = true;
      if (outsideBound) {
        document.removeEventListener("pointerdown", onOutside, true);
        document.removeEventListener("keydown", onEsc);
        outsideBound = false;
      }
    }
    function openPopover(anchorEl) {
      if (!pop) return;
      fillPopover();
      pop.hidden = false;
      var r = anchorEl.getBoundingClientRect();
      var pw = pop.offsetWidth;
      var ph = pop.offsetHeight;
      var left = Math.min(Math.max(8, r.left + r.width / 2 - pw / 2), window.innerWidth - pw - 8);
      var top = r.top - ph - 10;
      if (top < 8) top = Math.min(r.bottom + 10, window.innerHeight - ph - 8);
      pop.style.left = Math.round(left) + "px";
      pop.style.top = Math.round(Math.max(8, top)) + "px";
      if (closeBtn) setTimeout(function () { closeBtn.focus(); }, 0);
      if (!outsideBound) {
        setTimeout(function () {
          document.addEventListener("pointerdown", onOutside, true);
          document.addEventListener("keydown", onEsc);
          outsideBound = true;
        }, 0);
      }
    }

    if (closeBtn) closeBtn.addEventListener("click", closePopover);
    if (jumpBtn) jumpBtn.addEventListener("click", function () {
      if (window.WEAVE_DEBUG) { window.WEAVE_DEBUG.pause(); window.WEAVE_DEBUG.seek(blocker.from + 0.5); }
      closePopover();
    });
    if (lensBtn) lensBtn.addEventListener("click", function () {
      var lensNode = document.querySelector('.node[data-agent="lens"] .node-btn');
      if (lensNode) lensNode.click();
      closePopover();
    });

    laneBand.addEventListener("pointerdown", function (e) { e.stopPropagation(); });
    laneBand.addEventListener("click", function (e) { e.stopPropagation(); openPopover(laneBand); });
    label.addEventListener("click", function () { openPopover(label); });
    label.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openPopover(label); }
    });
    if (wcBand) wcBand.addEventListener("click", function (e) { e.stopPropagation(); openPopover(wcBand); });

    var wasActive = false;
    var relayoutQueued = false;
    function queueRelayout() {
      if (relayoutQueued) return;
      relayoutQueued = true;
      requestAnimationFrame(function () {
        relayoutQueued = false;
        window.dispatchEvent(new Event("resize"));
      });
    }

    function syncBlocker() {
      var state = window.WEAVE_DEBUG && window.WEAVE_DEBUG.state;
      var t = state ? state.t : 0;
      var active = t >= blocker.from;
      var resolved = t >= blocker.to;
      var elapsed = Math.max(0, Math.min(t, blocker.to) - blocker.from);
      var progress = duration > 0 ? elapsed / duration : 0;
      var short = window.innerWidth < 620;
      var statusText = resolved ? "已解除" : (blocker.title || "阻塞");
      var bandText = (short && !resolved ? "阻塞" : statusText) + " · " + fmt(duration);

      if (!active) {
        if (!laneBand.hidden) laneBand.hidden = true;
        if (!label.hidden) label.hidden = true;
        if (!row.hidden) row.hidden = true;
        if (wcWrap && !wcWrap.hidden) wcWrap.hidden = true;
        if (wasActive) { wasActive = false; queueRelayout(); }
        requestAnimationFrame(syncBlocker);
        return;
      }
      if (label.hidden) {
        // 只在阻塞真实存在且已经发生时，才让这条轨道出现
        label.hidden = false;
        row.hidden = false;
        wasActive = true;
        queueRelayout();
      }
      if (laneBand.hidden) laneBand.hidden = false;
      laneBand.style.left = (blocker.from / END * 100).toFixed(3) + "%";
      laneBand.style.width = (duration / END * 100).toFixed(3) + "%";
      laneFill.style.width = (progress * 100).toFixed(2) + "%";
      laneText.textContent = bandText;
      laneBand.classList.toggle("is-resolved", resolved);

      if (wcWrap) {
        if (wcWrap.hidden) wcWrap.hidden = false;
        wcBand.style.left = (blocker.from / END * 100).toFixed(3) + "%";
        wcBand.style.width = (duration / END * 100).toFixed(3) + "%";
        wcFill.style.width = (progress * 100).toFixed(2) + "%";
        wcText.textContent = bandText;
        wcBand.classList.toggle("is-resolved", resolved);
      }
      requestAnimationFrame(syncBlocker);
    }
    requestAnimationFrame(syncBlocker);
  }

  /* ---------------------------------------------------------- boot */

  function decorate() {
    document.body.classList.add("edition-silk");
    setupTheme();
    readEdgePairs();
    tagLaneLabels();
    decorateNodes();
    decorateInspector();
    var insp = document.getElementById("inspector");
    if (insp && window.MutationObserver) {
      new MutationObserver(decorateInspector).observe(insp, { childList: true, subtree: true });
    }
    setupWeave();
    setupSplitters();
    setupEdgeHover();
    setupTightStage();
    setupGraphZoom();
    setupLive();
    setupBlocker();
    decorateTokenLabels();
    setTimeout(decorateTokenLabels, 600);
    var tip = document.getElementById("tipToast");
    if (tip) tip.textContent = "点击丝印检视 · T 展开织带 · 拖动栏边调宽";
    setTimeout(decorateNodes, 500);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      // 等 app.js 完成首轮构建
      requestAnimationFrame(function () { requestAnimationFrame(decorate); });
    });
  } else {
    requestAnimationFrame(function () { requestAnimationFrame(decorate); });
  }
})();
