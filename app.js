'use strict';
/* =====================================================================
   Mi Día — prototipo
   Asistente de agenda con imágenes y voz.
   Todo se guarda en este dispositivo (localStorage).
   ===================================================================== */

/* ---------- Utilidades ---------- */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const uid = () => Math.random().toString(36).slice(2, 10);
const pad = n => String(n).padStart(2, '0');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const MIN = 60000;

const DAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const DAY_SHORT = ['D', 'L', 'M', 'X', 'J', 'V', 'S'];
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];
const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const MODES = {
  pie: { label: 'A pie', emoji: '🚶', phrase: 'Vas caminando' },
  auto: { label: 'Lo llevamos', emoji: '🚗', phrase: 'Te llevamos en auto' },
};

const dateKey = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const startOfDay = d => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const addDays = (d, n) => { const x = startOfDay(d); x.setDate(x.getDate() + n); return x; };
const hhmm = d => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

function listJoin(arr) {
  if (arr.length <= 1) return arr.join('');
  return arr.slice(0, -1).join(', ') + ' y ' + arr[arr.length - 1];
}

/* ---------- Estado ---------- */
const STORE_KEY = 'midia.v1';
const emo = v => ({ type: 'emoji', value: v });

function defaultState() {
  return {
    settings: {
      name: '',
      pin: '1234',
      rate: 0.95,
      voiceURI: '',
      wake: true,
      defaults: { pie: { travel: 10, prep: 20 }, auto: { travel: 20, prep: 15 } },
    },
    items: [
      { id: 'mochila', name: 'Mochila', pic: emo('🎒'), always: true },
      { id: 'celular', name: 'Celular', pic: emo('📱'), always: true },
      { id: 'llaves', name: 'Llaves', pic: emo('🔑'), always: false },
      { id: 'agua', name: 'Botella de agua', pic: emo('💧'), always: false },
      { id: 'campera', name: 'Campera', pic: emo('🧥'), always: false },
      { id: 'malla', name: 'Malla y toalla', pic: emo('🩱'), always: false },
    ],
    activities: [
      { id: uid(), name: 'Fonoaudiología', aliases: 'fono', pic: emo('🗣️'), time: '17:00', repeat: 'weekly', days: [1, 3], date: '', mode: 'auto', travel: 20, prep: 15, items: ['agua'] },
      { id: uid(), name: 'Natación', aliases: 'pileta', pic: emo('🏊'), time: '18:30', repeat: 'weekly', days: [2, 4], date: '', mode: 'pie', travel: 10, prep: 20, items: ['malla', 'agua'] },
      { id: uid(), name: 'Terapia ocupacional', aliases: 'terapia, to', pic: emo('🧩'), time: '10:00', repeat: 'weekly', days: [5, 6], date: '', mode: 'auto', travel: 15, prep: 15, items: ['campera'] },
    ],
    fired: {},   // avisos ya mostrados: "actId|fecha|prep"
    checks: {},  // cosas tildadas: "actId|fecha" -> [itemId]
  };
}

function loadState() {
  try {
    const s = JSON.parse(localStorage.getItem(STORE_KEY));
    if (s && Array.isArray(s.activities)) {
      const d = defaultState();
      return { ...d, ...s, settings: { ...d.settings, ...s.settings, defaults: { ...d.settings.defaults, ...(s.settings || {}).defaults } } };
    }
  } catch { /* sin almacenamiento */ }
  return defaultState();
}

let state = loadState();

function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); }
  catch { toast('No se pudo guardar en este dispositivo'); }
}

function pruneOld() {
  const limit = dateKey(addDays(new Date(), -1));
  for (const bag of [state.fired, state.checks]) {
    for (const k of Object.keys(bag)) {
      const date = k.split('|')[1];
      if (date && date < limit) delete bag[k];
    }
  }
}

/* ---------- Agenda ---------- */
function occursOn(a, day) {
  if (a.repeat === 'once') return a.date === dateKey(day);
  return (a.days || []).includes(day.getDay());
}

function occurrence(a, day) {
  const [h, m] = (a.time || '00:00').split(':').map(Number);
  const start = new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, m);
  const leave = new Date(start - (Number(a.travel) || 0) * MIN);
  const prep = new Date(leave - (Number(a.prep) || 0) * MIN);
  return { a, start, leave, prep, key: `${a.id}|${dateKey(day)}` };
}

function dayList(day) {
  return state.activities.filter(a => occursOn(a, day)).map(a => occurrence(a, day)).sort((x, y) => x.start - y.start);
}

function nextOccurrence(now = new Date(), filter = () => true) {
  for (let i = 0; i < 15; i++) {
    const found = dayList(addDays(now, i)).find(o => o.start > now && filter(o.a));
    if (found) return found;
  }
  return null;
}

function itemsFor(a) {
  const ids = new Set([...state.items.filter(i => i.always).map(i => i.id), ...(a.items || [])]);
  return state.items.filter(i => ids.has(i.id));
}

/* ---------- Frases habladas ---------- */
function horaHablada(d) {
  let h = d.getHours();
  const m = d.getMinutes();
  let suf = '';
  if (m === 45) { h = (h + 1) % 24; suf = ' menos cuarto'; }
  else if (m === 15) suf = ' y cuarto';
  else if (m === 30) suf = ' y media';
  else if (m > 0) suf = ` y ${m}`;
  const h12 = h % 12 || 12;
  let per;
  if (h === 0) per = 'de la noche';
  else if (h < 6) per = 'de la madrugada';
  else if (h < 12) per = 'de la mañana';
  else if (h === 12) per = 'del mediodía';
  else if (h < 20) per = 'de la tarde';
  else per = 'de la noche';
  return `${h12 === 1 ? 'la' : 'las'} ${h12}${suf} ${per}`;
}

function duracion(ms) {
  const mins = Math.max(0, Math.round(ms / MIN));
  const h = Math.floor(mins / 60), m = mins % 60;
  const parts = [];
  if (h) parts.push(h === 1 ? '1 hora' : `${h} horas`);
  if (m) parts.push(m === 1 ? '1 minuto' : `${m} minutos`);
  return parts.length ? parts.join(' y ') : 'un momento';
}

function diaRelativo(d, now = new Date()) {
  const diff = Math.round((startOfDay(d) - startOfDay(now)) / 86400000);
  if (diff === 0) return 'hoy';
  if (diff === 1) return 'mañana';
  if (diff === 2) return 'pasado mañana';
  return `el ${DAYS[d.getDay()]}`;
}

function fechaLarga(d) { return `${DAYS[d.getDay()]} ${d.getDate()} de ${MONTHS[d.getMonth()]}`; }
const nombre = () => (state.settings.name || '').trim();
const conNombre = txt => nombre() ? `${nombre()}, ${txt}` : txt.charAt(0).toUpperCase() + txt.slice(1);

