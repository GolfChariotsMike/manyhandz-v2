(function () {
  var script = document.currentScript || document.querySelector('script[data-key]');
  var embedKey = script && (script.getAttribute('data-key') || script.getAttribute('data-embed-key'));
  if (!embedKey) { console.warn('ManyHandz: missing data-key'); return; }

  var API = 'https://kouembkldbpdbhzeaoth.supabase.co/functions/v1/mhv2-chat-widget';
  var FALLBACK_COLOR = '#ca8a04';
  var DEFAULT_HINT = 'Need help?';
  var sessionKey = localStorage.getItem('mhz_session_' + embedKey) || 'sess_' + Math.random().toString(36).slice(2) + Date.now();
  localStorage.setItem('mhz_session_' + embedKey, sessionKey);

  var dataColor = script && (script.getAttribute('data-color') || '').trim();
  var config = {
    widget_name: 'Chat with us',
    widget_color: dataColor || FALLBACK_COLOR,
    greeting: 'Hi! How can we help?',
    launcher_hint: DEFAULT_HINT
  };
  var messages = [];
  var open = false;
  var loading = false;
  var launcherReady = false;
  var dismissKey = 'mhz_teaser_dismissed_' + embedKey;
  var teaserDismissed = false;
  try { teaserDismissed = sessionStorage.getItem(dismissKey) === '1'; } catch (e) {}

  // ── Styles ──────────────────────────────────────────────────────────────
  var style = document.createElement('style');
  style.textContent = `
    #mhz-widget * { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
    #mhz-btn {
      position: fixed; bottom: 24px; right: 24px; z-index: 99999;
      width: 56px; height: 56px; border-radius: 50%; border: none; cursor: pointer;
      display: flex; align-items: center; justify-content: center;
      box-shadow: 0 4px 20px rgba(0,0,0,0.25);
      opacity: 0; visibility: hidden; pointer-events: none;
      transition: transform 0.2s, opacity 0.25s ease, visibility 0.25s;
    }
    #mhz-btn.mhz-ready { opacity: 1; visibility: visible; pointer-events: auto; }
    #mhz-btn:hover { transform: scale(1.08); }
    #mhz-btn svg { width: 26px; height: 26px; }
    #mhz-teaser {
      position: fixed; bottom: 32px; right: 92px; z-index: 99999;
      max-width: min(240px, calc(100vw - 108px));
      background: #18181b; color: rgba(255,255,255,0.9);
      border-radius: 12px; padding: 10px 10px 10px 14px;
      font-size: 14px; line-height: 1.35; font-weight: 500;
      box-shadow: 0 8px 40px rgba(0,0,0,0.4);
      display: flex; align-items: center; gap: 6px; cursor: pointer;
      opacity: 0; visibility: hidden; pointer-events: none;
      transform: translateX(8px);
      transition: opacity 0.25s ease, visibility 0.25s, transform 0.25s ease;
    }
    #mhz-teaser.mhz-visible {
      opacity: 1; visibility: visible; pointer-events: auto;
      transform: translateX(0);
    }
    #mhz-teaser-text { flex: 1; min-width: 0; }
    #mhz-teaser-x {
      flex-shrink: 0; width: 22px; height: 22px; border: none; border-radius: 6px;
      background: transparent; color: rgba(255,255,255,0.4); cursor: pointer;
      display: flex; align-items: center; justify-content: center;
      font-size: 16px; line-height: 1; padding: 0;
    }
    #mhz-teaser-x:hover { color: rgba(255,255,255,0.75); background: rgba(255,255,255,0.08); }
    #mhz-teaser-nub {
      position: absolute; right: -6px; top: 50%; margin-top: -6px;
      width: 0; height: 0;
      border-top: 6px solid transparent; border-bottom: 6px solid transparent;
      border-left: 6px solid #18181b;
    }
    #mhz-panel {
      position: fixed; bottom: 92px; right: 24px; z-index: 99998;
      width: 360px; max-width: calc(100vw - 48px);
      background: #18181b; border-radius: 16px; overflow: hidden;
      box-shadow: 0 8px 40px rgba(0,0,0,0.4);
      display: flex; flex-direction: column;
      transform: scale(0.9) translateY(20px); opacity: 0; pointer-events: none;
      transition: transform 0.2s ease, opacity 0.2s ease;
    }
    #mhz-panel.open { transform: scale(1) translateY(0); opacity: 1; pointer-events: all; }
    #mhz-header {
      padding: 16px 18px; display: flex; align-items: center; gap: 10px;
      border-bottom: 1px solid rgba(255,255,255,0.08);
    }
    #mhz-header-dot { width: 10px; height: 10px; border-radius: 50%; background: #22c55e; flex-shrink: 0; }
    #mhz-header-name { color: #fff; font-weight: 600; font-size: 15px; flex: 1; }
    #mhz-messages {
      flex: 1; overflow-y: auto; padding: 16px; display: flex; flex-direction: column; gap: 10px;
      height: 340px; scroll-behavior: smooth;
    }
    .mhz-msg { max-width: 82%; padding: 10px 14px; border-radius: 14px; font-size: 14px; line-height: 1.45; word-break: break-word; }
    .mhz-msg.user { align-self: flex-end; color: #fff; border-radius: 14px 14px 4px 14px; }
    .mhz-msg.bot { align-self: flex-start; background: rgba(255,255,255,0.08); color: rgba(255,255,255,0.9); border-radius: 14px 14px 14px 4px; }
    .mhz-typing { display: flex; gap: 4px; padding: 12px 14px; align-self: flex-start;
      background: rgba(255,255,255,0.08); border-radius: 14px 14px 14px 4px; }
    .mhz-typing span { width: 7px; height: 7px; border-radius: 50%; background: rgba(255,255,255,0.4);
      animation: mhz-bounce 1s infinite; }
    .mhz-typing span:nth-child(2) { animation-delay: 0.15s; }
    .mhz-typing span:nth-child(3) { animation-delay: 0.3s; }
    @keyframes mhz-bounce { 0%,60%,100%{transform:translateY(0)} 30%{transform:translateY(-6px)} }
    #mhz-form { display: flex; gap: 8px; padding: 12px 16px; border-top: 1px solid rgba(255,255,255,0.08); }
    #mhz-input {
      flex: 1; background: rgba(255,255,255,0.07); border: 1px solid rgba(255,255,255,0.12);
      border-radius: 10px; padding: 10px 14px; color: #fff; font-size: 14px; outline: none;
      transition: border-color 0.2s;
    }
    #mhz-input::placeholder { color: rgba(255,255,255,0.3); }
    #mhz-input:focus { border-color: rgba(255,255,255,0.3); }
    #mhz-send {
      width: 40px; height: 40px; border-radius: 10px; border: none; cursor: pointer;
      display: flex; align-items: center; justify-content: center; flex-shrink: 0; transition: opacity 0.2s;
    }
    #mhz-send:disabled { opacity: 0.4; cursor: default; }
    #mhz-send svg { width: 18px; height: 18px; }
    #mhz-branding { text-align: center; padding: 6px; font-size: 11px; color: rgba(255,255,255,0.2); }
    #mhz-branding a { color: rgba(255,255,255,0.3); text-decoration: none; }
  `;
  document.head.appendChild(style);

  // ── DOM ─────────────────────────────────────────────────────────────────
  var wrap = document.createElement('div');
  wrap.id = 'mhz-widget';

  var btn = document.createElement('button');
  btn.id = 'mhz-btn';
  btn.setAttribute('aria-label', 'Open chat');

  var teaser = document.createElement('div');
  teaser.id = 'mhz-teaser';
  teaser.setAttribute('role', 'status');
  teaser.innerHTML =
    '<span id="mhz-teaser-text"></span>' +
    '<button id="mhz-teaser-x" type="button" aria-label="Dismiss hint">&times;</button>' +
    '<span id="mhz-teaser-nub" aria-hidden="true"></span>';

  var panel = document.createElement('div');
  panel.id = 'mhz-panel';
  panel.innerHTML = `
    <div id="mhz-header">
      <div id="mhz-header-dot"></div>
      <span id="mhz-header-name">Chat with us</span>
    </div>
    <div id="mhz-messages"></div>
    <form id="mhz-form">
      <input id="mhz-input" type="text" placeholder="Type a message..." autocomplete="off" />
      <button id="mhz-send" type="submit" aria-label="Send">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
        </svg>
      </button>
    </form>
    <div id="mhz-branding">Powered by <a href="https://manyhandz.ai" target="_blank">ManyHandz</a></div>
  `;

  wrap.appendChild(btn);
  wrap.appendChild(teaser);
  wrap.appendChild(panel);
  document.body.appendChild(wrap);

  var teaserText = document.getElementById('mhz-teaser-text');
  var teaserX = document.getElementById('mhz-teaser-x');
  teaserText.textContent = DEFAULT_HINT;

  // ── Helpers ──────────────────────────────────────────────────────────────
  function applyColor(color) {
    btn.style.background = color;
    document.getElementById('mhz-send').style.background = color;
    document.getElementById('mhz-send').style.color = '#fff';
  }

  function shouldShowLauncherTeaser() {
    return launcherReady && !open && !teaserDismissed;
  }

  function syncTeaser() {
    teaser.classList.toggle('mhz-visible', shouldShowLauncherTeaser());
  }

  function revealLauncher() {
    launcherReady = true;
    btn.classList.add('mhz-ready');
    syncTeaser();
  }

  function setLauncherHint(hint) {
    var text = (typeof hint === 'string' && hint.trim()) ? hint.trim() : DEFAULT_HINT;
    config.launcher_hint = text;
    teaserText.textContent = text;
  }

  function setChatIcon(isOpen) {
    btn.innerHTML = isOpen
      ? `<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`
      : `<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`;
  }

  function addMessage(role, text) {
    messages.push({ role, text });
    var msgs = document.getElementById('mhz-messages');
    var el = document.createElement('div');
    el.className = 'mhz-msg ' + role;
    el.textContent = text;
    if (role === 'user') el.style.background = config.widget_color;
    msgs.appendChild(el);
    msgs.scrollTop = msgs.scrollHeight;
  }

  function showTyping() {
    var msgs = document.getElementById('mhz-messages');
    var el = document.createElement('div');
    el.className = 'mhz-typing';
    el.id = 'mhz-typing';
    el.innerHTML = '<span></span><span></span><span></span>';
    msgs.appendChild(el);
    msgs.scrollTop = msgs.scrollHeight;
  }

  function removeTyping() {
    var el = document.getElementById('mhz-typing');
    if (el) el.remove();
  }

  function sendMessage(text) {
    if (!text.trim() || loading) return;
    loading = true;
    addMessage('user', text);
    showTyping();
    document.getElementById('mhz-send').disabled = true;

    fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ embed_key: embedKey, session_key: sessionKey, message: text })
    })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        removeTyping();
        addMessage('bot', d.reply || d.error || 'Sorry, something went wrong.');
      })
      .catch(function () {
        removeTyping();
        addMessage('bot', 'Sorry, something went wrong. Please try again.');
      })
      .finally(function () {
        loading = false;
        document.getElementById('mhz-send').disabled = false;
      });
  }

  function togglePanel() {
    open = !open;
    panel.classList.toggle('open', open);
    setChatIcon(open);
    syncTeaser();
    if (open && messages.length === 0 && config.greeting) {
      setTimeout(function () { addMessage('bot', config.greeting); }, 300);
    }
    if (open) setTimeout(function () { document.getElementById('mhz-input').focus(); }, 250);
  }

  // ── Events ───────────────────────────────────────────────────────────────
  btn.addEventListener('click', togglePanel);

  teaser.addEventListener('click', function (e) {
    if (e.target === teaserX || (teaserX && teaserX.contains(e.target))) return;
    if (!open) togglePanel();
  });

  teaserX.addEventListener('click', function (e) {
    e.preventDefault();
    e.stopPropagation();
    teaserDismissed = true;
    try { sessionStorage.setItem(dismissKey, '1'); } catch (err) {}
    syncTeaser();
  });

  document.getElementById('mhz-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var input = document.getElementById('mhz-input');
    var text = input.value.trim();
    input.value = '';
    sendMessage(text);
  });

  setChatIcon(false);

  // Optional data-color: theme + fade in immediately (no config wait).
  if (dataColor) {
    applyColor(dataColor);
    revealLauncher();
  }

  // ── Load config from backend ─────────────────────────────────────────────
  fetch(API + '?action=config&embed_key=' + embedKey)
    .then(function (r) {
      if (!r.ok) throw new Error('config');
      return r.json();
    })
    .then(function (d) {
      if (d && (d.widget_name || d.widget_color)) {
        config = Object.assign(config, d);
        document.getElementById('mhz-header-name').textContent = config.widget_name || 'Chat with us';
        applyColor(config.widget_color || FALLBACK_COLOR);
        setLauncherHint(config.launcher_hint);
      } else {
        applyColor(config.widget_color || FALLBACK_COLOR);
      }
      revealLauncher();
    })
    .catch(function () {
      applyColor(config.widget_color || FALLBACK_COLOR);
      revealLauncher();
    });
})();
