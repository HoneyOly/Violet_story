/* =====================================================================
   main.js — сцена Three.js, модель книги, анимации GSAP, звук.
   Контент книг лежит в js/books-data.js (глобальная константа BOOKS).
   ===================================================================== */

/* ---------- параметры модели ---------- */
const BOOK_COUNT = 7;
const W = 2.0, H = 2.8, C = 0.09;     // обложка: ширина, высота, толщина
const G = 0.07;                       // толщина одного листа в стопке
const RS = 4, LS = 4;                 // окно листов: сколько лежит справа / слева (остальные «виртуальны»)
const B = 8 * G;                      // толщина блока страниц в закрытом виде
const SP = 0.16;                      // ширина корешка
const LW = 1.9, LH = 2.62;            // размеры листа
const SEG = 28, BEND = 0.85;          // сегменты и сила изгиба листа
const PW = 512, PH = 706;             // размер текстуры страницы (px)
const MARGIN = 58, TEXT_W = PW - MARGIN * 2 - 14;
const TEXT_FONT = '500 25px "Cormorant Garamond",Georgia,serif', LINE = 33;
const TEXT_H = 560;                    // высота области текста на странице (px)
const TITLE_H = 60;                    // место под заголовок главы
const ILL_W = PW - 68;                 // ширина иллюстрации на странице
const REVEAL_SEC = 5.5, REVEAL_DELAY = .5;   // «раскрашивание»: длительность и задержка после открытия страницы

/* ---------- пути к ресурсам (замените файлы — код менять не нужно) ---------- */
const AUDIO_SRC = {
  ambient: 'assets/audio/ambient.mp3',       // фоновая музыка / атмосфера
  flip:    'assets/audio/flip.mp3',          // перелистывание страницы
  open:    'assets/audio/book-open.mp3',     // выезд / открытие / закрытие книги
};

/* Локальное открытие по file:// блокирует картинки в WebGL-текстурах (CORS) — тогда картинки пропускаем */
const LOCAL_FILE = location.protocol === 'file:';

/* =====================================================================
   ЗВУК: обычные Audio-элементы + запасной синтез, если mp3 не найден
   ===================================================================== */
const Sound = (() => {
  let on = true, started = false, ctx = null;
  try { on = localStorage.getItem('soundOn') !== '0'; } catch (e) {}
  const els = {}, missing = {};
  for (const k in AUDIO_SRC) {
    const a = new Audio(AUDIO_SRC[k]); a.preload = 'auto';
    a.addEventListener('error', () => { missing[k] = true; });   // файла нет → будем синтезировать
    els[k] = a;
  }
  els.ambient.loop = true; els.ambient.volume = 0.3;

  // Простой синтез шума (на случай отсутствия flip.mp3 / book-open.mp3)
  function synth(name) {
    try {
      ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
      const dur = name === 'flip' ? .35 : .6, buf = ctx.createBuffer(1, ctx.sampleRate * dur, ctx.sampleRate), d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 2);
      const src = ctx.createBufferSource(); src.buffer = buf;
      const f = ctx.createBiquadFilter(); f.type = name === 'flip' ? 'bandpass' : 'lowpass'; f.frequency.value = name === 'flip' ? 2200 : 300;
      const g = ctx.createGain(); g.gain.value = .35;
      src.connect(f); f.connect(g); g.connect(ctx.destination); src.start();
    } catch (e) {}
  }
  return {
    get on() { return on; },
    play(name) {                                    // короткий эффект (можно накладывать друг на друга)
      if (!on) return;
      if (missing[name]) return synth(name);
      const a = els[name].cloneNode(); a.volume = .8;
      a.play().catch(() => synth(name));
    },
    startAmbient() {                                // запускается от первого жеста пользователя (политика автоплея)
      started = true; if (on && !missing.ambient) els.ambient.play().catch(() => {});
    },
    ambientLevel(v) { gsap.to(els.ambient, { volume: v, duration: 1.5 }); },   // тише на полке, громче при чтении
    toggle() {
      on = !on; try { localStorage.setItem('soundOn', on ? '1' : '0'); } catch (e) {}
      if (!on) els.ambient.pause(); else if (started && !missing.ambient) els.ambient.play().catch(() => {});
      return on;
    },
  };
})();
const soundBtn = document.getElementById('sound');
const paintSound = () => { soundBtn.textContent = Sound.on ? '🔊 Звук: ВКЛ' : '🔇 Звук: ВЫКЛ'; soundBtn.setAttribute('aria-pressed', Sound.on); };
soundBtn.onclick = () => { Sound.toggle(); paintSound(); };
paintSound();
['pointerdown', 'keydown'].forEach(ev => addEventListener(ev, () => Sound.startAmbient(), { once: true }));

/* Шрифты для canvas грузятся лениво — запрашиваем заранее, иначе разбивка текста на страницы посчитается по запасному шрифту */
if (document.fonts && document.fonts.load) {
  Promise.all(['500 25px "Cormorant Garamond"', 'italic 500 22px "Cormorant Garamond"', '700 34px "Cormorant SC"', '600 40px "Cormorant SC"'].map(f => document.fonts.load(f, 'Аб'))).catch(() => {}).then(() => { storyCache.length = 0; });
}

/* ---------- фон: если файл видео/gif не найден — элемент удаляется ---------- */
document.getElementById('bg').addEventListener('error', e => { const t = e.target; (t.tagName === 'SOURCE' ? t.parentNode : t).remove(); }, true);

/* =====================================================================
   СЦЕНА
   ===================================================================== */
