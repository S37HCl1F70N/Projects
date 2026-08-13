from __future__ import annotations
import ipaddress
import json
import sqlite3
from datetime import datetime, timedelta, timezone
from pathlib import Path
from .classify import classify
from .utils import utcnow, json_dumps, parse_ts

SCHEMA_VERSION = "1"

class NBBConnection(sqlite3.Connection):
    def __exit__(self, exc_type, exc, tb):
        try:
            return super().__exit__(exc_type, exc, tb)
        finally:
            self.close()

class Database:
    def __init__(self, path: str):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)

    def connect(self, readonly: bool = False) -> sqlite3.Connection:
        if readonly:
            uri = f"file:{self.path}?mode=ro"
            conn = sqlite3.connect(uri, uri=True, timeout=30, factory=NBBConnection)
        else:
            conn = sqlite3.connect(self.path, timeout=30, factory=NBBConnection)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys=ON")
        conn.execute("PRAGMA busy_timeout=30000")
        if not readonly:
            conn.execute("PRAGMA journal_mode=WAL")
            conn.execute("PRAGMA synchronous=NORMAL")
        return conn

    def initialize(self) -> None:
        migrations_dir = Path(__file__).resolve().parents[2] / "database" / "migrations"
        migration_files = sorted(migrations_dir.glob("[0-9][0-9][0-9]_*.sql"))
        if not migration_files:
            raise RuntimeError(f"No database migrations found in {migrations_dir}")
        with self.connect() as conn:
            conn.execute("PRAGMA auto_vacuum=INCREMENTAL")
            conn.execute("CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY,name TEXT NOT NULL,applied_at TEXT NOT NULL)")
            applied={int(r[0]) for r in conn.execute("SELECT version FROM schema_migrations").fetchall()}
            for migration in migration_files:
                version=int(migration.name.split("_",1)[0])
                if version in applied:
                    continue
                conn.executescript(migration.read_text())
                conn.execute("INSERT INTO schema_migrations(version,name,applied_at) VALUES(?,?,?)",(version,migration.name,utcnow()))
            latest=max(int(m.name.split("_",1)[0]) for m in migration_files)
            conn.execute("INSERT OR REPLACE INTO meta(key,value) VALUES('schema_version',?)", (str(latest),))
            conn.execute("INSERT OR IGNORE INTO meta(key,value) VALUES('created_at',?)", (utcnow(),))

    @staticmethod
    def normalize_mac(mac: str | None) -> str | None:
        if not mac:
            return None
        raw = "".join(c for c in mac.lower() if c in "0123456789abcdef")
        if len(raw) != 12 or raw == "000000000000":
            return None
        return ":".join(raw[i:i+2] for i in range(0, 12, 2))

    def _device_by_address(self, conn, address: str):
        return conn.execute("SELECT d.* FROM devices d JOIN device_addresses a ON a.device_id=d.id WHERE a.address=? ORDER BY a.last_seen DESC LIMIT 1", (address,)).fetchone()

    def _merge_devices(self, conn, keep_id: int, drop_id: int) -> None:
        if keep_id == drop_id:
            return
        for table in ("device_observations", "dns_events", "system_events"):
            conn.execute(f"UPDATE {table} SET device_id=? WHERE device_id=?", (keep_id, drop_id))
        conn.execute("UPDATE flows SET src_device_id=? WHERE src_device_id=?", (keep_id, drop_id))
        conn.execute("UPDATE flows SET dst_device_id=? WHERE dst_device_id=?", (keep_id, drop_id))
        for row in conn.execute("SELECT address,family,first_seen,last_seen,is_current FROM device_addresses WHERE device_id=?", (drop_id,)).fetchall():
            conn.execute("INSERT INTO device_addresses(device_id,address,family,first_seen,last_seen,is_current) VALUES(?,?,?,?,?,?) ON CONFLICT(device_id,address) DO UPDATE SET last_seen=max(last_seen,excluded.last_seen), is_current=max(is_current,excluded.is_current)", (keep_id, *row))
        for row in conn.execute("SELECT hostname,first_seen,last_seen FROM device_hostnames WHERE device_id=?", (drop_id,)).fetchall():
            conn.execute("INSERT INTO device_hostnames(device_id,hostname,first_seen,last_seen) VALUES(?,?,?,?) ON CONFLICT(device_id,hostname) DO UPDATE SET last_seen=max(last_seen,excluded.last_seen)", (keep_id, *row))
        conn.execute("DELETE FROM devices WHERE id=?", (drop_id,))

    def upsert_device(self, mac: str | None, address: str | None = None, hostname: str | None = None,
                      vendor: str | None = None, interface: str | None = None, source: str = "unknown",
                      metadata: dict | None = None, ts: str | None = None, returned_after_seconds: int = 3600, record_observation: bool = True) -> tuple[int, bool, bool]:
        ts = ts or utcnow()
        mac = self.normalize_mac(mac)
        identity = f"mac:{mac}" if mac else (f"ip:{address}" if address else None)
        if not identity:
            raise ValueError("device requires MAC or address")
        with self.connect() as conn:
            existing = conn.execute("SELECT * FROM devices WHERE identity_key=?", (identity,)).fetchone()
            if mac and address:
                addr_dev = self._device_by_address(conn, address)
                if addr_dev and addr_dev["identity_key"].startswith("ip:"):
                    if existing:
                        self._merge_devices(conn, existing["id"], addr_dev["id"])
                    else:
                        conn.execute("UPDATE devices SET identity_key=?, mac=? WHERE id=?", (identity, mac, addr_dev["id"]))
                        existing = conn.execute("SELECT * FROM devices WHERE id=?", (addr_dev["id"],)).fetchone()
            is_new = existing is None
            was_online = bool(existing["online"]) if existing else False
            previous_last = existing["last_seen"] if existing else None
            if is_new:
                category, conf, reason = classify(hostname, vendor)
                cur = conn.execute("INSERT INTO devices(identity_key,mac,primary_hostname,vendor,category,classification_confidence,classification_reason,first_seen,last_seen,online,last_interface,last_source,metadata_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
                    (identity, mac, hostname, vendor, category, conf, reason, ts, ts, 1, interface, source, json_dumps(metadata or {})))
                device_id = cur.lastrowid
            else:
                device_id = existing["id"]
                new_host = hostname or existing["primary_hostname"]
                new_vendor = vendor or existing["vendor"]
                category, conf, reason = classify(new_host, new_vendor)
                conn.execute("UPDATE devices SET mac=COALESCE(?,mac), primary_hostname=COALESCE(?,primary_hostname), vendor=COALESCE(?,vendor), category=?, classification_confidence=?, classification_reason=?, last_seen=?, online=1, last_interface=COALESCE(?,last_interface), last_source=?, metadata_json=? WHERE id=?",
                    (mac, hostname, vendor, category, conf, reason, ts, interface, source, json_dumps(metadata or {}), device_id))
            if address:
                try: family = ipaddress.ip_address(address).version
                except ValueError: family = 0
                conn.execute("INSERT INTO device_addresses(device_id,address,family,first_seen,last_seen,is_current) VALUES(?,?,?,?,?,1) ON CONFLICT(device_id,address) DO UPDATE SET last_seen=excluded.last_seen,is_current=1", (device_id,address,family,ts,ts))
            if hostname:
                hostname = hostname.rstrip(".")[:255]
                conn.execute("INSERT INTO device_hostnames(device_id,hostname,first_seen,last_seen) VALUES(?,?,?,?) ON CONFLICT(device_id,hostname) DO UPDATE SET last_seen=excluded.last_seen", (device_id,hostname,ts,ts))
            if record_observation or is_new:
                conn.execute("INSERT INTO device_observations(ts,device_id,address,hostname,interface,source,metadata_json) VALUES(?,?,?,?,?,?,?)", (ts,device_id,address,hostname,interface,source,json_dumps(metadata or {})))
            if is_new:
                d = conn.execute("SELECT * FROM devices WHERE id=?", (device_id,)).fetchone()
                self._event_conn(conn, "new_device", "notice", f"New device: {d['mac'] or address} ({d['category']}, {d['classification_confidence']:.0%} confidence)", device_id=device_id, details={"address": address, "hostname": hostname, "vendor": vendor, "source": source})
            elif not was_online:
                elapsed = None
                prev = parse_ts(previous_last)
                now = parse_ts(ts)
                if prev and now: elapsed = (now-prev).total_seconds()
                etype = "device_returned" if elapsed and elapsed >= returned_after_seconds else "device_online"
                self._event_conn(conn, etype, "info", f"Device returned online: {mac or address}", device_id=device_id, details={"offline_seconds": elapsed})
            return device_id, is_new, was_online

    def mark_offline(self, offline_after_seconds: int) -> list[int]:
        cutoff = (datetime.now(timezone.utc) - timedelta(seconds=offline_after_seconds)).replace(microsecond=0).isoformat()
        changed = []
        with self.connect() as conn:
            conn.execute("UPDATE device_addresses SET is_current=0 WHERE is_current=1 AND last_seen<?", (cutoff,))
            rows = conn.execute("SELECT id,mac,primary_hostname,last_seen FROM devices WHERE online=1 AND last_seen<?", (cutoff,)).fetchall()
            for row in rows:
                conn.execute("UPDATE devices SET online=0 WHERE id=?", (row["id"],))
                self._event_conn(conn, "device_offline", "info", f"Device offline: {row['primary_hostname'] or row['mac'] or row['id']}", device_id=row["id"], details={"last_seen": row["last_seen"]})
                changed.append(row["id"])
        return changed

    def find_device_by_ip(self, address: str) -> int | None:
        try:
            with self.connect(readonly=True) as conn:
                row = conn.execute("SELECT device_id FROM device_addresses WHERE address=? ORDER BY last_seen DESC LIMIT 1", (address,)).fetchone()
                return int(row[0]) if row else None
        except sqlite3.OperationalError:
            return None

    def upsert_domain_event(self, domain: str, ts: str, device_id: int | None, src_ip: str | None,
                            qtype: int | None, server_ip: str | None, transport: str | None, interface: str | None) -> int:
        domain = domain.lower().rstrip(".")[:253]
        if not domain:
            raise ValueError("empty domain")
        with self.connect() as conn:
            row = conn.execute("SELECT id FROM domains WHERE name=?", (domain,)).fetchone()
            is_new = row is None
            if is_new:
                cur = conn.execute("INSERT INTO domains(name,first_seen,last_seen) VALUES(?,?,?)", (domain,ts,ts))
                domain_id = cur.lastrowid
            else:
                domain_id = row["id"]
                conn.execute("UPDATE domains SET last_seen=? WHERE id=?", (ts,domain_id))
            conn.execute("INSERT INTO dns_events(ts,device_id,src_ip,domain_id,qtype,server_ip,transport,interface) VALUES(?,?,?,?,?,?,?,?)", (ts,device_id,src_ip,domain_id,qtype,server_ip,transport,interface))
            if is_new:
                self._event_conn(conn, "new_domain", "info", f"New domain observed: {domain}", device_id=device_id, domain_id=domain_id, details={"src_ip": src_ip})
            return domain_id

    def _event_conn(self, conn, etype: str, severity: str, message: str, device_id=None, domain_id=None, details=None, ts=None):
        conn.execute("INSERT INTO system_events(ts,type,severity,device_id,domain_id,message,details_json) VALUES(?,?,?,?,?,?,?)", (ts or utcnow(),etype,severity,device_id,domain_id,message,json_dumps(details or {})))

    def event(self, etype: str, severity: str, message: str, device_id=None, domain_id=None, details=None, ts=None) -> None:
        with self.connect() as conn:
            self._event_conn(conn, etype,severity,message,device_id,domain_id,details,ts)

    def upsert_flow(self, flow: dict) -> None:
        with self.connect() as conn:
            conn.execute("INSERT INTO flows(bucket_start,bucket_end,src_device_id,dst_device_id,src_ip,dst_ip,src_port,dst_port,protocol,packets,bytes,interface) VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(bucket_start,src_ip,dst_ip,src_port,dst_port,protocol,interface) DO UPDATE SET bucket_end=max(bucket_end,excluded.bucket_end), packets=packets+excluded.packets, bytes=bytes+excluded.bytes, src_device_id=COALESCE(flows.src_device_id,excluded.src_device_id), dst_device_id=COALESCE(flows.dst_device_id,excluded.dst_device_id)",
                (flow["bucket_start"],flow["bucket_end"],flow.get("src_device_id"),flow.get("dst_device_id"),flow.get("src_ip"),flow.get("dst_ip"),flow.get("src_port"),flow.get("dst_port"),flow["protocol"],flow["packets"],flow["bytes"],flow["interface"]))

    def bandwidth_sample(self, ts: str, interface: str, rx_bytes: int, tx_bytes: int, rx_bps: float, tx_bps: float) -> None:
        with self.connect() as conn:
            conn.execute("INSERT INTO bandwidth_samples(ts,interface,rx_bytes,tx_bytes,rx_bps,tx_bps) VALUES(?,?,?,?,?,?)", (ts,interface,rx_bytes,tx_bytes,rx_bps,tx_bps))

    def health_sample(self, component: str, status: str, cpu_percent=None, memory_mb=None, disk_free_mb=None, details=None) -> None:
        with self.connect() as conn:
            conn.execute("INSERT INTO health_samples(ts,component,status,cpu_percent,memory_mb,disk_free_mb,details_json) VALUES(?,?,?,?,?,?,?)", (utcnow(),component,status,cpu_percent,memory_mb,disk_free_mb,json_dumps(details or {})))

    def get_meta(self, key: str, default=None):
        try:
            with self.connect(readonly=True) as conn:
                row=conn.execute("SELECT value FROM meta WHERE key=?",(key,)).fetchone()
                return row[0] if row else default
        except sqlite3.OperationalError:
            return default

    def set_meta(self, key: str, value) -> None:
        with self.connect() as conn:
            conn.execute("INSERT OR REPLACE INTO meta(key,value) VALUES(?,?)",(key,str(value)))

    def counts(self) -> dict:
        with self.connect(readonly=True) as conn:
            return {
                "devices": conn.execute("SELECT count(*) FROM devices").fetchone()[0],
                "online": conn.execute("SELECT count(*) FROM devices WHERE online=1").fetchone()[0],
                "domains": conn.execute("SELECT count(*) FROM domains").fetchone()[0],
                "events": conn.execute("SELECT count(*) FROM system_events").fetchone()[0],
            }

    def maintenance(self, retention: dict) -> dict:
        now = datetime.now(timezone.utc)
        mapping = {
            "dns_events": retention["dns_days"], "flows": retention["flows_days"],
            "bandwidth_samples": retention["bandwidth_days"], "device_observations": retention["observations_days"],
            "system_events": retention["events_days"], "health_samples": retention["health_days"],
        }
        deleted = {}
        with self.connect() as conn:
            for table, days in mapping.items():
                if table == "flows":
                    cutoff_epoch = int((now - timedelta(days=int(days))).timestamp())
                    cur = conn.execute("DELETE FROM flows WHERE bucket_start<?", (cutoff_epoch,))
                else:
                    cutoff = (now - timedelta(days=int(days))).replace(microsecond=0).isoformat()
                    cur = conn.execute(f"DELETE FROM {table} WHERE ts<?", (cutoff,))
                deleted[table] = cur.rowcount
            conn.execute("DELETE FROM domains WHERE id NOT IN (SELECT DISTINCT domain_id FROM dns_events) AND last_seen<?", ((now-timedelta(days=int(retention['dns_days']))).replace(microsecond=0).isoformat(),))
            conn.execute("INSERT OR REPLACE INTO meta(key,value) VALUES('last_maintenance',?)", (utcnow(),))
            conn.commit()
            conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
            conn.execute("PRAGMA incremental_vacuum(2000)")
            conn.commit()
        return deleted