/* ---------- Voz (hablar) ---------- */
let voices = [];
function loadVoices() {
  if (!('speechSynthesis' in window)) return;
  voices = speechSynthesis.getVoices().filter(v => /^es/i.test(v.lang));
}
function pickVoice() {
  return voices.find(v => v.voiceURI === state.settings.voiceURI)
    || voices.find(v => /es[-_]AR/i.test(v.lang))
    || voices.find(v => /es[-_](US|MX|419)/i.test(v.lang))
    || voices[0];
}
function speak(text, onend) {
  if (!('speechSynthesis' in window) || !text) { onend && onend(); return; }
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  const v = pickVoice();
  if (v) { u.voice = v; u.lang = v.lang; } else u.lang = 'es-AR';
  u.rate = Number(state.settings.rate) || 1;
  if (onend) u.onend = onend;
  // Chrome a veces pierde la frase si se habla justo después de cancel()
  setTimeout(() => speechSynthesis.speak(u), 60);
}

/* ---------- Sonido de aviso ---------- */
let audioCtx = null;
function chime(kind = 'soft') {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const notes = kind === 'alert' ? [660, 880, 990] : kind === 'done' ? [523, 659, 784, 1047] : [740];
    notes.forEach((f, i) => {
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      const t = audioCtx.currentTime + i * 0.18;
      o.type = 'sine'; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.25, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
      o.connect(g).connect(audioCtx.destination);
      o.start(t); o.stop(t + 0.55);
    });
  } catch { /* sin audio */ }
}

/* ---------- Imágenes ---------- */
function picSrc(p) {
  if (p.type === 'arasaac') return `https://static.arasaac.org/pictograms/${p.value}/${p.value}_500.png`;
  return p.value;
}
function picHTML(p, cls = '') {
  if (!p) return `<span class="pic emoji ${cls}" aria-hidden="true">❓</span>`;
  if (p.type === 'emoji') return `<span class="pic emoji ${cls}" aria-hidden="true">${esc(p.value)}</span>`;
  return `<img class="pic ${p.type === 'photo' ? 'photo' : ''} ${cls}" src="${esc(picSrc(p))}" alt="" draggable="false">`;
}

function clockSVG(d) {
  const h = d.getHours() % 12, m = d.getMinutes();
  const ha = (h + m / 60) * 30, ma = m * 6;
  const ticks = Array.from({ length: 12 }, (_, i) =>
    `<line x1="50" y1="8" x2="50" y2="${i % 3 === 0 ? 17 : 13}" transform="rotate(${i * 30} 50 50)" stroke="#1F2A33" stroke-width="${i % 3 === 0 ? 4 : 2}" stroke-linecap="round"/>`).join('');
  return `<svg class="clock" viewBox="0 0 100 100" aria-hidden="true">
    <circle cx="50" cy="50" r="46" fill="#fff" stroke="#1F2A33" stroke-width="4"/>${ticks}
    <line x1="50" y1="50" x2="50" y2="28" transform="rotate(${ha} 50 50)" stroke="#E76F51" stroke-width="7" stroke-linecap="round"/>
    <line x1="50" y1="50" x2="50" y2="16" transform="rotate(${ma} 50 50)" stroke="#1F7A6E" stroke-width="5" stroke-linecap="round"/>
    <circle cx="50" cy="50" r="5" fill="#1F2A33"/></svg>`;
}

/* =====================================================================
   PANTALLA DE ÉL
   ===================================================================== */
function renderKid() {
  const now = new Date();
  $('#greeting').textContent = nombre() ? `¡Hola, ${nombre()}!` : '¡Hola!';
  $('#dateText').textContent = fechaLarga(now);

  const next = nextOccurrence(now);
  const card = $('#nextCard');
  if (!next) {
    card.innerHTML = `<div class="next-empty">${picHTML(emo('😊'))}<span>No hay actividades cargadas</span></div>`;
  } else {
    const untilPrep = next.prep - now;
    const showBar = untilPrep > 0 && untilPrep <= 60 * MIN;
    card.innerHTML = `
      ${picHTML(next.a.pic, 'big')}
      <div class="next-info">
        <span class="next-name">${esc(next.a.name)}</span>
        <div class="next-when">
          ${clockSVG(next.start)}
          <span class="mode" aria-hidden="true">${MODES[next.a.mode]?.emoji || ''}</span>
          <span class="next-time"><b>${hhmm(next.start)}</b>${esc(diaRelativo(next.start, now))}</span>
        </div>
        ${showBar ? `<div class="countdown" title="Falta para alistarse"><span style="width:${clamp(untilPrep / (60 * MIN), 0.03, 1) * 100}%"></span></div>` : ''}
      </div>`;
  }

  const strip = $('#todayStrip');
  const today = dayList(now);
  strip.innerHTML = today.length
    ? today.map(o => `
        <button class="strip-item ${o.start <= now ? 'past' : ''} ${next && o.key === next.key ? 'is-next' : ''}" data-key="${esc(o.key)}">
          ${picHTML(o.a.pic)}<small>${hhmm(o.start)}</small>
        </button>`).join('')
    : `<span class="strip-empty" aria-label="Hoy no hay actividades">😴</span>`;
}

function describeNext() {
  const now = new Date();
  const o = nextOccurrence(now);
  if (!o) return { say: 'Por ahora no tenés actividades.', pics: [] };
  const mode = MODES[o.a.mode]?.phrase || '';
  return {
    say: `Lo próximo es ${o.a.name}, ${diaRelativo(o.start, now)} a ${horaHablada(o.start)}. ${/^1 (hora|minuto)$/.test(duracion(o.start - now)) ? 'Falta' : 'Faltan'} ${duracion(o.start - now)}. ${mode}.`,
    pics: [{ pic: o.a.pic, label: hhmm(o.start) }, { pic: emo(MODES[o.a.mode]?.emoji || '📍'), label: '' }],
  };
}

/* ---------- Respuestas a preguntas ---------- */
const STOP = new Set(['que', 'hora', 'horas', 'tengo', 'hoy', 'manana', 'cuando', 'como', 'voy', 'para', 'llevo', 'llevar', 'hay', 'mas', 'esta', 'dia', 'despues', 'sigue', 'ahora', 'tengo', 'tenes', 'donde', 'quien', 'con', 'una', 'los', 'las', 'del', 'por', 'favor', 'necesito', 'hago', 'hacer', 'toca', 'proxima', 'proximo', 'semana', 'vamos', 'ir']);