const canvas = document.getElementById('gl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputEncoding = THREE.sRGBEncoding;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 50);
camera.position.set(0, 0, 9);
scene.add(new THREE.AmbientLight(0x9a8a78, 0.85));
const key = new THREE.DirectionalLight(0xffe3b0, 0.95); key.position.set(-4, 6, 8); scene.add(key);
const warm = new THREE.PointLight(0xffa850, 0.7, 25); warm.position.set(3, 1, 6); scene.add(warm);
const aniso = renderer.capabilities.getMaxAnisotropy();

/* ---------- процедурные текстуры ---------- */
const mk = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
const tex = (c, srgb = true) => { const t = new THREE.CanvasTexture(c); if (srgb) t.encoding = THREE.sRGBEncoding; t.anisotropy = aniso; return t; };
function noise(ctx, w, h, amp) {
  const d = ctx.getImageData(0, 0, w, h), a = d.data;
  for (let i = 0; i < a.length; i += 4) { const n = (Math.random() - .5) * amp; a[i] += n; a[i+1] += n; a[i+2] += n; }
  ctx.putImageData(d, 0, 0);
}
const LEATHER = (() => {                                // состаренная кожа
  const c = mk(512, 512), x = c.getContext('2d');
  x.fillStyle = '#4b2b15'; x.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 900; i++) {
    x.fillStyle = `rgba(${Math.random() < .5 ? '20,8,0' : '120,70,35'},${Math.random() * .12})`;
    x.beginPath(); x.arc(Math.random() * 512, Math.random() * 512, 4 + Math.random() * 26, 0, 7); x.fill();
  }
  x.strokeStyle = 'rgba(15,6,0,.35)';
  for (let i = 0; i < 160; i++) {
    let px = Math.random() * 512, py = Math.random() * 512; x.beginPath(); x.moveTo(px, py);
    for (let k = 0; k < 5; k++) { px += (Math.random() - .5) * 40; py += (Math.random() - .5) * 40; x.lineTo(px, py); }
    x.stroke();
  }
  noise(x, 512, 512, 38); return c;
})();
const PARCH = (() => {                                  // общая основа пергамента
  const c = mk(PW, PH), x = c.getContext('2d');
  x.fillStyle = '#d8bf88'; x.fillRect(0, 0, PW, PH);
  for (let i = 0; i < 40; i++) {
    const px = Math.random() * PW, py = Math.random() * PH, r = 40 + Math.random() * 120;
    const rg = x.createRadialGradient(px, py, 0, px, py, r);
    rg.addColorStop(0, `rgba(120,80,30,${.05 + Math.random() * .1})`); rg.addColorStop(1, 'rgba(120,80,30,0)');
    x.fillStyle = rg; x.fillRect(px - r, py - r, r * 2, r * 2);
  }
  const v = x.createRadialGradient(PW / 2, PH / 2, PH * .25, PW / 2, PH / 2, PH * .75);
  v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(70,40,10,.45)');
  x.fillStyle = v; x.fillRect(0, 0, PW, PH);
  noise(x, PW, PH, 18); return c;
})();
const edgeTex = vertical => {
  const c = mk(128, 128), x = c.getContext('2d'); x.fillStyle = '#cdb07a'; x.fillRect(0, 0, 128, 128);
  x.strokeStyle = 'rgba(90,60,20,.35)';
  for (let i = 0; i < 128; i += 3) { x.beginPath(); vertical ? (x.moveTo(i, 0), x.lineTo(i, 128)) : (x.moveTo(0, i), x.lineTo(128, i)); x.stroke(); }
  return tex(c);
};
const roman = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];
const goldGrad = (x, y0, y1) => { const g = x.createLinearGradient(0, y0, 0, y1); g.addColorStop(0, '#f0d98a'); g.addColorStop(.5, '#b98c30'); g.addColorStop(1, '#e6c670'); return g; };
function coverCanvas(n) {                               // обложка с золотым тиснением
  const w = 512, h = 717, c = mk(w, h), x = c.getContext('2d');
  x.drawImage(LEATHER, 0, 0, w, h);
  x.shadowColor = 'rgba(0,0,0,.7)'; x.shadowBlur = 3; x.shadowOffsetX = 2; x.shadowOffsetY = 2;
  x.strokeStyle = goldGrad(x, 0, h); x.fillStyle = x.strokeStyle;
  x.lineWidth = 5; x.strokeRect(26, 26, w - 52, h - 52); x.lineWidth = 2; x.strokeRect(42, 42, w - 84, h - 84);
  for (const [cx, cy, sx, sy] of [[42,42,1,1],[w-42,42,-1,1],[42,h-42,1,-1],[w-42,h-42,-1,-1]]) {
    x.lineWidth = 3; x.beginPath(); x.arc(cx + sx * 34, cy + sy * 34, 26, 0, 7); x.stroke();
    x.beginPath(); x.arc(cx + sx * 34, cy + sy * 34, 8, 0, 7); x.fill();
  }
  x.save(); x.translate(w / 2, h / 2 - 20); x.lineWidth = 4;
  for (const r of [150, 120, 70]) { x.beginPath(); x.arc(0, 0, r, 0, 7); x.stroke(); }
  for (const a of [0, Math.PI / 4]) { x.save(); x.rotate(a); x.strokeRect(-100, -100, 200, 200); x.restore(); }
  for (let i = 0; i < 16; i++) { x.save(); x.rotate(i * Math.PI / 8); x.fillRect(-2, -150, 4, -14); x.restore(); }
  x.font = '600 96px "Cormorant SC",Georgia,serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText(roman[n - 1], 0, 4); x.restore();
  x.font = '600 40px "Cormorant SC",Georgia,serif'; x.textAlign = 'center'; x.fillText('КНИГА ' + roman[n - 1], w / 2, h - 96);
  return c;
}
function spineCanvas(n) {
  const w = 128, h = 640, c = mk(w, h), x = c.getContext('2d');
  x.drawImage(LEATHER, 0, 0, w, h); x.fillStyle = goldGrad(x, 0, h);
  for (const y of [30, 52, 150, 172, h - 172, h - 150, h - 52, h - 30]) x.fillRect(8, y, w - 16, 7);
  x.save(); x.translate(w / 2, h / 2); x.rotate(Math.PI / 4); x.fillRect(-26, -26, 52, 52); x.restore();
  x.fillStyle = '#4b2b15'; x.font = '600 34px "Cormorant SC",Georgia,serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText(roman[n - 1], w / 2, h / 2 + 2); return c;
}

