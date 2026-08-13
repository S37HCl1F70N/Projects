from __future__ import annotations
import os
import shutil
import subprocess
import time
from pathlib import Path

_CPU_STATE: dict[int, tuple[float, int]] = {}

def process_memory_mb(pid: int | None = None) -> float | None:
    pid = pid or os.getpid()
    try:
        for line in Path(f"/proc/{pid}/status").read_text().splitlines():
            if line.startswith("VmRSS:"):
                return float(line.split()[1]) / 1024
    except OSError:
        pass
    return None

def process_cpu_percent(pid: int | None = None) -> float | None:
    pid = pid or os.getpid()
    try:
        fields = Path(f"/proc/{pid}/stat").read_text().split()
        ticks = int(fields[13]) + int(fields[14])
        now = time.monotonic()
        old = _CPU_STATE.get(pid)
        _CPU_STATE[pid] = (now, ticks)
        if not old or now <= old[0]:
            return 0.0
        hz = os.sysconf(os.sysconf_names["SC_CLK_TCK"])
        return max(0.0, min(100.0 * (os.cpu_count() or 1), ((ticks-old[1]) / hz) / (now-old[0]) * 100.0))
    except (OSError, ValueError, IndexError, KeyError):
        return None

def system_load_percent() -> float | None:
    try:
        return min(100.0, os.getloadavg()[0] / (os.cpu_count() or 1) * 100)
    except OSError:
        return None

def sample(db, cfg, component="collector") -> dict:
    state = Path(cfg["core"]["state_dir"])
    free = None
    disk_error = None
    try:
        usage = shutil.disk_usage(state)
        free = usage.free / 1024 / 1024
    except OSError as exc:
        disk_error = str(exc)
    status = "ok"
    if disk_error is not None:
        status = "critical"
    elif free is not None and free < float(cfg["health"]["disk_free_critical_mb"]):
        status = "critical"
    elif free is not None and free < float(cfg["health"]["disk_free_warn_mb"]):
        status = "warning"
    cpu = process_cpu_percent()
    memory = process_memory_mb()
    details = {"pid": os.getpid(), "system_load_percent": system_load_percent(), "state_dir": str(state)}
    if disk_error is not None:
        details["disk_error"] = disk_error
    previous = db.get_meta(f"health_status:{component}", "unknown")
    db.health_sample(component, status, cpu, memory, free, details)
    if status != previous:
        if disk_error is not None:
            db.event("monitoring_path_failure", "critical", f"State path unavailable for {component}: {state}", details={"path": str(state), "error": disk_error, "previous": previous})
        elif status in ("warning", "critical"):
            db.event("disk_space_low", status, f"Low free disk space for {component}: {free:.0f} MB", details={"free_mb": free, "previous": previous})
        elif previous in ("warning", "critical") and status == "ok":
            db.event("disk_space_recovered", "info", f"Disk free space recovered for {component}: {free:.0f} MB", details={"free_mb": free})
        db.set_meta(f"health_status:{component}", status)
    return {"status": status, "disk_free_mb": free, "cpu_percent": cpu, "memory_mb": memory, **details}

def sample_systemd_service(db, service: str, component: str) -> dict:
    try:
        state_proc = subprocess.run(["systemctl", "is-active", service], capture_output=True, text=True, timeout=5)
        active = state_proc.stdout.strip() == "active"
        pid_proc = subprocess.run(["systemctl", "show", service, "-p", "MainPID", "--value"], capture_output=True, text=True, timeout=5)
        pid = int(pid_proc.stdout.strip() or "0")
    except (OSError, subprocess.TimeoutExpired, ValueError):
        active = False; pid = 0
    status = "ok" if active and pid > 0 else "error"
    cpu = process_cpu_percent(pid) if pid > 0 else None
    mem = process_memory_mb(pid) if pid > 0 else None
    previous = db.get_meta(f"service_status:{component}", "unknown")
    db.health_sample(component, status, cpu, mem, None, {"service": service, "pid": pid})
    if status != previous:
        if status != "ok":
            db.event("service_failure", "error", f"Service unhealthy: {service}", details={"pid": pid})
        elif previous not in ("unknown", "ok"):
            db.event("service_recovered", "info", f"Service recovered: {service}", details={"pid": pid})
        db.set_meta(f"service_status:{component}", status)
    return {"status": status, "pid": pid, "cpu_percent": cpu, "memory_mb": mem}
