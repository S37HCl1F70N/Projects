PRAGMA foreign_keys=ON;
PRAGMA auto_vacuum=INCREMENTAL;
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS devices (
  id INTEGER PRIMARY KEY,
  identity_key TEXT NOT NULL UNIQUE,
  mac TEXT,
  primary_hostname TEXT,
  vendor TEXT,
  category TEXT NOT NULL DEFAULT 'unknown',
  classification_confidence REAL NOT NULL DEFAULT 0.0,
  classification_reason TEXT,
  first_seen TEXT NOT NULL,
  last_seen TEXT NOT NULL,
  online INTEGER NOT NULL DEFAULT 1,
  last_interface TEXT,
  last_source TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_devices_mac ON devices(mac);
CREATE INDEX IF NOT EXISTS idx_devices_last_seen ON devices(last_seen);
CREATE INDEX IF NOT EXISTS idx_devices_hostname ON devices(primary_hostname);

CREATE TABLE IF NOT EXISTS device_addresses (
  id INTEGER PRIMARY KEY,
  device_id INTEGER NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  address TEXT NOT NULL,
  family INTEGER NOT NULL,
  first_seen TEXT NOT NULL,
  last_seen TEXT NOT NULL,
  is_current INTEGER NOT NULL DEFAULT 1,
  UNIQUE(device_id, address)
);
CREATE INDEX IF NOT EXISTS idx_addresses_address ON device_addresses(address);
CREATE INDEX IF NOT EXISTS idx_addresses_device ON device_addresses(device_id, last_seen);

CREATE TABLE IF NOT EXISTS device_hostnames (
  id INTEGER PRIMARY KEY,
  device_id INTEGER NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  hostname TEXT NOT NULL,
  first_seen TEXT NOT NULL,
  last_seen TEXT NOT NULL,
  UNIQUE(device_id, hostname)
);
CREATE INDEX IF NOT EXISTS idx_hostnames_hostname ON device_hostnames(hostname);

CREATE TABLE IF NOT EXISTS device_observations (
  id INTEGER PRIMARY KEY,
  ts TEXT NOT NULL,
  device_id INTEGER NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  address TEXT,
  hostname TEXT,
  interface TEXT,
  source TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_obs_device_ts ON device_observations(device_id, ts);
CREATE INDEX IF NOT EXISTS idx_obs_ts ON device_observations(ts);

CREATE TABLE IF NOT EXISTS domains (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  first_seen TEXT NOT NULL,
  last_seen TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_domains_last_seen ON domains(last_seen);

CREATE TABLE IF NOT EXISTS dns_events (
  id INTEGER PRIMARY KEY,
  ts TEXT NOT NULL,
  device_id INTEGER REFERENCES devices(id) ON DELETE SET NULL,
  src_ip TEXT,
  domain_id INTEGER NOT NULL REFERENCES domains(id) ON DELETE CASCADE,
  qtype INTEGER,
  server_ip TEXT,
  transport TEXT,
  interface TEXT
);
CREATE INDEX IF NOT EXISTS idx_dns_ts ON dns_events(ts);
CREATE INDEX IF NOT EXISTS idx_dns_device_ts ON dns_events(device_id, ts);
CREATE INDEX IF NOT EXISTS idx_dns_domain_ts ON dns_events(domain_id, ts);

CREATE TABLE IF NOT EXISTS flows (
  id INTEGER PRIMARY KEY,
  bucket_start INTEGER NOT NULL,
  bucket_end INTEGER NOT NULL,
  src_device_id INTEGER REFERENCES devices(id) ON DELETE SET NULL,
  dst_device_id INTEGER REFERENCES devices(id) ON DELETE SET NULL,
  src_ip TEXT,
  dst_ip TEXT,
  src_port INTEGER,
  dst_port INTEGER,
  protocol TEXT NOT NULL,
  packets INTEGER NOT NULL,
  bytes INTEGER NOT NULL,
  interface TEXT NOT NULL,
  UNIQUE(bucket_start, src_ip, dst_ip, src_port, dst_port, protocol, interface)
);
CREATE INDEX IF NOT EXISTS idx_flows_bucket ON flows(bucket_start);
CREATE INDEX IF NOT EXISTS idx_flows_srcdev_bucket ON flows(src_device_id, bucket_start);
CREATE INDEX IF NOT EXISTS idx_flows_dstdev_bucket ON flows(dst_device_id, bucket_start);
CREATE INDEX IF NOT EXISTS idx_flows_dstip ON flows(dst_ip);
CREATE INDEX IF NOT EXISTS idx_flows_ports ON flows(dst_port, protocol);

CREATE TABLE IF NOT EXISTS bandwidth_samples (
  id INTEGER PRIMARY KEY,
  ts TEXT NOT NULL,
  interface TEXT NOT NULL,
  rx_bytes INTEGER NOT NULL,
  tx_bytes INTEGER NOT NULL,
  rx_bps REAL NOT NULL,
  tx_bps REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_bw_ts ON bandwidth_samples(ts);
CREATE INDEX IF NOT EXISTS idx_bw_if_ts ON bandwidth_samples(interface, ts);

CREATE TABLE IF NOT EXISTS system_events (
  id INTEGER PRIMARY KEY,
  ts TEXT NOT NULL,
  type TEXT NOT NULL,
  severity TEXT NOT NULL,
  device_id INTEGER REFERENCES devices(id) ON DELETE SET NULL,
  domain_id INTEGER REFERENCES domains(id) ON DELETE SET NULL,
  message TEXT NOT NULL,
  details_json TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_events_ts ON system_events(ts);
CREATE INDEX IF NOT EXISTS idx_events_type_ts ON system_events(type, ts);
CREATE INDEX IF NOT EXISTS idx_events_device_ts ON system_events(device_id, ts);

CREATE TABLE IF NOT EXISTS health_samples (
  id INTEGER PRIMARY KEY,
  ts TEXT NOT NULL,
  component TEXT NOT NULL,
  status TEXT NOT NULL,
  cpu_percent REAL,
  memory_mb REAL,
  disk_free_mb REAL,
  details_json TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_health_ts ON health_samples(ts);
CREATE INDEX IF NOT EXISTS idx_health_component_ts ON health_samples(component, ts);