/* ---------- материалы ---------- */
const leatherT = tex(LEATHER);
const leatherM = new THREE.MeshStandardMaterial({ map: leatherT, bumpMap: tex(LEATHER, false), bumpScale: 1.5, roughness: .8 });
const innerM = new THREE.MeshStandardMaterial({ map: leatherT, color: 0x8f7458, roughness: .9 });
const goldM = new THREE.MeshPhongMaterial({ color: 0xc9a227, specular: 0xffe9a0, shininess: 70 });
const edgeV = new THREE.MeshStandardMaterial({ map: edgeTex(true), roughness: .95 });
const edgeH = new THREE.MeshStandardMaterial({ map: edgeTex(false), roughness: .95 });

/* ---------- модель книги ---------- */
function addCorners(mesh, zs) {                         // золотые уголки и заклёпки
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
    const g = new THREE.Group(); g.position.set(sx * (W / 2 - .02), sy * (H / 2 - .02), zs * (C / 2 + .012));
    const a = new THREE.Mesh(new THREE.BoxGeometry(.46, .07, .025), goldM); a.position.x = -sx * .23;
    const b = new THREE.Mesh(new THREE.BoxGeometry(.07, .46, .025), goldM); b.position.y = -sy * .23;
    const s = new THREE.Mesh(new THREE.CylinderGeometry(.07, .07, .04, 16), goldM); s.rotation.x = Math.PI / 2; s.position.set(-sx * .09, -sy * .09, 0);
    g.add(a, b, s); mesh.add(g);
  }
}
function buildBook(n) {                                 // n = 1..7 — уникальный ID книги
  const holder = new THREE.Group(), inner = new THREE.Group(); holder.add(inner);
  const coverM = new THREE.MeshStandardMaterial({ map: tex(coverCanvas(n)), bumpMap: tex(LEATHER, false), bumpScale: 1, roughness: .65 });
  const spineM = new THREE.MeshStandardMaterial({ map: tex(spineCanvas(n)), roughness: .6 });
  const back = new THREE.Mesh(new THREE.BoxGeometry(W, H, C), [leatherM, leatherM, leatherM, leatherM, innerM, coverM]);
  back.position.set(W / 2, 0, -C / 2); addCorners(back, -1); inner.add(back);
  const cover = new THREE.Group(); cover.position.z = B + C / 2; inner.add(cover);     // обложка на шарнире x=0
  const front = new THREE.Mesh(new THREE.BoxGeometry(W, H, C), [leatherM, leatherM, leatherM, leatherM, coverM, innerM]);
  front.position.x = W / 2; addCorners(front, 1); cover.add(front);
  const D = B + 2 * C;
  const spine = new THREE.Mesh(new THREE.BoxGeometry(SP, H, D), [leatherM, spineM, leatherM, leatherM, leatherM, leatherM]);
  spine.position.set(-SP / 2, 0, B / 2); inner.add(spine);
  const BH = B - .02;                                    // плотный блок страниц (виден в закрытом виде)
  const block = new THREE.Mesh(new THREE.BoxGeometry(LW, LH, BH), [edgeV, edgeV, edgeH, edgeH, edgeV, edgeV]);
  block.position.set(LW / 2, 0, BH / 2); inner.add(block);
  inner.position.x = -(W - SP) / 2;                      // центрируем закрытую книгу по горизонтали
  holder.userData = { isBook: true, id: n, inner, cover, spine, block, D, BH, leaves: new Map(), p: 0, anim: 0, state: 'shelf' };
  return holder;
}

/* =====================================================================
   СОДЕРЖИМОЕ СТРАНИЦ (данные берутся из BOOKS в books-data.js)
   ===================================================================== */
const MEASURE = mk(8, 8).getContext('2d'), imgCache = {}, storyCache = [];
function loadImage(src, cb) {                           // загрузка картинки с кэшем; cb вызывается, когда она готова
  let im = imgCache[src];
  if (!im) { im = imgCache[src] = new Image(); if (/^https?:/i.test(src)) im.crossOrigin = 'anonymous'; im.src = src; }
  const ok = im.complete && im.naturalWidth > 0;
  if (!ok && cb) im.addEventListener('load', cb, { once: true });
  return ok ? im : null;
}
function wrap(ctx, text, w) {                           // перенос строк по ширине листа
  ctx.font = TEXT_FONT; const out = [];
  for (const para of text.split('\n')) {
    if (!para.trim()) { out.push(''); continue; }
    let line = '';
    for (const word of para.split(' ')) {
      const t = line ? line + ' ' + word : word;
      if (ctx.measureText(t).width > w && line) { out.push(line); line = word; } else line = t;
    }
    out.push(line);
  }
  return out;
}
const illH = ill => Math.round(ILL_W / (ill.aspect || 1.78));
/* Главы → список страниц. Первая страница главы: заголовок + иллюстрация + начало текста,
   остальной текст автоматически идёт на следующие страницы. */