function findActivity(t) {
  const words = t.split(' ').filter(w => w.length >= 2 && !STOP.has(w));
  if (!words.length) return null;
  for (const a of state.activities) {
    const aliases = norm(a.aliases).split(' ').filter(Boolean);
    if (words.some(w => aliases.includes(w))) return a;
  }
  for (const a of state.activities) {
    const nameWords = norm(a.name).split(' ').filter(w => w.length >= 3);
    if (words.some(w => w.length >= 3 && nameWords.some(n => n.startsWith(w) || w.startsWith(n)))) return a;
  }
  return null;
}

function answerDay(day, now = new Date()) {
  const list = dayList(day);
  const rel = diaRelativo(day, now);
  const isToday = rel === 'hoy';
  const pending = isToday ? list.filter(o => o.start > now) : list;
  if (!list.length) return { say: `${rel.charAt(0).toUpperCase() + rel.slice(1)} no tenés actividades. ¡Día libre!`, pics: [{ pic: emo('😎'), label: '' }] };
  if (!pending.length) return { say: 'Hoy ya terminaste todas tus actividades. ¡Muy bien!', pics: [{ pic: emo('⭐'), label: '' }] };
  const frases = pending.map(o => `${o.a.name} a ${horaHablada(o.start)}`);
  const intro = isToday && pending.length < list.length ? 'Hoy te queda' : `${rel.charAt(0).toUpperCase() + rel.slice(1)} tenés`;
  return { say: `${intro}: ${listJoin(frases)}.`, pics: pending.map(o => ({ pic: o.a.pic, label: hhmm(o.start) })) };
}

function answerItems(o) {
  if (!o) return { say: 'No tenés actividades próximas.', pics: [] };
  const items = itemsFor(o.a);
  if (!items.length) return { say: `Para ${o.a.name} no hace falta llevar nada especial.`, pics: [{ pic: o.a.pic, label: '' }] };
  return {
    say: `Para ${o.a.name} tenés que llevar: ${listJoin(items.map(i => i.name.toLowerCase()))}.`,
    pics: items.map(i => ({ pic: i.pic, label: i.name })),
  };
}

function answer(raw) {
  const t = norm(raw);
  const now = new Date();
  if (!t) return null;

  if (/\b(hola|buen dia|buenas)\b/.test(t)) {
    const n = describeNext();
    return { say: `¡Hola${nombre() ? ' ' + nombre() : ''}! ${n.say}`, pics: n.pics };
  }
  if (/\b(gracias|genial|chau)\b/.test(t)) return { say: '¡De nada! Acá estoy si me necesitás.', pics: [{ pic: emo('😊'), label: '' }] };

  const act = findActivity(t);
  if (act) {
    const o = nextOccurrence(now, a => a.id === act.id);
    if (!o) return { say: `No encontré cuándo es ${act.name}.`, pics: [{ pic: act.pic, label: '' }] };
    if (/llev|necesit|mochila/.test(t)) return answerItems(o);
    return {
      say: `${act.name} es ${diaRelativo(o.start, now)} a ${horaHablada(o.start)}. ${MODES[act.mode]?.phrase || ''}.`,
      pics: [{ pic: act.pic, label: hhmm(o.start) }, { pic: emo(MODES[act.mode]?.emoji || '📍'), label: '' }],
    };
  }

  if (/llev|necesit|mochila|preparo|alist/.test(t)) return answerItems(nextOccurrence(now));
  if (/que hora|hora es/.test(t)) return { say: `Son ${horaHablada(now)}.`, pics: [{ html: clockSVG(now), label: hhmm(now) }] };
  if (/que dia|fecha|que es hoy/.test(t)) return { say: `Hoy es ${fechaLarga(now)}.`, pics: [{ pic: emo('📅'), label: '' }] };
  if (/pasado manana/.test(t)) return answerDay(addDays(now, 2), now);

  const dayIdx = DAYS.findIndex(d => t.includes(norm(d)));
  if (dayIdx >= 0) {
    let off = (dayIdx - now.getDay() + 7) % 7;
    return answerDay(addDays(now, off), now);
  }
  if (/manana/.test(t) && !/a la manana|de la manana/.test(t)) return answerDay(addDays(now, 1), now);
  if (/como voy|camin|en auto|me llev/.test(t)) {
    const o = nextOccurrence(now);
    if (!o) return { say: 'No tenés actividades próximas.', pics: [] };
    return { say: `A ${o.a.name}: ${MODES[o.a.mode]?.phrase || ''}.`, pics: [{ pic: o.a.pic, label: '' }, { pic: emo(MODES[o.a.mode]?.emoji || ''), label: '' }] };
  }
  if (/sigue|proxim|despues|ahora|cuando|falta/.test(t)) return describeNext();
  if (/hoy|tengo|agenda|toca|hacer/.test(t)) return answerDay(now, now);

  return {
    say: 'No te entendí. Podés preguntarme: ¿qué tengo hoy?, ¿qué sigue?, o ¿qué tengo que llevar?',
    pics: [{ pic: emo('📅'), label: '' }, { pic: emo('➡️'), label: '' }, { pic: emo('🎒'), label: '' }],
  };
}

let answerTimer = null;
function showAnswer(res, heard = '') {
  if (!res) return;
  const box = $('#answer');
  box.hidden = false;
  box.innerHTML = `
    ${heard ? `<div class="answer-heard">“${esc(heard)}”</div>` : ''}
    <div class="answer-pics">${res.pics.map(p => `<div class="chip">${p.html || picHTML(p.pic)}${p.label ? `<small>${esc(p.label)}</small>` : ''}</div>`).join('')}</div>
    <div class="answer-text">${esc(res.say)}</div>`;
  speak(res.say);
  clearTimeout(answerTimer);
  answerTimer = setTimeout(() => { box.hidden = true; }, 30000);
}

const QUICK = {
  hoy: () => answerDay(new Date()),
  sigue: () => describeNext(),
  llevo: () => answerItems(nextOccurrence()),
  hora: () => answer('que hora es'),
};

/* ---------- Escuchar (reconocimiento de voz) ---------- */
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let rec = null, listening = false;

