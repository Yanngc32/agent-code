/*
 * Agent Remote — phone client for the desktop "agent-code" app.
 *
 * Talks to the PC LAN bridge (src/main/remote/remoteServer.ts):
 *   GET  /api/state            list conversations
 *   GET  /api/history?conv=ID  full message history of a conversation
 *   GET  /api/events  (SSE)    live agent events {convId, event}
 *   POST /api/send             send a command into a conversation
 *
 * It mirrors the desktop chat (history + what's being built) but is limited to
 * sending commands — permissions are approved on the PC.
 */
'use strict'

var CONFIG_KEY = 'agent-remote-config'
var LAST_CONV_KEY = 'agent-remote-last-conv'

var state = {
  base: '',
  token: '',
  conversations: [],
  convId: null,
  messages: [],
  es: null,
  poll: null
}

var $ = function (id) { return document.getElementById(id) }

// ---- config / pairing -----------------------------------------------------

function parseConfig(addr, token) {
  addr = (addr || '').trim()
  token = (token || '').trim()
  var base = ''
  if (/^https?:\/\//i.test(addr)) {
    try {
      var u = new URL(addr)
      base = u.protocol + '//' + u.host
      if (!token && u.searchParams.get('token')) token = u.searchParams.get('token')
    } catch (e) { /* invalid url */ }
  } else if (addr) {
    base = 'http://' + addr.replace(/\/+$/, '')
  }
  return { base: base, token: token }
}

function loadConfig() {
  try { return JSON.parse(localStorage.getItem(CONFIG_KEY) || 'null') } catch (e) { return null }
}
function saveConfig(cfg) { localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg)) }

function api(path) {
  var sep = path.indexOf('?') >= 0 ? '&' : '?'
  return state.base + path + sep + 'token=' + encodeURIComponent(state.token)
}

// ---- message reducer (mirrors renderer reduceMessages) --------------------

function reduce(list, e) {
  if (e.kind === 'assistant-text') {
    for (var i = 0; i < list.length; i++) {
      if (list[i].kind === 'assistant-text' && list[i].id === e.id) {
        list[i] = Object.assign({}, e)
        return list
      }
    }
  }
  if (e.kind === 'tool-result') {
    for (var j = 0; j < list.length; j++) {
      if (list[j].kind === 'tool-use' && list[j].id === e.toolUseId) {
        list[j] = Object.assign({}, list[j], { result: { isError: e.isError, text: e.text } })
        return list
      }
    }
    return list
  }
  if (e.kind === 'result') {
    for (var k = list.length - 1; k >= 0; k--) {
      if (list[k].kind === 'assistant-text') { list[k] = Object.assign({}, list[k], { answer: true }); break }
    }
    return list
  }
  list.push(e)
  return list
}

// ---- rendering ------------------------------------------------------------

function el(cls, text) {
  var d = document.createElement('div')
  d.className = cls
  if (text != null) d.textContent = text
  return d
}

function summarizeInput(input) {
  try {
    var s = typeof input === 'string' ? input : JSON.stringify(input)
    return s.length > 220 ? s.slice(0, 220) + '…' : s
  } catch (e) { return '' }
}

function renderMessages() {
  var box = $('messages')
  var nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 80
  box.innerHTML = ''
  state.messages.forEach(function (m) {
    if (m.kind === 'user') {
      box.appendChild(el('msg user', m.text))
    } else if (m.kind === 'assistant-text') {
      box.appendChild(el('msg assistant', m.text))
    } else if (m.kind === 'thinking') {
      box.appendChild(el('msg thinking', m.text))
    } else if (m.kind === 'system') {
      box.appendChild(el('msg system', 'sessão pronta' + (m.model ? ' · ' + m.model : '')))
    } else if (m.kind === 'error') {
      box.appendChild(el('msg error', m.text))
    } else if (m.kind === 'status') {
      box.appendChild(el('msg system', m.text))
    } else if (m.kind === 'tool-use') {
      var t = el('tool')
      t.appendChild(el('tool-name', m.name || 'tool'))
      t.appendChild(el('tool-input', summarizeInput(m.input)))
      if (m.result) {
        var r = el('tool-result' + (m.result.isError ? ' err' : ''), m.result.text || '')
        t.appendChild(r)
      }
      box.appendChild(t)
    }
  })
  if (nearBottom) box.scrollTop = box.scrollHeight
}

