# Cloudless - Secure Self-Hosted File Transfer

A completely secure, self-hosted file transfer application with end-to-end encryption. Your files stay on your hardware, encrypted with keys that only you and your recipient can access.

## Features

- **End-to-End Encryption**: Files are encrypted on your device using XSalsa20-Poly1305 before leaving your browser
- **Zero Knowledge**: The server never sees your encryption keys, file contents, or even filenames
- **Encrypted Chat**: WhatsApp-style chat interface with inline file attachments
- **Relay Transfers**: Encrypted relay through the server for reliable file transfer
- **Safety Numbers**: Verify you're talking to the right person with safety number comparison
- **Invite-Only**: Control who can register with admin-managed invite codes
- **Role-Based Access**: Admin users can manage invites and system settings
- **Dark/Light Theme**: System-aware theming with manual toggle option
- **Self-Hosted**: Runs on your own hardware, under your complete control

## Security Architecture

### Encryption Layers

1. **Network Layer**: Tailscale WireGuard (ChaCha20-Poly1305)
2. **Transport Layer**: HTTPS/WSS with TLS 1.3
3. **Application Layer**: E2E encryption (XSalsa20-Poly1305)
4. **Storage Layer**: Encrypted at rest with unique keys per file

### Key Exchange

- X25519 Elliptic Curve Diffie-Hellman for key agreement
- Ephemeral keys per session (Perfect Forward Secrecy)
- Safety numbers for MITM protection

### Password Security

- Argon2id hashing (memory-hard, resistant to GPU attacks)
- Secure session management with JWT

## Prerequisites

