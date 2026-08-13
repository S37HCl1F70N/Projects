# Changelog

## 0.1.0 - 2026-08-12

- Initial reusable Network Black Box implementation.
- Pure-Python pcap/Ethernet/ARP/IPv4/IPv6/TCP/UDP/DNS/DHCP metadata parser.
- Neighbor/ARP/DHCP-assisted device discovery with MAC-stable identity history.
- Local OUI vendor lookup and confidence-bearing heuristic device classification.
- DNS/domain event storage and flow/bandwidth aggregation.
- SQLite WAL schema with bounded retention and incremental cleanup.
- Authenticated LAN dashboard and administrative CLI.
- systemd services, capability-limited collector, daily maintenance timer.
- Idempotent-style installer preserving configuration/data on rerun; non-destructive default uninstaller.
- Automated unit/integration tests and end-to-end source-tree test.
