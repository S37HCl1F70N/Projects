from __future__ import annotations
import ipaddress
import json
import socket
import threading
from .utils import run


def resolve_interfaces(configured: list[str]) -> list[str]:
    if configured and configured != ["auto"] and "auto" not in configured:
        return configured
    # On small appliances, auto prefers the default-route interface to avoid
    # duplicate capture on machines with both Ethernet and Wi-Fi active.
    route = run(["ip", "-j", "route", "show", "default"], timeout=5)
    try:
        rows = json.loads(route.stdout or "[]")
        defaults = [r.get("dev") for r in rows if r.get("dev") and r.get("dev") != "lo"]
        if defaults:
            return list(dict.fromkeys(defaults))
    except json.JSONDecodeError:
        pass
    proc = run(["ip", "-j", "link", "show"], timeout=5)
    if proc.returncode != 0:
        return []
    try:
        rows = json.loads(proc.stdout)
        return [r["ifname"] for r in rows if r.get("ifname") != "lo" and "UP" in r.get("flags", [])]
    except (json.JSONDecodeError, KeyError):
        return []

def resolve_networks(configured: list[str], interfaces: list[str]) -> list[ipaddress._BaseNetwork]:
    if configured and configured != ["auto"] and "auto" not in configured:
        out=[]
        for n in configured:
            try: out.append(ipaddress.ip_network(n, strict=False))
            except ValueError: pass
        return out
    proc = run(["ip", "-j", "address", "show"], timeout=5)
    out=[]
    try:
        for item in json.loads(proc.stdout or "[]"):
            if item.get("ifname") not in interfaces: continue
            for info in item.get("addr_info", []):
                if info.get("scope") != "global": continue
                try: out.append(ipaddress.ip_network(f"{info['local']}/{info['prefixlen']}", strict=False))
                except ValueError: pass
    except json.JSONDecodeError:
        pass
    return out

def neighbor_rows(interface: str) -> list[dict]:
    proc = run(["ip", "-j", "neigh", "show", "dev", interface], timeout=5)
    if proc.returncode != 0: return []
    try:
        rows=json.loads(proc.stdout)
    except json.JSONDecodeError:
        return []
    out=[]
    for r in rows:
        state = r.get("state", [])
        if isinstance(state, str): state=[state]
        if any(s in state for s in ("FAILED","INCOMPLETE")): continue
        if r.get("dst") and r.get("lladdr"):
            out.append({"address":r["dst"],"mac":r["lladdr"],"state":state,"interface":interface})
    return out

def reverse_hostname(address: str, timeout: float = .25) -> str | None:
    old=socket.getdefaulttimeout(); socket.setdefaulttimeout(timeout)
    try:
        name=socket.gethostbyaddr(address)[0]
        return name.rstrip(".")
    except (socket.herror,socket.gaierror,OSError):
        return None
    finally:
        socket.setdefaulttimeout(old)

def active_ping_sweep(networks, timeout_seconds: int = 1, max_hosts: int = 512) -> int:
    hosts=[]
    for net in networks:
        if net.version != 4: continue
        if net.num_addresses > max_hosts + 2: continue
        hosts.extend(str(h) for h in net.hosts())
    if len(hosts) > max_hosts: hosts=hosts[:max_hosts]
    sem=threading.Semaphore(24); count=0; lock=threading.Lock(); threads=[]
    def ping(host):
        nonlocal count
        with sem:
            rc=run(["ping","-n","-c","1","-W",str(timeout_seconds),host], timeout=timeout_seconds+2).returncode
            if rc==0:
                with lock: count += 1
    for h in hosts:
        t=threading.Thread(target=ping,args=(h,),daemon=True); t.start(); threads.append(t)
    for t in threads: t.join()
    return count
