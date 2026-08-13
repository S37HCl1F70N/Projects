from __future__ import annotations
import re
from pathlib import Path

class OUIResolver:
    def __init__(self):
        self._map: dict[str, str] | None = None

    def _load(self) -> None:
        self._map = {}
        candidates = [
            Path("/usr/share/ieee-data/oui.txt"),
            Path("/var/lib/ieee-data/oui.txt"),
            Path("/usr/share/misc/oui.txt"),
            Path("/usr/share/wireshark/manuf"),
        ]
        pattern = re.compile(r"^\s*([0-9A-Fa-f]{2})[-:]?([0-9A-Fa-f]{2})[-:]?([0-9A-Fa-f]{2})\s+(?:\(hex\)\s+)?(.+?)\s*$")
        for path in candidates:
            if not path.exists():
                continue
            try:
                with path.open("r", errors="ignore") as fh:
                    for line in fh:
                        m = pattern.match(line)
                        if not m:
                            continue
                        key = "".join(m.group(i).upper() for i in range(1, 4))
                        vendor = m.group(4).strip()
                        if vendor and not vendor.startswith("#"):
                            self._map.setdefault(key, vendor)
                if self._map:
                    return
            except OSError:
                continue

    def lookup(self, mac: str | None) -> str | None:
        if not mac:
            return None
        if self._map is None:
            self._load()
        key = re.sub(r"[^0-9A-Fa-f]", "", mac)[:6].upper()
        return self._map.get(key) if len(key) == 6 else None
