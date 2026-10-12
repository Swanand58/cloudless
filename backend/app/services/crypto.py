"""Server-side cryptographic utilities.

Note: The server does NOT perform E2E encryption - that happens client-side.
This module provides utilities for:
- Password hashing (Argon2)
- Generating secure random values
"""

import secrets
from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError


class CryptoService:
    """Cryptographic utilities for the server."""

    def __init__(self):
        # Argon2id with secure parameters
        self._hasher = PasswordHasher(
            time_cost=3,  # Number of iterations
            memory_cost=65536,  # 64MB memory
            parallelism=4,  # Number of parallel threads
            hash_len=32,  # Output hash length
            salt_len=16,  # Salt length
        )

    def hash_password(self, password: str) -> str:
        """Hash a password using Argon2id.

        Args:
            password: Plain text password

        Returns:
            Argon2 hash string
        """
        return self._hasher.hash(password)

    def verify_password(self, password: str, hash: str) -> bool:
        """Verify a password against its hash.

        Args:
            password: Plain text password to verify
            hash: Argon2 hash to verify against

        Returns:
            True if password matches, False otherwise
        """
        try:
            self._hasher.verify(hash, password)
            return True
        except VerifyMismatchError:
            return False

    def needs_rehash(self, hash: str) -> bool:
        """Check if a password hash needs to be rehashed.

        This is useful when Argon2 parameters are updated.

        Args:
            hash: Existing Argon2 hash

        Returns:
            True if hash should be regenerated
        """
        return self._hasher.check_needs_rehash(hash)

    @staticmethod
    def generate_token(length: int = 32) -> str:
        """Generate a cryptographically secure random token.

        Args:
            length: Number of bytes of randomness (output will be longer due to base64)

        Returns:
            URL-safe base64 encoded token
        """
        return secrets.token_urlsafe(length)

    @staticmethod
    def constant_time_compare(a: bytes, b: bytes) -> bool:
        """Compare two byte strings in constant time.

        This prevents timing attacks by ensuring the comparison
        takes the same amount of time regardless of where the
        strings differ.

        Args:
            a: First byte string
            b: Second byte string

        Returns:
            True if strings are equal
        """
        return secrets.compare_digest(a, b)


# Singleton instance
crypto_service = CryptoService()