// ---- networking -----------------------------------------------------------

function setStatus(on) {
  var s = $('status')
  s.className = 'status ' + (on ? 'on' : 'off')
  s.textContent = on ? '● online' : '● offline'
}

function fetchState() {
  return fetch(api('/api/state'))
    .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json() })
    .then(function (data) {
      state.conversations = data.conversations || []
      if (!$('history').hidden) renderHistory()
      updateConvTitle()
      var cur = current()
      $('busy').hidden = !(cur && cur.busy)
      return data
    })
}

function current() {
  for (var i = 0; i < state.conversations.length; i++)
    if (state.conversations[i].id === state.convId) return state.conversations[i]
  return null
}

function basename(p) {
  var parts = (p || '').split(/[\\/]+/).filter(Boolean)
  return parts[parts.length - 1] || p || '—'
}

function updateConvTitle() {
  var cur = current()
  $('conv-title-text').textContent = (cur && cur.title) || 'Conversa'
}

// History drawer, grouped by project (cwd) like the PC sidebar.
function renderHistory() {
  var list = $('history-list')
  list.innerHTML = ''
  var convs = state.conversations.slice().sort(function (a, b) { return b.updatedAt - a.updatedAt })
  var groups = {}
  var order = []
  convs.forEach(function (c) {
    var k = c.cwd || ''
    if (!groups[k]) { groups[k] = []; order.push(k) }
    groups[k].push(c)
  })
  order.forEach(function (k) {
    var g = el('hist-group')
    g.appendChild(el('hist-project', '📁 ' + basename(k)))
    groups[k].forEach(function (c) {
      var row = el('hist-row' + (c.id === state.convId ? ' active' : ''))
      row.appendChild(el('hist-title', c.title || 'Conversa'))
      if (c.busy) row.appendChild(el('hist-busy', '⏳'))
      row.addEventListener('click', function () { selectConv(c.id); closeDrawer() })
      g.appendChild(row)
    })
    list.appendChild(g)
  })
  updateConvTitle()
}

// ---- drawer / connection menu --------------------------------------------

function openDrawer() {
  renderHistory()
  $('history').hidden = false
  $('scrim').hidden = false
}
function closeDrawer() {
  $('history').hidden = true
  if ($('status-menu').hidden) $('scrim').hidden = true
}
function toggleStatusMenu() {
  var m = $('status-menu')
  var show = m.hidden
  $('status-info').textContent = state.base ? state.base.replace(/^https?:\/\//, '') : 'conectado'
  m.hidden = !show
  if (show) $('scrim').hidden = false
  else if ($('history').hidden) $('scrim').hidden = true
}
function closeMenus() {
  $('history').hidden = true
  $('status-menu').hidden = true
  $('scrim').hidden = true
}

function loadHistory(convId) {
  return fetch(api('/api/history?conv=' + encodeURIComponent(convId)))
    .then(function (r) { return r.json() })
    .then(function (data) {
      state.messages = (data.messages || []).slice()
      renderMessages()
    })
}

function openEvents() {
  if (state.es) state.es.close()
  var es = new EventSource(api('/api/events'))
  state.es = es
  es.onopen = function () { setStatus(true) }
  es.onerror = function () { setStatus(false) }
  es.onmessage = function (ev) {
    var msg
    try { msg = JSON.parse(ev.data) } catch (e) { return }
    if (!msg || msg.convId !== state.convId) {
      // Event for another conversation — refresh the list (busy flags/titles).
      fetchState()
      return
    }
    reduce(state.messages, msg.event)
    renderMessages()
    if (msg.event.kind === 'result' || msg.event.kind === 'error') {
      $('busy').hidden = true
      fetchState()
    } else {
      $('busy').hidden = false
    }
  }
}

function selectConv(convId) {
  state.convId = convId
  localStorage.setItem(LAST_CONV_KEY, convId)
  updateConvTitle()
  var cur = current()
  $('busy').hidden = !(cur && cur.busy)
  loadHistory(convId)
}

function send() {
  var input = $('input')
  var text = input.value.trim()
  if (!text || !state.convId) return
  // Optimistic echo (the PC adds the user message locally; SSE only carries
  // agent events, so there's no duplicate).
  reduce(state.messages, { kind: 'user', id: 'u' + Date.now(), text: text })
  renderMessages()
  input.value = ''
  autoGrow()
  $('busy').hidden = false
  // Token goes in the query string (like the GET/SSE routes); body is the command.
  fetch(api('/api/send'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ convId: state.convId, text: text })
  }).catch(function () { setStatus(false) })
}

