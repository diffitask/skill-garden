// A key moment as one image: the hint on top, Before | After overviews with the rest
// of the page dimmed and one red outline around the highlighted area, then close-ups
// of that area at full size so it reads even when GitHub shrinks the image.
const OVERVIEW = 640; // px per side
const CLOSEUP = 620;
const PAD = 32;

const escape = (text) => String(text).replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
const dataURL = (png) => `data:image/png;base64,${png.toString('base64')}`;

function overview(side) {
  if (!side.png) return `<figure><figcaption>${escape(side.label)}</figcaption><div class="missing">${escape(side.missing)}</div></figure>`;
  const { width, height } = side.size;
  const pct = (value, total) => `${(value / total) * 100}%`;
  const r = side.rect && { x: side.rect.x - 6, y: side.rect.y - 6, w: side.rect.width + 12, h: side.rect.height + 12 };
  const svg = r ? `<svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none"><defs><mask id="m${side.key}">
      <rect width="${width}" height="${height}" fill="white"/><rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" rx="8" fill="black"/></mask></defs>
      <rect width="${width}" height="${height}" fill="#0d1117" fill-opacity=".45" mask="url(#m${side.key})"/>
      <rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" rx="8" fill="none" stroke="#e5534b" stroke-width="${Math.max(4, width / 220)}"/></svg>
      <b class="num${r.x < 40 ? ' inside' : ''}" style="left:${pct(r.x, width)};top:${pct(r.y, height)}">${side.number}</b>` : '';
  const banner = side.banner ? `<div class="banner">${escape(side.banner)}</div>` : '';
  return `<figure><figcaption>${escape(side.label)}</figcaption>
    <div class="frame" style="width:${OVERVIEW}px;aspect-ratio:${width}/${height}"><img src="${dataURL(side.png)}">${svg}${banner}</div></figure>`;
}

function closeup(side, area) {
  if (!side.png || !area) return `<figure style="width:${OVERVIEW}px"></figure>`; // keeps each close-up under its side
  const { width, height } = side.size;
  const x = Math.max(0, area.x - PAD), y = Math.max(0, area.y - PAD);
  const w = Math.min(width, area.x + area.width + PAD) - x, h = Math.min(height, area.y + area.height + PAD) - y;
  const scale = Math.min(1.6, CLOSEUP / w); // screenshots are 2x, so enlarging stays sharp
  const ring = side.rect ? `<i style="left:${(side.rect.x - x - 4) * scale}px;top:${(side.rect.y - y - 4) * scale}px;width:${(side.rect.width + 8) * scale}px;height:${(side.rect.height + 8) * scale}px"></i>` : '';
  return `<figure style="width:${OVERVIEW}px"><figcaption>${escape(side.closeupLabel)}</figcaption><div class="crop" style="width:${w * scale}px;height:${h * scale}px">
    <img src="${dataURL(side.png)}" style="left:${-x * scale}px;top:${-y * scale}px;width:${width * scale}px">${ring}</div></figure>`;
}

/**
 * @param {import('playwright').Browser} browser
 * @param {{number: number, name: string, note?: string, before: any, after: any, file: string}} moment
 *   before/after: {png?, size?, rect?, label, banner?, missing?}
 */
export async function composeSheet(browser, { number, name, note, before, after, file }) {
  for (const [key, side] of [['b', before], ['a', after]]) Object.assign(side, { key, number });
  // The close-up shows the same area in both revisions: where it is now, and what was there.
  const area = after.rect ?? before.rect;
  const closeupArea = area && area.width * area.height < 0.5 * (after.size ?? before.size).width * (after.size ?? before.size).height ? area : null;
  before.closeupLabel = before.rect ? 'Before, close up' : 'Same area before';
  after.closeupLabel = after.rect ? 'After, close up' : 'Same area after';
  const closeups = closeupArea ? `<div class="sides closeups">${closeup(before, closeupArea)}${closeup(after, closeupArea)}</div>` : '';
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 2 });
  await page.setContent(`<!doctype html><style>
    body{margin:0;background:#f6f8fa;font:16px/1.4 system-ui,-apple-system,"Segoe UI",sans-serif;color:#1f2328}
    #sheet{display:inline-block;padding:24px 28px}
    h1{display:flex;align-items:center;gap:12px;font-size:24px;margin:0}
    h1 .badge{display:inline-grid;place-items:center;width:34px;height:34px;border-radius:50%;background:#e5534b;color:white;font-size:18px}
    .note{font-size:20px;margin:10px 0 20px;max-width:1280px}
    .sides{display:flex;gap:24px;align-items:flex-start}.closeups{margin-top:22px}
    figure{margin:0}figcaption{font-weight:650;font-size:15px;margin-bottom:6px;color:#57606a}
    .frame{position:relative;border:1px solid #d0d7de;background:white;overflow:hidden}
    .frame img,.frame svg{position:absolute;inset:0;width:100%;height:100%}
    .num{position:absolute;transform:translate(calc(-100% - 6px),-50%);display:grid;place-items:center;width:26px;height:26px;border-radius:50%;
      background:#e5534b;color:white;font-size:14px;box-shadow:0 0 0 2px white}
    .num.inside{transform:translate(4px,-50%)}.banner{position:absolute;left:50%;top:12px;transform:translateX(-50%);padding:6px 12px;border-radius:6px;background:#57606a;color:white;font-size:14px;white-space:nowrap}
    .missing{width:${OVERVIEW}px;height:400px;display:grid;place-items:center;border:1px dashed #d0d7de;color:#6e7781;background:white}
    .crop{position:relative;overflow:hidden;background:white;border:1px solid #d0d7de;box-shadow:0 4px 14px #1f232814}
    .crop img{position:absolute;max-width:none}.crop i{position:absolute;box-sizing:border-box;border:3px solid #e5534b;border-radius:6px}
  </style><div id="sheet"><h1><span class="badge">${number}</span>${escape(name)}</h1>
    ${note ? `<p class="note">${escape(note)}</p>` : '<p class="note"></p>'}
    <div class="sides">${overview(before)}${overview(after)}</div>${closeups}</div>`);
  await page.waitForFunction(() => [...document.images].every((image) => image.complete));
  await page.locator('#sheet').screenshot({ path: file });
  await page.close();
}
