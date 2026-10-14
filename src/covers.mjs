// Phrases de couverture : ce que voit un observateur qui n'a pas le plugin.
//
// Le point faible d'un canal stéganographique n'est pas le chiffrement, c'est la
// régularité — et trois régularités se repèrent sans aucun outil, juste en
// lisant le salon : toujours les mêmes phrases, toujours la même FORME, et la
// même phrase deux fois à quelques messages d'écart (ce qu'un tirage uniforme
// produit très vite). D'où plusieurs gabarits composés à partir de pools
// séparés, et une mémoire des derniers tirages.
//
// Le pool ci-dessous est public, donc connu de l'adversaire : le réglage
// *Cover Pool* existe pour qui préfère ses propres phrases.

import { graphemeCount } from "./graphemes.mjs";
import { pickOne as pick, randomInt } from "./random.mjs";

const SHORT = [
    "ok", "ouais", "mdr", "ah ok", "hmm", "jsp", "carrément", "ptdr",
    "grave", "clair", "ça marche", "nickel", "ah bon", "yes", "bah ouais",
    "mouais", "ah si", "voilà", "exact", "tranquille",
    "ah ouais", "trop bien", "je vois", "ça roule", "tqt", "genre",
    "au pire", "bien vu", "ok ok", "pas mal", "évidemment", "aucune idée"
];

const OPENERS = [
    "ok ça marche", "ah ouais carrément", "mdr t'es sérieux", "ouais je te suis là-dessus",
    "franchement pas faux", "haha ok je note", "nickel on fait comme ça", "ptdr ouais grave",
    "attends je check et je reviens", "hmm ok pourquoi pas", "genre ouais je vois",
    "bah écoute ça me va", "ah d'accord je comprends mieux", "oui oui t'inquiète",
    "mouais à voir", "ok reçu", "ah bah tiens", "bon bah nickel", "j'avoue ouais",
    "ah mais oui suis bête", "ouais non t'as raison", "attends deux secondes",
    "ok je regarde ça", "haha n'importe quoi", "bon ok ça marche pour moi", "ouais enfin bon",
    "ah ok je vois le truc", "mdr arrête", "ouais c'est clair", "bah oui logique",
    "ok noté merci", "hmm je sais pas trop", "ah si si je me souviens", "ouais ça se tente",
    "bon on verra bien", "ok parfait", "ah mince ok", "ouais pas de souci", "bon bref",
    "ah ouais quand même",
    "ah je savais pas tiens", "ouais bon on verra", "franchement ça dépend",
    "mdr t'as raison en vrai", "attends je réfléchis", "ok mais genre comment",
    "ah ouais je vois le délire", "bon allez ça marche", "ouais faut que je check",
    "hmm pas sûr en fait", "ah bah voilà quoi", "ptdr t'es grave toi",
    "ouais je crois aussi", "ah ok ok je note ça", "bon bah on fait ça alors",
    "franchement pourquoi pas", "ouais carrément grave", "ah mince j'avais oublié",
    "ok je te fais signe", "haha ouais c'est ça", "bon écoute pourquoi pas",
    "ouais non mais clair", "ah t'inquiète c'est bon", "mdr ok si tu veux"
];

// Deuxième proposition, pour les gabarits en deux temps.
const FOLLOWS = [
    "je te redis", "on verra", "faut voir", "j'y pense", "je note", "ça marche",
    "pas de souci", "je te tiens au courant", "à voir demain", "on en reparle",
    "je check", "faut que j'y réfléchisse",
    "on s'appelle", "je reviens vers toi", "faut qu'on cale ça", "je te confirme après",
    "dispo ce soir", "on cale demain", "je regarde de mon côté", "à voir ensemble"
];

const QUESTIONS = [
    "t'en penses quoi ?", "tu fais quoi ce soir ?", "c'est bon pour toi ?",
    "on dit quoi du coup ?", "t'es dispo quand ?", "ça te va ?", "tu confirmes ?",
    "et sinon quoi de neuf ?", "tu pars à quelle heure ?", "c'était bien ?",
    "on se cale ça quand ?", "ça part sur quoi ?", "t'as vu le truc ?",
    "tu viens du coup ?", "on part à quelle heure ?", "c'est chaud ou pas ?",
    "tu me redis ?", "ça donne quoi ?"
];

