#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PID_DIR="$SCRIPT_DIR/.pids"
LOG_DIR="$SCRIPT_DIR/.logs"

mkdir -p "$PID_DIR" "$LOG_DIR"

RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
BOLD='\033[1m'
NC='\033[0m'

cleanup_on_error() {
  echo -e "\n${RED}Error occurred. Cleaning up...${NC}"
  bash "$SCRIPT_DIR/stop.sh" 2>/dev/null || true
  exit 1
}
trap cleanup_on_error ERR

echo -e "${BOLD}${CYAN}"
echo "  ╔═══════════════════════════════════════╗"
echo "  ║         ☁  Cloudless Deploy  ☁        ║"
echo "  ╚═══════════════════════════════════════╝"
echo -e "${NC}"

# --- Pre-flight checks ---
echo -e "${BOLD}[1/5] Pre-flight checks${NC}"

if ! command -v docker &>/dev/null; then
  echo -e "${RED}  ✗ Docker not found. Install Docker Desktop first.${NC}" && exit 1
fi
if ! docker info &>/dev/null 2>&1; then
  echo -e "${RED}  ✗ Docker daemon not running. Start Docker Desktop first.${NC}" && exit 1
fi
echo -e "${GREEN}  ✓ Docker${NC}"

if ! command -v node &>/dev/null; then
  echo -e "${RED}  ✗ Node.js not found.${NC}" && exit 1
fi
echo -e "${GREEN}  ✓ Node.js $(node -v)${NC}"

if ! command -v cloudflared &>/dev/null; then
  echo -e "${RED}  ✗ cloudflared not found. Install: brew install cloudflared${NC}" && exit 1
fi
echo -e "${GREEN}  ✓ cloudflared${NC}"

# Check if already running
if [ -f "$PID_DIR/backend.pid" ] || [ -f "$PID_DIR/tunnel.pid" ] || [ -f "$PID_DIR/frontend.pid" ]; then
  echo -e "${YELLOW}  ⚠ Previous session detected. Stopping first...${NC}"
  bash "$SCRIPT_DIR/stop.sh" 2>/dev/null || true
  sleep 2
fi

# --- Backend ---
echo -e "\n${BOLD}[2/5] Starting backend (Docker)${NC}"
cd "$SCRIPT_DIR"
docker compose up -d --build backend > "$LOG_DIR/backend.log" 2>&1
echo "docker" > "$PID_DIR/backend.pid"

echo -n "  Waiting for backend health check"
for i in $(seq 1 30); do
  if curl -sf http://localhost:8000/api/health > /dev/null 2>&1; then
    echo -e "\n${GREEN}  ✓ Backend healthy at http://localhost:8000${NC}"
    break
  fi
  echo -n "."
  sleep 2
  if [ "$i" -eq 30 ]; then
    echo -e "\n${RED}  ✗ Backend failed to start. Check: docker compose logs backend${NC}"
    exit 1
  fi
done

# --- Cloudflare Tunnel for backend ---
echo -e "\n${BOLD}[3/5] Starting Cloudflare Tunnel (backend)${NC}"
cloudflared tunnel --url http://localhost:8000 > "$LOG_DIR/tunnel.log" 2>&1 &
TUNNEL_PID=$!
echo "$TUNNEL_PID" > "$PID_DIR/tunnel.pid"

echo -n "  Waiting for tunnel URL"
BACKEND_TUNNEL_URL=""
for i in $(seq 1 30); do
  BACKEND_TUNNEL_URL=$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$LOG_DIR/tunnel.log" 2>/dev/null | head -1 || true)
  if [ -n "$BACKEND_TUNNEL_URL" ]; then
    echo -e "\n${GREEN}  ✓ Backend tunnel: ${BOLD}${BACKEND_TUNNEL_URL}${NC}"
    break
  fi
  echo -n "."
  sleep 2
  if [ "$i" -eq 30 ]; then
    echo -e "\n${RED}  ✗ Tunnel failed to start. Check: cat $LOG_DIR/tunnel.log${NC}"
    exit 1
  fi