// ---- screens --------------------------------------------------------------

function showChat() {
  $('pair').hidden = true
  $('chat').hidden = false
  fetchState()
    .then(function () {
      if (!state.conversations.length) {
        alert('Nenhuma conversa no PC ainda. Crie uma conversa no app do PC primeiro.')
        return
      }
      var last = localStorage.getItem(LAST_CONV_KEY)
      var pick = state.conversations.some(function (c) { return c.id === last }) ? last : state.conversations[0].id
      selectConv(pick)
      openEvents()
      if (state.poll) clearInterval(state.poll)
      state.poll = setInterval(fetchState, 4000)
    })
    .catch(function (e) {
      showPair('Não foi possível conectar: ' + e.message + '. Confira endereço/token e a rede.')
    })
}

function showPair(error) {
  if (state.es) { state.es.close(); state.es = null }
  if (state.poll) { clearInterval(state.poll); state.poll = null }
  if (typeof stopScan === 'function') stopScan()
  $('chat').hidden = true
  $('pair').hidden = false
  // Reset to the QR-first layout (manual entry collapsed behind the link).
  $('manual').hidden = true
  $('toggle-manual').hidden = false
  var err = $('pair-error')
  if (error) { err.textContent = error; err.hidden = false } else { err.hidden = true }
}

function autoGrow() {
  var t = $('input')
  t.style.height = 'auto'
  t.style.height = Math.min(t.scrollHeight, 140) + 'px'
}

// ---- QR scanner (camera + jsQR) ------------------------------------------

var scan = { stream: null, timer: 0 }

function showManual(error) {
  $('manual').hidden = false
  $('toggle-manual').hidden = true
  if (error) { var e = $('pair-error'); e.textContent = error; e.hidden = false }
}

function applyConfig(cfg) {
  state.base = cfg.base
  state.token = cfg.token
  saveConfig(cfg)
  $('addr').value = cfg.base
  $('token').value = cfg.token
  showChat()
}

function startScan() {
  $('pair-error').hidden = true
  var hasCam = navigator.mediaDevices && navigator.mediaDevices.getUserMedia
  if (!hasCam || typeof jsQR === 'undefined') {
    // getUserMedia needs a secure context. The installed APK runs from
    // http://localhost (secure → camera OK); the web client over http://IP is
    // an insecure origin, so the camera is blocked here — fall back to manual.
    var insecure = !window.isSecureContext
    showManual(
      insecure
        ? 'A câmera só funciona no app instalado. Aqui no navegador, insira o endereço manualmente.'
        : 'Câmera indisponível neste dispositivo. Insira os dados manualmente.'
    )
    return
  }
  $('scanner').hidden = false
  navigator.mediaDevices
    .getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false })
    .then(function (stream) {
      scan.stream = stream
      var v = $('video')
      // muted + autoplay + playsinline → the WebView plays the live MediaStream
      // without a user gesture (otherwise it stays paused, showing a play poster).
      v.srcObject = stream
      v.muted = true
      v.autoplay = true
      v.playsInline = true
      v.setAttribute('playsinline', 'true')
      var tryPlay = function () {
        var p = v.play()
        if (p && p.catch) p.catch(function () {})
      }
      v.onloadedmetadata = tryPlay
      tryPlay()
      scan.timer = setTimeout(tick, 300)
    })
    .catch(function (e) {
      stopScan()
      showManual('Não foi possível abrir a câmera (' + (e && e.name ? e.name : 'erro') + '). Insira manualmente.')
    })
}

