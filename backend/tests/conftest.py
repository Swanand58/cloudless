"""Test configuration: point the app at a throwaway database and upload dir.

Must run before anything imports app.config, which reads the environment once.
"""

import os
import tempfile

_tmp = tempfile.mkdtemp(prefix="cloudless-test-")
os.environ["SECRET_KEY"] = "t" * 64
os.environ["ADMIN_PASSWORD"] = "admin-password-1"
os.environ["DATABASE_URL"] = f"sqlite+aiosqlite:///{_tmp}/test.db"
os.environ["UPLOAD_DIR"] = f"{_tmp}/uploads"
os.environ["DEBUG"] = "false"
