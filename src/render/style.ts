/**
 * Hoja de estilos única, compartida por el render estático y por la app.
 *
 * Vive en TypeScript en vez de en un `.css` porque el paso de construcción la
 * escribe a `web/app.css` y el render estático la incrusta: una sola fuente,
 * dos destinos. Los colores salen del manifest de §12.1.
 */

export const TOKENS = `
:root{
  --ink:#12211f; --bg:#DCE2E1; --card:#fff; --accent:#1F6070; --muted:#5f7370;
  --warn:#8a5a00; --warn-bg:#fdf3dc; --bad:#8c2f24; --bad-bg:#fbe9e6;
  --good:#1d5e33; --good-bg:#e4f2e8; --line:#c3d0ce;
  --safe-top:env(safe-area-inset-top,0px); --safe-bottom:env(safe-area-inset-bottom,0px);
}
@media(prefers-color-scheme:dark){
  :root{
    --ink:#e6edec; --bg:#101a19; --card:#182726; --accent:#7fc4d3; --muted:#9bb0ad;
    --warn:#f0c674; --warn-bg:#3a2f14; --bad:#f2a196; --bad-bg:#3d1f1b;
    --good:#9ad9b0; --good-bg:#16301f; --line:#2b3d3b;
  }
}
`;

/** Estilos del día: los usa igual el HTML exportado que la pantalla del día. */
export const DAY_STYLE = `
*{box-sizing:border-box}
body{margin:0;padding:1.25rem;background:var(--bg);color:var(--ink);font:1rem/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;max-width:44rem;margin-inline:auto;-webkit-text-size-adjust:100%}
h1{font-size:1.7rem;line-height:1.2;margin:.2rem 0}
h2.alt{font-size:1.05rem;font-weight:500;color:var(--muted);margin:.1rem 0 0}
h3{font-size:1.1rem;margin:0 0 .15rem}
.date{text-transform:uppercase;letter-spacing:.08em;font-size:.75rem;color:var(--muted);margin:0}
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
.meta{margin:0;font-size:.8rem;color:var(--muted)}
.hours{margin-left:.4rem}
.hours.unknown{font-style:italic}
.local{font-weight:400;color:var(--muted);font-size:.9rem}
.anchor{margin:.45rem 0 0;font-size:.82rem;font-weight:600;color:var(--accent)}
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

/** Cromo de la app: barra, avisos, librería, botones. No lo usa el HTML exportado. */
export const APP_STYLE = `
body{padding:0}
#app{padding:calc(1rem + var(--safe-top)) 1rem calc(5rem + var(--safe-bottom));max-width:44rem;margin-inline:auto}
button{font:inherit;color:inherit;background:none;border:none;padding:0;cursor:pointer}
.bar{display:flex;align-items:center;gap:.6rem;margin:0 0 1rem}
.bar h1{font-size:1.35rem;flex:1;margin:0}
.chip{padding:.3rem .7rem;border:1px solid var(--line);border-radius:2rem;font-size:.8rem;background:var(--card)}
.chip[aria-pressed=true]{background:var(--accent);color:var(--bg);border-color:var(--accent)}
.back{color:var(--accent);font-size:.9rem}
.back.grow{flex:1}
.tabs{display:flex;gap:.3rem;margin:.8rem 0 1rem;padding:.25rem;background:var(--card);border-radius:.7rem}
.tabs button{flex:1;padding:.45rem 0;border-radius:.5rem;font-size:.85rem;font-weight:600;color:var(--muted)}
.tabs button[aria-pressed=true]{background:var(--accent);color:var(--bg)}
.group{margin:1.2rem 0 0;font-size:.8rem;text-transform:uppercase;letter-spacing:.06em;color:var(--muted)}
.panel .ref{margin:.3rem 0;font-size:1.5rem;font-weight:700;letter-spacing:.04em;font-variant-numeric:tabular-nums;user-select:all;-webkit-user-select:all}
.chip.off{opacity:.3}

.install{position:sticky;top:0;z-index:10;margin:0 0 1rem;padding:.7rem .9rem;background:var(--warn-bg);color:var(--warn);border-radius:.6rem;font-size:.85rem;line-height:1.4}
.install strong{display:block;margin-bottom:.15rem}

.alert{position:sticky;top:.5rem;z-index:9;margin:0 0 .9rem;padding:.75rem .9rem;border-radius:.6rem;font-size:.9rem;font-weight:600;display:flex;gap:.6rem;align-items:flex-start}
.alert.amber{background:var(--warn-bg);color:var(--warn)}
.alert.red{background:var(--bad-bg);color:var(--bad)}
.alert p{margin:0;flex:1}
.alert .act{font-size:.8rem;text-decoration:underline;white-space:nowrap}