done

# --- Update frontend .env.local with tunnel URL ---
echo -e "\n${BOLD}[4/5] Starting frontend (Next.js dev)${NC}"
echo "NEXT_PUBLIC_API_URL=${BACKEND_TUNNEL_URL}" > "$SCRIPT_DIR/frontend/.env.local"
echo -e "${GREEN}  ✓ Frontend .env.local updated with tunnel URL${NC}"

cd "$SCRIPT_DIR/frontend"

if [ ! -d "node_modules" ]; then
  echo "  Installing dependencies..."
  npm install > "$LOG_DIR/npm-install.log" 2>&1
fi

npx next dev --port 3000 > "$LOG_DIR/frontend.log" 2>&1 &
FRONTEND_PID=$!
echo "$FRONTEND_PID" > "$PID_DIR/frontend.pid"

echo -n "  Waiting for frontend"
for i in $(seq 1 30); do
  if curl -sf http://localhost:3000 > /dev/null 2>&1; then
    echo -e "\n${GREEN}  ✓ Frontend running at http://localhost:3000${NC}"
    break
  fi
  echo -n "."
  sleep 2
  if [ "$i" -eq 30 ]; then
    echo -e "\n${RED}  ✗ Frontend failed to start. Check: cat $LOG_DIR/frontend.log${NC}"
    exit 1
  fi
done

# --- Cloudflare Tunnel for frontend ---
echo -e "\n${BOLD}[5/5] Starting Cloudflare Tunnel (frontend)${NC}"
cloudflared tunnel --url http://localhost:3000 > "$LOG_DIR/tunnel-frontend.log" 2>&1 &
TUNNEL_FE_PID=$!
echo "$TUNNEL_FE_PID" > "$PID_DIR/tunnel-frontend.pid"

echo -n "  Waiting for tunnel URL"
FRONTEND_TUNNEL_URL=""
for i in $(seq 1 30); do
  FRONTEND_TUNNEL_URL=$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$LOG_DIR/tunnel-frontend.log" 2>/dev/null | head -1 || true)
  if [ -n "$FRONTEND_TUNNEL_URL" ]; then
    echo -e "\n${GREEN}  ✓ Frontend tunnel: ${BOLD}${FRONTEND_TUNNEL_URL}${NC}"
    break
  fi
  echo -n "."
  sleep 2
  if [ "$i" -eq 30 ]; then
    echo -e "\n${RED}  ✗ Frontend tunnel failed. Check: cat $LOG_DIR/tunnel-frontend.log${NC}"
    exit 1
  fi
done

# --- Summary ---
echo ""
echo -e "${BOLD}${CYAN}═══════════════════════════════════════════${NC}"
echo -e "${BOLD}${GREEN}  Cloudless is live!${NC}"
echo -e "${CYAN}═══════════════════════════════════════════${NC}"
echo ""
echo -e "  ${BOLD}Local access:${NC}"
echo -e "    Frontend:  ${CYAN}http://localhost:3000${NC}"
echo -e "    Backend:   ${CYAN}http://localhost:8000${NC}"
echo ""
echo -e "  ${BOLD}Share with friends:${NC}"
echo -e "    App URL:   ${GREEN}${BOLD}${FRONTEND_TUNNEL_URL}${NC}"
echo -e "    API URL:   ${GREEN}${BOLD}${BACKEND_TUNNEL_URL}${NC}"
echo ""
echo -e "  ${BOLD}Logs:${NC}"
echo -e "    Backend:   ${LOG_DIR}/backend.log"
echo -e "    Frontend:  ${LOG_DIR}/frontend.log"
echo -e "    Tunnels:   ${LOG_DIR}/tunnel.log, tunnel-frontend.log"
echo ""
echo -e "  ${YELLOW}Run ${BOLD}./stop.sh${NC}${YELLOW} to shut everything down.${NC}"
echo -e "${CYAN}═══════════════════════════════════════════${NC}"
