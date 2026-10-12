"""Security middleware for headers and rate limiting."""

import time
from collections import defaultdict
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response
from fastapi import status

from app.config import settings


class RateLimiter:
    """Simple in-memory rate limiter."""

    def __init__(self, requests: int, window_seconds: int):
        self.requests = requests
        self.window = window_seconds
        self.clients: dict[str, list[float]] = defaultdict(list)

    def is_allowed(self, client_id: str) -> bool:
        """Check if client is allowed to make a request."""
        now = time.time()
        window_start = now - self.window

        # Clean old requests
        recent = [t for t in self.clients[client_id] if t > window_start]

        # Check limit
        if len(recent) >= self.requests:
            self.clients[client_id] = recent
            return False

        # Record request
        recent.append(now)
        self.clients[client_id] = recent
        return True

    def get_retry_after(self, client_id: str) -> int:
        """Get seconds until next allowed request."""
        if not self.clients[client_id]:
            return 0
        oldest = min(self.clients[client_id])
        return max(0, int(oldest + self.window - time.time()))


# Global rate limiter
rate_limiter = RateLimiter(
    requests=settings.rate_limit_requests,
    window_seconds=settings.rate_limit_window_seconds,
)

# Stricter limiter for password guessing targets
auth_rate_limiter = RateLimiter(
    requests=settings.auth_rate_limit_requests,
    window_seconds=settings.rate_limit_window_seconds,
)

AUTH_LIMITED_PATHS = ("/api/auth/login", "/api/auth/register")


def get_client_ip(request: Request) -> str:
    """Get the real client IP.

    The backend is only reachable through the reverse proxy and Cloudflare
    Tunnel, so the Cloudflare header can be trusted when present.
    """
    cf_ip = request.headers.get("cf-connecting-ip")
    if cf_ip:
        return cf_ip
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """Middleware to add security headers and rate limiting to API responses."""

    async def dispatch(self, request: Request, call_next) -> Response:
        client_ip = get_client_ip(request)
        path = request.url.path

        # Skip rate limiting for:
        # - OPTIONS preflight requests (CORS)
        # - Chunk uploads (many sequential requests expected, auth required)
        skip_rate_limit = request.method == "OPTIONS" or "/chunks/" in path

        if not skip_rate_limit:
            limiter = auth_rate_limiter if path in AUTH_LIMITED_PATHS else rate_limiter
            if not limiter.is_allowed(client_ip):
                return Response(
                    content="Rate limit exceeded",
                    status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                    headers={"Retry-After": str(limiter.get_retry_after(client_ip))},
                )

        response = await call_next(request)

        # Security headers (the page's Content-Security-Policy is set by the
        # frontend, which serves the HTML)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Cache-Control"] = "no-store"

        # HSTS (only in production with HTTPS)
        if not settings.debug:
            response.headers["Strict-Transport-Security"] = (
                "max-age=31536000; includeSubDomains"
            )

        return response