function buildPages(b) {
  const chapters = b.chapters || (b.story ? [{ title: b.title, text: b.story }] : []), pages = [];
  for (const ch of chapters) {
    const lines = wrap(MEASURE, ch.text || '', TEXT_W); let i = 0, first = true;
    do {
      const pg = { lines: [] }; let used = 0;
      if (first) {
        if (ch.title) { pg.title = ch.title; used += TITLE_H; }
        if (ch.illustration) { pg.ill = ch.illustration; used += illH(ch.illustration) + 18; if (ch.illustration.caption) used += 36; }
      }
      const cap = Math.max(0, Math.floor((TEXT_H - used) / LINE)); pg.lines = lines.slice(i, i + cap); i += cap;
      while (pg.lines.length && pg.lines[0] === '') pg.lines.shift();
      pages.push(pg); first = false;
    } while (i < lines.length);
  }
  return pages;
}
function getPage(bi, s) {                               // содержимое стороны s книги bi (бесконечно)
  const b = BOOKS[bi] || {};
  if (!storyCache[bi]) storyCache[bi] = buildPages(b);
  const sp = storyCache[bi], manual = b.pages || [], total = Math.max(sp.length, manual.length);
  if (b.loop && total) s %= total;                      // цикл: после последней страницы — снова первая
  let c = manual[s];
  if (c == null || c === '') c = sp[s];
  if (typeof c === 'string') c = { text: c };
  if (c && c.img && !c.ill) c = { ...c, ill: { sketch: c.img, aspect: c.aspect || 1.5, caption: c.caption } };   // старый формат img
  return c || null;                                     // null → чистый пергамент
}

/* ---------- иллюстрация: карандашный набросок → «раскрашивается» в цветную ----------
   Для каждой пары картинок один раз строится карта «времени закраски» (слева направо + пятнистый шум),
   затем кадр за кадром набросок плавно замещается цветной версией. Прогресс p: 0 = набросок, 1 = цвет. */
const reveals = {};
function getReveal(ill, w, h) {
  const key = ill.sketch + '|' + ill.color; if (reveals[key]) return reveals[key];
  const sk = loadImage(ill.sketch), co = loadImage(ill.color); if (!sk || !co) return null;
  const grab = im => { const c = mk(w, h), cx = c.getContext('2d'); cx.drawImage(im, 0, 0, w, h); return cx.getImageData(0, 0, w, h).data; };
  const A = grab(sk), Bc = grab(co), T = new Float32Array(w * h);
  const grid = (gw, gh) => { const g = new Float32Array((gw + 1) * (gh + 1)).map(Math.random); return (u, v) => {     // сглаженный шум
    const x = u * gw, y = v * gh, i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j, W1 = gw + 1;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy), a = g[j * W1 + i], b = g[j * W1 + i + 1], c = g[(j + 1) * W1 + i], d = g[(j + 1) * W1 + i + 1];
    return (a + (b - a) * sx) * (1 - sy) + (c + (d - c) * sx) * sy; }; };
  const n1 = grid(7, 4), n2 = grid(22, 12);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const u = x / (w - 1), v = y / (h - 1);
    T[y * w + x] = .5 * u + .08 * v + .27 * n1(u, v) + .15 * n2(u, v);       // порядок закраски
  }
  let mn = 1e9, mx = -1e9; for (const t of T) { if (t < mn) mn = t; if (t > mx) mx = t; }
  for (let i = 0; i < T.length; i++) T[i] = (T[i] - mn) / (mx - mn);
  const out = mk(w, h), ox = out.getContext('2d'), img = ox.createImageData(w, h);
  const R = { p: 0, w, h, out, tween: null, key,
    compose(p) {
      const d = img.data, soft = .22, edge = p * (1 + soft);
      for (let i = 0, k = 0; i < T.length; i++, k += 4) {
        let a = (edge - T[i]) / soft; a = a < 0 ? 0 : a > 1 ? 1 : a * a * (3 - 2 * a);
        d[k] = A[k] + (Bc[k] - A[k]) * a; d[k+1] = A[k+1] + (Bc[k+1] - A[k+1]) * a; d[k+2] = A[k+2] + (Bc[k+2] - A[k+2]) * a; d[k+3] = 255;
      }
      ox.putImageData(img, 0, 0);
    } };
  R.compose(0); return reveals[key] = R;
}
function drawIllustration(x, ill, f, bi, s, y) {        // рисует иллюстрацию на странице, возвращает новый y
  const w = ILL_W, h = illH(ill), dx = (PW - w) / 2;
  if (!LOCAL_FILE) {
    const redo = () => { if (f.s === s) renderFace(f, bi, s); };
    const sk = loadImage(ill.sketch, redo); if (ill.color) loadImage(ill.color, redo);
    const R = ill.color ? getReveal(ill, w, h) : null;
    if (R) x.drawImage(R.out, dx, y);
    else if (sk) x.drawImage(sk, dx, y, w, h);
    x.save(); x.globalCompositeOperation = 'multiply'; x.globalAlpha = .3; x.drawImage(PARCH, dx, y, w, h, dx, y, w, h); x.restore();   // «пергаментный» тон поверх
    x.strokeStyle = 'rgba(50,30,10,.45)'; x.lineWidth = 1.5; x.strokeRect(dx, y, w, h);
  }
  y += h + 18;
  if (ill.caption) { x.font = 'italic 500 22px "Cormorant Garamond",Georgia,serif'; x.textAlign = 'center'; x.fillStyle = '#2b1a0c'; x.fillText(ill.caption, PW / 2, y); y += 36; }
  return y;
}
/* Запуск раскрашивания для страниц, которые сейчас видны (вызывается после открытия книги и перелистывания) */
function revealVisible(u) {
  if (u.state !== 'reading') return;
  const sides = [2 * u.p]; if (u.p > 0) sides.push(2 * u.p - 1);
  sides.forEach(s => {
    const c = getPage(u.id - 1, s), ill = c && c.ill; if (!ill || !ill.color || LOCAL_FILE) return;
    const R = getReveal(ill, ILL_W, illH(ill)); if (!R || R.p >= 1 || R.tween) return;
    const st = { p: R.p };
    R.tween = gsap.to(st, { p: 1, duration: REVEAL_SEC, delay: REVEAL_DELAY, ease: 'power1.inOut',
      onUpdate: () => { R.p = st.p; R.compose(R.p); refreshIll(u, ill); },
      onComplete: () => { R.p = 1; R.compose(1); R.tween = null; refreshIll(u, ill); } });
  });
}
function refreshIll(u, ill) {                           // перерисовать грани листов, на которых эта иллюстрация
  u.leaves.forEach(L => L.faces.forEach(f => { const c = f.s >= 0 && getPage(u.id - 1, f.s); if (c && c.ill && c.ill.sketch === ill.sketch) renderFace(f, u.id - 1, f.s); }));
}
function resetReveals() { for (const k in reveals) { const R = reveals[k]; if (R.tween) R.tween.kill(); R.tween = null; R.p = 0; R.compose(0); } }

