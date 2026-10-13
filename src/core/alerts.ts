/**
 * Avisos — §6.3.
 *
 * La tabla de la especificación deja un hueco: verde es holgura ≥ 25 y ámbar es
 * 0 ≤ holgura < 15, así que entre 15 y 25 no dice nada. No es un olvido, es que
 * la tabla describe una histéresis y en una histéresis el nivel depende también
 * de dónde venías. Bajando desde verde te quedas en verde hasta cruzar 15;
 * subiendo desde ámbar te quedas en ámbar hasta cruzar 25. Ese hueco es
 * precisamente la banda que impide el parpadeo.
 */

import type { Day, Waypoint } from '../model/types.ts';
import { computeSlack, type StatusLookup, type SlackResult } from './schedule.ts';
import { formatClock, formatDuration, type Minutes } from './time.ts';

export type AlertLevel = 'green' | 'amber' | 'red';

const AMBER_ON = 15;
const AMBER_OFF = 25;
const RED_OFF = 10;

/** El nivel depende del anterior: sin eso, parpadea al cruzar el umbral. */
export function nextLevel(previous: AlertLevel, slack: Minutes): AlertLevel {
  if (slack < 0) return 'red';
  if (previous === 'red' && slack <= RED_OFF) return 'red';
  if (slack < AMBER_ON) return 'amber';
  if (previous === 'amber' && slack < AMBER_OFF) return 'amber';
  return 'green';
}

export interface DropProposal {
  /** Paradas a soltar, en el orden en que se sueltan. */
  drop: Waypoint[];
  /** Minutos que se recuperan. */
  recovers: Minutes;
  /** Holgura tras soltarlas. */
  slackAfter: Minutes;
  /** `true` si ni soltándolo todo se llega: entonces el ancla está perdida. */
  insufficient: boolean;
}

/**
 * §6.3 — el rojo nunca aparece sin proponer la salida.
 *
 * `priority: "key"` y `dropRank: null` significan lo mismo en la práctica —no se
 * suelta— y el fixture de Sevilla los mezcla: hay paradas `key` con dropRank 8,
 * 9 y 10. Se respeta lo más conservador de las dos, así que basta con que una
 * diga que no para no tocarla.
 */
export function proposeDrops(slack: SlackResult): DropProposal {
  const droppable = slack.pending
    .filter((w) => w.priority !== 'key' && typeof w.dropRank === 'number')
    .sort((a, b) => (a.dropRank as number) - (b.dropRank as number));

  const drop: Waypoint[] = [];
  let recovers = 0;

  for (const w of droppable) {
    if (slack.slack + recovers >= 0) break;
    drop.push(w);
    recovers += (w.duration ?? 0) + (w.travelFrom ?? 0);
  }

  return {
    drop,
    recovers,
    slackAfter: slack.slack + recovers,
    insufficient: slack.slack + recovers < 0,
  };
}

export interface Alert {
  level: AlertLevel;
  slack: Minutes;
  message: string;
  /** Sólo en rojo. La salida propuesta. */
  proposal?: DropProposal;
}

export interface AlertState {
  level: AlertLevel;
  /** Nivel al que se descartó el aviso. Vuelve a hablar si empeora un escalón. */
  dismissedAt?: AlertLevel;
}

/**
 * Descartar silencia hasta que la cosa empeore un escalón, no treinta segundos.
 * Un aviso que reaparece solo enseña a ignorarlo.
 */
export function shouldShow(state: AlertState, level: AlertLevel): boolean {
  if (level === 'green') return false;
  if (!state.dismissedAt) return true;
  const rank: Record<AlertLevel, number> = { green: 0, amber: 1, red: 2 };
  return rank[level] > rank[state.dismissedAt];
}

export interface EvaluateOptions {
  /** Nivel mostrado en el tick anterior. Sin él no hay histéresis. */
  previous?: AlertLevel;
  statusOf?: StatusLookup;
  /** Traduce un id de sitio a su nombre. Sin esto el aviso enseña ids. */
  nameOf?: (placeId: string) => string;
}

export function evaluate(day: Day, now: Minutes, opts: EvaluateOptions = {}): Alert {
  const { previous = 'green', statusOf, nameOf = (id) => id } = opts;
  const slack = computeSlack(day, now, statusOf);

  if (!slack.anchor || slack.slack === Infinity) {
    return { level: 'green', slack: Infinity, message: '' };
  }

  const level = nextLevel(previous, slack.slack);
  const at = formatClock(slack.anchor.time);

  // Sitio y hora, y nada más. Las etiquetas del plan son frases enteras
  // («Cierra el mercado (domingo)») que dentro de «No llegas a …» se leen fatal
  // y repiten lo que ya dice el nombre del sitio.
  const target = `${nameOf(slack.anchor.waypoint.place)} by ${at}`;

  if (level === 'green') {
    return { level, slack: slack.slack, message: '' };
  }

  if (level === 'amber') {
    return {
      level,
      slack: slack.slack,
      message: `${formatDuration(slack.slack)} to spare to reach ${target}`,
    };
  }

  const proposal = proposeDrops(slack);
  const shortfall = formatDuration(Math.abs(slack.slack));

  if (proposal.insufficient) {
    return {
      level,
      slack: slack.slack,
      proposal,
      message: `You will miss ${target} by ${shortfall}, even after dropping everything optional.`,
    };
  }

  const names = proposal.drop.map((w) => nameOf(w.place)).join(', ');
  return {
    level,
    slack: slack.slack,
    proposal,
    message:
      `You will miss ${target} by ${shortfall}. ` +
      `Skipping ${names} wins back ${formatDuration(proposal.recovers)}`,
  };
}
