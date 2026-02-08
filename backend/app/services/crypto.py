"""Server-side cryptographic utilities.

Note: The server does NOT perform E2E encryption - that happens client-side.
This module provides utilities for:
- Password hashing (Argon2)
- Generating secure random values
- Safety number generation (for verification)
"""

import secrets
import hashlib
import base64
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
    def generate_room_code() -> str:
        """Generate a human-readable room code.

        Uses unambiguous characters to avoid confusion (no 0/O, 1/I/l).

        Returns:
            6-character room code
        """
        alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
        return "".join(secrets.choice(alphabet) for _ in range(6))

    @staticmethod
    def generate_safety_number(public_key_a: str, public_key_b: str) -> str:
        """Generate a safety number from two public keys.

        This allows users to verify they're communicating with the right person
        by comparing safety numbers out-of-band (phone, in-person).

        The safety number is deterministic - both parties will compute the same
        value from the same public keys.

        Args:
            public_key_a: First public key (base64 encoded)
            public_key_b: Second public key (base64 encoded)

        Returns:
            60-digit safety number (12 groups of 5 digits)
        """
        # Sort keys to ensure consistent ordering
        keys = sorted([public_key_a, public_key_b])

        # Concatenate and hash
        combined = (keys[0] + keys[1]).encode()
        hash_bytes = hashlib.sha256(combined).digest()

        # Convert to numeric safety number
        # Use first 30 bytes (240 bits) to generate 60 digits
        safety_number = ""
        for i in range(0, 30, 5):
            # Take 5 bytes and convert to a 5-digit number
            chunk = int.from_bytes(hash_bytes[i : i + 5], "big")
            safety_number += f"{chunk % 100000:05d}"

        # Format as 12 groups of 5 digits
        formatted = " ".join(
            safety_number[i : i + 5] for i in range(0, 60, 5)
        )
        return formatted

    @staticmethod
    def generate_emoji_fingerprint(public_key: str) -> list[str]:
        """Generate an emoji fingerprint for visual verification.

        Args:
            public_key: Public key (base64 encoded)

        Returns:
            List of 8 emojis representing the key
        """
        # Emoji set for fingerprints (visually distinct)
        emojis = [
            "🔐", "🔑", "🛡️", "⚡", "🌟", "🎯", "🚀", "💎",
            "🔮", "🌈", "🎪", "🎭", "🎨", "🎸", "🎺", "🎻",
            "🌺", "🌸", "🌼", "🌻", "🍀", "🌴", "🌵", "🎄",
            "🦊", "🦁", "🐯", "🦄", "🐲", "🦅", "🦋", "🐙",
        ]

        # Hash the public key
        hash_bytes = hashlib.sha256(base64.b64decode(public_key)).digest()

        # Select 8 emojis based on hash bytes
        fingerprint = []
        for i in range(8):
            index = hash_bytes[i] % len(emojis)
            fingerprint.append(emojis[index])

        return fingerprint

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
