from __future__ import annotations
import ipaddress
import socket
import struct
from dataclasses import dataclass

@dataclass
class PacketMeta:
    ts: float
    frame_len: int
    src_mac: str | None = None
    dst_mac: str | None = None
    ethertype: int | None = None
    src_ip: str | None = None
    dst_ip: str | None = None
    protocol: str = "OTHER"
    src_port: int | None = None
    dst_port: int | None = None
    dns_queries: list[tuple[str,int]] | None = None
    dhcp_hostname: str | None = None
    arp_sender_ip: str | None = None
    arp_sender_mac: str | None = None


def mac(raw: bytes) -> str:
    return ":".join(f"{b:02x}" for b in raw)

def parse_dns(payload: bytes, tcp: bool = False) -> list[tuple[str,int]]:
    if tcp:
        if len(payload) < 2:
            return []
        size = struct.unpack("!H", payload[:2])[0]
        payload = payload[2:2+size]
    if len(payload) < 12:
        return []
    try:
        _id, flags, qdcount, _an, _ns, _ar = struct.unpack("!HHHHHH", payload[:12])
    except struct.error:
        return []
    if flags & 0x8000:
        return []
    pos = 12
    out = []
    for _ in range(min(qdcount, 32)):
        labels = []
        jumped = False
        seen = set()
        cur = pos
        end_pos = None
        while cur < len(payload):
            if cur in seen:
                return out
            seen.add(cur)
            ln = payload[cur]
            if ln == 0:
                cur += 1
                if not jumped:
                    end_pos = cur
                break
            if ln & 0xC0 == 0xC0:
                if cur + 1 >= len(payload): return out
                ptr = ((ln & 0x3F) << 8) | payload[cur+1]
                if not jumped: end_pos = cur + 2
                cur = ptr; jumped = True
                continue
            if ln > 63 or cur + 1 + ln > len(payload): return out
            label = payload[cur+1:cur+1+ln].decode("utf-8", "replace")
            labels.append(label)
            cur += 1 + ln
            if not jumped: end_pos = cur
        pos = end_pos if end_pos is not None else cur
        if pos + 4 > len(payload): break
        qtype, _qclass = struct.unpack("!HH", payload[pos:pos+4]); pos += 4
        name = ".".join(labels).strip(".")
        if name:
            out.append((name, qtype))
    return out

def parse_dhcp(payload: bytes) -> tuple[str | None, str | None]:
    if len(payload) < 240 or payload[236:240] != b"\x63\x82\x53\x63":
        return None, None
    chaddr = payload[28:34]
    client_mac = mac(chaddr)
    hostname = None
    i = 240
    while i < len(payload):
        code = payload[i]; i += 1
        if code == 255: break
        if code == 0: continue
        if i >= len(payload): break
        ln = payload[i]; i += 1
        val = payload[i:i+ln]; i += ln
        if code == 12:
            hostname = val.decode("utf-8", "replace").strip("\x00")[:255]
    return client_mac, hostname

def parse_packet(data: bytes, ts: float, frame_len: int | None = None) -> PacketMeta | None:
    if len(data) < 14:
        return None
    p = PacketMeta(ts=ts, frame_len=frame_len or len(data), dst_mac=mac(data[:6]), src_mac=mac(data[6:12]))
    et = struct.unpack("!H", data[12:14])[0]
    off = 14
    if et in (0x8100, 0x88A8) and len(data) >= 18:
        et = struct.unpack("!H", data[16:18])[0]; off = 18
    p.ethertype = et
    if et == 0x0806:
        p.protocol = "ARP"
        if len(data) >= off + 28:
            hlen, plen = data[off+4], data[off+5]
            if hlen == 6 and plen == 4:
                p.arp_sender_mac = mac(data[off+8:off+14])
                p.arp_sender_ip = socket.inet_ntoa(data[off+14:off+18])
        return p
    payload_off = None
    ip_proto = None
    if et == 0x0800:
        if len(data) < off + 20: return p
        ihl = (data[off] & 0x0F) * 4
        if ihl < 20 or len(data) < off + ihl: return p
        ip_proto = data[off+9]
        p.src_ip = socket.inet_ntoa(data[off+12:off+16]); p.dst_ip = socket.inet_ntoa(data[off+16:off+20])
        payload_off = off + ihl
    elif et == 0x86DD:
        if len(data) < off + 40: return p
        ip_proto = data[off+6]
        p.src_ip = str(ipaddress.IPv6Address(data[off+8:off+24])); p.dst_ip = str(ipaddress.IPv6Address(data[off+24:off+40]))
        payload_off = off + 40
        while ip_proto in (0, 43, 60) and len(data) >= payload_off + 2:
            nxt, extlen = data[payload_off], data[payload_off+1]
            payload_off += (extlen + 1) * 8; ip_proto = nxt
        if ip_proto == 44 and len(data) >= payload_off + 8:
            ip_proto = data[payload_off]; payload_off += 8
    else:
        return p
    if ip_proto == 6:
        p.protocol = "TCP"
        if payload_off is None or len(data) < payload_off + 20: return p
        p.src_port, p.dst_port = struct.unpack("!HH", data[payload_off:payload_off+4])
        hlen = ((data[payload_off+12] >> 4) & 0xF) * 4
        app = data[payload_off+hlen:] if hlen >= 20 else b""
        if p.src_port == 53 or p.dst_port == 53:
            p.dns_queries = parse_dns(app, tcp=True)
    elif ip_proto == 17:
        p.protocol = "UDP"
        if payload_off is None or len(data) < payload_off + 8: return p
        p.src_port, p.dst_port = struct.unpack("!HH", data[payload_off:payload_off+4])
        app = data[payload_off+8:]
        if p.src_port in (53,5353) or p.dst_port in (53,5353):
            p.dns_queries = parse_dns(app)
        if {p.src_port,p.dst_port} & {67,68}:
            client_mac, hostname = parse_dhcp(app)
            if client_mac: p.src_mac = client_mac
            if hostname: p.dhcp_hostname = hostname
    elif ip_proto == 1:
        p.protocol = "ICMP"
    elif ip_proto == 58:
        p.protocol = "ICMPv6"
    else:
        p.protocol = f"IP-{ip_proto}"
    return p

class PcapStream:
    def __init__(self, stream):
        self.stream = stream
        self.endian = "<"
        self.nano = False

    def _read_exact(self, n: int) -> bytes:
        out = b""
        while len(out) < n:
            part = self.stream.read(n-len(out))
            if not part: return b""
            out += part
        return out

    def packets(self):
        gh = self._read_exact(24)
        if len(gh) != 24:
            return
        magic = gh[:4]
        if magic == b"\xd4\xc3\xb2\xa1": self.endian, self.nano = "<", False
        elif magic == b"\xa1\xb2\xc3\xd4": self.endian, self.nano = ">", False
        elif magic == b"\x4d\x3c\xb2\xa1": self.endian, self.nano = "<", True
        elif magic == b"\xa1\xb2\x3c\x4d": self.endian, self.nano = ">", True
        else: raise ValueError("unsupported pcap magic")
        while True:
            ph = self._read_exact(16)
            if not ph: break
            if len(ph) != 16: break
            sec, frac, incl, orig = struct.unpack(self.endian+"IIII", ph)
            data = self._read_exact(incl)
            if len(data) != incl: break
            ts = sec + frac/(1_000_000_000 if self.nano else 1_000_000)
            yield ts, orig, data