function tick() {
  var v = $('video')
  if (!scan.stream) return
  if (v.readyState >= 2 && v.videoWidth) {
    // Draw the current frame to the visible canvas (the feed the user sees) and
    // decode straight from it — no on-screen <video>, so taps reach the controls.
    var c = $('scan-view')
    var ctx = c.getContext('2d', { willReadFrequently: true })
    if (c.width !== v.videoWidth) c.width = v.videoWidth
    if (c.height !== v.videoHeight) c.height = v.videoHeight
    ctx.drawImage(v, 0, 0, c.width, c.height)
    var img = ctx.getImageData(0, 0, c.width, c.height)
    var code = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' })
    if (code && code.data) {
      var cfg = parseConfig(code.data, '')
      if (cfg.base && cfg.token) {
        stopScan()
        applyConfig(cfg)
        return
      }
    }
  }
  // Throttled (~8fps): decoding every animation frame saturates the main thread
  // and the UI stops responding to taps (e.g. Cancelar). This is plenty for QR.
  scan.timer = setTimeout(tick, 120)
}

function stopScan() {
  if (scan.timer) { clearTimeout(scan.timer); scan.timer = 0 }
  if (scan.stream) {
    scan.stream.getTracks().forEach(function (t) { t.stop() })
    scan.stream = null
  }
  var v = $('video')
  if (v) v.srcObject = null
  $('scanner').hidden = true
}

// ---- boot -----------------------------------------------------------------

function init() {
  var cfg = loadConfig()
  if (cfg) {
    $('addr').value = cfg.base || ''
    $('token').value = cfg.token || ''
  }

  $('scan').addEventListener('click', startScan)
  $('scan-cancel').addEventListener('click', stopScan)
  // Tap anywhere on the scanner overlay also cancels (robust + intuitive).
  $('scanner').addEventListener('click', function (e) {
    if (e.target.id !== 'scan-cancel') stopScan()
  })
  $('toggle-manual').addEventListener('click', function () { showManual() })

  $('connect').addEventListener('click', function () {
    var cfg2 = parseConfig($('addr').value, $('token').value)
    if (!cfg2.base || !cfg2.token) {
      showPair('Informe o endereço (ex: 192.168.0.10:8765) e o token.')
      showManual()
      return
    }
    applyConfig(cfg2)
  })

  // Open the conversation history (drawer) from the menu button or the title.
  $('menu').addEventListener('click', openDrawer)
  $('conv-title').addEventListener('click', openDrawer)
  // The online indicator reveals the connection menu; "Sair" asks to confirm.
  $('status').addEventListener('click', toggleStatusMenu)
  $('scrim').addEventListener('click', closeMenus)
  $('exit').addEventListener('click', function () {
    closeMenus()
    if (confirm('Sair desta conexão? Você precisará parear de novo (QR ou endereço) para voltar.')) {
      showPair()
    }
  })
  $('send').addEventListener('click', send)
  $('input').addEventListener('input', autoGrow)
  $('input').addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
  })

  // Auto-connect if we already have a saved config.
  if (cfg && cfg.base && cfg.token) {
    state.base = cfg.base
    state.token = cfg.token
    showChat()
  }
}

document.addEventListener('DOMContentLoaded', init)