.trips{list-style:none;margin:0;padding:0}
.trip{display:block;width:100%;text-align:left;background:var(--card);border-radius:.7rem;padding:.9rem 1rem;margin:0 0 .7rem}
.trip h3{margin:0 0 .2rem}
.trip .when{border:none;text-align:left;padding:0}
.trip .tag{float:right;font-size:.7rem;text-transform:uppercase;letter-spacing:.05em;padding:.15rem .5rem;border-radius:1rem;background:var(--line);color:var(--ink)}
.trip .tag.active{background:var(--accent);color:var(--bg)}
.progress{margin:.5rem 0 0;height:.35rem;background:var(--line);border-radius:1rem;overflow:hidden}
.progress i{display:block;height:100%;background:var(--accent)}

.days{list-style:none;margin:1rem 0 0;padding:0;display:grid;gap:.5rem}
.dayrow{display:flex;gap:.8rem;align-items:baseline;width:100%;text-align:left;background:var(--card);border-radius:.6rem;padding:.7rem .9rem}
.dayrow b{font-variant-numeric:tabular-nums;color:var(--muted);font-size:.8rem;min-width:3.5rem}
.dayrow.today{outline:2px solid var(--accent)}
.dayrow.past{opacity:.5}
.dayrow .grow{flex:1}
.dayrow .sub{display:block;color:var(--muted);font-size:.85em}
.dayrow .flag{color:var(--warn);font-weight:700}
.dayrow .go{color:var(--muted)}
.nowline{display:flex;align-items:center;gap:.5rem;color:var(--accent);font-size:.75rem;font-weight:600}
.nowline::after{content:"";flex:1;border-top:2px solid var(--accent)}
.lead{font-size:.95rem;margin:.7rem 0}
.photo{margin:0 0 .9rem}
.photo img{display:block;width:100%;aspect-ratio:16/10;object-fit:cover;border-radius:.7rem;background:var(--card)}
.photo figcaption{margin:.3rem 0 0;font-size:.68rem;color:var(--muted)}

.stop{transition:opacity .15s}
.stop.done .when strong{color:var(--muted);text-decoration:line-through}
.stop.skipped{opacity:.5}
.stop.skipped h3{text-decoration:line-through}
.stop.current{outline:2px solid var(--accent)}
.acts{grid-column:1/-1;display:flex;gap:.4rem;margin:.7rem 0 0;flex-wrap:wrap}
.acts button{padding:.35rem .8rem;border:1px solid var(--line);border-radius:2rem;font-size:.8rem;background:var(--bg)}
.acts button[aria-pressed=true]{background:var(--accent);color:var(--bg);border-color:var(--accent)}

.panel{background:var(--card);border-radius:.7rem;padding:1rem;margin:.8rem 0}
.panel h3{margin:0 0 .5rem}
.panel p{margin:.35rem 0;font-size:.9rem}
.panel dl{display:grid;grid-template-columns:auto 1fr;gap:.3rem .8rem;margin:.6rem 0 0;font-size:.85rem}
.panel dt{color:var(--muted)}
.panel dd{margin:0;font-variant-numeric:tabular-nums}
.panel a{color:var(--accent)}
.panel ul{margin:.4rem 0 0;padding-left:1.1rem;font-size:.88rem}
.panel li{margin:.35rem 0}
details.panel summary{font-weight:600;cursor:pointer}
a.chip{color:inherit;text-decoration:none}
.btn{display:inline-block;padding:.55rem 1.1rem;border-radius:.5rem;background:var(--accent);color:var(--bg);font-weight:600;font-size:.9rem;margin:.5rem .4rem 0 0}
.btn.ghost{background:none;border:1px solid var(--line);color:var(--ink)}
.verdict{margin:.6rem 0 0;padding:.7rem .85rem;border-radius:.5rem;font-size:.88rem;background:var(--warn-bg);color:var(--warn)}
.verdict.ok{background:var(--good-bg);color:var(--good)}
.verdict.bad{background:var(--bad-bg);color:var(--bad)}
.empty{color:var(--muted);text-align:center;padding:3rem 1rem;font-size:.95rem}
`;

/** Todo junto, para `web/app.css`. */
export const FULL_STYLE = TOKENS + DAY_STYLE + APP_STYLE;

/** Sólo lo que necesita el HTML exportado, que viaja suelto. */
export const STATIC_STYLE = TOKENS + DAY_STYLE;
