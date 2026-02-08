#!/bin/bash

# Cloudless - Start Script
# This script starts both backend and frontend servers

set -e

echo "======================================"
echo "   Cloudless - Secure File Transfer   "
echo "======================================"
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if running from correct directory
if [ ! -d "backend" ] || [ ! -d "frontend" ]; then
    echo -e "${RED}Error: Please run this script from the cloudless root directory${NC}"
    exit 1
fi

# Check for required tools
command -v uv >/dev/null 2>&1 || { echo -e "${RED}Error: uv is not installed. Install from https://docs.astral.sh/uv/${NC}"; exit 1; }
command -v node >/dev/null 2>&1 || { echo -e "${RED}Error: Node.js is not installed${NC}"; exit 1; }

echo -e "${GREEN}Starting backend...${NC}"
cd backend

# Create .env if it doesn't exist
if [ ! -f ".env" ]; then
    echo -e "${YELLOW}Creating backend .env file...${NC}"
    cp .env.example .env
    # Generate secure secret key
    SECRET_KEY=$(openssl rand -hex 32 2>/dev/null || python3 -c "import secrets; print(secrets.token_hex(32))")
    sed -i.bak "s/your-secret-key-here-generate-with-openssl-rand-hex-32/$SECRET_KEY/" .env
    rm -f .env.bak
    echo -e "${GREEN}Generated secure SECRET_KEY${NC}"
fi

# Start backend in background
uv run uvicorn app.main:app --host 0.0.0.0 --port 8000 &
BACKEND_PID=$!
echo -e "${GREEN}Backend started (PID: $BACKEND_PID)${NC}"

cd ../frontend

# Create .env.local if it doesn't exist
if [ ! -f ".env.local" ]; then
    echo -e "${YELLOW}Creating frontend .env.local file...${NC}"
    cp .env.local.example .env.local
fi

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
    echo -e "${YELLOW}Installing frontend dependencies...${NC}"
    npm install
fi

echo -e "${GREEN}Starting frontend...${NC}"
npm run dev &
FRONTEND_PID=$!
echo -e "${GREEN}Frontend started (PID: $FRONTEND_PID)${NC}"

echo ""
echo "======================================"
echo -e "${GREEN}Cloudless is running!${NC}"
echo "======================================"
echo ""
echo "  Backend:  http://localhost:8000"
echo "  Frontend: http://localhost:3000"
echo "  API Docs: http://localhost:8000/docs (debug mode only)"
echo ""
echo "  Default admin login:"
echo "    Username: admin"
echo "    Password: changeme123"
echo ""
echo -e "${YELLOW}IMPORTANT: Change the admin password immediately!${NC}"
echo ""
echo "Press Ctrl+C to stop both servers"

# Trap Ctrl+C and kill both processes
trap "echo ''; echo 'Stopping servers...'; kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; exit 0" INT

# Wait for both processes
wait
