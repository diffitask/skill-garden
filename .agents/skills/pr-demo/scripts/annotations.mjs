// Recording-only overlays. Import from the trusted skill; include a copy with replay evidence.
export async function installAnnotations(page) {
  await page.evaluate(() => {
    if (document.getElementById('air-pr-demo-annotations')) return;
    const host = document.createElement('div');
    host.id = 'air-pr-demo-annotations';
    host.setAttribute('aria-hidden', 'true');
    Object.assign(host.style, { position: 'fixed', inset: '0', zIndex: '2147483647', pointerEvents: 'none' });
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `<style>
      :host{font-family:Inter,ui-sans-serif,system-ui,sans-serif;color:#31312f}
      *{box-sizing:border-box} [hidden]{display:none!important}
      #chapter{position:absolute;inset:0;background:#f2f1ed;display:grid;place-items:center;opacity:0;transition:opacity 220ms ease}
      #chapter[data-visible]{opacity:1}
      .chapter-copy{max-width:880px;padding:40px;text-align:center;animation:arrive 350ms ease both}
      #chapter-label{font-size:clamp(56px,8vw,96px);font-weight:540;line-height:1.1;letter-spacing:-5px;margin:0 0 22px}
      #chapter-summary{font-size:clamp(18px,2.3vw,28px);font-weight:400;letter-spacing:-.6px;line-height:1.5;margin:0;color:#68665f}
      #chapter-detail{position:absolute;bottom:36px;left:24px;right:24px;text-align:center;font-size:12px;letter-spacing:.15px;color:#88857d}
      #note{position:absolute;width:max-content;max-width:min(280px,calc(100vw - 32px));padding:12px 16px;border:1px solid #e0ded9;border-radius:12px;background:#fffffff5;box-shadow:0 6px 24px #26231e0c;font-size:16px;line-height:1.45;letter-spacing:-.2px;overflow-wrap:anywhere;animation:arrive 180ms ease both}
      svg{position:absolute;inset:0;width:100%;height:100%;overflow:visible}
      line{stroke:#aaa49a;stroke-width:1}circle{fill:#8d8577}
      #pointer{position:absolute;width:10px;height:10px;border-radius:50%;background:#55504a88;box-shadow:0 0 0 4px #fff8;transform:translate(-50%,-50%)}
      @keyframes arrive{from{opacity:0;transform:translateY(5px)}to{opacity:1;transform:translateY(0)}}
    </style>
    <div id="callout" hidden><svg><line/><circle r="3"/></svg><div id="note"></div></div>
    <div id="pointer" hidden></div>
    <section id="chapter" hidden><div class="chapter-copy"><h1 id="chapter-label"></h1><p id="chapter-summary"></p></div><small id="chapter-detail"></small></section>`;
    document.documentElement.append(host);
    const chapter = shadow.querySelector('#chapter');
    const callout = shadow.querySelector('#callout');
    const note = shadow.querySelector('#note');
    let target;
    let preferred = 'right';
    const margin = 16, gap = 24;
    function place() {
      if (!target) return;
      callout.hidden = false;
      const element = document.querySelector(target);
      const rect = element?.getBoundingClientRect();
      if (!rect || !rect.width || !rect.height || rect.bottom <= 0 || rect.top >= innerHeight) {
        callout.hidden = true;
        return;
      }
      const { width, height } = note.getBoundingClientRect();
      const clamp = (value, low, high) => Math.max(low, Math.min(value, high));
      const midX = (rect.left + rect.right) / 2, midY = (rect.top + rect.bottom) / 2;
      const candidates = {
        right: { x: rect.right + gap, y: clamp(midY - height / 2, margin, innerHeight - height - margin), ax: rect.right + 5, ay: midY, side: 'right' },
        left: { x: rect.left - gap - width, y: clamp(midY - height / 2, margin, innerHeight - height - margin), ax: rect.left - 5, ay: midY, side: 'left' },
        bottom: { x: clamp(midX - width / 2, margin, innerWidth - width - margin), y: rect.bottom + gap, ax: midX, ay: rect.bottom + 5, side: 'bottom' },
        top: { x: clamp(midX - width / 2, margin, innerWidth - width - margin), y: rect.top - gap - height, ax: midX, ay: rect.top - 5, side: 'top' },
      };
      const order = [...new Set([preferred, 'right', 'left', 'bottom', 'top'])];
      const fit = order.map((side) => candidates[side]).find((p) => p.x >= margin && p.y >= margin && p.x + width <= innerWidth - margin && p.y + height <= innerHeight - margin);
      if (!fit) { callout.hidden = true; return; }
      note.style.left = `${fit.x}px`; note.style.top = `${fit.y}px`;
      const endX = fit.side === 'right' ? fit.x : fit.side === 'left' ? fit.x + width : fit.x + width / 2;
      const endY = fit.side === 'bottom' ? fit.y : fit.side === 'top' ? fit.y + height : fit.y + height / 2;
      const line = shadow.querySelector('line');
      for (const [key, value] of Object.entries({ x1: fit.ax, y1: fit.ay, x2: endX, y2: endY })) line.setAttribute(key, String(value));
      const dot = shadow.querySelector('circle'); dot.setAttribute('cx', String(fit.ax)); dot.setAttribute('cy', String(fit.ay));
    }
    document.addEventListener('pointermove', (event) => {
      const pointer = shadow.querySelector('#pointer');
      pointer.hidden = !chapter.hidden;
      pointer.style.left = `${event.clientX}px`; pointer.style.top = `${event.clientY}px`;
    });
    window.addEventListener('scroll', place, { passive: true });
    window.addEventListener('resize', place);
    // The single namespaced API stays in the overlay's Shadow DOM, not the product's globals.
    host.demo = {
      chapter({ label, summary, detail }) {
        callout.hidden = true; target = undefined;
        shadow.querySelector('#pointer').hidden = true;
        shadow.querySelector('#chapter-label').textContent = label;
        shadow.querySelector('#chapter-summary').textContent = summary;
        shadow.querySelector('#chapter-detail').textContent = detail;
        chapter.hidden = false;
        requestAnimationFrame(() => chapter.setAttribute('data-visible', ''));
      },
      fadeChapter() { chapter.removeAttribute('data-visible'); },
      hideChapter() { chapter.hidden = true; },
      note({ selector, text, side }) {
        target = selector; preferred = side;
        note.textContent = text; callout.hidden = false; place();
        if (callout.hidden) throw new Error(`No unobscured space for annotation near ${selector}`);
      },
      clear() { target = undefined; callout.hidden = true; },
    };
  });
}

export async function showChapter(page, { label, summary, detail = '', holdMs = 2400 }) {
  await installAnnotations(page);
  await page.evaluate((data) => document.getElementById('air-pr-demo-annotations').demo.chapter(data), { label, summary, detail });
  await page.waitForTimeout(holdMs);
  await page.evaluate(() => document.getElementById('air-pr-demo-annotations').demo.fadeChapter());
  await page.waitForTimeout(240);
  await page.evaluate(() => document.getElementById('air-pr-demo-annotations').demo.hideChapter());
}

export async function showCallout(page, { selector, text, side = 'right' }) {
  await installAnnotations(page);
  const element = page.locator(selector);
  if (!await element.isVisible()) throw new Error(`Annotation target is missing or invisible: ${selector}`);
  await page.evaluate((data) => document.getElementById('air-pr-demo-annotations').demo.note(data), { selector, text, side });
  await page.waitForTimeout(200);
}

export async function clearCallout(page) {
  await page.evaluate(() => document.getElementById('air-pr-demo-annotations')?.demo.clear());
}