function listen() {
  if (!SR) {
    showAnswer({ say: 'En este navegador no puedo escucharte. Usá los botones.', pics: [{ pic: emo('👇'), label: '' }] });
    return;
  }
  if (listening) { rec.stop(); return; }
  if ('speechSynthesis' in window) speechSynthesis.cancel();
  rec = new SR();
  rec.lang = 'es-AR';
  rec.interimResults = true;
  rec.maxAlternatives = 1;
  let heard = '', errored = false;
  rec.onresult = e => {
    heard = [...e.results].map(r => r[0].transcript).join(' ');
    const box = $('#answer');
    box.hidden = false;
    box.innerHTML = `<div class="answer-heard">“${esc(heard)}”</div>`;
  };
  rec.onerror = e => {
    errored = true;
    if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
      showAnswer({ say: 'Necesito permiso para usar el micrófono.', pics: [{ pic: emo('🎤'), label: '' }] });
    } else if (e.error === 'no-speech') {
      showAnswer({ say: 'No te escuché. Probá de nuevo.', pics: [{ pic: emo('👂'), label: '' }] });
    }
  };
  rec.onend = () => {
    listening = false;
    $('#micBtn').classList.remove('listening');
    if (heard) showAnswer(answer(heard), heard);
    else if (!errored) showAnswer({ say: 'No te escuché. Probá de nuevo.', pics: [{ pic: emo('👂'), label: '' }] });
  };
  try {
    rec.start();
    listening = true;
    $('#micBtn').classList.add('listening');
    chime('soft');
  } catch { listening = false; }
}

/* =====================================================================
   AVISOS (alistarse / salir)
   ===================================================================== */
let currentAlert = null;     // { occ, stage, test }
let alertRepeat = null;
const alertQueue = [];
const testChecks = {};

function checksFor(occ, test) {
  const bag = test ? testChecks : state.checks;
  return bag[occ.key] || (bag[occ.key] = []);
}

function alertSpeech(occ, stage) {
  const now = new Date();
  const items = itemsFor(occ.a).map(i => i.name.toLowerCase());
  const lleva = items.length ? ` Fijate si tenés: ${listJoin(items)}.` : '';
  const mode = MODES[occ.a.mode]?.phrase || '';
  if (stage === 'prep') {
    const falta = occ.leave > now ? ` Salimos en ${duracion(occ.leave - now)}.` : '';
    return conNombre(`es hora de alistarte para ${occ.a.name}.${falta} ${mode}.${lleva}`);
  }
  return conNombre(`¡es hora de salir para ${occ.a.name}! ${mode}.${lleva}`);
}

function openAlert(occ, stage, test = false) {
  if (currentAlert && !test) { alertQueue.push({ occ, stage }); return; }
  currentAlert = { occ, stage, test };
  renderAlert();
  chime('alert');
  setTimeout(() => speak(alertSpeech(occ, stage)), 1200);
  clearInterval(alertRepeat);
  let times = 0;
  alertRepeat = setInterval(() => {
    if (++times > 4) return clearInterval(alertRepeat);
    chime('alert');
    setTimeout(() => speak(alertSpeech(occ, stage)), 1200);
  }, 90000);
  notifyIfHidden(occ, stage);
}

function renderAlert() {
  const { occ, stage, test } = currentAlert;
  const el = $('#alert');
  const items = itemsFor(occ.a);
  const checked = checksFor(occ, test);
  const allDone = items.length > 0 && items.every(i => checked.includes(i.id));
  el.className = `overlay alert ${stage}`;
  el.hidden = false;
  el.innerHTML = `
    <div class="alert-stage">
      <span class="stage-emoji" aria-hidden="true">${stage === 'prep' ? '👕' : '🚪'}</span>
      <span>${stage === 'prep' ? '¡A alistarse!' : '¡Hora de salir!'}</span>
    </div>
    <div class="alert-act">
      ${picHTML(occ.a.pic)}
      <span class="act-name">${esc(occ.a.name)}</span>
    </div>
    <div class="alert-meta">
      ${clockSVG(stage === 'prep' ? occ.leave : occ.start)}
      <span aria-hidden="true">${MODES[occ.a.mode]?.emoji || ''}</span>
      <small>${stage === 'prep' ? `Salimos ${hhmm(occ.leave)}` : `Empieza ${hhmm(occ.start)}`}</small>
    </div>
    ${items.length ? `<div class="check-grid">${items.map(i => `
      <button class="check-item ${checked.includes(i.id) ? 'checked' : ''}" data-item="${esc(i.id)}" aria-pressed="${checked.includes(i.id)}">
        ${picHTML(i.pic)}<small>${esc(i.name)}</small>
      </button>`).join('')}</div>` : ''}
    ${allDone ? `<div class="celebrate" aria-hidden="true">🎉</div>` : ''}
    <div class="alert-actions">
      <button class="btn-round" data-alert="repeat" aria-label="Escuchar de nuevo">🔊</button>
      <button class="btn-ok" data-alert="ok" aria-label="${stage === 'prep' ? 'Ya voy' : 'Listo'}">👍</button>
    </div>`;
}

function closeAlert() {
  clearInterval(alertRepeat);
  if ('speechSynthesis' in window) speechSynthesis.cancel();
  $('#alert').hidden = true;
  currentAlert = null;
  renderKid();
  const nxt = alertQueue.shift();
  if (nxt) setTimeout(() => openAlert(nxt.occ, nxt.stage), 600);
}

async function notifyIfHidden(occ, stage) {
  if (!document.hidden || !('Notification' in window) || Notification.permission !== 'granted') return;
  const title = stage === 'prep' ? `👕 A alistarse: ${occ.a.name}` : `🚪 Hora de salir: ${occ.a.name}`;
  const opts = { body: alertSpeech(occ, stage), tag: occ.key + stage, renotify: true, requireInteraction: true };
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) reg.showNotification(title, opts); else new Notification(title, opts);
  } catch { /* sin notificaciones */ }
}

function checkSchedule() {
  const now = new Date();
  let changed = false;
  for (const o of dayList(now)) {
    const kp = `${o.key}|prep`, kl = `${o.key}|leave`;
    if (!state.fired[kl] && now >= o.leave && now < o.start) {
      state.fired[kl] = state.fired[kp] = true; changed = true;
      openAlert(o, 'leave');
    } else if (!state.fired[kp] && now >= o.prep && now < o.leave) {
      state.fired[kp] = true; changed = true;
      openAlert(o, 'prep');
    }
  }
  if (changed) save();
}

/* =====================================================================
   MODO PADRES
   ===================================================================== */
let pinEntry = '';
function openPin() {
  pinEntry = '';
  renderPin();
  $('#pin').hidden = false;
}
function renderPin(bad = false) {
  $('#pin').innerHTML = `
    <div class="pin-box">
      <h2>Modo padres</h2>
      <span class="hint">Ingresá el PIN</span>
      <div class="pin-dots ${bad ? 'bad' : ''}">${[0, 1, 2, 3].map(i => `<i class="${i < pinEntry.length ? 'on' : ''}"></i>`).join('')}</div>
      <div class="pin-pad">
        ${[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => `<button data-pin="${n}">${n}</button>`).join('')}
        <button class="ghost" data-pin="cancel">Cancelar</button>
        <button data-pin="0">0</button>
        <button class="ghost" data-pin="del" aria-label="Borrar">⌫</button>
      </div>
    </div>`;
}
function pinPress(k) {
  if (k === 'cancel') { $('#pin').hidden = true; return; }
  if (k === 'del') pinEntry = pinEntry.slice(0, -1);
  else if (pinEntry.length < 4) pinEntry += k;
  if (pinEntry.length === 4) {
    if (pinEntry === String(state.settings.pin)) { $('#pin').hidden = true; openParent(); return; }
    pinEntry = '';
    renderPin(true);
    return;
  }
  renderPin();
}

