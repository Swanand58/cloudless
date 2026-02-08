"""Security middleware for headers and rate limiting."""

import time
from collections import defaultdict
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response
from fastapi import HTTPException, status

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
        self.clients[client_id] = [
            req_time for req_time in self.clients[client_id] if req_time > window_start
        ]

        # Check limit
        if len(self.clients[client_id]) >= self.requests:
            return False

        # Record request
        self.clients[client_id].append(now)
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


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """Middleware to add security headers to all responses."""

    async def dispatch(self, request: Request, call_next) -> Response:
        # Get client IP (handle proxies)
        client_ip = request.client.host if request.client else "unknown"
        forwarded = request.headers.get("x-forwarded-for")
        if forwarded:
            client_ip = forwarded.split(",")[0].strip()

        # Skip rate limiting for:
        # - Static files
        # - WebSocket upgrades
        # - OPTIONS preflight requests (CORS)
        # - Chunk uploads (many sequential requests expected)
        skip_rate_limit = (
            request.url.path.startswith("/static") or
            request.url.path.startswith("/api/ws") or
            request.method == "OPTIONS" or
            "/chunks/" in request.url.path
        )
        
        if not skip_rate_limit:
            if not rate_limiter.is_allowed(client_ip):
                retry_after = rate_limiter.get_retry_after(client_ip)
                # Include CORS headers in rate limit response
                origin = request.headers.get("origin", "")
                cors_headers = {
                    "Retry-After": str(retry_after),
                }
                # Add CORS headers if origin is allowed
                allowed_origins = settings.cors_origins
                if origin in allowed_origins or "*" in allowed_origins:
                    cors_headers.update({
                        "Access-Control-Allow-Origin": origin,
                        "Access-Control-Allow-Credentials": "true",
                    })
                return Response(
                    content="Rate limit exceeded",
                    status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                    headers=cors_headers,
                )

        response = await call_next(request)

        # Security headers
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["X-XSS-Protection"] = "1; mode=block"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"

        # HSTS (only in production with HTTPS)
        if not settings.debug:
            response.headers["Strict-Transport-Security"] = (
                "max-age=31536000; includeSubDomains"
            )

        # Content Security Policy
        # In debug mode, allow CDN resources for Swagger UI
        if settings.debug:
            csp_directives = [
                "default-src 'self'",
                "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.jsdelivr.net",
                "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net",
                "img-src 'self' data: blob: https://fastapi.tiangolo.com",
                "font-src 'self' https://cdn.jsdelivr.net",
                "connect-src 'self' wss: ws:",
                "frame-ancestors 'none'",
                "base-uri 'self'",
                "form-action 'self'",
            ]
        else:
            csp_directives = [
                "default-src 'self'",
                "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
                "style-src 'self' 'unsafe-inline'",
                "img-src 'self' data: blob:",
                "font-src 'self'",
                "connect-src 'self' wss: ws:",
                "frame-ancestors 'none'",
                "base-uri 'self'",
                "form-action 'self'",
            ]
        response.headers["Content-Security-Policy"] = "; ".join(csp_directives)

        # Permissions Policy
        response.headers["Permissions-Policy"] = (
            "accelerometer=(), camera=(), geolocation=(), gyroscope=(), "
            "magnetometer=(), microphone=(), payment=(), usb=()"
        )

        return response