/* Грань листа: canvas → CanvasTexture. Текст рисуется прямо на текстуре пергамента. */
function makeFace(isRight) {
  const c = mk(PW, PH), t = tex(c);
  if (!isRight) { t.wrapS = THREE.RepeatWrapping; t.repeat.x = -1; t.offset.x = 1; }   // оборот листа зеркален по u
  return { c, x: c.getContext('2d'), t, isRight, s: -1 };
}
function renderFace(f, bi, s) {
  f.s = s; const x = f.x, c0 = getPage(bi, s);
  x.drawImage(PARCH, 0, 0);
  const gx = f.isRight ? 0 : PW, g = x.createLinearGradient(gx, 0, f.isRight ? PW * .2 : PW * .8, 0);   // тень у корешка
  g.addColorStop(0, 'rgba(40,20,5,.5)'); g.addColorStop(1, 'rgba(40,20,5,0)'); x.fillStyle = g; x.fillRect(0, 0, PW, PH);
  const ox = f.isRight ? MARGIN + 14 : MARGIN; let y = MARGIN + 10;
  x.fillStyle = '#2b1a0c'; x.textBaseline = 'top';
  if (c0) {
    if (c0.title) { x.font = '700 34px "Cormorant SC",Georgia,serif'; x.textAlign = 'center'; x.fillText(c0.title, ox + TEXT_W / 2, y); y += 60; }
    if (c0.ill) y = drawIllustration(x, c0.ill, f, bi, s, y);   // иллюстрация главы (набросок → цвет)
    const lines = c0.lines || (c0.text ? wrap(x, c0.text, TEXT_W) : []);
    x.font = TEXT_FONT; x.textAlign = 'left';
    for (const ln of lines) { x.fillText(ln, ox, y); y += LINE; }
  }
  x.font = '500 20px "Cormorant Garamond",Georgia,serif'; x.textAlign = 'center'; x.fillStyle = 'rgba(60,35,10,.7)';
  x.fillText(String(s + 1), ox + TEXT_W / 2, PH - 50);   // номер страницы
  f.t.needsUpdate = true;
}

/* ---------- листы: лицо (справа) + оборот (слева), изгиб при перелистывании ---------- */
function makeLeaf(bi, v) {                              // v — виртуальный номер листа: лицо = стр. 2v, оборот = стр. 2v+1
  const geo = new THREE.BufferGeometry(), uv = [], idx = [];
  for (let j = 0; j <= SEG; j++) uv.push(j / SEG, 0, j / SEG, 1);
  for (let j = 0; j < SEG; j++) { const a = 2 * j; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array((SEG + 1) * 6), 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); geo.setIndex(idx);
  const ff = makeFace(true), fb = makeFace(false); renderFace(ff, bi, 2 * v); renderFace(fb, bi, 2 * v + 1);
  const mf = new THREE.MeshStandardMaterial({ map: ff.t, roughness: .95, side: THREE.FrontSide });
  const mb = new THREE.MeshStandardMaterial({ map: fb.t, roughness: .95, side: THREE.BackSide });
  const grp = new THREE.Group(); grp.add(new THREE.Mesh(geo, mf), new THREE.Mesh(geo, mb));
  return { v, geo, grp, theta: 0, zR: 0, zL: 0, fresh: true, mats: [mf, mb], faces: [ff, fb] };
}
function updateLeaf(L) {
  const pos = L.geo.attributes.position, th = L.theta, bend = BEND * Math.sin(th), du = LW / SEG;
  const z0 = THREE.MathUtils.lerp(L.zR, L.zL, th / Math.PI);
  let x = 0, z = 0;
  for (let j = 0; j <= SEG; j++) {
    pos.setXYZ(2 * j, x, -LH / 2, z + z0); pos.setXYZ(2 * j + 1, x, LH / 2, z + z0);
    const a = th - bend * ((j + .5) / SEG); x += Math.cos(a) * du; z += Math.sin(a) * du;
  }
  pos.needsUpdate = true; L.geo.computeVertexNormals();
}
function addLeaf(u, v, theta) {
  const L = makeLeaf(u.id - 1, v); L.theta = theta; u.inner.add(L.grp); u.leaves.set(v, L); return L;
}
function removeLeaf(u, v) {
  const L = u.leaves.get(v); if (!L) return;
  gsap.killTweensOf(L); u.inner.remove(L.grp); L.geo.dispose(); L.mats.forEach(m => { m.map.dispose(); m.dispose(); }); u.leaves.delete(v);
}
function restack(u, tween) {                            // высоты стопок слева и справа относительно текущей страницы p
  u.leaves.forEach(L => {
    const zR = (RS - (L.v - u.p)) * G, zL = (LS - (u.p - 1 - L.v)) * G;
    if (!tween || L.fresh) { L.zR = zR; L.zL = zL; L.fresh = false; updateLeaf(L); }
    else gsap.to(L, { zR, zL, duration: .6, ease: 'power2.out', onUpdate: () => updateLeaf(L) });
  });
}

/* =====================================================================
   ПОЛКА И РАСКЛАДКА
   ===================================================================== */
const shelfEl = document.getElementById('shelf'), books = [];
/* Каждый слот — кликабельная кнопка на ВСЮ рамку (углы, середина, подпись). Выбор книги идёт по
   номеру слота, а не по попаданию луча в 3D-модель, поэтому клик всегда достаёт именно эту книгу. */
