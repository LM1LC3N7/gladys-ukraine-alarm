// -----------------------------------------------------------------------------
// The texts shown in Gladys (connection status, buttons), in English and
// French. Never the token, never a text of the API: codes and numbers only.
// -----------------------------------------------------------------------------

import { TIME_ZONE } from './constants.js';

const clock = new Intl.DateTimeFormat('en-GB', {
  timeZone: TIME_ZONE,
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** "HH:MM" in Kyiv of an instant (wall clock, ms), rounded up to the minute. */
export const kyivTime = (instant) => clock.format(new Date(Math.ceil(instant / 60_000) * 60_000));

const both = (en, fr) => ({ en, fr });
const plural = (n, one, many) => (n === 1 ? one : many);

export const STATUS = {
  ok: (count, alerts) =>
    both(
      `Connected: ${count} ${plural(count, 'location', 'locations')} watched, ${alerts} with an alert.`,
      `Connecté : ${count} ${plural(count, 'lieu suivi', 'lieux suivis')}, ${alerts} en alerte.`,
    ),
  waiting: both(
    'Connected: the first read is on its way.',
    'Connecté : la première lecture est en cours.',
  ),
  noDevice: both(
    'Connected. Add the locations in the Discover tab of the integration to read them.',
    'Connecté. Ajoutez les lieux dans l’onglet Découverte de l’intégration pour les lire.',
  ),
  noLocation: both(
    'No location: type the UIDs of the locations to watch (button "Find a location").',
    'Aucun lieu : saisissez les UID des lieux à suivre (bouton « Chercher un lieu »).',
  ),
  tokenMissing: both(
    'No token: request a free token from alerts.in.ua (link above) and type it.',
    'Aucun jeton : demandez un jeton gratuit à alerts.in.ua (lien ci-dessus) et saisissez-le.',
  ),
  tokenInvalid: both(
    'The token holds spaces or characters a token never has: type it again.',
    'Le jeton contient des espaces ou des caractères qu’un jeton n’a jamais : saisissez-le à nouveau.',
  ),
  refused: (status) =>
    both(
      `alerts.in.ua refused the token (HTTP ${status}): no automatic read until a new token is saved or the "Test the connection" button succeeds.`,
      `alerts.in.ua a refusé le jeton (HTTP ${status}) : plus aucune lecture automatique tant qu’un nouveau jeton n’est pas enregistré ou que le bouton « Tester la connexion » ne réussit pas.`,
    ),
  denied: (until) =>
    both(
      `alerts.in.ua refused this address (HTTP 403: address blocked, or the API not served in this country). Next try at ${kyivTime(until)} (Kyiv time).`,
      `alerts.in.ua a refusé cette adresse (HTTP 403 : adresse bloquée, ou API non servie dans ce pays). Nouvel essai à ${kyivTime(until)} (heure de Kyiv).`,
    ),
  paused: (until) =>
    both(
      `Too many requests (HTTP 429): reads paused until ${kyivTime(until)} (Kyiv time).`,
      `Trop de requêtes (HTTP 429) : lectures en pause jusqu’à ${kyivTime(until)} (heure de Kyiv).`,
    ),
  failing: (code, next) =>
    both(
      `alerts.in.ua could not be read (${code}). Next try at ${kyivTime(next)} (Kyiv time).`,
      `alerts.in.ua n’a pas pu être lu (${code}). Nouvel essai à ${kyivTime(next)} (heure de Kyiv).`,
    ),
  stale: (since) =>
    since === null
      ? both('No good read yet.', 'Aucune lecture réussie pour l’instant.')
      : both(
          `No good read since ${kyivTime(since)}: the levels shown are not recent.`,
          `Aucune lecture réussie depuis ${kyivTime(since)} : les niveaux affichés ne sont pas récents.`,
        ),
  unknownUids: (uids) =>
    both(
      `No data for the UID ${uids.join(', ')}: check it (button "Find a location", or the full list linked above).`,
      `Aucune donnée pour l’UID ${uids.join(', ')} : vérifiez-le (bouton « Chercher un lieu », ou la liste complète en lien ci-dessus).`,
    ),
  invalidLocations: (n) =>
    both(
      `${n} ${plural(n, 'entry', 'entries')} of the locations ignored: not a UID (1 to 9999).`,
      `${n} ${plural(n, 'entrée ignorée', 'entrées ignorées')} dans les lieux : pas un UID (1 à 9999).`,
    ),
  droppedLocations: (n, max) =>
    both(
      `${n} more ${plural(n, 'location', 'locations')} ignored: ${max} at most.`,
      `${n} ${plural(n, 'lieu ignoré', 'lieux ignorés')} en plus : ${max} au plus.`,
    ),
  store: both(
    'The integration folder (/data) cannot be read yet: retried every 10 s.',
    'Le dossier de l’intégration (/data) n’est pas encore lisible : nouvel essai toutes les 10 s.',
  ),
  configRetry: both(
    'The configuration could not be read from Gladys: retried.',
    'La configuration n’a pas pu être lue depuis Gladys : nouvel essai.',
  ),
};

export const TEST = {
  ok: (lines) => both(`Token accepted.\n${lines.en}`, `Jeton accepté.\n${lines.fr}`),
  recent: (seconds, lines) =>
    both(
      `Last read ${seconds} s ago (no new request sooner than every 20 s).\n${lines.en}`,
      `Dernière lecture il y a ${seconds} s (pas de nouvelle requête à moins de 20 s d’écart).\n${lines.fr}`,
    ),
  line: (name, uid, level) =>
    both(`${name} [${uid}]: ${LEVEL_TEXT.en[level]}`, `${name} [${uid}] : ${LEVEL_TEXT.fr[level]}`),
  unknown: (name, uid) =>
    both(`${name} [${uid}]: no data for this UID`, `${name} [${uid}] : aucune donnée pour cet UID`),
  none: both('No location typed yet.', 'Aucun lieu saisi pour l’instant.'),
};

export const LEVEL_TEXT = {
  en: ['no alert', 'alert in part of it', 'alert, yellow level', 'alert, red level'],
  fr: ['pas d’alerte', 'alerte sur une partie', 'alerte, niveau jaune', 'alerte, niveau rouge'],
};

export const SEARCH = {
  short: both('Type at least two letters.', 'Saisissez au moins deux lettres.'),
  none: both(
    'Nothing found among the oblasts, raions and cities. A hromada: take its UID from the full list linked above.',
    'Rien trouvé parmi les oblasts, raions et villes. Une hromada : prenez son UID dans la liste complète en lien ci-dessus.',
  ),
  found: (lines) => both(lines.join('\n'), lines.join('\n')),
};
