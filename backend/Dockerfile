# Backend Dockerfile
FROM python:3.13-slim

WORKDIR /app

# Install uv
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

# Install dependencies
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev

# Copy project files
COPY app ./app

# Run as an unprivileged user that owns only the data directory
RUN useradd --system --uid 1001 cloudless \
    && mkdir -p /app/data/uploads \
    && chown -R cloudless /app/data
USER cloudless

# Expose port
EXPOSE 8000

# Run the application
CMD [".venv/bin/uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
