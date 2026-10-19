/**
 * Hoja de estilos única, compartida por el render estático y por la app.
 *
 * Vive en TypeScript en vez de en un `.css` porque el paso de construcción la
 * escribe a `web/app.css` y el render estático la incrusta: una sola fuente,
 * dos destinos.
 *
 * Sólo hay tema claro: la guía se usa a la luz del día, y la versión oscura
 * salía sombría. Cada zona del viaje tiene su color (`--a`); la pantalla del
 * día toma el de la zona en la que se duerme.
 */

export const TOKENS = `
:root{
  --bg:#FDFBF7; --card:#fff; --ink:#1E1C18; --muted:#726C62; --line:#EAE4DA;
  --a:#C65D21; --a-ink:color-mix(in srgb,var(--a) 70%,black); --a-soft:color-mix(in srgb,var(--a) 13%,white);
  --accent:var(--a);
  --warn:#8a5a00; --warn-bg:#fdf3dc; --bad:#8c2f24; --bad-bg:#fbe9e6;
  --good:#1d5e33; --good-bg:#e4f2e8;
  --display:"Bricolage Grotesque",-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;
  --safe-top:env(safe-area-inset-top,0px); --safe-bottom:env(safe-area-inset-bottom,0px);
  color-scheme:light;
}
`;

/** Estilos del día: los usa igual el HTML exportado que la pantalla del día. */
export const DAY_STYLE = `
*{box-sizing:border-box}
body{margin:0;padding:1.25rem;background:var(--bg);color:var(--ink);font:1rem/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;max-width:44rem;margin-inline:auto;-webkit-text-size-adjust:100%}
h1,h2,h3{font-family:var(--display);letter-spacing:-.015em;text-wrap:balance}
h1{font-size:1.85rem;line-height:1.12;margin:.2rem 0}
h2{font-size:1.25rem;line-height:1.25;margin:0}
h2.alt{font-size:1.05rem;font-weight:500;color:var(--muted);margin:.1rem 0 0}
h3{font-size:1.05rem;line-height:1.3;margin:0 0 .15rem}
.date{text-transform:uppercase;letter-spacing:.08em;font-size:.72rem;font-weight:700;color:var(--muted);margin:0}
.start{color:var(--muted);font-size:.9rem;margin:.5rem 0 0}
.intro{margin:1rem 0 0;padding:.85rem 1rem;background:var(--card);border-radius:.7rem}
.intro p{margin:0}
.timeline{list-style:none;margin:1.5rem 0 0;padding:0}
.stop{display:grid;grid-template-columns:4.5rem 1fr;gap:.9rem;background:var(--card);border-radius:.7rem;padding:.9rem 1rem;margin:0 0 .7rem;position:relative}
.stop.optional{opacity:.82;border:1px dashed var(--line)}
.travel{grid-column:1/-1;margin:-.2rem 0 .2rem;font-size:.78rem;color:var(--muted);text-transform:lowercase}
.when{text-align:right;border-right:2px solid var(--line);padding-right:.9rem}
.when strong{display:block;font-variant-numeric:tabular-nums;font-size:1.05rem}
.when span{font-size:.75rem;color:var(--muted)}
.meta{margin:0;font-size:.85rem;color:var(--muted)}
.hours{margin-left:.4rem}
.hours.unknown{font-style:italic}
.local{font-weight:400;color:var(--muted);font-size:.9rem}
.anchor{margin:.45rem 0 0;font-size:.85rem;font-weight:600;color:var(--a-ink)}
.anchor.hard::before{content:"◆ "}
.anchor.soft::before{content:"◇ "}
.conflict{margin:.5rem 0 0;padding:.5rem .65rem;background:var(--bad-bg);color:var(--bad);border-radius:.4rem;font-size:.85rem;font-weight:600}
.unknown-hours{margin:.5rem 0 0;padding:.5rem .65rem;background:var(--warn-bg);color:var(--warn);border-radius:.4rem;font-size:.85rem}
.dog{margin:.45rem 0 0;font-size:.83rem;color:var(--muted)}
ul.notes,ul.facts{margin:.5rem 0 0;padding:0;list-style:none;font-size:.86rem}
ul.notes li,ul.facts li{margin:.3rem 0;padding-left:1.1rem;position:relative}
.note::before{content:"·";position:absolute;left:.25rem}
.note.warn::before{content:"!";color:var(--warn);font-weight:700}
.note.dog::before{content:"~"}
.fact::before{content:"·";position:absolute;left:.25rem}
.fact.unverified{color:var(--muted)}
.badge{display:inline-block;margin-left:.4rem;padding:.05rem .4rem;border:1px solid currentColor;border-radius:.5rem;font-size:.68rem;text-transform:uppercase;letter-spacing:.04em;opacity:.85}
.src{margin-left:.4rem;font-size:.72rem;color:var(--muted)}
.alt{color:var(--muted);font-size:.9em}
ul.notes .alt,ul.facts .alt{display:block}
.deep{margin:.6rem 0 0;font-size:.88rem;color:var(--muted)}
.deep p{margin:.3rem 0 0}
.broken{background:var(--bad-bg);color:var(--bad)}
`;

