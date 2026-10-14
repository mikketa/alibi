<div align="center">

# Alibi

**Encrypted Discord messages that look like small talk.**

A [Vencord](https://vencord.dev) plugin that encrypts what you type and hides
the ciphertext as invisible characters inside an ordinary-looking phrase.

[![CI](https://github.com/mikketa/alibi/actions/workflows/ci.yml/badge.svg)](https://github.com/mikketa/alibi/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![Node](https://img.shields.io/badge/node-%E2%89%A520-brightgreen.svg)

</div>

---

| What everyone else sees | What you see |
| --- | --- |
| `ouais tranquille et toi ?` | 🔓 `rdv à 20h` |

Both columns are the same Discord message. The secret travels as a few hundred
zero-width characters scattered between the visible letters.

> [!NOTE]
> The cover phrases are in French, and so is the plugin's interface.

## ✨ Features

- 🔐 **AES-GCM 256.** The key is derived with PBKDF2-SHA256 (600 000
  iterations) from a shared passphrase **and the channel ID**, so the same
  passphrase gives a different key in every conversation.
- ✍️ **Bound to its author.** Each message is authenticated with its sender's
  Discord ID. Someone who reposts your message under their own name, even
  without the passphrase, gets nothing that decrypts.
- 👻 **No visible trace.** The payload has no header or fixed marker, never
  starts or ends the message, and is split into irregular chunks across the
  cover phrase.
- 🎭 **2 674 built-in cover phrases**, with a short memory that avoids
  repeating one a few messages apart.
- 🛑 **Fail closed.** If anything goes wrong while sending or editing, the
  message is cancelled. Plaintext is never sent by accident.
- 🔍 **Tamper check.** Each sent message is compared with the copy Discord
  echoes back, and you are warned if the invisible part was altered.

## 📦 Installation

Alibi is a Vencord *user plugin*, so it is built from source.

1. Copy the contents of `src/` into `Vencord/src/userplugins/alibi/`, so
   that `index.tsx` sits directly in that folder.
2. Build Vencord with `pnpm build`.
3. Enable **Alibi** in Vencord's plugin settings and set the passphrase.

> [!TIP]
> On **Vesktop**, point `vencordDir` in `state.json` at the build's `dist`
> folder, and make sure that folder contains a `package.json`.

## 🚀 Usage

> [!IMPORTANT]
> Everyone in the conversation must use the **same passphrase**. Share it
> outside Discord, and make it at least 12 characters long: guessing the
> passphrase is the most realistic way to break Alibi.

Turn encryption on or off per channel with the lock button in the message bar.
**Right-click it to open the settings.**

| Lock | Meaning |
| --- | --- |
| ⚪ Grey | Off, messages are sent normally |
| 🟢 Green | On, messages are encrypted |
| 🟠 Orange | On, but no passphrase is set |

With encryption on, type as usual and a random cover phrase is chosen for you.

> [!TIP]
> To pick the visible text yourself, write `cover | secret`:
>
> ```
> ouais tranquille et toi ? | rdv à 20h
> ```

> [!NOTE]
> A Alibi message you can't decrypt just shows its cover, with no marker.
> This is on purpose: a marker would give you away to anyone looking at your
> screen.

### ⚙️ Settings

| Setting | What it does |
| --- | --- |
| Passphrase | Shared secret, required |
| Encoding | How the ciphertext is written (see below) |
| Auto Decrypt | Decrypt incoming messages automatically |
| Show 🔓 | Prefix decrypted messages so you can tell them apart |
| Custom Cover | Fixed cover phrase instead of a random one (8 characters minimum) |
| Cover Pool | Your own cover phrases, one per line |
| Length Hiding | Pad to size buckets instead of 16-byte blocks. Hides length, costs space |
| Separator | Delimiter between cover and secret, ` \| ` by default |

> [!TIP]
> The built-in cover pool is public, since anyone can read this repository.
> Add your own phrases in **Cover Pool** for covers nobody can predict.

### 🔤 Encodings

| Mode | Cost per byte | Max secret per message | Notes |
| --- | --- | --- | --- |
| **Invisible dense** (default) | 2.67 chars | ≈ 865 chars | 8 zero-width characters |
| Invisible safe | 4 chars | ≈ 550 chars | 4 zero-width characters, the most widely preserved set |
| Compact | 1 char | ≈ 1 225 chars | Unicode variation selectors |
| Emoji | 2 emojis | ≈ 550 chars | Visible and odd-looking, for short messages |

Capacities are measured on random text, which compresses worst.

> [!NOTE]
> A message that would exceed Discord's 2000-character limit is not sent, and
> you are told by how much it overflows.

## ⚠️ Limitations

> [!WARNING]
> - **One key per channel.** Anyone with the passphrase reads the whole
>   conversation, past and future. There is no forward secrecy.
> - **Metadata stays visible.** Discord still knows who talks to whom, and
>   when.
> - **Hidden, not undetectable.** A person reading the chat sees nothing, but a
>   script that counts invisible characters will notice them.
> - **Not a replacement for Signal.** Alibi is a privacy tool for everyday
>   use. It won't protect you from someone specifically targeting you.

> [!CAUTION]
> Vencord stores the passphrase **in plain text** in `settings.json`, and
> decrypted messages exist in plain text inside the client. Anyone with access
> to your computer can read both.

> [!IMPORTANT]
> Version 5 **cannot read messages from earlier versions**, and earlier
> versions cannot read it. Everyone needs to update at the same time. Messages
> from another version just show their cover phrase.

## 🛠️ Development

Everything except the Vencord glue runs in plain Node, with no dependencies.

```bash
npm test        # Node >= 20, 126 tests
npm run audit   # looks for detectable patterns in generated messages
npm run bench   # performance measurements
```

Only `src/index.tsx` knows about Discord. `test/architecture.test.mjs`
enforces this dependency graph:

```
index.tsx          Vencord wiring: lock button, send/edit hooks, toasts
  └─ plugin-core   send and receive rules
       ├─ codec      bytes <-> invisible characters, scattering into the cover
       ├─ covers     cover phrase generation
       └─ envelope   AES-GCM, key derivation, padding
```

## 📄 License

[MIT](LICENSE)
