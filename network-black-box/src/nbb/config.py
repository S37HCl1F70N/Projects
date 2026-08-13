from __future__ import annotations
import os
import tomllib
from copy import deepcopy
from pathlib import Path

DEFAULT_CONFIG = {
    "core": {
        "database_path": "/var/lib/network-black-box/network-black-box.db",
        "state_dir": "/var/lib/network-black-box",
        "log_dir": "/var/log/network-black-box",
    },
    "monitoring": {
        "interfaces": ["auto"], "networks": ["auto"], "observation_mode": "auto",
        "neighbor_interval_seconds": 30, "device_refresh_seconds": 120, "observation_history_seconds": 900, "offline_after_seconds": 300,
        "returned_after_seconds": 3600, "active_scan": False,
        "active_scan_interval_seconds": 300, "active_scan_timeout_seconds": 1,
        "capture": True, "capture_snaplen": 256,
        "capture_filter": "arp or ip or ip6", "flow_bucket_seconds": 60,
        "flow_flush_seconds": 30, "bandwidth_sample_seconds": 10,
        "capture_dns": True, "capture_mdns": True, "capture_dhcp": True,
        "store_destination_ips": True,
    },
    "web": {
        "bind": "0.0.0.0", "port": 8088, "auth_enabled": True,
        "auth_file": "/etc/network-black-box/dashboard.auth",
        "allow_private_clients_only": True,
    },
    "retention": {
        "dns_days": 30, "flows_days": 30, "bandwidth_days": 90,
        "observations_days": 30, "events_days": 180, "health_days": 30,
        "vacuum_min_interval_days": 7,
    },
    "health": {
        "sample_seconds": 60, "disk_free_warn_mb": 1024,
        "disk_free_critical_mb": 512, "collector_stale_seconds": 120,
    },
    "logging": {"level": "INFO", "max_bytes": 5242880, "backup_count": 3},
}

def _merge(base: dict, override: dict) -> dict:
    out = deepcopy(base)
    for k, v in override.items():
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k] = _merge(out[k], v)
        else:
            out[k] = v
    return out

def load_config(path: str | Path | None = None) -> dict:
    p = Path(path or os.environ.get("NBB_CONFIG", "/etc/network-black-box/config.toml"))
    if not p.exists():
        project_default = Path(__file__).resolve().parents[2] / "config" / "default.toml"
        p = project_default if project_default.exists() else p
    data = {}
    if p.exists():
        with p.open("rb") as fh:
            data = tomllib.load(fh)
    cfg = _merge(DEFAULT_CONFIG, data)
    cfg["_path"] = str(p)
    return cfg
