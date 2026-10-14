// Logique du plugin, isolée de Vencord.
//
// Tout ce qui décide *quoi* envoyer et *quoi* déchiffrer vit ici : aucune
// dépendance à Discord, donc testable en Node. `index.tsx` ne garde que le
// câblage (boutons, événements Flux, toasts).
//
// C'est aussi le seul module qui assemble les trois mécanismes : `envelope`
// chiffre, `codec` cache les octets, `covers` choisit la phrase affichée.
// Aucun des trois ne connaît les deux autres.

import { MODE, detectMode, encode, frames, visibleText } from "./codec.mjs";
import { MIN_COVER_GRAPHEMES, parseCoverPool, pickCover } from "./covers.mjs";
import { PADDING, forgetKeys, open, seal, warmKey } from "./envelope.mjs";

// Réexporté pour que le câblage Vencord n'ait qu'une seule couche en face de
// lui : c'est la couche application qui expose ce dont l'interface a besoin.
export { MIN_COVER_GRAPHEMES, MODE, PADDING, parseCoverPool, warmKey };

export const DEFAULT_SEPARATOR = " | ";
export const LOCK_PREFIX = "🔓 ";
const MAX_MESSAGE_CHARS = 2000; // limite Discord

// Un séparateur vide ou fait uniquement d'espaces découperait tous les messages
// normaux : on retombe sur la valeur par défaut dans ce cas.
export function resolveSeparator(sep) {
    return sep && sep.trim() ? sep : DEFAULT_SEPARATOR;
}

export class AlibiError extends Error {
    constructor(code, message) {
        super(message);
        this.name = "AlibiError";
        this.code = code;
    }
}

// Sépare une saisie « phrase visible | message secret ».
//   - séparateur présent -> couverture écrite par l'humain, pour garder une
//     conversation cohérente ;
//   - absent -> tout est secret, la couverture est tirée au sort.
// On coupe au PREMIER séparateur seulement : le secret peut en contenir.
//
// C'est de l'interprétation de saisie utilisateur, pas de l'encodage — d'où sa
// place ici et non dans le codec.
function parseInput(raw, separator) {
    const at = raw.indexOf(separator);
    const cover = at < 0 ? "" : raw.slice(0, at).trim();
    const secret = at < 0 ? raw : raw.slice(at + separator.length);
    // Un des deux côtés vide (espaces compris) => la saisie n'est pas un vrai
    // couple couverture/secret : on chiffre tout, plutôt que de publier la
    // moitié gauche en clair en croyant que c'est une couverture voulue.
    return cover && secret.trim() ? { cover, secret } : { cover: null, secret: raw };
}

// ===========================================================================
// Envoi
// ===========================================================================
// Renvoie le message prêt à envoyer. Lève une AlibiError sur TOUT problème :
// l'appelant doit annuler l'envoi. C'est le point le plus important du plugin —
// un échec silencieux ici publie le message en clair.
export async function encodeOutgoing({
    raw, passphrase, mode = MODE.HIDDEN, defaultCover = "", separator = DEFAULT_SEPARATOR,
    context = "", author = "", padding = PADDING.BLOCK, pool = []
}) {
    if (!passphrase) throw new AlibiError("no-passphrase",
        "Alibi : aucun mot de passe défini. Message NON envoyé (il serait parti en clair).");
    // Le message est lié à son auteur : sans identifiant, personne ne pourrait
    // le lire. Mieux vaut ne rien envoyer que publier une couverture vide.
    if (!author) throw new AlibiError("no-author",
        "Alibi : impossible d'identifier ton compte. Message NON envoyé.");
    if (!raw || !raw.trim()) throw new AlibiError("empty", "Alibi : message vide.");

    const { cover, secret } = parseInput(raw, resolveSeparator(separator));
    // Le choix de la phrase affichée se fait ICI : c'est une décision de produit.
    // Le codec la reçoit toute faite et n'a pas à connaître le pool.
    let content;
    try {
        content = encode(mode, await seal(secret, passphrase, { context, author, padding }),
            pickCover(cover ?? defaultCover, { pool }));
    } catch (e) {
        // Une couverture trop courte n'est pas une panne de chiffrement : c'est
        // un réglage à corriger, et le message doit le dire.
        if (e instanceof RangeError) {
            throw new AlibiError("cover-too-short", `${e.message} Message NON envoyé.`);
        }
        throw new AlibiError("encode-failed",
            `Alibi : échec du chiffrement (${e?.message ?? e}). Message NON envoyé.`);
    }

    // Discord rejette silencieusement au-delà de 2000 : mieux vaut annuler avec
    // une explication que laisser le message disparaître sans rien dire.
    if (content.length > MAX_MESSAGE_CHARS) throw new AlibiError("too-long",
        `Alibi : message trop long de ${content.length - MAX_MESSAGE_CHARS} caractères une fois chiffré `
        + `(${content.length} / ${MAX_MESSAGE_CHARS}). Coupe-le en deux`
        + (mode === MODE.HIDDEN ? " ou passe en mode compact." : "."));
    return content;
}

