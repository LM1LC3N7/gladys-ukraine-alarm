# Ukraine Alarm (alerts.in.ua)

Les alertes aériennes ukrainiennes dans Gladys, par oblast, raion, hromada ou
ville, lues depuis l’API officielle d’[alerts.in.ua](https://alerts.in.ua).

Connecteur non officiel, sans lien avec alerts.in.ua. Jamais testé avec un vrai
jeton : écrit d’après la documentation officielle de l’API ; merci de signaler
ce que vous observez.

**Ce n’est PAS un système de sécurité.** Les données arrivent avec des retards
(techniques ou humains) et l’intégration les lit toutes les 30 s par défaut.
Fiez-vous aux canaux officiels : sirènes, application Air Alert, autorités
locales.

## Ce que vous obtenez

- Un appareil par lieu suivi, avec une fonction, **Niveau d’alerte** :
  - `0` aucune alerte ;
  - `1` alerte sur une partie du lieu (certains de ses raions ou hromadas, pas
    tout le lieu) ;
  - `2` alerte de niveau jaune ;
  - `3` alerte de niveau rouge.
- Deux déclencheurs de scène :
  - **Alerte aérienne commencée** : une alerte de niveau jaune ou rouge a
    commencé sur tout le lieu, ou une alerte jaune est passée au rouge. Filtres :
    le lieu (vide : n’importe lequel) et le niveau (vide : n’importe lequel).
    Informations transmises à la scène : le nom du lieu, son UID, le niveau
    (`yellow` ou `red`), si une alerte jaune est passée au rouge, et si le
    changement a été vu en retard (voir plus bas).
  - **Alerte aérienne terminée** : l’alerte de niveau jaune ou rouge sur tout le
    lieu est terminée (niveau 0 ou 1). Informations : le nom du lieu, son UID,
    la durée en minutes (vide si le début n’a pas été vu) et « vue en retard ».
- Le niveau est aussi un état d’appareil ordinaire : une scène peut le tester
  (par exemple « Niveau d’alerte de Kyiv supérieur ou égal à 2 »).

Un niveau 1 (alerte sur une partie du lieu) ne déclenche rien : suivez le plus
petit lieu qui contient votre domicile (sa hromada ou son raion) pour savoir si
l’alerte le concerne.

## Étape 1 : obtenir un jeton

Demandez un jeton personnel gratuit avec le formulaire d’alerts.in.ua :
<https://alerts.in.ua/api-request>. Il arrive par e-mail. Le jeton est à vous :
alerts.in.ua vous attribue chaque requête faite avec.

## Étape 2 : configurer

Dans Gladys, **Intégrations > Ukraine Alarm > Configuration** :

1. **Jeton de l’API alerts.in.ua** : collez le jeton. Gardé par Gladys dans sa
   base, jamais réaffiché, envoyé seulement à alerts.in.ua (dans l’en-tête
   `Authorization` de chaque requête, en HTTPS).
2. **Lieux à suivre (UID)** : les UID des lieux, séparés par des virgules, 20
   au plus. Exemples : `31` Kyiv (ville), `14` oblast de Kyiv, `1293` Kharkiv
   (ville), `564` Zaporijjia (ville).
   - Le bouton **Chercher un lieu** donne l’UID d’un oblast, d’un raion ou d’une
     ville à partir d’une partie de son nom, en lettres ukrainiennes ou latines
     (`Kharkiv`, `Львів`). Il n’envoie aucune requête.
   - Une hromada : prenez son UID dans la
     [liste complète des lieux](https://docs.google.com/spreadsheets/d/1XnTOzcPHd1LZUrarR1Fk43FUyl8Ae6a6M7pcwDRjNdA/edit?usp=sharing)
     donnée par la documentation de l’API. Son appareil s’appelle « Alerts: Location
     <UID> » : renommez-le dans Gladys.
3. **Intervalle de lecture** : 30 s par défaut, de 20 s à 600 s. Une seule
   requête lit tous les lieux.
4. Enregistrez, puis **Tester la connexion** : le bouton lit alerts.in.ua et
   montre le niveau de chaque lieu.
5. Dans l’onglet **Découverte**, ajoutez les appareils voulus. Rien n’est lu
   avant qu’un appareil soit ajouté.

## Comment il lit

- Une requête GET par intervalle, quel que soit le nombre de lieux, avec
  `If-Modified-Since` (alerts.in.ua répond « non modifié » si rien n’a changé).
  Une requête à la fois.
- alerts.in.ua admet 8 à 10 requêtes par minute et par adresse Internet (12 au
  maximum, puis l’adresse et le jeton sont bloqués). Les autres applications
  derrière la même adresse comptent aussi : d’où 20 s au plus rapide.
- Le rythme tient après un redémarrage : l’heure de chaque tentative est écrite
  dans le dossier de l’intégration avant la requête, et la lecture suivante
  attend la fin de l’intervalle.
- Le bouton **Tester la connexion** n’envoie pas de nouvelle requête moins de
  20 s après la précédente : il montre alors la dernière réponse.

## Quand quelque chose ne va pas

| Ce qui arrive                                                         | Ce que fait l’intégration                                                                                                                                              |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Le jeton est refusé (HTTP 401)                                        | Plus aucune lecture automatique. Enregistrer un nouveau jeton, ou le bouton de test qui lit avec succès, relance les lectures. Le statut le dit.                       |
| HTTP 403 (adresse bloquée, ou API non servie dans votre pays)         | Pas un refus du jeton : lectures en pause 30 min, puis 1 h, 2 h… jusqu’à 6 h.                                                                                          |
| Trop de requêtes (HTTP 429)                                           | Lectures en pause le temps demandé par alerts.in.ua (`Retry-After`), sinon 1 min doublée à chaque fois ; entre 1 min et 6 h.                                           |
| Erreur du serveur, délai dépassé, réseau, réponse coupée ou illisible | Pas un refus : nouvel essai après un intervalle, puis l’attente double à chaque fois, jusqu’à 15 min (30 s, 1 min, 2, 4, 8, puis 15 min avec l’intervalle par défaut). |
| Aucune lecture réussie depuis 10 min                                  | Le statut dit que les niveaux affichés ne sont pas récents.                                                                                                            |
| Un UID sans données                                                   | Le statut le nomme ; son appareil ne reçoit pas de niveau.                                                                                                             |

Les pauses et le refus sont gardés dans le dossier de l’intégration (`/data`)
et tiennent après un redémarrage. D’un jeton refusé, seuls 8 bits d’une
empreinte salée sont gardés, jamais le jeton.

## Événements de scène après un redémarrage ou une panne

Le dernier niveau de chaque lieu est gardé 2 heures. Après un redémarrage ou une
panne, la première lecture lui est comparée : une alerte commencée (ou
terminée) entre-temps déclenche sa scène avec « vue en retard ». Un niveau de
plus de 2 heures n’est pas comparé : aucun déclenchement pour un changement qui
date peut-être de plusieurs heures.

## Limites

- Le niveau vient de l’état compact « IoT » d’alerts.in.ua (v2, avec les
  niveaux rouge et jaune). Une alerte active donnée sans niveau (`A`) compte
  comme rouge.
- Que l’état d’une hromada montre aussi une alerte déclarée pour tout son oblast
  dépend d’alerts.in.ua (non vérifié sans vrai jeton).
- Seulement les alertes aériennes : les autres menaces d’alerts.in.ua
  (artillerie, combats urbains, chimique, nucléaire) et le détail de chaque
  menace ne sont pas lus dans cette version.
- Les noms des raions sont en ukrainien seulement.

## Vie privée

L’intégration n’envoie que le jeton et son propre User-Agent
(`gladys-ukraine-alarm/<version>`) à api.alerts.in.ua. Elle ne suit jamais de
redirection. Le jeton n’est jamais écrit dans les journaux, le statut ni le
dossier de l’intégration.

## Source

Données : [alerts.in.ua](https://alerts.in.ua), projet bénévole ; API :
<https://devs.alerts.in.ua>. Code source : Apache-2.0,
<https://github.com/LM1LC3N7/gladys-ukraine-alarm>.