let pTab = 'acts';
let editing = null; // copia de la actividad que se está editando
let editingOrig = ''; // cómo estaba al empezar a editar, para detectar cambios sin guardar

function startEditing(a) {
  editing = a;
  editingOrig = JSON.stringify(a);
}

function saveEditing() {
  if (!editing.name.trim()) { toast('Falta el nombre'); return false; }
  if (!editing.time) { toast('Falta la hora'); return false; }
  if (editing.repeat === 'once' && !editing.date) { toast('Falta la fecha'); return false; }
  if (editing.repeat !== 'once' && !editing.days.length) { toast('Elegí al menos un día'); return false; }
  editing.name = editing.name.trim();
  const i = state.activities.findIndex(a => a.id === editing.id);
  if (i >= 0) state.activities[i] = editing; else state.activities.push(editing);
  // Si cambió la hora, que los avisos de hoy se puedan volver a disparar
  for (const k of Object.keys(state.fired)) if (k.startsWith(editing.id + '|')) delete state.fired[k];
  save();
  editing = null;
  toast('Guardado');
  return true;
}

// Antes de salir de una actividad en edición: si hay cambios, preguntar si se guardan.
// Devuelve false si hay que quedarse (por ejemplo, falta un dato para poder guardar).
function leaveEditing() {
  if (!editing) return true;
  if (JSON.stringify(editing) !== editingOrig) {
    if (confirm(`Hay cambios sin guardar en “${editing.name || 'la actividad'}”.\n\nAceptar: guardarlos.\nCancelar: descartarlos.`)) {
      return saveEditing();
    }
  }
  editing = null;
  return true;
}

function openParent() {
  $('#parent').hidden = false;
  editing = null;
  renderParent();
}
function closeParent() {
  if (!leaveEditing()) return;
  $('#parent').hidden = true;
  editing = null;
  renderKid();
}