for (let n = 1; n <= BOOK_COUNT; n++) {
  const d = document.createElement('div');
  d.className = 'slot'; d.dataset.n = n; d.setAttribute('role', 'button'); d.tabIndex = 0;
  d.innerHTML = `<span>Книга ${n}</span>`; shelfEl.appendChild(d);
  d.addEventListener('click', () => onSlot(n - 1));
  d.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSlot(n - 1); } });
  d.addEventListener('pointerenter', () => hoverSlot(n - 1, true));
  d.addEventListener('pointerleave', () => hoverSlot(n - 1, false));
}
const slotEls = [...shelfEl.children];
const S = { cur: null, closedScale: 1, readScale: 1, cx: 0 };
const shelfQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.05, 0.55, 0));
const centerQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.15, -0.35, 0));
const readQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.32, 0, 0));
const vel = new THREE.Vector2();

/* ★ ИСПРАВЛЕННОЕ ПОЗИЦИОНИРОВАНИЕ ★
   Для каждого слота берём его рамку (getBoundingClientRect), вычитаем нижнюю полосу с подписью
   и ставим книгу в ЦЕНТР оставшейся области. Масштаб — по высоте этой области, поэтому книга
   лежит строго внутри рамки и не заходит на подпись. Пиксели → мировые координаты плоскости z=0
   (камера смотрит в начало координат). Подгонка вручную: SHELF_FILL — доля свободной области,
   которую занимает книга; SHELF_NUDGE_PX — сдвиг по Y в пикселях (+ вниз). */
const SHELF_FILL = 0.78, SHELF_NUDGE_PX = 0;
let layoutSig = '';
/* «Подпись» геометрии: если хоть что-то из этого изменилось (шрифты, видео-фон, панель браузера,
   масштаб, дозагрузка страницы) — книги пересчитываются. Проверяется каждый кадр, поэтому
   книги больше не «уезжают» через несколько секунд после загрузки. */
function layoutSignature() {
  const c = canvas.getBoundingClientRect(), s = shelfEl.getBoundingClientRect(), a = slotEls[0].getBoundingClientRect(), z = slotEls[BOOK_COUNT - 1].getBoundingClientRect();
  return [c.left, c.top, c.width, c.height, s.left, s.top, s.width, s.height, a.top, a.height, z.top, z.height, devicePixelRatio]
    .map(n => Math.round(n * 10)).join('|');
}
function layout() {
  /* Единая система координат: размеры берём у САМОГО canvas (его CSS-прямоугольник на экране).
     Тогда пиксель экрана ↔ точка сцены совпадают при любом размере окна, масштабе и смещении. */
  const cr = canvas.getBoundingClientRect(), cw = Math.max(1, Math.round(cr.width)), ch = Math.max(1, Math.round(cr.height));
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(cw, ch, false);
  camera.aspect = cw / ch; camera.updateProjectionMatrix(); camera.updateMatrixWorld();
  const visH = 2 * camera.position.z * Math.tan(camera.fov * Math.PI / 360), visW = visH * camera.aspect, ppu = visH / ch;
  books.forEach((b, k) => {
    const r = slotEls[k].getBoundingClientRect();
    const labelH = slotEls[k].firstElementChild.getBoundingClientRect().height + 4;    // подпись + небольшой зазор
    const top = r.top, bottom = r.bottom - labelH, availH = Math.max(10, bottom - top);
    const cxPx = r.left + r.width / 2, cyPx = top + availH / 2 + SHELF_NUDGE_PX;       // центр свободной зоны слота (px окна)
    const pos = new THREE.Vector3((cxPx - cr.left - cw / 2) * ppu, -(cyPx - cr.top - ch / 2) * ppu, 0);
    const s = Math.min(availH * SHELF_FILL, r.width * .8 * H / 2.1) * ppu / H;       // масштаб по высоте/ширине рамки
    b.userData.shelf = { pos, s };
    if (b.userData.state === 'shelf') { b.position.copy(pos); b.scale.setScalar(s); }
  });
  const panel = shelfEl.getBoundingClientRect().width * ppu, free = visW - panel * 1.1;
  S.closedScale = Math.min(visH * .6 / H, free * .62 / 2.2);
  S.readScale = Math.min(visH * .66 / H, free * .9 / (2 * W));
  S.cx = -panel / 2;
  layoutSig = layoutSignature();
  const cur = S.cur; if (cur && cur.userData.state === 'center') { cur.position.x = S.cx; cur.scale.setScalar(S.closedScale); }
}
for (let n = 1; n <= BOOK_COUNT; n++) { const b = buildBook(n); b.quaternion.copy(shelfQ); scene.add(b); books.push(b); }
layout();
addEventListener('resize', layout); addEventListener('load', layout);
if (window.visualViewport) visualViewport.addEventListener('resize', layout);
const ro = new ResizeObserver(layout); ro.observe(shelfEl); ro.observe(canvas);
if (document.fonts) document.fonts.ready.then(layout);

/* ---------- UI ---------- */
const $ = id => document.getElementById(id), hint = $('hint');
function ui() {
  const st = S.cur ? S.cur.userData.state : 'shelf';
  $('gCenter').classList.toggle('on', st === 'center'); $('gRead').classList.toggle('on', st === 'reading');
  slotEls.forEach((el, k) => {                          // слот выехавшей книги подсвечен; клик по нему вернёт книгу
    const out = books[k] === S.cur; el.classList.toggle('out', out);
    el.setAttribute('aria-label', out ? `Вернуть книгу ${k + 1} на полку` : `Достать книгу ${k + 1}`);
    el.title = out ? 'Нажмите, чтобы вернуть книгу на полку' : '';
  });
  hint.textContent = LOCAL_FILE && st === 'shelf' ? 'Запустите через локальный сервер, чтобы работали картинки в книгах'
    : { shelf: 'Нажмите на любой слот справа, чтобы достать книгу', center: 'Вращайте книгу мышью. Клик по книге — открыть, клик по её слоту — вернуть',
        reading: 'Клик справа — вперёд, слева — назад (или стрелки ← →). Слот книги — вернуть на полку' }[st] || '';
  if (S.cur && st === 'reading') { const p = S.cur.userData.p; $('pg').textContent = p === 0 ? 'Стр. 1' : `Стр. ${2 * p}–${2 * p + 1}`; $('bPrev').disabled = p === 0; }
}