// Suffixes optionnels. La chaîne vide DOMINE largement : une phrase sur deux
// avec emoji serait elle-même une signature. Ici ~53 % de tirages sans emoji.
const TAILS = [
    "", "", "", "", "", "", "", "", "", "",
    " 👍", " 😂", " 🤔", " 😅", " 🙌", " 🤷", " 😬", " 🔥", " 🙄"
];

// Gabarits, avec leur poids. La variété de FORME compte autant que celle du
// vocabulaire : un fil où tous les messages font la même longueur se voit.
const SHAPES = [
    { weight: 20, build: () => pick(SHORT) },
    { weight: 28, build: () => pick(OPENERS) },
    { weight: 22, build: () => pick(OPENERS) + pick(TAILS) },
    { weight: 15, build: () => `${pick(OPENERS)}, ${pick(FOLLOWS)}` },
    { weight: 10, build: () => pick(QUESTIONS) },
    { weight: 5, build: () => `${pick(SHORT)}, ${pick(FOLLOWS)}` }
];

const TOTAL_WEIGHT = SHAPES.reduce((n, s) => n + s.weight, 0);

// Nombre de sorties distinctes possibles, un terme par pool de départ.
export const COVER_POOL_SIZE = SHORT.length * (1 + FOLLOWS.length)
    + OPENERS.length * (1 + new Set(TAILS).size + FOLLOWS.length) + QUESTIONS.length;

// Une couverture n'est pas qu'une phrase crédible : c'est l'espace dans lequel le
// payload se disperse, un intervalle entre graphèmes par emplacement. Mesuré sur
// 800 messages : les couvertures de 2 graphèmes donnaient 100 % de série
// contiguë, celles de 3 graphèmes 77 %, celles de 5 graphèmes 49 %. À partir de
// 8, on retombe sous le seuil visé.
export const MIN_COVER_GRAPHEMES = 8;

// Mémoire des dernières couvertures produites. Sans elle, un tirage uniforme sur
// 40 ouvertures répète la même phrase au bout de ~8 messages (paradoxe des
// anniversaires) — exactement le motif qu'un lecteur du salon remarque.
const RECENT_MAX = 16;
const recent = [];

function remember(cover) {
    recent.push(cover);
    if (recent.length > RECENT_MAX) recent.shift();
    return cover;
}

// Tire jusqu'à obtenir une phrase à la fois inédite et assez longue pour
// disperser. Le nombre d'essais est borné : avec un pool minuscule fourni par
// l'utilisateur, on finit par accepter ce qu'on a plutôt que de boucler.
function pickFresh(generate, min, tries = 24) {
    let cover = generate(), repli = cover; // repli : meilleure phrase vue jusqu'ici
    for (let i = 0; i < tries; i++) {
        const assezLongue = graphemeCount(cover) >= min;
        if (assezLongue && !recent.includes(cover)) return remember(cover);
        if (assezLongue) repli = cover;
        cover = generate();
    }
    return remember(repli);
}

function generateAuto() {
    let roll = randomInt(TOTAL_WEIGHT);
    return SHAPES.find(({ weight }) => (roll -= weight) < 0).build();
}

// Découpe une liste fournie par l'utilisateur. Le champ de réglage Vencord est
// mono-ligne, donc on accepte aussi le point-virgule comme séparateur.
export function parseCoverPool(text) {
    return text ? text.split(/[\n;]/).map(s => s.trim()).filter(Boolean) : [];
}

// Couverture à utiliser :
//   1. `custom` — phrase imposée pour ce message précis. Reprise telle quelle :
//      l'utilisateur a demandé cette phrase-là. Si elle est trop courte pour
//      disperser, le codec refusera d'encoder plutôt que de produire un message
//      qui se repère.
//   2. `pool` — liste perso (le pool intégré est public, donc connu).
//   3. sinon — génération par gabarits, contrainte à `min` graphèmes.
export function pickCover(custom, { pool, min = MIN_COVER_GRAPHEMES } = {}) {
    if (custom && custom.trim()) return custom.trim();
    return pickFresh(pool && pool.length ? () => pick(pool) : generateAuto, min);
}

// Vide la mémoire anti-répétition (tests, changement de pool).
export function resetCoverHistory() {
    recent.length = 0;
}
