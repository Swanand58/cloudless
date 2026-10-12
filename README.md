# Cloudless - Private Photo and File Sharing

A self-hosted, end-to-end encrypted place for two people to send each other photos, files and messages. Everything is encrypted in the browser before it leaves your device; the server on your own hardware only stores ciphertext.

## Features

- **End-to-End Encryption**: Files and messages are encrypted in the browser with XSalsa20-Poly1305
- **Built for Photos**: Images up to 50 MB with instant previews and a full-size viewer
- **Lasting Rooms**: Send while the other person is offline; rooms and their contents delete themselves after 7 days
- **Encrypted Chat**: Chat with inline file attachments
- **Safety Numbers**: Verify you're talking to the right person, with a warning if their key ever changes
- **Invite-Only**: Only people you invite can register
- **Self-Hosted**: One `docker compose up` on your own machine, published through your own domain

## How it works

```
 Friend's browser ──HTTPS──► Cloudflare ──tunnel──► your machine
                                                    ┌──────────────────────────────┐
                                                    │ proxy (Caddy)                │
                                                    │   /api/*  ──► backend :8000  │
                                                    │   else    ──► frontend :3000 │
                                                    │ backend: FastAPI + SQLite    │
                                                    │ frontend: Next.js            │
                                                    └──────────────────────────────┘
```

- Each person generates an X25519 key pair per room, kept in their browser. The shared secret derived from the two keys encrypts messages, file contents, file names and thumbnails.
- A file is split into 512 KB chunks, each encrypted separately. The recipient checks a SHA-256 of the whole file after decrypting, which catches missing or reordered chunks.
- A room holds exactly two people.

## Setup

You need Docker, and for access from outside your machine: a domain whose DNS is managed by Cloudflare (free plan) and [`cloudflared`](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/).

### 1. Configure

```bash
cp .env.example .env
# Put the output of this in .env as SECRET_KEY:
openssl rand -hex 32
```

### 2. Start

```bash
docker compose up -d --build
```

The app is now at http://localhost:8080, on this machine only.

On first start the backend creates an `admin` account. If you did not set `ADMIN_PASSWORD` in `.env`, the generated password is printed once:

```bash
docker compose logs backend | grep -i "admin"
```

Log in, change the password in Settings, and create invite codes there for the people you want to share with.

### 3. Publish on your domain

Check that Cloudflare manages your domain's DNS. The answer should end in `ns.cloudflare.com`:

```bash
dig NS example.com +short
```

If it does not, add the domain to a free Cloudflare account and switch the nameservers at your registrar first.

Create the tunnel once (the first command opens a browser to log in):

```bash
cloudflared tunnel login
cloudflared tunnel create cloudless
cloudflared tunnel route dns cloudless cloudless.example.com
```

`tunnel create` prints a tunnel ID (a UUID). Put it in `.env` as `TUNNEL_ID`, then:

```bash
docker compose --profile tunnel up -d
```

The app is now at `https://cloudless.example.com`.

On Linux, the tunnel container may not be able to read the credentials file; `chmod 644 ~/.cloudflared/<TUNNEL_ID>.json` fixes that.

### Keeping it running

The app is only reachable while the host is on and awake. On a Mac: start Docker Desktop at login, and prevent sleep while plugged in (System Settings, Battery, Options). Containers restart on their own.

## Using it

1. **Create a room** and send the six-character code to your friend.
2. **They join** with the code. From then on either of you can send at any time.
3. **Verify** (Room Info, Verify Identity): compare the emoji fingerprints over a call or in person, then mark as verified.
4. **Send** photos or files with the paperclip, several at once if you like. The recipient sees a preview immediately and taps to open the full image.

Rooms are listed on the home page until they expire.

## Security

### What the server (and Cloudflare) cannot see

- File contents, file names, types and thumbnails
- Message contents
- Encryption keys

### What they can see

- Encrypted blobs and their sizes
- Accounts, room membership and timing
- **Cloudflare ends the HTTPS connection**, so it can also see login passwords and session tokens in transit, and it delivers the app's JavaScript to your friends. This is true of any browser app behind a proxy. Use a password you use nowhere else.

### Limits to know about

- **One browser per person per room.** Keys live in the browser. Clearing site data or opening the room on another device creates a new key: the other person sees a key-change warning, and older content can no longer be opened.
- **Verification is manual.** Until you compare safety numbers, the server could have swapped keys.
- Sessions are stored in the browser's local storage. Changing your password signs out every other session.

## Configuration

Deployment settings are in the root `.env` (see `.env.example`). Backend limits can be overridden by adding them to the backend's `environment` in `docker-compose.yml`:

| Variable | Default | Meaning |
|---|---|---|
| `MAX_FILE_SIZE_MB` | 50 | Largest file. Also change `MAX_FILE_SIZE` in `frontend/src/lib/filecrypt.ts`. |
| `MAX_STORAGE_GB` | 20 | Total for all rooms; uploads are refused beyond it |
| `ROOM_EXPIRY_DAYS` | 7 | Lifetime of a room and everything in it |
| `AUTH_RATE_LIMIT_REQUESTS` | 10 | Login and register attempts per minute per IP |

Data lives in the `data` Docker volume (SQLite database and encrypted uploads).

## Development

```bash
# Backend, http://localhost:8000
cd backend
cp .env.example .env
uv sync
uv run uvicorn app.main:app --reload

# Frontend, http://localhost:3000
cd frontend
cp .env.local.example .env.local
npm install
npm run dev
```

Tests:

```bash
cd backend && uv run pytest
cd frontend && npm test && npm run lint
```

There are no database migrations yet. After changing a model, delete the local `cloudless.db` (or the `data` volume).

## Tech stack

- **Frontend**: Next.js 16, React 19, TypeScript, Tailwind CSS v4, shadcn/ui, Zustand, TweetNaCl
- **Backend**: FastAPI, SQLAlchemy (async) with SQLite, Argon2id password hashing, JWT sessions
- **Deployment**: Docker Compose, Caddy, Cloudflare Tunnel

## License

MIT
