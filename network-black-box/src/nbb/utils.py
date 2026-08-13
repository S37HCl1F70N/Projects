from __future__ import annotations
import ipaddress
import json
import os
import subprocess
from datetime import datetime, timezone
from pathlib import Path

UTC = timezone.utc

def utcnow() -> str:
    return datetime.now(UTC).replace(microsecond=0).isoformat()

def epoch() -> float:
    return datetime.now(UTC).timestamp()

def parse_ts(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None

def run(cmd: list[str], timeout: int = 10) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, check=False)

def atomic_write(path: str | Path, text: str, mode: int = 0o640) -> None:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(text)
    os.chmod(tmp, mode)
    os.replace(tmp, path)

def json_dumps(value) -> str:
    return json.dumps(value, separators=(",", ":"), sort_keys=True, default=str)

def is_private_client(addr: str) -> bool:
    try:
        ip = ipaddress.ip_address(addr.split("%", 1)[0])
        return ip.is_private or ip.is_loopback or ip.is_link_local
    except ValueError:
        return False
