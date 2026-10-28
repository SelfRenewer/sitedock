import { getLang, t } from '../../shared/i18n'

/** Text into the page's script: a JS string literal (JSON), safe inside <script> — no «</». */
const q = (text: string): string => JSON.stringify(text).replace(/</g, '\\u003c')
/** Text into the page's HTML. */
const h = (text: string): string =>
  text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string)

/**
 * Страница пульта. Отдаётся одним файлом, без внешних зависимостей —
 * ПК в локальной сети может быть вообще без интернета. Собирается на каждый запрос: язык — как в приложении.
 */
export function remotePage(): string {
  return `<!doctype html>
<html lang="${getLang()}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>SiteDock — ${h(t('пульт'))}</title>
<style>
  :root {
    --bg:#f2f2f7; --card:#fff; --text:#1c1c1e; --dim:#8a8a8e; --line:#e2e2e6;
    --accent:#0a84ff; --green:#30c85e; --red:#ff453a; --amber:#ff9f0a;
    --shadow:0 1px 2px rgba(0,0,0,.05),0 6px 18px rgba(0,0,0,.06);
  }
  @media (prefers-color-scheme:dark){
    :root{ --bg:#141416; --card:#1f1f22; --text:#f2f2f7; --dim:#8a8a8e; --line:#2c2c30;
           --shadow:0 1px 2px rgba(0,0,0,.4),0 8px 24px rgba(0,0,0,.35); }
  }
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--text);
    font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
    -webkit-font-smoothing:antialiased}
  .wrap{width:min(1100px,100% - 32px);margin:0 auto;padding:24px 0 48px}
  header{display:flex;align-items:center;gap:14px;flex-wrap:wrap;margin-bottom:20px}
  h1{font-size:20px;margin:0;letter-spacing:-.01em}
  .count{color:var(--dim);font-size:14px;margin-right:auto}
  button{font:inherit;cursor:pointer;border-radius:9px;border:1px solid var(--line);
    background:var(--card);color:var(--text);padding:8px 14px;box-shadow:var(--shadow)}
  button:hover{border-color:var(--accent)}
  button:disabled{opacity:.45;cursor:default;border-color:var(--line)}
  button.primary{background:var(--accent);border-color:var(--accent);color:#fff}
  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:12px;align-items:start}
  .site{background:var(--card);border-radius:13px;padding:14px;box-shadow:var(--shadow);
    display:flex;flex-direction:column;gap:9px}
  .row{display:flex;align-items:center;gap:9px}
  .name{font-weight:600;letter-spacing:-.005em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .dot{width:9px;height:9px;border-radius:50%;background:#8e8e93;flex:none}
  .dot.running{background:var(--green)} .dot.error{background:var(--red)}
  .dot.starting{background:var(--amber);animation:p 1s ease-in-out infinite}
  @keyframes p{50%{opacity:.35}}
  .path{font:11px ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--dim);
    overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  a.open{color:var(--accent);text-decoration:none;font-size:14px;word-break:break-all}
  a.open:hover{text-decoration:underline}
  .actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:2px}
  .note{font-size:12.5px;color:var(--dim);line-height:1.45}
  .badge{font-size:11px;padding:2px 8px;border-radius:999px;background:var(--bg);
    color:var(--dim);border:1px solid var(--line)}
  .badge.warn{color:var(--amber);border-color:var(--amber)}
  .badge.danger{color:var(--red);border-color:var(--red)}
  #toast{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);background:var(--red);
    color:#fff;padding:10px 16px;border-radius:10px;max-width:90vw;display:none;box-shadow:var(--shadow)}
</style>
</head>
<body>
<div class="wrap">
  <header>
    <h1>SiteDock</h1>
    <span class="count" id="count"></span>
    <button id="startAll">${h(t('Запустить все'))}</button>
    <button id="stopAll">${h(t('Остановить все'))}</button>
  </header>
  <div class="grid" id="grid"></div>
  <p class="note" id="hint"></p>
</div>
<div id="toast"></div>

<script>
(function () {
  var grid = document.getElementById('grid');
  var busy = {};

  function toast(text) {
    var t = document.getElementById('toast');
    t.textContent = text; t.style.display = 'block';
    clearTimeout(t._h); t._h = setTimeout(function () { t.style.display = 'none' }, 5000);
  }

  function api(path, method) {
    var headers = { 'Accept': 'application/json' };
    if (method === 'POST') headers['X-SiteDock'] = '1'; // the server takes changes only with it (no other page can add it)
    return fetch(path, { method: method || 'GET', headers: headers })
      .then(function (r) { return r.json().then(function (b) {
        if (!r.ok) throw new Error(b && b.error ? b.error : 'HTTP ' + r.status);
        return b;
      }) });
  }

  function act(id, what) {
    busy[id] = true; render(last);
    api('/api/site/' + encodeURIComponent(id) + '/' + what, 'POST')
      .then(function (s) { last = s; })
      .catch(function (e) { toast(e.message) })
      .then(function () { busy[id] = false; refresh() });
  }

  var last = null;

  function card(s) {
    var el = document.createElement('div');
    el.className = 'site';

    var head = document.createElement('div');
    head.className = 'row';
    var dot = document.createElement('span');
    dot.className = 'dot ' + s.status;
    var name = document.createElement('span');
    name.className = 'name'; name.textContent = s.name;
    head.appendChild(dot); head.appendChild(name);
    el.appendChild(head);

    var p = document.createElement('div');
    p.className = 'path'; p.textContent = s.path; p.title = s.path;
    el.appendChild(p);

    if (s.status === 'running') {
      if (s.lanUrl) {
        var a = document.createElement('a');
        a.className = 'open'; a.href = s.lanUrl; a.target = '_blank'; a.rel = 'noopener';
        a.textContent = ${q(t('Открыть: '))} + s.lanUrl;
        el.appendChild(a);
      } else {
        var warn = document.createElement('div');
        warn.className = 'note';
        warn.textContent = ${q(t('Сайт слушает только на Mac. Чтобы открыть его отсюда, включите доступ по сети.'))};
        el.appendChild(warn);
      }
    }

    if (s.meshUrl) {
      var mesh = document.createElement('a');
      mesh.className = 'open'; mesh.href = s.meshUrl; mesh.target = '_blank'; mesh.rel = 'noopener';
      mesh.textContent = ${q(t('Через mesh-сеть: '))} + s.meshUrl;
      el.appendChild(mesh);
    }

    if (s.tunnelUrl) {
      var t = document.createElement('a');
      t.className = 'open'; t.href = s.tunnelUrl; t.target = '_blank'; t.rel = 'noopener';
      t.textContent = ${q(t('Туннель: '))} + s.tunnelUrl;
      el.appendChild(t);
    }

    var badges = document.createElement('div');
    badges.className = 'row';
    function badge(text, cls) {
      var b = document.createElement('span');
      b.className = 'badge' + (cls ? ' ' + cls : ''); b.textContent = text;
      badges.appendChild(b);
    }
    if (s.kind === 'command') badge(${q(t('Команда'))});
    if (s.tunnelStatus === 'starting') badge(${q(t('Туннель поднимается…'))}, 'warn');
    if (s.tunnelStatus === 'on' && s.tunnelError) badge(s.tunnelError.slice(0, 70), 'warn');
    if (s.tunnelStatus === 'error' && s.tunnelError) badge(s.tunnelError.slice(0, 70), 'danger');
    if (s.lan) badge(${q(t('Сеть'))});
    if (!s.exists) badge(${q(t('Папка не найдена'))}, 'danger');
    if (s.error) badge(s.error.slice(0, 80), 'danger');
    if (badges.children.length) el.appendChild(badges);

    var actions = document.createElement('div');
    actions.className = 'actions';

    var toggle = document.createElement('button');
    var running = s.status === 'running';
    toggle.textContent = running ? ${q(t('Остановить'))} : ${q(t('Запустить'))};
    if (!running) toggle.className = 'primary';
    toggle.disabled = busy[s.id] || !s.exists || s.status === 'starting';
    toggle.onclick = function () { act(s.id, running ? 'stop' : 'start') };
    actions.appendChild(toggle);

    if (running) {
      var tun = document.createElement('button');
      tun.textContent = s.tunnelStatus === 'on' ? ${q(t('Убрать туннель'))} : ${q(t('Туннель'))};
      tun.title = ${q(t('Публичный адрес в интернете'))};
      tun.disabled = busy[s.id] || s.tunnelStatus === 'starting';
      tun.onclick = function () { act(s.id, s.tunnelStatus === 'on' ? 'tunnel-off' : 'tunnel-on') };
      actions.appendChild(tun);
    }

    if (!s.lan) {
      var lanBtn = document.createElement('button');
      lanBtn.textContent = ${q(t('Открыть в сеть'))};
      lanBtn.title = ${q(t('Сайт начнёт слушать на 0.0.0.0 и станет доступен с этого компьютера'))};
      lanBtn.disabled = busy[s.id];
      lanBtn.onclick = function () { act(s.id, 'lan-on') };
      actions.appendChild(lanBtn);
    }

    el.appendChild(actions);
    return el;
  }

  function render(state) {
    if (!state) return;
    var running = state.sites.filter(function (s) { return s.status === 'running' }).length;
    document.getElementById('count').textContent = ${q(t('{running} из {total} запущено'))}.replace('{running}', running).replace('{total}', state.sites.length);
    grid.textContent = '';
    state.sites.forEach(function (s) { grid.appendChild(card(s)) });
    document.getElementById('hint').textContent =
      ${q(t('Пульт управляет SiteDock на Mac ({ip}). Ссылки на сайты уже содержат ключ доступа.'))}.replace('{ip}', state.ip || ${q(t('локально'))});
  }

  function refresh() {
    return api('/api/state').then(function (s) { last = s; render(s) })
      .catch(function (e) { toast(${q(t('Нет связи с Mac: '))} + e.message) });
  }

  document.getElementById('startAll').onclick = function () {
    api('/api/all/start', 'POST').catch(function (e) { toast(e.message) }).then(refresh);
  };
  document.getElementById('stopAll').onclick = function () {
    api('/api/all/stop', 'POST').catch(function (e) { toast(e.message) }).then(refresh);
  };

  refresh();
  setInterval(refresh, 2500);
})();
</script>
</body>
</html>
`
}

