from __future__ import annotations
import json
from pathlib import Path
from .discovery import resolve_interfaces
from .utils import run

def _default_route():
    p=run(["ip","-j","route","show","default"],5)
    try:
        rows=json.loads(p.stdout or "[]")
        return rows[0] if rows else {}
    except json.JSONDecodeError: return {}

def _promisc(iface: str) -> bool:
    p=run(["ip","-j","-details","link","show","dev",iface],5)
    try:
        rows=json.loads(p.stdout or "[]")
        return bool(rows and (rows[0].get("promiscuity",0)>0 or "PROMISC" in rows[0].get("flags",[])))
    except json.JSONDecodeError: return False

def report(cfg: dict) -> dict:
    interfaces=resolve_interfaces(cfg["monitoring"]["interfaces"])
    mode=cfg["monitoring"].get("observation_mode","auto")
    forwarding=False
    try: forwarding=Path("/proc/sys/net/ipv4/ip_forward").read_text().strip()=="1"
    except OSError: pass
    route=_default_route()
    promisc={i:_promisc(i) for i in interfaces}
    bridge=any(Path(f"/sys/class/net/{i}/bridge").exists() for i in interfaces)
    inferred="passive"
    if mode != "auto": inferred=mode
    elif bridge: inferred="bridge"
    elif forwarding: inferred="possible_gateway"
    visible=[]; not_visible=[]; improvements=[]; external=[]
    if inferred in ("gateway","bridge","access_point","mirror","possible_gateway"):
        visible.append("Packets traversing monitored interfaces that the host actually receives can be accounted for by endpoint, port, protocol, and byte count.")
    else:
        visible.append("Traffic to or from this Pi, plus broadcast, multicast, ARP, DHCP, mDNS, and any frames flooded to the Pi by the switch.")
        not_visible.append("Ordinary unicast traffic exchanged between two other devices on a switched LAN is normally not delivered to this Pi.")
    visible.append("Neighbor-table, ARP, DHCP, DNS, and mDNS observations that are present on monitored interfaces.")
    not_visible.append("HTTPS page paths, message contents, credentials, and other data protected by TLS are not decrypted by Network Black Box.")
    not_visible.append("Traffic on network segments/VLANs not routed, bridged, mirrored, or otherwise delivered to this host is invisible.")
    improvements += [
        "Use the Pi as the LAN DNS resolver to improve domain visibility.",
        "Place the Pi in a gateway/bridge/access-point path when full transit accounting is required and hardware capacity permits.",
        "Enable active discovery only if additional neighbor discovery is worth the extra probes.",
    ]
    external += [
        "Configure a managed switch SPAN/port-mirror session to send desired VLAN/port traffic to the Pi.",
        "Configure router/firewall flow or DNS telemetry to forward records to this collector when supported.",
    ]
    return {"configured_mode":mode,"inferred_mode":inferred,"interfaces":interfaces,"default_route":route,"ipv4_forwarding":forwarding,"promiscuous":promisc,"visible":visible,"not_visible":not_visible,"host_improvements":improvements,"external_improvements":external}
