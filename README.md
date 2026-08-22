<div align="center">

# Papotage

**A Vencord plugin that encrypts your Discord messages and hides them in invisible text.**

Without the plugin, a message looks like any throwaway reply — `ok ça marche 👍`.
With the plugin and the right passphrase, it shows the real text instead.

[![CI](https://github.com/mikketa/papotage/actions/workflows/ci.yml/badge.svg)](https://github.com/mikketa/papotage/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![Node](https://img.shields.io/badge/node-%E2%89%A520-brightgreen.svg)

</div>

---

## What it looks like

| Everyone else sees | You (plugin + passphrase) see |
| --- | --- |
| `ouais tranquille et toi ?` | 🔓 `rdv à 20h` |

Same message. The difference is a few hundred invisible characters scattered
between the visible ones — encrypted, unreadable without the key.

## How it works

1. The message is encrypted with **AES-GCM 256**. The key comes from the shared
   passphrase (**PBKDF2-SHA256, 600 000 iterations**) **and the channel ID**, so
   the same passphrase yields a different key in every conversation.
2. The ciphertext is encoded as invisible Unicode characters, **scattered inside**
   a short cover phrase. Discord preserves them.
3. On reception, the plugin finds the invisible part, decrypts it, and replaces
   the displayed text. Everyone else only ever sees the cover.
4. Every message you send is compared to the copy Discord echoes back. If it was
   altered in transit, you are warned right away.

> [!NOTE]
> An encrypted message you **can't** read is flagged by nothing at all — an
> on-screen marker would give you away to a bystander or a screen share. The
> silence is part of the cover.

Toggle encryption per channel with the lock button in the message bar
(grey = off, green = on, orange = armed but no passphrase). **Right-click it to
open the settings.**

## Usage

> [!IMPORTANT]
> Set the same **passphrase** for every participant, and share it over a
> different channel (not inside Discord). At least 12 characters — guessing the
> passphrase is the most realistic way to break this.

The cover phrase is drawn at random from **2 700+ combinations**, with varied
shapes and a memory that avoids repeating one a few messages apart.

> [!TIP]
> Write the façade yourself with `visible phrase | secret message`.
> `ouais tranquille et toi ? | rdv à 20h` shows *"ouais tranquille et toi ?"* to
> everyone, and the real message to those who have the plugin.

### Settings

| Setting | Role |
| --- | --- |
| Passphrase | Shared password (required) |
| Encoding | How the secret is encoded (see below) |
| Auto Decrypt | Decrypt incoming messages automatically |
| Show 🔓 | Prefix decrypted messages so you can tell them apart |
| Custom Cover | Default cover phrase |
| Cover Pool | Your own cover phrases, one per line (the built-in pool is public) |
| Length Hiding | Pad to size buckets instead of 16-byte blocks: masks length, costs space |
| Separator | Delimiter between cover and secret (default ` \| `) |

### Encoding modes

| Mode | Cost per byte | Capacity (1 message) | Note |
| --- | --- | --- | --- |
| **Invisible dense** (default) | 2.67 chars | ≈ 865 chars | 8 zero-width symbols |
| Invisible safe | 4 chars | ≈ 550 chars | 4 symbols, the most universally preserved set |
| Compact | 1 char | ≈ 1 225 chars | Variation selectors, attached to the cover |
| Emoji | 2 emojis | ≈ 550 chars | Visible and weird: short messages only |

Capacities are measured on random text (the worst case). Beyond Discord's 2000-char
limit the send is **cancelled** with an exact overrun — never silently swallowed.

## Limitations

> [!WARNING]
> - **Shared passphrase** — anyone with the key reads the whole channel. No
>   per-person secrecy, no forward secrecy.
> - **Metadata** — Discord still sees who talks to whom and when.
> - **Detectability** — invisible to a reader, but a scan that *counts* the
>   invisible characters will find them. That's a fundamental limit; the payload
>   just carries no fixed marker and no contiguous run to make it easy.
> - **Not a Signal replacement.** This is a hobby privacy tool, not one that
>   stands up to an adversary targeting you personally.

> [!CAUTION]
> The passphrase is stored **in the clear** in the Vencord settings
> (`settings.json`), and the text is in the clear inside the client. Anyone with
> access to your machine reads both.

The **v4 wire format is incompatible with earlier versions**: everyone updates at
the same time. A message from another version stays an ordinary phrase.

## Installation

1. Drop the folder into `Vencord/src/userplugins/papotage/`.
2. Build Vencord: `pnpm build`.
3. Enable **Papotage** in the plugin settings, then set the passphrase.

On **Vesktop**, point `state.json` (`vencordDir`) at the build's `dist` folder,
and make sure it contains a `package.json`.

## Development

The core (crypto + steganography + plugin logic) has no Discord dependency and
runs in Node:

```bash
npm test        # Node >= 20 — 116 tests
npm run audit   # hunt for exploitable regularities in the produced messages
npm run bench   # performance measurements
```

Dependencies point inward: `index.tsx` is the only file that knows about Discord.
`test/architecture.test.mjs` enforces that graph.

```
index.tsx          Vencord wiring (button, events, toasts)
  └─ plugin-core   send/receive rules — no Vencord dependency
       ├─ codec    encodings: bytes <-> invisible characters, dispersion
       │    └─ envelope   AES-GCM encryption, key derivation, padding
       ├─ covers   cover-phrase generation
       └─ envelope
```

## License

MIT.
