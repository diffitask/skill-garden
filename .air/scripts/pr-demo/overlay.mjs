// What the viewer sees on top of the app while recording: a cursor, click ripples, a
// caption with the current hint, the revision badge, and a spotlight that draws a red
// outline around the part the PR changed. Injected with addInitScript, so it must be
// self-contained. Nothing here intercepts input, and `hide` removes it for screenshots.
export function installOverlay() {
  if (window.__demo) return;
  const state = { cursor: null, badge: null, queue: [] };
  const ready = (fn) => (document.body ? fn() : state.queue.push(fn));
  addEventListener('DOMContentLoaded', () => { for (const fn of state.queue.splice(0)) fn(); });
  const css = `
    #__demo{position:fixed;inset:0;z-index:2147483647;pointer-events:none;font:600 18px/1.35 system-ui,-apple-system,"Segoe UI",sans-serif}
    #__demo[hidden]{display:none}
    #__demo .cursor{position:absolute;left:0;top:0;width:28px;height:28px;transition:transform .65s cubic-bezier(.45,0,.2,1);filter:drop-shadow(0 2px 3px #0006)}
    #__demo .ripple{position:absolute;width:44px;height:44px;margin:-22px 0 0 -22px;border-radius:50%;border:3px solid #2f81f7;background:#2f81f733;animation:__demo-ripple .6s ease-out forwards}
    @keyframes __demo-ripple{from{transform:scale(.3);opacity:1}to{transform:scale(1.6);opacity:0}}
    #__demo .caption{position:absolute;left:50%;bottom:28px;transform:translateX(-50%);max-width:min(760px,90vw);padding:12px 20px;border-radius:10px;
      color:#fff;background:#0d1117e6;box-shadow:0 6px 24px #0005;text-align:center;transition:opacity .3s}
    #__demo .caption.top{bottom:auto;top:28px}
    #__demo .caption:empty{opacity:0}
    #__demo .badge{position:absolute;left:16px;bottom:16px;padding:6px 12px;border-radius:6px;font-size:13px;letter-spacing:.6px;color:#fff}
    #__demo .badge.before{background:#9a6700}#__demo .badge.after{background:#1a7f37}
    #__demo svg.spot{position:absolute;inset:0;width:100%;height:100%;transition:opacity .35s}
    #__demo svg.spot rect.ring{fill:none;stroke:#e5534b;stroke-width:4;animation:__demo-draw .8s ease-out forwards}
    @keyframes __demo-draw{to{stroke-dashoffset:0}}
    #__demo .tag{position:absolute;padding:4px 10px;border-radius:5px;background:#e5534b;color:#fff;font-size:14px;white-space:nowrap}`;
  const root = document.createElement('div');
  root.id = '__demo';
  root.setAttribute('aria-hidden', 'true');
  // The app's CSP blocks <style> elements; constructed stylesheets are not affected.
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(css);
  ready(() => { document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet]; });
  root.innerHTML = `<div class="badge" hidden></div><div class="caption"></div>
    <svg class="cursor" viewBox="0 0 28 28"><path d="M5 3 L5 23 L10.5 17.8 L14.2 26 L17.6 24.5 L14 16.6 L21.5 16.2 Z" fill="#111" stroke="#fff" stroke-width="1.8" stroke-linejoin="round"/></svg>`;
  const $ = (selector) => root.querySelector(selector);
  ready(() => document.body.append(root));
  const api = {
    cursor(x, y, animate = true) {
      state.cursor = [x, y];
      const cursor = $('.cursor');
      cursor.style.transition = animate ? '' : 'none';
      cursor.style.transform = `translate(${x - 5}px, ${y - 3}px)`;
    },
    ripple(x, y) {
      const ripple = document.createElement('div');
      ripple.className = 'ripple';
      Object.assign(ripple.style, { left: `${x}px`, top: `${y}px` });
      root.append(ripple);
      setTimeout(() => ripple.remove(), 700);
    },
    badge(text, kind) {
      state.badge = [text, kind];
      Object.assign($('.badge'), { textContent: text, className: `badge ${kind}`, hidden: false });
    },
    caption(text, top = false) {
      const caption = $('.caption');
      caption.textContent = text ?? '';
      caption.classList.toggle('top', top);
    },
    spotlight(rect, tag) {
      api.unspot();
      const pad = 8, x = rect.x - pad, y = rect.y - pad, w = rect.width + 2 * pad, h = rect.height + 2 * pad;
      const perimeter = 2 * (w + h);
      const ns = 'http://www.w3.org/2000/svg';
      const svg = document.createElementNS(ns, 'svg');
      svg.setAttribute('class', 'spot');
      svg.innerHTML = `<defs><mask id="__demo-mask"><rect width="100%" height="100%" fill="white"/><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="10" fill="black"/></mask></defs>
        <rect width="100%" height="100%" fill="#0d1117" fill-opacity=".42" mask="url(#__demo-mask)"/>
        <rect class="ring" x="${x}" y="${y}" width="${w}" height="${h}" rx="10" stroke-dasharray="${perimeter}" stroke-dashoffset="${perimeter}"/>`;
      root.insertBefore(svg, $('.caption'));
      if (tag) {
        const label = document.createElement('div');
        label.className = 'tag';
        label.textContent = tag;
        const above = y > 40;
        Object.assign(label.style, { left: `${Math.max(8, x)}px`, top: above ? `${y - 34}px` : `${y + h + 8}px` });
        root.append(label);
      }
    },
    unspot() { for (const element of root.querySelectorAll('svg.spot, .tag')) element.remove(); },
    hide(hidden) { root.hidden = hidden; },
  };
  window.__demo = api;
}