function renderParent() {
  $$('.p-tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === pTab));
  const body = $('#pBody');
  if (pTab === 'acts') body.innerHTML = editing ? actForm() : actList();
  else if (pTab === 'items') body.innerHTML = itemList();
  else body.innerHTML = settingsForm();
  if (pTab === 'acts' && editing) updateSummary();
}

function scheduleText(a) {
  const when = a.repeat === 'once'
    ? (a.date ? a.date.split('-').reverse().join('/') : 'sin fecha')
    : DAY_ORDER.filter(d => (a.days || []).includes(d)).map(d => DAYS[d].slice(0, 3)).join(', ') || 'sin días';
  return `${when} · ${a.time} · ${MODES[a.mode]?.emoji || ''} ${MODES[a.mode]?.label || ''}`;
}

function actList() {
  const acts = [...state.activities].sort((x, y) => x.time.localeCompare(y.time));
  return `
    <div class="btn-row"><button class="btn primary" data-do="new-act">+ Nueva actividad</button></div>
    <div class="list">
      ${acts.length ? acts.map(a => `
        <div class="row">
          ${picHTML(a.pic)}
          <div class="grow"><div class="title">${esc(a.name)}</div><div class="sub">${esc(scheduleText(a))}</div></div>
          <button class="btn small" data-do="edit-act" data-id="${a.id}">Editar</button>
        </div>`).join('') : '<p class="hint">Todavía no hay actividades.</p>'}
    </div>`;
}

function actForm() {
  const e = editing;
  const isNew = !state.activities.some(a => a.id === e.id);
  return `
    <div class="form">
      <h3>${isNew ? 'Nueva actividad' : 'Editar actividad'}</h3>
      <button class="pic-pick" data-do="pick-act-pic">${picHTML(e.pic)}<span>Cambiar imagen</span></button>
      <label>Nombre <input type="text" data-f="name" value="${esc(e.name)}" placeholder="Ej: Fonoaudiología"></label>
      <label>Otras formas en que la nombra
        <input type="text" data-f="aliases" value="${esc(e.aliases || '')}" placeholder="Ej: fono, Laura">
        <small>Separadas por coma. Sirve para que la app entienda cuando pregunta por voz.</small>
      </label>
      <label>Hora de inicio <input type="time" data-f="time" value="${esc(e.time)}"></label>
      <fieldset>
        <legend>¿Cuándo?</legend>
        <div class="seg">
          <button data-do="repeat" data-v="weekly" class="${e.repeat !== 'once' ? 'on' : ''}">Todas las semanas</button>
          <button data-do="repeat" data-v="once" class="${e.repeat === 'once' ? 'on' : ''}">Un solo día</button>
        </div>
        ${e.repeat === 'once'
          ? `<input type="date" data-f="date" value="${esc(e.date || '')}">`
          : `<div class="seg days">${DAY_ORDER.map(d => `<button data-do="day" data-v="${d}" class="${(e.days || []).includes(d) ? 'on' : ''}" aria-label="${DAYS[d]}">${DAY_SHORT[d]}</button>`).join('')}</div>`}
      </fieldset>
      <fieldset>
        <legend>¿Cómo va?</legend>
        <div class="seg modes">
          ${Object.entries(MODES).map(([k, m]) => `<button data-do="mode" data-v="${k}" class="${e.mode === k ? 'on' : ''}">${m.emoji} ${m.label}</button>`).join('')}
        </div>
      </fieldset>
      <div class="two">
        <label>Minutos de viaje <input type="number" min="0" max="240" data-f="travel" value="${esc(e.travel)}"></label>
        <label>Minutos para alistarse <input type="number" min="0" max="240" data-f="prep" value="${esc(e.prep)}"></label>
      </div>
      <p id="actSummary" class="summary"></p>
      <fieldset>
        <legend>Cosas para llevar</legend>
        <div class="chips">
          ${state.items.map(i => {
            const on = i.always || (e.items || []).includes(i.id);
            return `<button class="chip-tog ${on ? 'on' : ''}" data-do="toggle-item" data-id="${i.id}" ${i.always ? 'disabled title="Se lleva siempre"' : ''}>${picHTML(i.pic)}${esc(i.name)}${i.always ? ' · siempre' : ''}</button>`;
          }).join('')}
        </div>
        <small>Las marcadas “siempre” se agregan a todas las actividades. Se cambian en “Cosas para llevar”.</small>
      </fieldset>
      <div class="btn-row save-bar">
        <button class="btn primary" data-do="save-act">Guardar</button>
        <button class="btn" data-do="cancel-act">Cancelar</button>
      </div>
      <div class="btn-row">
        <button class="btn" data-do="test-prep">▶ Probar aviso de alistarse</button>
        <button class="btn" data-do="test-leave">▶ Probar aviso de salir</button>
      </div>
      ${isNew ? '' : '<div class="btn-row"><button class="btn danger" data-do="del-act">Eliminar actividad</button></div>'}
    </div>`;
}

function updateSummary() {
  const el = $('#actSummary');
  if (!el || !editing) return;
  const o = occurrence(editing, new Date());
  el.innerHTML = `👕 Aviso para alistarse: <b>${hhmm(o.prep)}</b><br>🚪 Aviso para salir: <b>${hhmm(o.leave)}</b><br>📍 Empieza: <b>${hhmm(o.start)}</b>`;
}

function itemList() {
  return `
    <p class="hint">Estas son las cosas que puede tener que revisar antes de salir. Las marcadas “Siempre” aparecen en todos los avisos; las demás se eligen en cada actividad.</p>
    <div class="list">
      ${state.items.map(i => `
        <div class="row">
          <button data-do="pick-item-pic" data-id="${i.id}" aria-label="Cambiar imagen">${picHTML(i.pic)}</button>
          <div class="grow"><input type="text" data-item-name="${i.id}" value="${esc(i.name)}" aria-label="Nombre"></div>
          <label class="switch"><input type="checkbox" data-item-always="${i.id}" ${i.always ? 'checked' : ''}> Siempre</label>
          <button class="btn small danger" data-do="del-item" data-id="${i.id}" aria-label="Eliminar">✕</button>
        </div>`).join('')}
    </div>
    <div class="btn-row"><button class="btn primary" data-do="new-item">+ Agregar cosa</button></div>`;
}

function settingsForm() {
  const s = state.settings;
  const notif = !('Notification' in window) ? 'No disponible en este navegador'
    : Notification.permission === 'granted' ? 'Activadas' : Notification.permission === 'denied' ? 'Bloqueadas (cambialo en el navegador)' : 'Sin activar';
  return `
    <div class="form">
      <label>Nombre de él <input type="text" data-s="name" value="${esc(s.name)}" placeholder="Para saludarlo y avisarle"></label>
      <h3>Voz</h3>
      <label>Voz
        <select data-s="voiceURI">
          <option value="">Automática</option>
          ${voices.map(v => `<option value="${esc(v.voiceURI)}" ${v.voiceURI === s.voiceURI ? 'selected' : ''}>${esc(v.name)} (${esc(v.lang)})</option>`).join('')}
        </select>
      </label>
      <label>Velocidad: <span id="rateVal">${Number(s.rate).toFixed(2)}</span>
        <input type="range" min="0.6" max="1.3" step="0.05" data-s="rate" value="${esc(s.rate)}">
      </label>
      <div class="btn-row"><button class="btn" data-do="test-voice">🔊 Probar voz</button></div>

      <h3>Tiempos por defecto</h3>
      <p class="hint">Se usan al crear una actividad o al cambiar cómo va. Después se pueden ajustar en cada una.</p>
      ${Object.entries(MODES).map(([k, m]) => `
        <fieldset><legend>${m.emoji} ${m.label}</legend>
          <div class="two">
            <label>Minutos de viaje <input type="number" min="0" data-def="${k}.travel" value="${s.defaults[k].travel}"></label>
            <label>Minutos para alistarse <input type="number" min="0" data-def="${k}.prep" value="${s.defaults[k].prep}"></label>
          </div>
        </fieldset>`).join('')}

      <h3>Avisos</h3>
      <label class="switch"><input type="checkbox" data-s="wake" ${s.wake ? 'checked' : ''}> Mantener la pantalla encendida mientras la app está abierta</label>
      <p class="hint">Notificaciones: <b>${notif}</b>. En este prototipo los avisos funcionan mientras la app está abierta.</p>
      <div class="btn-row"><button class="btn" data-do="ask-notif">Activar notificaciones</button></div>

      <h3>PIN de padres</h3>
      <label>PIN (4 números) <input type="text" inputmode="numeric" maxlength="4" data-s="pin" value="${esc(s.pin)}"></label>

      <h3>Pasar la agenda a otro dispositivo</h3>
      <p class="hint">Guardá un archivo con toda la configuración y abrilo en el otro dispositivo con “Cargar archivo”.</p>
      <div class="btn-row">
        <button class="btn" data-do="export">⬇ Guardar archivo</button>
        <label class="btn">⬆ Cargar archivo<input type="file" accept="application/json,.json" data-do-file="import" hidden></label>
      </div>
    </div>`;
}

function newActivity() {
  const d = state.settings.defaults.auto;
  return { id: uid(), name: '', aliases: '', pic: emo('📍'), time: '17:00', repeat: 'weekly', days: [new Date().getDay()], date: dateKey(new Date()), mode: 'auto', travel: d.travel, prep: d.prep, items: [] };
}

function onParentClick(ev) {
  const b = ev.target.closest('[data-do]');
  if (!b || b.disabled) return;
  const id = b.dataset.id;
  switch (b.dataset.do) {
    case 'new-act': startEditing(newActivity()); renderParent(); break;
    case 'edit-act': startEditing(structuredClone(state.activities.find(a => a.id === id))); renderParent(); break;
    case 'cancel-act': editing = null; renderParent(); break;
    case 'repeat': editing.repeat = b.dataset.v; renderParent(); break;
    case 'day': {
      const d = Number(b.dataset.v);
      editing.days = editing.days.includes(d) ? editing.days.filter(x => x !== d) : [...editing.days, d];
      b.classList.toggle('on');
      break;
    }
    case 'mode': {
      editing.mode = b.dataset.v;
      Object.assign(editing, state.settings.defaults[b.dataset.v]);
      renderParent();
      break;
    }
    case 'toggle-item': {
      editing.items = editing.items.includes(id) ? editing.items.filter(x => x !== id) : [...editing.items, id];
      b.classList.toggle('on');
      break;
    }
    case 'pick-act-pic': openPicker(p => { editing.pic = p; renderParent(); }, editing.name); break;
    case 'save-act':
      if (saveEditing()) renderParent();
      break;
    case 'del-act':
      if (!confirm(`¿Eliminar “${editing.name}”?`)) return;
      state.activities = state.activities.filter(a => a.id !== editing.id);
      save(); editing = null; renderParent();
      break;
    case 'test-prep':
    case 'test-leave': {
      const o = occurrence(editing, new Date());
      o.key = 'test|' + editing.id;
      delete testChecks[o.key];
      openAlert(o, b.dataset.do === 'test-prep' ? 'prep' : 'leave', true);
      break;
    }
    case 'new-item':
      state.items.push({ id: uid(), name: 'Nueva cosa', pic: emo('📦'), always: false });
      save(); renderParent();
      $$('[data-item-name]').pop()?.select();
      break;
    case 'del-item': {
      const it = state.items.find(i => i.id === id);
      if (!confirm(`¿Eliminar “${it.name}”?`)) return;
      state.items = state.items.filter(i => i.id !== id);
      state.activities.forEach(a => { a.items = (a.items || []).filter(x => x !== id); });
      save(); renderParent();
      break;
    }
    case 'pick-item-pic': {
      const it = state.items.find(i => i.id === id);
      openPicker(p => { it.pic = p; save(); renderParent(); }, it.name);
      break;
    }
    case 'test-voice': speak(conNombre('hola, soy tu asistente. Lo próximo es Natación, hoy a las 6 y media de la tarde.')); break;
    case 'ask-notif':
      if (!('Notification' in window)) return toast('Este navegador no tiene notificaciones');
      Notification.requestPermission().then(() => renderParent());
      break;
    case 'export': {
      const data = { ...state, fired: {}, checks: {} };
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `mi-dia-agenda-${dateKey(new Date())}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      break;
    }
  }
}

function onParentInput(ev) {
  const t = ev.target;
  if (t.dataset.f && editing) {
    const f = t.dataset.f;
    editing[f] = (f === 'travel' || f === 'prep') ? Math.max(0, Number(t.value) || 0) : t.value;
    updateSummary();
  } else if (t.dataset.itemName) {
    const it = state.items.find(i => i.id === t.dataset.itemName);
    it.name = t.value; save();
  } else if (t.dataset.itemAlways) {
    const it = state.items.find(i => i.id === t.dataset.itemAlways);
    it.always = t.checked; save();
  } else if (t.dataset.s) {
    const k = t.dataset.s;
    if (k === 'pin') {
      const v = t.value.replace(/\D/g, '').slice(0, 4);
      t.value = v;
      if (v.length === 4) { state.settings.pin = v; save(); toast('PIN cambiado'); }
      return;
    }
    state.settings[k] = t.type === 'checkbox' ? t.checked : k === 'rate' ? Number(t.value) : t.value;
    if (k === 'rate') $('#rateVal').textContent = Number(t.value).toFixed(2);
    if (k === 'name') renderKid();
    if (k === 'wake') applyWakeLock();
    save();
  } else if (t.dataset.def) {
    const [mode, key] = t.dataset.def.split('.');
    state.settings.defaults[mode][key] = Math.max(0, Number(t.value) || 0);
    save();
  } else if (t.dataset.doFile === 'import' && t.files[0]) {
    t.files[0].text().then(txt => {
      const data = JSON.parse(txt);
      if (!Array.isArray(data.activities) || !Array.isArray(data.items)) throw new Error('formato');
      if (!confirm('Esto reemplaza toda la agenda de este dispositivo. ¿Seguir?')) return;
      state = { ...defaultState(), ...data, fired: {}, checks: {} };
      save(); renderParent(); renderKid(); toast('Agenda cargada');
    }).catch(() => toast('Ese archivo no es una agenda válida'));
  }
}

/* ---------- Elegir imagen ---------- */
const EMOJIS = ['🗣️', '🧩', '🏊', '⚽', '🏀', '🎨', '🎵', '🩺', '🦷', '🏥', '🏫', '🧠', '🤸', '🐴', '🚌', '🛒', '🍽️', '🍎', '🛁', '😴', '📚', '💊', '🎒', '📱', '🔑', '💧', '🧥', '☂️', '🧢', '👟', '🕶️', '🍪', '🪪', '💳', '🎧', '👓', '🧴', '😷', '🖍️', '📝', '🩱', '🧦', '🎂', '👵', '👨‍👩‍👦', '🐶', '⛪', '🎮', '📦', '📍'];
let pickerCb = null, pickerTab = 'pict', pickerQuery = '';

function openPicker(cb, query = '') {
  pickerCb = cb;
  pickerTab = 'pict';
  pickerQuery = query;
  $('#picker').hidden = false;
  renderPicker();
  if (query) searchPicto(query);
}
function closePicker() { $('#picker').hidden = true; pickerCb = null; }
function choosePic(p) { const cb = pickerCb; closePicker(); cb && cb(p); }

function renderPicker() {
  $('#picker').innerHTML = `
    <div class="picker-box">
      <div class="picker-head"><h2>Elegir imagen</h2><button class="btn small" data-pk="close">Cerrar</button></div>
      <div class="picker-tabs seg">
        <button data-pk-tab="pict" class="${pickerTab === 'pict' ? 'on' : ''}">Pictogramas</button>
        <button data-pk-tab="emoji" class="${pickerTab === 'emoji' ? 'on' : ''}">Dibujos</button>
        <button data-pk-tab="photo" class="${pickerTab === 'photo' ? 'on' : ''}">Foto</button>
      </div>
      <div class="picker-body">
        ${pickerTab === 'pict' ? `
          <form class="picker-search" data-pk-form>
            <input type="search" name="q" value="${esc(pickerQuery)}" placeholder="Buscar: natación, médico, mochila…" autocomplete="off">
            <button class="btn primary">Buscar</button>
          </form>
          <div id="pkResults" class="pic-grid"></div>
          <p class="hint">Pictogramas de ARASAAC (Sergio Palao, CC BY-NC-SA). Se necesita internet.</p>`
        : pickerTab === 'emoji' ? `
          <div class="pic-grid">${EMOJIS.map(e => `<button data-pk-emoji="${e}">${picHTML(emo(e))}</button>`).join('')}</div>`
        : `
          <p class="hint">Una foto real (del lugar, de la terapeuta, de su mochila) suele ser lo más fácil de reconocer.</p>
          <label class="btn primary">📷 Elegir o sacar foto<input type="file" accept="image/*" data-pk-photo hidden></label>`}
      </div>
    </div>`;
}

async function searchPicto(q) {
  pickerQuery = q;
  const box = $('#pkResults');
  if (!box || !q.trim()) return;
  box.innerHTML = '<p class="hint">Buscando…</p>';
  try {
    const r = await fetch(`https://api.arasaac.org/v1/pictograms/es/search/${encodeURIComponent(q.trim())}`);
    const list = r.ok ? await r.json() : [];
    if (!list.length) { box.innerHTML = '<p class="hint">No encontré pictogramas. Probá con otra palabra.</p>'; return; }
    box.innerHTML = list.slice(0, 40).map(p =>
      `<button data-pk-arasaac="${p._id}"><img class="pic" loading="lazy" src="https://static.arasaac.org/pictograms/${p._id}/${p._id}_300.png" alt="${esc(p.keywords?.[0]?.keyword || '')}"></button>`).join('');
  } catch {
    box.innerHTML = '<p class="hint">No se pudo conectar. Revisá internet o usá “Dibujos” o “Foto”.</p>';
  }
}

function resizePhoto(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const max = 320, s = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(img.src);
      resolve(c.toDataURL('image/jpeg', 0.8));
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

/* ---------- Varios ---------- */
let toastTimer = null;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 2500);
}

let wakeLock = null;
async function applyWakeLock() {
  try {
    if (state.settings.wake && 'wakeLock' in navigator && document.visibilityState === 'visible') {
      if (!wakeLock) { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => { wakeLock = null; }); }
    } else if (wakeLock) { await wakeLock.release(); wakeLock = null; }
  } catch { /* no disponible */ }
}