/* =====================================================================
   АНИМАЦИИ (со звуками)
   ===================================================================== */
const slerpTo = (b, q, o) => { const q0 = b.quaternion.clone(); return () => b.quaternion.slerpQuaternions(q0, q, o.t); };
function toCenter(b) {                                  // выезд ИМЕННО выбранной книги из её слота
  if (S.cur || b.userData.state !== 'shelf') return;
  S.cur = b; const u = b.userData; u.state = 'moving'; ui(); gsap.killTweensOf(b.scale);
  Sound.play('open');                                   // 🔊 звук выезда книги
  const o = { t: 0 };
  gsap.timeline({ onComplete: () => { u.state = 'center'; ui(); } })
    .to(b.position, { x: S.cx, y: 0, z: 1.5, duration: 1.1, ease: 'power3.inOut' }, 0)
    .to(b.scale, { x: S.closedScale, y: S.closedScale, z: S.closedScale, duration: 1.1, ease: 'power3.inOut' }, 0)
    .to(o, { t: 1, duration: 1.1, ease: 'power2.inOut', onUpdate: slerpTo(b, centerQ, o) }, 0);
}
function toShelf(b, done) {                             // возврат в СВОЙ слот
  const u = b.userData; if (u.state !== 'center') return; u.state = 'moving'; vel.set(0, 0); ui();
  Sound.play('open'); Sound.ambientLevel(.3);
  const o = { t: 0 }, sh = u.shelf;
  gsap.timeline({ onComplete: () => { u.state = 'shelf'; S.cur = null; layout(); ui(); done && done(); } })
    .to(b.position, { x: sh.pos.x, y: sh.pos.y, z: sh.pos.z, duration: 1, ease: 'power3.inOut' }, 0)
    .to(b.scale, { x: sh.s, y: sh.s, z: sh.s, duration: 1, ease: 'power3.inOut' }, 0)
    .to(o, { t: 1, duration: 1, ease: 'power2.inOut', onUpdate: slerpTo(b, shelfQ, o) }, 0);
}
function openBook() {                                   // обложка откидывается влево
  const b = S.cur; if (!b || b.userData.state !== 'center') return;
  const u = b.userData; u.state = 'opening'; vel.set(0, 0); ui();
  Sound.startAmbient(); Sound.ambientLevel(.5); Sound.play('open');     // 🔊 эмбиент усиливается при чтении
  u.p = 0; u.anim = 0; for (let v = 0; v < RS; v++) addLeaf(u, v, 0); restack(u, false);
  const o = { t: 0 }, T = 1.4, e = 'power2.inOut';
  gsap.timeline({ onComplete: () => { u.state = 'reading'; ui(); revealVisible(u); } })
    .to(o, { t: 1, duration: 1.2, ease: e, onUpdate: slerpTo(b, readQ, o) }, 0)
    .to(b.position, { x: S.cx, y: 0, z: 0, duration: 1.2, ease: e }, 0)
    .to(b.scale, { x: S.readScale, y: S.readScale, z: S.readScale, duration: 1.2, ease: e }, 0)
    .to(u.cover.rotation, { y: -Math.PI, duration: T, ease: e }, .1)
    .to(u.cover.position, { z: -C / 2, duration: T, ease: e }, .1)
    .to(u.inner.position, { x: 0, duration: T, ease: e }, .1)
    .to(u.spine.scale, { z: C / u.D, duration: T, ease: e }, .1)
    .to(u.spine.position, { z: -C / 2, duration: T, ease: e }, .1)
    .to(u.block.scale, { z: .5, duration: .5, ease: e }, .1)
    .to(u.block.position, { z: u.BH / 4, duration: .5, ease: e }, .1)
    .call(() => { u.block.visible = false; }, null, .65);
}
function flip(dir) {                                    // бесконечное перелистывание вперёд / назад
  const b = S.cur; if (!b || b.userData.state !== 'reading') return; const u = b.userData;
  if ((dir < 0 && u.p === 0) || u.anim >= 2) return;
  const L = u.leaves.get(dir > 0 ? u.p : u.p - 1); if (!L) return;
  Sound.play('flip');                                   // 🔊 звук перелистывания
  u.p += dir; u.anim++; ui();
  gsap.to(L, { theta: dir > 0 ? Math.PI : 0, duration: 1.15, ease: 'power2.inOut', onUpdate: () => updateLeaf(L), onComplete: () => { u.anim--; revealVisible(u); } });
  removeLeaf(u, dir > 0 ? u.p - 1 - LS : u.p + RS);     // лишний лист убираем, новый (с новыми страницами) добавляем
  const add = dir > 0 ? u.p + RS - 1 : u.p - LS; if (add >= 0) addLeaf(u, add, dir > 0 ? 0 : Math.PI);
  restack(u, true);
}
function closeBook(done) {
  const b = S.cur; if (!b || b.userData.state !== 'reading') return;
  const u = b.userData; u.state = 'closing'; u.anim = 0; ui(); Sound.play('open'); resetReveals();
  const o = { t: 0 }, e = 'power2.inOut', T = 1.2, tl = gsap.timeline({ onComplete: () => {
    [...u.leaves.keys()].forEach(v => removeLeaf(u, v)); resetReveals(); u.p = 0; u.state = 'center'; ui(); done && done(); } });
  const left = [...u.leaves.values()].filter(L => L.v < u.p).sort((a, c) => c.v - a.v);   // левую стопку возвращаем вправо
  left.forEach((L, k) => tl.to(L, { theta: 0, duration: .6, ease: e, overwrite: 'auto', onUpdate: () => updateLeaf(L) }, k * .12));
  const t0 = left.length ? .6 + (left.length - 1) * .12 + .1 : 0;
  tl.call(() => { u.block.visible = true; }, null, t0)
    .to(u.block.scale, { z: 1, duration: T, ease: e }, t0).to(u.block.position, { z: u.BH / 2, duration: T, ease: e }, t0)
    .to(u.cover.rotation, { y: 0, duration: T, ease: e }, t0).to(u.cover.position, { z: B + C / 2, duration: T, ease: e }, t0)
    .to(u.inner.position, { x: -(W - SP) / 2, duration: T, ease: e }, t0)
    .to(u.spine.scale, { z: 1, duration: T, ease: e }, t0).to(u.spine.position, { z: B / 2, duration: T, ease: e }, t0)
    .to(b.scale, { x: S.closedScale, y: S.closedScale, z: S.closedScale, duration: T, ease: e }, t0)
    .to(o, { t: 1, duration: T, ease: e, onUpdate: slerpTo(b, centerQ, o) }, t0);
}
/* then — необязательная функция, которая выполнится, когда книга окажется на полке (клик на события не передаётся) */
const backToShelf = then => {
  const b = S.cur; if (!b) return; const fin = typeof then === 'function' ? then : undefined;
  b.userData.state === 'reading' ? closeBook(() => toShelf(b, fin)) : toShelf(b, fin);
};
/* Клик по слоту k:
   • на столе нет книги        → книга k выезжает;
   • клик по слоту ЭТОЙ книги   → она возвращается на полку (если открыта — сначала закрывается);
   • клик по слоту другой книги → текущая уезжает на полку, затем выезжает выбранная. */