// ===========================================================================
// Réception
// ===========================================================================
// true si le message porte déjà un payload Alibi (ne pas le re-chiffrer).
export function isAlibiMessage(content) {
    return detectMode(content) !== null;
}

// Essaie chaque trame que le mode `mode` peut lire dans le message. Le codec
// propose, l'enveloppe tranche : elle écarte les longueurs impossibles sans
// déchiffrer, donc en pratique une seule trame est vraiment essayée.
export async function decodeAs(mode, content, passphrase, { context = "", author = "" } = {}) {
    for (const frame of frames(mode, content)) {
        const text = await open(frame, passphrase, { context, author });
        if (text != null) return text;
    }
    return null;
}

// Renvoie le texte clair, ou null si ce n'est pas pour nous / mauvaise clé /
// message reposté par quelqu'un d'autre que son auteur.
// Ne lève jamais : un message hostile ne doit pas casser le rendu du salon.
export async function decodeIncoming({ content, passphrase, context = "", author = "" }) {
    if (!passphrase || !content || !author) return null;
    const mode = detectMode(content);
    if (!mode) return null;
    try {
        return await decodeAs(mode, content, passphrase, { context, author });
    } catch {
        return null;
    }
}

// Retire le marqueur ajouté à l'affichage, pour récupérer le clair d'origine
// (nécessaire avant de re-chiffrer un message qu'on édite).
export function stripMarkers(content) {
    return content.startsWith(LOCK_PREFIX) ? content.slice(LOCK_PREFIX.length) : content;
}

// ===========================================================================
// Anti-rejeu d'affichage
// ===========================================================================
// Discord re-dispatche les mêmes messages en boucle (scroll, focus, édition).
// On mémorise ce qui a déjà été traité — succès comme échec — pour ne pas
// relancer un déchiffrement par re-render.
export class SeenCache {
    constructor(max = 5000, evict = 1000) {
        this.max = max;
        this.evict = evict;
        this.map = new Map(); // Map = ordre d'insertion : les plus anciens d'abord
    }

    has(id, content) { return this.map.get(id) === content; }
    clear() { this.map.clear(); }
    get size() { return this.map.size; }

    set(id, content) {
        if (this.map.size >= this.max) {
            let n = this.evict;
            for (const k of this.map.keys()) { this.map.delete(k); if (--n === 0) break; }
        }
        this.map.set(id, content);
    }
}

// ===========================================================================
// Déchiffrement des messages affichés
// ===========================================================================
// Tout ce que le câblage Vencord doit retenir d'un message à l'autre, réuni ici
// pour être testé : dédoublonnage, nouvel essai quand le mot de passe change,
// et la liste des messages affichés en clair.
export class Decryptor {
    constructor() {
        this.seen = new SeenCache();  // messageId -> contenu déjà traité
        this.inFlight = new Set();    // déchiffrements en cours (anti-doublon)
        this.passphrase = "";
        // Messages dont le contenu affiché a été remplacé par le clair.
        // Volontairement SANS limite de taille : oublier une entrée, c'est perdre
        // la protection à l'édition sur un message dont le store contient le
        // secret en clair. Ce ne sont que des identifiants.
        this.decrypted = new Set();
    }