/* =====================================================================
   Arranque y eventos
   ===================================================================== */
function bind() {
  // Empezar (habilita audio y voz con un toque)
  $('#startBtn').addEventListener('click', () => {
    $('#start').hidden = true;
    chime('soft');
    applyWakeLock();
    const n = describeNext();
    speak(`${nombre() ? '¡Hola ' + nombre() + '!' : '¡Hola!'} ${n.say}`);
    checkSchedule();
  });

  $('#dateBtn').addEventListener('click', () => speak(`Hoy es ${fechaLarga(new Date())}. Son ${horaHablada(new Date())}.`));
  $('#nextCard').addEventListener('click', () => showAnswer(describeNext()));
  $('#todayStrip').addEventListener('click', e => {
    const b = e.target.closest('[data-key]');
    if (!b) return;
    const o = dayList(new Date()).find(x => x.key === b.dataset.key);
    if (!o) return;
    const past = o.start <= new Date();
    speak(`${o.a.name}, a ${horaHablada(o.start)}.${past ? ' Ya pasó.' : ''}`);
  });
  $$('.quick').forEach(b => b.addEventListener('click', () => showAnswer(QUICK[b.dataset.q]())));
  $('#micBtn').addEventListener('click', listen);

  // Engranaje: mantener apretado 1,5 s
  const gear = $('#parentBtn');
  let holdTimer = null;
  const cancelHold = () => { clearTimeout(holdTimer); gear.classList.remove('holding'); };
  gear.addEventListener('pointerdown', e => {
    e.preventDefault();
    gear.classList.add('holding');
    holdTimer = setTimeout(() => { cancelHold(); openPin(); }, 1500);
  });
  ['pointerup', 'pointerleave', 'pointercancel'].forEach(t => gear.addEventListener(t, cancelHold));
  gear.addEventListener('contextmenu', e => e.preventDefault());

  // PIN
  $('#pin').addEventListener('click', e => { const b = e.target.closest('[data-pin]'); if (b) pinPress(b.dataset.pin); });

  // Aviso
  $('#alert').addEventListener('click', e => {
    const item = e.target.closest('[data-item]');
    if (item && currentAlert) {
      const list = checksFor(currentAlert.occ, currentAlert.test);
      const id = item.dataset.item;
      const it = state.items.find(i => i.id === id);
      const i = list.indexOf(id);
      if (i >= 0) list.splice(i, 1); else list.push(id);
      if (!currentAlert.test) save();
      renderAlert();
      const items = itemsFor(currentAlert.occ.a);
      if (i < 0 && items.every(x => list.includes(x.id))) { chime('done'); speak('¡Muy bien! Tenés todo listo.'); }
      else speak(i >= 0 ? it.name : `${it.name}. ¡Listo!`);
      return;
    }
    const b = e.target.closest('[data-alert]');
    if (!b || !currentAlert) return;
    if (b.dataset.alert === 'repeat') speak(alertSpeech(currentAlert.occ, currentAlert.stage));
    if (b.dataset.alert === 'ok') {
      const stage = currentAlert.stage;
      closeAlert();
      speak(stage === 'prep' ? '¡Bien! A prepararse.' : '¡Que te vaya muy bien!');
    }
  });

  // Padres
  $('#pClose').addEventListener('click', closeParent);
  $$('.p-tabs button').forEach(b => b.addEventListener('click', () => { if (!leaveEditing()) return; pTab = b.dataset.tab; renderParent(); }));
  $('#pBody').addEventListener('click', onParentClick);
  $('#pBody').addEventListener('input', onParentInput);
  $('#pBody').addEventListener('change', e => { if (e.target.type === 'checkbox' || e.target.type === 'file' || e.target.tagName === 'SELECT') onParentInput(e); });

  // Selector de imágenes
  const pk = $('#picker');
  pk.addEventListener('click', e => {
    if (e.target === pk || e.target.closest('[data-pk="close"]')) return closePicker();
    const tab = e.target.closest('[data-pk-tab]');
    if (tab) { pickerTab = tab.dataset.pkTab; renderPicker(); if (pickerTab === 'pict' && pickerQuery) searchPicto(pickerQuery); return; }
    const em = e.target.closest('[data-pk-emoji]');
    if (em) return choosePic(emo(em.dataset.pkEmoji));
    const ar = e.target.closest('[data-pk-arasaac]');
    if (ar) return choosePic({ type: 'arasaac', value: Number(ar.dataset.pkArasaac) });
  });
  pk.addEventListener('submit', e => { e.preventDefault(); searchPicto(new FormData(e.target).get('q') || ''); });
  pk.addEventListener('change', async e => {
    if (!e.target.matches('[data-pk-photo]') || !e.target.files[0]) return;
    try { choosePic({ type: 'photo', value: await resizePhoto(e.target.files[0]) }); }
    catch { toast('No se pudo usar esa foto'); }
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') { applyWakeLock(); checkSchedule(); renderKid(); }
  });
}

function init() {
  pruneOld(); save();
  loadVoices();
  if ('speechSynthesis' in window) speechSynthesis.onvoiceschanged = () => { loadVoices(); if (!$('#parent').hidden && pTab === 'settings') renderParent(); };
  if ('serviceWorker' in navigator && window.isSecureContext) navigator.serviceWorker.register('sw.js').catch(() => {});
  bind();
  renderKid();
  setInterval(checkSchedule, 15000);
  setInterval(() => { if ($('#parent').hidden) renderKid(); }, 30000);
}

init();