- Docker and Docker Compose (recommended)
- OR Python 3.11+ with [uv](https://docs.astral.sh/uv/) and Node.js 18+
- [Tailscale](https://tailscale.com/) (free for personal use, recommended for secure access)

## Quick Start with Docker

### 1. Clone and Setup

```bash
git clone <your-repo>
cd cloudless
```

### 2. Configure Environment

```bash
# Backend configuration
cd backend
cp .env.example .env
# Edit .env and set a secure SECRET_KEY:
# SECRET_KEY=$(openssl rand -hex 32)

# Frontend configuration
cd ../frontend
cp .env.local.example .env.local
# Edit .env.local if needed
```

### 3. Start with Docker Compose

```bash
docker-compose up -d
```

The application will be available at:
- Frontend: http://localhost:3000
- Backend API: http://localhost:8000

### 4. Initial Admin Setup

When you first start the backend, it creates an admin user. Check the backend logs for the initial credentials:

```bash
docker-compose logs backend | grep -i admin
```

**IMPORTANT**: Log in immediately and change your password via Settings.

## Manual Setup (Without Docker)

### Backend Setup

```bash
cd backend

# Create environment file
cp .env.example .env
# Edit .env and set a secure SECRET_KEY

# Install dependencies and run
uv sync
uv run uvicorn app.main:app --host 0.0.0.0 --port 8000
```

### Frontend Setup

```bash
cd frontend

# Create environment file
cp .env.local.example .env.local

# Install dependencies
npm install

# Development
npm run dev

# Or build for production
npm run build
npm start
```

## Tailscale Setup (Recommended)

Tailscale creates a private encrypted network so your server isn't exposed to the public internet.

### On Your PC (Host)

1. Install Tailscale: https://tailscale.com/download
2. Sign in and enable MagicDNS
3. Note your Tailscale IP (e.g., `100.x.y.z`)

### Update Configuration

Update your frontend `.env.local`:
```
NEXT_PUBLIC_API_URL=http://100.x.y.z:8000
```

Update your backend `.env`:
```
CORS_ORIGINS=["http://100.x.y.z:3000"]
```

### For Your Friends

1. Send them your Tailscale invite link (from admin console)
2. They install Tailscale and join your network
3. They can now access your Cloudless instance via your Tailscale IP

### HTTPS with Tailscale (Optional)

Tailscale can provide automatic HTTPS certificates:

```bash
# Enable HTTPS on your machine
tailscale cert your-machine-name.your-tailnet.ts.net

# Use the certificates with your servers
```

## Usage

### Creating a Transfer Room

1. Log in to Cloudless
2. Click "Create New Room"
3. Share the room code with your friend (click to copy)
4. Wait for them to join - you'll see a notification when they do

### Joining a Room

1. Log in to Cloudless
2. Enter the room code in "Join Room"
3. You're now connected with end-to-end encryption

### Verifying Identity (Important!)

Before transferring sensitive files:

1. Click "Verify Identity" in the room sidebar
2. Compare safety numbers with your friend over phone/in-person
3. If they match, you can be confident there's no man-in-the-middle

### Sending Files

1. Click the attachment icon in the chat input
2. Select a file (up to 1GB supported)
3. The file is encrypted in your browser before upload
4. Progress shows encryption → upload → complete
5. Your friend sees the file in the chat and can download it

### Encrypted Chat

Messages are end-to-end encrypted just like files. Type in the chat input and press Enter or click Send.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Your Friends (Browsers)                   │
│                   via Tailscale VPN Network                  │
└─────────────────────┬───────────────────────────────────────┘
                      │
          ┌───────────┴───────────┐
          │   Tailscale Mesh      │
          │   (WireGuard E2E)     │
          └───────────┬───────────┘
                      │
┌─────────────────────┴───────────────────────────────────────┐
│                       Your PC                                │
│  ┌─────────────────┐         ┌─────────────────────────┐    │
│  │  Next.js :3000  │◄───────►│    FastAPI :8000        │    │
│  │  - React 19     │         │    - REST API           │    │
│  │  - shadcn/ui    │         │    - WebSocket          │    │
│  │  - TweetNaCl    │         │    - File Relay         │    │
│  │  - Zustand      │         │    - SQLAlchemy         │    │
│  └─────────────────┘         └───────────┬─────────────┘    │
│                                          │                   │
│                              ┌───────────┴─────────────┐    │
│                              │  SQLite   │  Encrypted  │    │
│                              │  (users)  │  Uploads    │    │
│                              └─────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
```

## Tech Stack

### Frontend
- Next.js 16 (App Router)
- React 19
- TypeScript
- TailwindCSS v4
- shadcn/ui components
- Zustand (state management)
- TweetNaCl (client-side encryption)

### Backend
- FastAPI
- SQLAlchemy (async)
- aiosqlite
- PyNaCl (server-side crypto utilities)
- Argon2id (password hashing)
- python-jose (JWT)

## API Endpoints

### Authentication
- `POST /api/auth/login` - Login
- `POST /api/auth/register` - Register with invite code
- `POST /api/auth/refresh` - Refresh tokens
- `GET /api/auth/me` - Current user info
- `PUT /api/auth/password` - Change password
- `POST /api/auth/invites` - Create invite code (admin only)
- `GET /api/auth/invites` - List invite codes (admin only)

### Rooms
- `POST /api/rooms` - Create room
- `POST /api/rooms/join` - Join room by code
- `GET /api/rooms` - List your rooms
- `GET /api/rooms/{id}` - Get room details
- `GET /api/rooms/{id}/safety-number/{peer_id}` - Get safety number

### Transfers
- `POST /api/transfers` - Initialize transfer
- `POST /api/transfers/{id}/chunks/{index}` - Upload chunk
- `GET /api/transfers/{id}` - Get transfer info
- `GET /api/transfers/{id}/download` - Download file
- `GET /api/transfers/room/{room_id}` - List room transfers

### WebSocket
- `WS /api/ws/{room_id}?token=...` - Real-time room connection

## Security Considerations

### What the Server CAN See
- Encrypted file blobs (cannot decrypt)
- File sizes
- User accounts and room metadata
- When transfers happen (not what's transferred)

### What the Server CANNOT See
- File contents
- Filenames (encrypted)
- Message contents (encrypted)
- Encryption keys

### Recommendations

1. **Use Tailscale**: Keeps your server off the public internet
2. **Verify Safety Numbers**: Always verify before sensitive transfers
3. **Secure Your Host**: Keep your PC secure - it's running your server
4. **Regular Updates**: Keep dependencies updated
5. **Strong Passwords**: Use strong, unique passwords
6. **Change Default Credentials**: Change the admin password immediately after first login

## Development

### Backend Tests

```bash
cd backend
uv run pytest
```

### Frontend Development

```bash
cd frontend
npm run dev    # Development with hot reload
npm run lint   # Run linter
npm run build  # Production build
```

## Troubleshooting

### "WebSocket connection failed"
- Check that the backend is running
- Verify CORS_ORIGINS includes your frontend URL
- Check browser console for detailed errors

### "Decryption failed"
- Ensure both parties are in the same room
- Try leaving and rejoining the room
- Verify safety numbers match
- Make sure the shared secret was established (wait for "Connected" status)

### "Cannot connect to server"
- If using Tailscale, ensure both devices are connected
- Check firewall allows connections to ports 3000 and 8000
- Verify the NEXT_PUBLIC_API_URL is correct

### "Rate limit exceeded"
- Wait a few seconds and try again
- This protects against abuse

## License

MIT License - Use freely, but remember: with great power comes great responsibility.

## Contributing

Contributions welcome! Please:
1. Fork the repository
2. Create a feature branch
3. Submit a pull request

Focus areas:
- Security improvements
- Performance optimizations
- UI/UX enhancements
- Documentation