    // Renvoie le texte à afficher à la place du message, ou null s'il n'y a
    // rien à remplacer.
    //
    // Un message chiffré qu'on ne sait PAS lire n'est, lui, marqué par rien : un
    // signe à l'écran trahirait l'utilisateur devant un témoin ou un partage
    // d'écran. L'échec silencieux est un choix, pas un oubli.
    async read({ messageId, content, passphrase, context = "", author = "", showLock = true }) {
        if (passphrase !== this.passphrase) {
            this.passphrase = passphrase;
            this.seen.clear(); // retenter tout le salon avec la nouvelle clé
            forgetKeys();
            // `decrypted` n'est PAS vidé : les messages déjà affichés en clair le
            // restent, et leur édition doit continuer d'être interceptée.
        }
        // Sans auteur (mise à jour partielle de Discord), rien n'est tenté NI
        // mémorisé : le même contenu, revenu avec son auteur, doit être lu.
        if (!passphrase || !content || !author) return null;
        // Dédoublonnage AVANT le pré-filtre : un message déjà traité (échec
        // compris, ou contenu déjà remplacé) ne relance ni la détection ni le
        // déchiffrement.
        if (this.inFlight.has(messageId) || this.seen.has(messageId, content)) return null;

        this.inFlight.add(messageId);
        try {
            const text = await decodeIncoming({ content, passphrase, context, author });
            this.seen.set(messageId, content);
            if (text == null) return null;
            const shown = showLock ? LOCK_PREFIX + text : text;
            this.seen.set(messageId, shown); // le contenu remplacé ne repassera pas le filtre
            this.decrypted.add(messageId);
            return shown;
        } finally {
            this.inFlight.delete(messageId);
        }
    }

    // true si ce message est affiché en clair : son édition doit être re-chiffrée.
    wasDecrypted(messageId) {
        return this.decrypted.has(messageId);
    }

    reset() {
        this.seen.clear();
        this.decrypted.clear();
        forgetKeys(); // ne pas laisser traîner les clés dérivées
    }
}

// ===========================================================================
// Vérification de bout en bout
// ===========================================================================
// Le codec suppose que Discord conserve intégralement les caractères invisibles
// d'un message, y compris insérés au milieu d'un texte. Cette hypothèse ne se
// vérifie pas en local : seul un aller-retour par les serveurs de Discord peut
// trancher. Plutôt que de la documenter comme une inconnue, on la mesure. Chaque
// message chiffré envoyé est retenu ; quand Discord nous le renvoie
// (MESSAGE_CREATE), on compare. S'il diffère, le destinataire ne pourra pas le
// lire, et l'expéditeur doit le savoir tout de suite.
export class SendLedger {
    constructor(max = 32) {
        this.max = max;
        this.pending = [];
    }

    get size() { return this.pending.length; }

    remember(content) {
        if (this.pending.length >= this.max) this.pending.shift();
        this.pending.push({ content, key: visibleText(content), settled: false });
    }

    // "ok"      : Discord a rendu le message à l'identique ;
    // "altered" : un de nos envois est revenu différent ;
    // null      : rien à signaler.
    //
    // `isOwn` est indispensable et ne peut pas être deviné ici : un message
    // dépouillé de tous ses caractères invisibles est indiscernable d'un message
    // où quelqu'un d'autre a tapé la même phrase que notre couverture. Sans
    // l'identité de l'auteur, on alerterait à tort.
    check(received, { isOwn = false } = {}) {
        const exact = this.pending.find(e => e.content === received);
        if (exact) { exact.settled = true; return "ok"; }
        if (!isOwn) return null;
        // Même couverture, contenu différent : Discord a touché au message.
        // On ne prévient qu'une fois par envoi.
        const key = visibleText(received); // invariant de boucle : une seule fois
        const near = this.pending.find(e => !e.settled && e.key === key);
        if (!near) return null;
        near.settled = true;
        return "altered";
    }
}
