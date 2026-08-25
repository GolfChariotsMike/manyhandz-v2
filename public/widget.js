(function () {
  var script = document.currentScript || document.querySelector('script[data-key]');
  var embedKey = script && (script.getAttribute('data-key') || script.getAttribute('data-embed-key'));
  if (!embedKey) { console.warn('ManyHandz: missing data-key'); return; }

  var API = 'https://kouembkldbpdbhzeaoth.supabase.co/functions/v1/mhv2-chat-widget';
  var sessionKey = localStorage.getItem('mhz_session_' + embedKey) || 'sess_' + Math.random().toString(36).slice(2) + Date.now();
  localStorage.setItem('mhz_session_' + embedKey, sessionKey);

  var config = { widget_name: 'Chat with us', widget_color: '#ca8a04', greeting: 'Hi! How can we help?' };
  var messages = [];
  var open = false;
  var loading = false;

  // ── Styles ──────────────────────────────────────────────────────────────
  var style = document.createElement('style');
  style.textContent = `
    #mhz-widget * { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
    #mhz-btn {
      position: fixed; bottom: 24px; right: 24px; z-index: 99999;
      width: 56px; height: 56px; border-radius: 50%; border: none; cursor: pointer;
      display: flex; align-items: center; justify-content: center;
      box-shadow: 0 4px 20px rgba(0,0,0,0.25); transition: transform 0.2s;
    }
    #mhz-btn:hover { transform: scale(1.08); }
    #mhz-btn svg { width: 26px; height: 26px; }
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
  wrap.appendChild(panel);
  document.body.appendChild(wrap);

  // ── Helpers ──────────────────────────────────────────────────────────────
  function applyColor(color) {
    btn.style.background = color;
    document.getElementById('mhz-send').style.background = color;
    document.getElementById('mhz-send').style.color = '#fff';
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

  // ── Events ───────────────────────────────────────────────────────────────
  btn.addEventListener('click', function () {
    open = !open;
    panel.classList.toggle('open', open);
    setChatIcon(open);
    if (open && messages.length === 0 && config.greeting) {
      setTimeout(function () { addMessage('bot', config.greeting); }, 300);
    }
    if (open) setTimeout(function () { document.getElementById('mhz-input').focus(); }, 250);
  });

  document.getElementById('mhz-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var input = document.getElementById('mhz-input');
    var text = input.value.trim();
    input.value = '';
    sendMessage(text);
  });

  // ── Load config from backend ─────────────────────────────────────────────
  fetch(API + '?action=config&embed_key=' + embedKey)
    .then(function (r) { return r.json(); })
    .then(function (d) {
      if (d.widget_name) {
        config = d;
        document.getElementById('mhz-header-name').textContent = d.widget_name;
        applyColor(d.widget_color || '#ca8a04');
      }
    })
    .catch(function () {});

  // Apply default color immediately
  applyColor(config.widget_color);
  setChatIcon(false);
})();
