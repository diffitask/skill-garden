// Botanical marks are decorative identifiers, not inferred skill categories.
// Only a bounded hash and fixed artwork enter SVG markup; source text never does.
const palettes = [
  ['#dca2b6', '#f2d1dc', '#bd748e'],
  ['#b7a0d1', '#ded1ec', '#8e75ad'],
  ['#e2bd70', '#f5e5b7', '#b69246'],
  ['#8ebac6', '#cce5e9', '#648f9b'],
  ['#dca68b', '#f3d8c6', '#b77b5e'],
  ['#a8bc8f', '#dce8cb', '#809b66'],
];

export function flowerMarkup(seed) {
  let hash = 2166136261;
  for (const character of String(seed)) hash = Math.imul(hash ^ character.codePointAt(0), 16777619) >>> 0;
  const [petal, light, edge] = palettes[hash % palettes.length];
  const petals = 5 + ((hash >>> 4) % 5);
  const width = 4 + ((hash >>> 8) % 4) * .6;
  const length = 8 + ((hash >>> 12) % 4);
  const tilt = ((hash >>> 16) % 25) - 12;
  return `<svg class="skill-flower" viewBox="0 0 48 68" aria-hidden="true" focusable="false" xmlns="http://www.w3.org/2000/svg">
    <path d="M24 27Q${20 + tilt / 3} 43 25 64" fill="none" stroke="#829b74" stroke-width="1.6" stroke-linecap="round"/>
    <path d="M24 51Q9 53 10 40Q20 40 24 51Z" fill="#c1d1ad"/><path d="M23 43Q37 43 38 32Q27 33 23 43Z" fill="#a5bd94"/>
    <g transform="rotate(${tilt} 24 23)">${Array.from({ length: petals }, (_, i) => `<ellipse cx="24" cy="${23 - length * .75}" rx="${width}" ry="${length}" transform="rotate(${i * 360 / petals} 24 23)" fill="${i % 2 ? light : petal}" stroke="${edge}" stroke-width=".45"/>`).join('')}</g>
    <circle cx="24" cy="23" r="4.5" fill="#e5c76e"/><circle cx="23" cy="22" r="1.2" fill="#fff4cf"/>
  </svg>`.replace(/>\s+</g, '><');
}

export function createFlower(seed) {
  const template = document.createElement('template');
  template.innerHTML = flowerMarkup(seed);
  return template.content.firstElementChild;
}

export function createBouquet(seeds) {
  const bouquet = document.createElement('span');
  bouquet.className = 'flower-bouquet';
  bouquet.setAttribute('aria-hidden', 'true');
  for (const seed of [...seeds].sort().slice(0, 3)) bouquet.append(createFlower(seed));
  return bouquet;
}