/** Cromo de la app: barra, avisos, librería, pantallas. No lo usa el HTML exportado. */
export const APP_STYLE = `
@font-face{font-family:"Bricolage Grotesque";src:url(./fonts/bricolage-latin.woff2) format("woff2");font-weight:600 700;font-style:normal;font-display:swap}
body{padding:0}
#app{padding:calc(.5rem + var(--safe-top)) 1rem calc(4rem + var(--safe-bottom));max-width:30rem;margin-inline:auto}
button{font:inherit;color:inherit;background:none;border:none;padding:0;cursor:pointer;text-align:left}
a{color:inherit}
img{display:block;max-width:100%}
p{margin:0}
.eyebrow{font-size:.72rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin:0}
.eyebrow.a{color:var(--a-ink)}

/* barra de arriba: no es una banda, sino controles sueltos que flotan al bajar.
   La barra en sí es transparente y deja pasar los toques; al bajar, el título
   se aparta y queda sólo la pastilla de volver (y las flechas, si las hay). */
.bar{display:flex;align-items:center;justify-content:space-between;gap:.6rem;padding:.6rem 0 .4rem;position:sticky;top:var(--safe-top);z-index:3;pointer-events:none}
.bar>*{pointer-events:auto}
.bar h1{font-size:1.35rem;flex:1;margin:0}
.bar h1,.bar .eyebrow{transition:opacity .2s}
.scrolled .bar h1,.scrolled .bar .eyebrow{opacity:0;pointer-events:none}
.glass{background:color-mix(in srgb,var(--bg) 82%,transparent);-webkit-backdrop-filter:blur(14px) saturate(1.2);backdrop-filter:blur(14px) saturate(1.2);transition:box-shadow .2s}
.scrolled .glass{box-shadow:0 3px 14px rgba(30,28,24,.12)}
.back{display:inline-flex;align-items:center;gap:.15rem;font-weight:700;color:var(--a-ink);min-height:40px;max-width:70%;padding:0 .9rem 0 .5rem;border:1px solid var(--line);border-radius:2rem;text-decoration:none;font-size:.9rem;white-space:nowrap}
.back .lbl{overflow:hidden;text-overflow:ellipsis;min-width:0}
.back svg{width:18px;height:18px;flex:none}
.arrows{display:flex;gap:.4rem}
.arrows .chip{width:40px;height:40px;padding:0;border-radius:50%;display:grid;place-items:center}
.arrows svg{width:16px;height:16px}
.chip{display:inline-flex;align-items:center;gap:.35rem;padding:.3rem .7rem;border:1px solid var(--line);border-radius:2rem;font-size:.8rem;font-weight:600;background:var(--card);text-decoration:none}
.chip[aria-pressed=true]{background:var(--a);color:#fff;border-color:var(--a)}
.chip.off{opacity:.3}
.chip img{width:24px;height:24px;border-radius:50%;object-fit:cover;margin-left:-.5rem}
.tabs{display:flex;gap:.25rem;margin:.9rem 0 1rem;padding:.25rem;background:var(--card);border:1px solid var(--line);border-radius:2rem;position:sticky;top:calc(var(--safe-top) + 1rem + 40px);z-index:2}
.tabs button{flex:1;padding:.5rem 0;border-radius:2rem;font-size:.9rem;font-weight:700;color:var(--muted);text-align:center}
.tabs button[aria-pressed=true]{background:var(--a);color:#fff}
.filters{display:flex;align-items:center;gap:.35rem;flex-wrap:wrap;margin:.25rem 0 .5rem}
.filters .grow{flex:1}
.section{margin:1.5rem 0 .6rem;display:flex;justify-content:space-between;align-items:baseline;gap:.5rem}
.section h2{font-size:1.25rem}
.group{margin:1.2rem 0 0;font-size:.8rem;text-transform:uppercase;letter-spacing:.06em;color:var(--muted)}
.lead{font-size:1.02rem;margin:.6rem 0 0;max-width:62ch}
.intro{margin:0 0 1.25rem;padding:0;background:none;font-size:.95rem;color:var(--muted);max-width:62ch}
.empty{color:var(--muted);text-align:center;padding:3rem 1rem;font-size:.95rem}

.install{position:sticky;top:0;z-index:10;margin:0 0 1rem;padding:.7rem .9rem;background:var(--warn-bg);color:var(--warn);border-radius:.6rem;font-size:.85rem;line-height:1.4}
.install strong{display:block;margin-bottom:.15rem}
.alert{position:sticky;top:.5rem;z-index:9;margin:0 0 .9rem;padding:.75rem .9rem;border-radius:.6rem;font-size:.9rem;font-weight:600;display:flex;gap:.6rem;align-items:flex-start}
.alert.amber{background:var(--warn-bg);color:var(--warn)}
.alert.red{background:var(--bad-bg);color:var(--bad)}
.alert p{margin:0;flex:1}
.alert .act{font-size:.8rem;text-decoration:underline;white-space:nowrap}

/* librería */
.trips{list-style:none;margin:0;padding:0}
.trip{display:grid;grid-template-columns:72px 1fr;gap:.9rem;align-items:center;width:100%;background:var(--card);border:1px solid var(--line);border-radius:1.1rem;padding:.8rem .9rem;margin:0 0 .7rem}
.trip .pic{width:72px;height:72px;border-radius:.9rem;overflow:hidden;background:var(--a-soft)}
.trip .pic img{width:100%;height:100%;object-fit:cover}
.trip h3{margin:0 0 .1rem}
.trip .tag{font-size:.8rem;font-weight:700;color:var(--a-ink);margin-top:.2rem}

/* pantalla del viaje */
.cover{position:relative;margin:calc(-.5rem - var(--safe-top)) -1rem 0;aspect-ratio:4/3;max-width:none;overflow:hidden;background:var(--a-soft)}
.install+.cover{margin-top:0}
.cover img{width:100%;height:100%;object-fit:cover}
.cover .shade{position:absolute;inset:0;background:linear-gradient(180deg,rgba(0,0,0,.3),rgba(0,0,0,0) 26%,rgba(0,0,0,.02) 42%,rgba(0,0,0,.62))}
.cover .text{position:absolute;left:1rem;right:1rem;bottom:1rem;color:#fff}
.cover h1{font-size:2.3rem;color:#fff;margin:.1rem 0}
.cover .eyebrow,.cover .meta{color:rgba(255,255,255,.88)}
.cover .back{position:absolute;top:calc(.5rem + var(--safe-top));left:.6rem;color:#fff;background:rgba(0,0,0,.35);border-color:rgba(255,255,255,.25);-webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px);min-height:36px}
.today{margin:1rem 0;padding:1rem;background:var(--a-soft);border-radius:1.1rem;display:grid;grid-template-columns:1fr auto;gap:.75rem;align-items:center;width:100%}
.today h3{margin:.15rem 0 .1rem}
.today .go{width:40px;height:40px;border-radius:50%;background:var(--a);color:#fff;display:grid;place-items:center}
.today .go svg{width:16px;height:16px}
.today .num{display:grid;justify-items:center;line-height:1;font-size:.7rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--a-ink);padding:0 .25rem}
.today .num b{font-family:var(--display);font-size:2.4rem;letter-spacing:-.02em;margin-bottom:.15rem}
.stays{list-style:none;margin:0;padding:0}
.stay{display:grid;grid-template-columns:72px 1fr auto;gap:.9rem;align-items:center;padding:.6rem 0;cursor:pointer;list-style:none}
.stay::-webkit-details-marker{display:none}
.stay .pic{width:72px;height:72px;border-radius:1rem;overflow:hidden;background:var(--a-soft);position:relative}
.stay .pic img{width:100%;height:100%;object-fit:cover}
.stay .n{position:absolute;left:-4px;bottom:-4px;width:24px;height:24px;border-radius:50%;background:var(--a);color:#fff;font-size:.75rem;font-weight:700;display:grid;place-items:center;border:2px solid var(--bg)}
.stay h3{color:var(--a-ink)}
.stay .open{width:28px;height:28px;display:grid;place-items:center;color:var(--muted);transition:transform .15s}
.stay .open svg{width:16px;height:16px}
details[open]>.stay .open{transform:rotate(90deg)}
.days{list-style:none;margin:0 0 .5rem 52px;padding:0 0 0 1.2rem;border-left:2px solid var(--a-soft)}
.days a{display:grid;grid-template-columns:3.4rem 1fr;gap:.6rem;padding:.4rem 0;text-decoration:none;align-items:baseline}
.days .d{font-size:.78rem;font-weight:700;color:var(--a-ink);text-transform:uppercase;letter-spacing:.04em;line-height:1.3}
.days .t{font-size:.92rem;line-height:1.3}
.days a.is-today .t{font-weight:700}
.leg{display:flex;align-items:center;padding:.1rem 0 .1rem 81px;position:relative}
.leg::before{content:"";position:absolute;left:35px;top:-.4rem;bottom:-.4rem;border-left:2px dotted var(--line)}
.leg .chip{color:var(--muted);font-weight:500}
.leg svg{width:14px;height:14px}

/* mapa del viaje */
.tripmap{margin:1rem 0 0;background:#DCEBF0;border-radius:1.1rem;overflow:hidden}
.tripmap svg{display:block;width:100%;height:auto}

/* mapa del día */
.daymap{margin:0 0 1.25rem}
.daymap .frame{position:relative;border-radius:1rem;overflow:hidden;border:1px solid var(--line);background:#F4EFE6}
.daymap .frame img,.daymap .frame svg,.mapfull .frame svg{position:absolute;inset:0;width:100%;height:100%;display:block}
.daymap figcaption{display:flex;gap:.5rem;flex-wrap:wrap;margin-top:.5rem}
.pin circle{fill:var(--a);stroke:#fff;stroke-width:3}
.pin text{fill:#fff;font-weight:700;text-anchor:middle;dominant-baseline:central;font-family:var(--ui)}
.here{fill:#1E6FD9;stroke:#fff;stroke-width:4}
.here-halo{fill:#1E6FD9;opacity:.18}
.mapfull{position:fixed;inset:0;z-index:20;background:#F4EFE6;display:flex;flex-direction:column}
.mapfull .scroll{flex:1;overflow:auto;-webkit-overflow-scrolling:touch}
.mapfull .frame{position:relative;width:260vw}
.mapfull .frame img{position:absolute;inset:0;width:100%;height:100%;display:block}
.mapfull .barf{display:flex;gap:.5rem;justify-content:space-between;align-items:center;padding:calc(.5rem + var(--safe-top)) 1rem .5rem;background:var(--bg);border-bottom:1px solid var(--line)}
.mapfull .foot{padding:.5rem 1rem calc(.6rem + var(--safe-bottom));background:var(--bg);border-top:1px solid var(--line);display:flex;gap:.5rem}

/* línea de tiempo del día */
.tl{list-style:none;margin:0;padding:0;position:relative}
.tl::before{content:"";position:absolute;left:calc(3.6rem + 21px);top:14px;bottom:14px;width:2px;background:var(--line)}
.tl li{display:grid;grid-template-columns:3.6rem 44px 1fr;gap:0 .8rem;align-items:start;padding:.55rem 0;position:relative}
.tl li.nowline{display:flex;padding:.2rem 0}
.tl .t{font-weight:700;font-variant-numeric:tabular-nums;line-height:44px;text-align:right}
.tl .t small{display:block;line-height:1.2;font-size:.7rem;color:var(--muted);font-weight:500;margin-top:-.5rem}
.tl .ic{width:44px;height:44px;border-radius:50%;background:var(--card);border:2px solid var(--line);display:grid;place-items:center;position:relative;z-index:1;overflow:hidden;color:var(--muted)}
.tl .ic img{width:100%;height:100%;object-fit:cover}
.tl .ic svg{width:18px;height:18px}
.tl li.key .ic{border-color:var(--a);box-shadow:0 0 0 2px var(--a-soft)}
.tl li.meal .ic{background:var(--a-soft);color:var(--a-ink);border-color:var(--a-soft)}
.tl li.past{opacity:.55}
.tl li.current .ic{box-shadow:0 0 0 4px var(--a-soft);border-color:var(--a)}
.tl .body{padding-top:.55rem;min-width:0}
.tl .name{display:block;font-weight:700;line-height:1.3;text-decoration:none}
.tl .dead{font-size:.85rem;color:var(--a-ink);font-weight:600}
.tl .note{font-size:.85rem;color:var(--muted);margin-top:.15rem}
.tl .note::before{content:none}
.tl .note.warn{color:var(--warn)}
.tl .optional .name{color:var(--muted);font-weight:500}
.tl .optional .name::after{content:" · optional";font-size:.8rem;font-weight:400}
.chips{display:flex;flex-wrap:wrap;gap:.35rem;margin-top:.45rem}
.chips .chip{padding-left:.15rem}
.chips .chip.plain{padding-left:.7rem}
.chips .chip img{margin:0}
.nowline{display:flex;align-items:center;gap:.5rem;color:var(--a-ink);font-size:.75rem;font-weight:700;letter-spacing:.06em;text-transform:uppercase}
.nowline::after{content:"";flex:1;border-top:2px solid var(--a)}

/* sitios del día */
.cards{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:1fr 1fr;gap:1rem .8rem}
.card{display:block;text-decoration:none;min-width:0;width:100%}
.card .pic{aspect-ratio:4/3;border-radius:.9rem;overflow:hidden;background:var(--a-soft);display:grid;place-items:center;color:var(--a-ink)}
.card .pic img{width:100%;height:100%;object-fit:cover}
.card .pic svg{width:28px;height:28px}
.card .eyebrow{margin-top:.5rem}
.card h3{font-size:.98rem;margin:.1rem 0 0}
.card .line{font-size:.82rem;color:var(--muted);margin-top:.15rem;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.meals{list-style:none;margin:0;padding:0;display:grid;gap:1rem}
.spots{list-style:none;margin:0;padding:0}
.spot{display:grid;grid-template-columns:64px 1fr;gap:.9rem;align-items:center;padding:.5rem 0;border-bottom:1px solid var(--line);width:100%;text-decoration:none}
.spot:last-child{border-bottom:0}
.spot .pic{width:64px;height:64px;border-radius:.9rem;overflow:hidden;background:var(--a-soft);display:grid;place-items:center;color:var(--a-ink);flex:none}
.spot .pic img{width:100%;height:100%;object-fit:cover}
.spot .pic svg{width:24px;height:24px}
.spot .name{font-weight:700;line-height:1.3;margin:.1rem 0;display:block}
.spot .line{font-size:.85rem;color:var(--muted);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.filters .chip{font-size:.85rem;padding:.35rem .8rem}

/* reservas y paneles */
.panel{background:var(--card);border:1px solid var(--line);border-radius:1.1rem;padding:1rem;margin:.8rem 0}
.panel h3{margin:0 0 .5rem}
.panel p{margin:.35rem 0;font-size:.9rem}
.panel dl{display:grid;grid-template-columns:auto 1fr;gap:.3rem .8rem;margin:.6rem 0 0;font-size:.88rem}
.panel dt{color:var(--muted)}
.panel dd{margin:0;font-variant-numeric:tabular-nums}
.panel a{color:var(--a-ink)}
.panel ul{margin:.4rem 0 0;padding-left:1.1rem;font-size:.88rem}
.panel li{margin:.35rem 0}
.panel .ref{margin:.3rem 0;font-size:1.5rem;font-weight:700;letter-spacing:.04em;font-variant-numeric:tabular-nums;user-select:all;-webkit-user-select:all}
a.panel{display:block;text-decoration:none}
details.panel summary{font-weight:700;cursor:pointer}
.bk{display:grid;grid-template-columns:40px 1fr;gap:.8rem;align-items:start}
.bk .ic{width:40px;height:40px;border-radius:50%;background:var(--a-soft);color:var(--a-ink);display:grid;place-items:center}
.bk .ic svg{width:18px;height:18px}
.btns{display:flex;flex-wrap:wrap;gap:.5rem;margin:.75rem 0}
.btn{display:inline-flex;align-items:center;gap:.4rem;padding:.55rem 1rem;border-radius:2rem;background:var(--a);color:#fff;font-weight:700;font-size:.9rem;text-decoration:none}
.btn.ghost{background:var(--card);border:1px solid var(--line);color:var(--ink)}
.btn svg{width:15px;height:15px}
.acts{display:flex;gap:.4rem;margin:.7rem 0 0;flex-wrap:wrap}
.acts button{padding:.35rem .8rem;border:1px solid var(--line);border-radius:2rem;font-size:.8rem;background:var(--bg)}
.acts button[aria-pressed=true]{background:var(--a);color:#fff;border-color:var(--a)}
.verdict{margin:.6rem 0 0;padding:.7rem .85rem;border-radius:.6rem;font-size:.88rem;background:var(--warn-bg);color:var(--warn)}
.verdict.ok{background:var(--good-bg);color:var(--good)}
.verdict.bad{background:var(--bad-bg);color:var(--bad)}

/* página del sitio y del hotel */
.hero{margin:0 -1rem;max-width:none}
.hero img{width:100%;aspect-ratio:4/3;object-fit:cover;background:var(--a-soft)}
.hero figcaption{font-size:.72rem;color:var(--muted);padding:.3rem 1rem 0}
.hero figcaption .credit{font-size:.68rem;display:block}
.place h1{margin-top:.6rem}
.facts{display:grid;grid-template-columns:auto 1fr;gap:.3rem .9rem;margin:1rem 0;font-size:.9rem;padding:.9rem 1rem;background:var(--card);border:1px solid var(--line);border-radius:1.1rem}
.facts dt{color:var(--muted)}
.facts dd{margin:0;font-variant-numeric:tabular-nums}
.facts a{color:var(--a-ink)}
.taxi{margin:1rem 0;padding:1rem 1.1rem;background:var(--a-soft);border-radius:1.1rem}
.taxi .eyebrow{color:var(--a-ink);margin-bottom:.4rem}
.taxi .thai{font-size:1.5rem;line-height:1.45;margin:.1rem 0}
.story{margin:1.5rem 0 .5rem;padding-top:.75rem;border-top:1px solid var(--line)}
.story h3{font-family:inherit;font-size:.75rem;letter-spacing:.08em;text-transform:uppercase;color:var(--a-ink);margin:1.2rem 0 .35rem}
.story p{margin:.5rem 0;font-size:1rem;line-height:1.6;max-width:62ch}
.story ul{margin:.4rem 0;padding-left:1.1rem;font-size:.95rem;line-height:1.55}
.story li{margin:.25rem 0}
.story figure{margin:1.1rem 0}
.story figure img{width:100%;aspect-ratio:16/10;object-fit:cover;object-position:50% 25%;border-radius:1rem;background:var(--a-soft)}
.story figcaption{font-size:.85rem;color:var(--muted);margin-top:.4rem}
.story figcaption .credit{font-size:.68rem;display:block;margin-top:.1rem}
.options{margin:1rem 0 0}

/* ajustes */
.panel input{font:inherit;color:inherit;background:var(--bg);border:1px solid var(--line);border-radius:.4rem;padding:.2rem .4rem}
@media (prefers-reduced-motion:no-preference){.screen{animation:in .18s ease-out}@keyframes in{from{opacity:.4;transform:translateY(4px)}}}
button:focus-visible,a:focus-visible{outline:2px solid var(--a);outline-offset:2px}
`;

/** Todo junto, para `web/app.css`. */
export const FULL_STYLE = TOKENS + DAY_STYLE + APP_STYLE;

/** Sólo lo que necesita el HTML exportado, que viaja suelto. */
export const STATIC_STYLE = TOKENS + DAY_STYLE;