/** Страница входа: когда пульт открыли по чистому адресу, без ключа в ссылке. */
export function loginPage(error: string | null): string {
  return `<!doctype html>
<html lang="${getLang()}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>SiteDock — ${h(t('вход'))}</title>
<style>
  :root{--bg:#f2f2f7;--card:#fff;--text:#1c1c1e;--dim:#8a8a8e;--line:#e2e2e6;--accent:#0a84ff;--red:#ff453a;
    --shadow:0 1px 2px rgba(0,0,0,.05),0 8px 26px rgba(0,0,0,.08)}
  @media (prefers-color-scheme:dark){:root{--bg:#141416;--card:#1f1f22;--text:#f2f2f7;--dim:#8a8a8e;--line:#2c2c30;
    --shadow:0 1px 2px rgba(0,0,0,.4),0 10px 30px rgba(0,0,0,.4)}}
  *{box-sizing:border-box}
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
    background:var(--bg);color:var(--text);padding:24px;
    font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
    -webkit-font-smoothing:antialiased}
  form{background:var(--card);border-radius:14px;box-shadow:var(--shadow);padding:26px;width:min(360px,100%)}
  h1{font-size:19px;margin:0 0 6px;letter-spacing:-.01em}
  p{margin:0 0 18px;color:var(--dim);font-size:13.5px}
  label{display:block;font-size:12px;letter-spacing:.04em;text-transform:uppercase;color:var(--dim);margin-bottom:7px}
  input{width:100%;font:inherit;font-size:17px;letter-spacing:.04em;padding:11px 13px;border-radius:10px;
    border:1px solid var(--line);background:var(--bg);color:var(--text);outline:none;
    font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
  input:focus{border-color:var(--accent);box-shadow:0 0 0 3px rgba(10,132,255,.18)}
  button{width:100%;margin-top:14px;font:inherit;font-weight:500;cursor:pointer;padding:11px;border-radius:10px;
    border:1px solid var(--accent);background:var(--accent);color:#fff}
  .err{color:var(--red);font-size:13.5px;margin:0 0 14px}
</style>
</head>
<body>
  <form method="post" action="/login">
    <h1>SiteDock</h1>
    <p>${h(t('Пульт управления сайтами на Mac. Введите пароль — он показан в приложении, в окне «Доступ с ПК».'))}</p>
    ${error ? `<p class="err">${h(error)}</p>` : ''}
    <label for="password">${h(t('Пароль пульта'))}</label>
    <input id="password" name="password" type="password" autocomplete="current-password"
           autofocus spellcheck="false" placeholder="xxxx-xxxx-xxxx">
    <button type="submit">${h(t('Войти'))}</button>
  </form>
</body>
</html>
`
}