function onSlot(k) {
  const b = books[k], cur = S.cur;
  if (!cur) return toCenter(b);
  const st = cur.userData.state; if (st !== 'center' && st !== 'reading') return;      // идёт анимация — игнорируем
  if (cur === b) backToShelf(); else backToShelf(() => toCenter(b));
}
function hoverSlot(k, on) {                             // лёгкий отклик: книга на полке чуть увеличивается под курсором
  const b = books[k]; if (!b || b.userData.state !== 'shelf') return;
  const s = b.userData.shelf.s * (on ? 1.1 : 1);
  gsap.to(b.scale, { x: s, y: s, z: s, duration: .2, overwrite: true });
}

$('bOpen').onclick = openBook; $('bClose').onclick = () => closeBook();
$('bBack1').onclick = $('bBack2').onclick = backToShelf;
$('bPrev').onclick = () => flip(-1); $('bNext').onclick = () => flip(1);
addEventListener('keydown', e => {
  if (e.key === 'ArrowRight') flip(1); else if (e.key === 'ArrowLeft') flip(-1); else if (e.key === 'Escape') backToShelf();
});

/* =====================================================================
   ВВОД: клик по полке, вращение, открытие по клику
   ===================================================================== */
const ray = new THREE.Raycaster(), mouse = new THREE.Vector2(); let drag = null;
function pick(e) {                                      // какая именно книга под курсором
  const cr = canvas.getBoundingClientRect();            // тот же прямоугольник, по которому раскладывается полка
  mouse.set((e.clientX - cr.left) / cr.width * 2 - 1, -((e.clientY - cr.top) / cr.height) * 2 + 1); ray.setFromCamera(mouse, camera);
  const hit = ray.intersectObjects(books, true)[0]; if (!hit) return null;
  let o = hit.object; while (o && !o.userData.isBook) o = o.parent; return o;
}
const qa = new THREE.Quaternion(), AX = new THREE.Vector3(1, 0, 0), AY = new THREE.Vector3(0, 1, 0);
const rotateBy = (dx, dy) => { const q = S.cur.quaternion; q.premultiply(qa.setFromAxisAngle(AY, dx)); q.premultiply(qa.setFromAxisAngle(AX, dy)); };
canvas.addEventListener('pointerdown', e => { drag = { x: e.clientX, y: e.clientY, moved: 0, hit: pick(e) }; canvas.setPointerCapture(e.pointerId); });
canvas.addEventListener('pointermove', e => {
  const st = S.cur && S.cur.userData.state;
  if (drag) {
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y; drag.x = e.clientX; drag.y = e.clientY; drag.moved += Math.abs(dx) + Math.abs(dy);
    if (st === 'center') { vel.set(dx * .008, dy * .008); rotateBy(vel.x, vel.y); }   // вращение на 360° по всем осям
  } else { const h = pick(e); canvas.style.cursor = h && h === S.cur && st === 'center' ? 'pointer' : 'default'; }
});
canvas.addEventListener('pointerup', e => {
  if (!drag) return; const d = drag; drag = null; if (d.moved > 6) return;
  const st = S.cur && S.cur.userData.state;
  if (!S.cur) return;                                                                 // с полки книги достаются кликом по слоту (onSlot)
  if (st === 'center' && d.hit === S.cur) openBook();
  else if (st === 'reading') { const cr = canvas.getBoundingClientRect(); flip(e.clientX > cr.left + (cr.width - shelfEl.offsetWidth) / 2 ? 1 : -1); }
});
(function loop() {
  requestAnimationFrame(loop);
  if (layoutSignature() !== layoutSig) layout();     // страховка: любые поздние изменения вёрстки → пересчёт позиций
  if (!drag && S.cur && S.cur.userData.state === 'center' && vel.lengthSq() > 1e-8) { rotateBy(vel.x, vel.y); vel.multiplyScalar(.94); }
  renderer.render(scene, camera);
})();
ui();
