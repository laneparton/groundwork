import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Self

from dotenv import load_dotenv

EVAL_DIR = Path(__file__).resolve().parents[1]
load_dotenv(EVAL_DIR / ".env")
load_dotenv(EVAL_DIR.parent / "apps/server/.env")
os.environ.setdefault("DEEPEVAL_TELEMETRY_OPT_OUT", "YES")


@dataclass(frozen=True)
class Settings:
    base_url: str
    email: str
    password: str = field(repr=False)
    judge_model: str

    @classmethod
    def from_env(cls) -> Self:
        email = os.environ.get("EVAL_EMAIL", "")
        password = os.environ.get("EVAL_PASSWORD", "")
        if not email or not password:
            raise ValueError("Set EVAL_EMAIL and EVAL_PASSWORD in evals/.env.")
        return cls(
            base_url=os.environ.get("EVAL_BASE_URL", "http://localhost:3000").rstrip("/"),
            email=email,
            password=password,
            judge_model=os.environ.get("EVAL_JUDGE_MODEL", "gpt-4.1-mini"),
        )
