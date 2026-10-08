# Main_PC — Hardware and Windows Report

Collected: **October 8, 2026, 11:59:10 AM CDT** (America/Chicago).
Source: user-supplied `Main_PC-system-info.json`, collected using Windows CIM, Windows version registry values, and `Get-HotFix`. This describes Main_PC at collection time; it is not a live inspection or an inventory of other computers.

## Overview

- **OS:** Windows 11 Home, version 25H2, full build **26200.9457**, 64-bit.
- **CPU:** AMD Ryzen 7 3700X, 8 cores / 16 logical processors.
- **RAM:** 32 GiB installed across two 16 GiB modules; Windows reports 31.92 GiB total physical memory.
- **GPU:** NVIDIA GeForce RTX 2080 (Turing), 8 GiB VRAM.
- **Motherboard:** MSI MPG X570 GAMING PRO CARBON WIFI (MS-7B93), revision 1.0.
- **Storage:** two reported disks, approximately 2,328.77 GiB combined.

## Windows and Firmware

| Field | Reported value |
| --- | --- |
| Windows edition | Microsoft Windows 11 Home |
| Feature version | 25H2 |
| OS version | 10.0.26200 |
| Full build (including revision) | 26200.9457 |
| Architecture | 64-bit |
| Last boot | October 4, 2026, 6:28:29 PM CDT |
| System manufacturer | Micro-Star International Co., Ltd. |
| System model | MS-7B93 |
| System type | x64-based PC |
| BIOS vendor | American Megatrends International, LLC. |
| BIOS version | 1.K1 |
| BIOS release timestamp | 2023-05-25T19:00:00-05:00 |

Firmware dates are reproduced as collected; CIM date conversion may shift the displayed calendar day. No firmware or Windows update was installed as part of this report.

## Processor

| Processor | Cores | Logical processors | Reported maximum clock (MHz) |
| --- | --- | --- | --- |
| AMD Ryzen 7 3700X 8-Core Processor | 8 | 16 | 3600 |

The CIM clock value is a reported specification, not a measured boost clock.

## Memory

| Module | Manufacturer | Part number | Reported locator | Capacity (GiB) | Reported speed | Configured speed |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Unknown | F4-3600C16-16GTZNC | DIMM 1 | 16.0 | 3600 | 3600 |
| 2 | Unknown | F4-3600C16-16GTZNC | DIMM 1 | 16.0 | 3600 | 3600 |

Both module records report `DIMM 1`; the upload does not establish their distinct physical slots. Manufacturer is reported as `Unknown`. Speed values are preserved from CIM (3600); no independent memory timing or effective-rate verification was performed.

## Graphics

| GPU | Windows driver version | Driver timestamp | Reported current resolution |
| --- | --- | --- | --- |
| NVIDIA GeForce RTX 2080 | 32.0.16.1088 | 2026-07-21T19:00:00-05:00 | 1920 × 1080 |

### Extended NVIDIA Diagnostics

Source: user-supplied `Main_PC-GPU.txt`, produced by `nvidia-smi -q`. The log reports **October 8, 2026, 12:21:41 PM** without a timezone; interpreted as CDT using the earlier Main_PC collection. One GPU was detected.

| Property | Reported value |
| --- | --- |
| Product / architecture | NVIDIA GeForce RTX 2080 / Turing |
| NVIDIA kernel-mode driver (KMD) | 610.88 |
| CUDA user-mode driver (UMD) version | 13.3 |
| Windows driver model | WDDM |
| VBIOS | 90.04.23.40.14 |
| GPU part number | 1E87-400-A1 |
| Display | Attached; active |
| Compute mode | Default |
| Virtualization mode | None |
| PCI device / subsystem IDs | 0x1E8710DE / 0x22873842 |
| PCIe generation | Current: 3; GPU maximum: 3; host maximum: 4 |
| PCIe link width | Current: x16; maximum: x16 |
| PCIe replay count / rollovers | 0 / 0 |
| Dedicated VRAM | 8192 MiB (8 GiB) |
| VRAM reserved / used / free | 205 / 495 / 7493 MiB |
| BAR1 aperture total / used / free | 256 / 2 / 254 MiB |

CUDA UMD 13.3 describes the driver-reported CUDA compatibility level; it does not prove that the CUDA Toolkit is installed. The NVIDIA version 610.88 and original Windows driver version 32.0.16.1088 are distinct version formats. BAR1 is an address-mapping aperture, not additional VRAM; its size alone does not establish the platform's Resizable BAR setting.

### GPU Snapshot: Load, Temperature, and Power

| Reading | Value at collection |
| --- | --- |
| Performance state | P8; idle clock-event reason active |
| GPU utilization | 1% |
| Memory utilization | 3% (activity metric, not VRAM capacity used) |
| Encoder / decoder utilization | 0% / 0% |
| Active encoder / frame-buffer capture sessions | 0 / 0 |
| Fan speed | 0% |
| GPU temperature | 35 °C |
| Target / maximum operating temperature | 83 / 88 °C |
| Slowdown / shutdown temperature | 97 / 100 °C |
| Instantaneous power draw | 16.34 W |
| Current / requested / default power limit | 260 / 260 / 260 W |
| Reported adjustable power-limit range | 105–338 W |
| Software power cap / thermal slowdown | Not active / not active |
| Hardware thermal / power-brake slowdown | Not active / not active |
| GPU recovery action | None |

The readings reflect an idle or light-load snapshot, not a stress test. A 0% fan reading at 35 °C alone does not indicate a cooling fault. Power-limit values describe this board's reported configuration, not measured peak draw or a recommendation to change settings. No active power or thermal slowdown was reported at collection; this does not establish sustained-load stability.

### GPU Clock Readings

| Clock domain | Current (MHz) | Reported maximum (MHz) |
| --- | --- | --- |
| Graphics | 300 | 2190 |
| SM | 300 | 2190 |
| Memory | 405 | 7000 |
| Video | 540 | 1950 |

Reported maximum clocks are not guaranteed sustained clocks or a measured overclock. Memory values are reproduced in NVIDIA's reported units without converting them to an effective transfer rate.

Memory temperature, ECC counters, and several enterprise features were reported as unavailable (`N/A`). Monitor models, refresh rates, memory bus width/type, CUDA-core count, and the exact board-partner retail model were not established by these uploads. GPU UUID, serial number, GPU PDI, PCI bus location, and process details were omitted from the published report.

## Storage Devices

| Model | Capacity (GiB) | CIM media type | CIM interface |
| --- | --- | --- | --- |
| WD Blue SA510 2.5 2TB | 1863.01 | Fixed hard disk media | IDE |
| Samsung SSD 850 EVO M.2 500GB | 465.76 | Fixed hard disk media | IDE |

CIM reports generic `Fixed hard disk media` and `IDE` values. These do not establish whether a drive is mechanical or its actual physical connection. Disk health and SMART data were not collected.

### Local Volumes

| Volume | Filesystem | Capacity (GiB) | Used (GiB) | Free (GiB) | Free (%) |
| --- | --- | --- | --- | --- | --- |
| C: | NTFS | 464.72 | 152.81 | 311.91 | 67.1% |
| D: | NTFS | 1863.02 | 494.77 | 1368.25 | 73.4% |

The collector labeled capacities `GB` but divided by PowerShell `1GB` (1,073,741,824 bytes); this report therefore uses **GiB**. Volume-to-physical-disk mapping was not collected.

## Network Adapters

| Reported adapter | Manufacturer |
| --- | --- |
| Allied Telesis AT-2911xx Gigabit Copper Ethernet | Broadcom |
| Intel(R) Wi-Fi 6 AX200 160MHz | Intel Corporation |
| Intel(R) I211 Gigabit Network Connection | Intel |
| Allied Telesis AT-2911xx Gigabit Copper Ethernet #2 | Broadcom |
| Bluetooth Device (Personal Area Network) | Microsoft |
| VirtualBox Host-Only Ethernet Adapter | Oracle Corporation |

The collection includes a VirtualBox virtual adapter and a Bluetooth PAN adapter; this list is not exclusively physical networking hardware. Connection status, link speed, IP/MAC addresses, and network configuration were not collected.

## Reported Recent Windows Hotfixes

| Hotfix | Description | Installation date |
| --- | --- | --- |
| KB5129195 | Security Update | 2026-09-15 |
| KB5126052 | Update | 2026-09-09 |
| KB5124007 | Security Update | 2026-09-09 |
| KB5078674 | Update | 2026-04-19 |
| KB5054156 | Update | 2026-03-06 |

These are the five entries returned in the supplied `Get-HotFix` collection. That command does not provide a complete history of every Windows, Store, or driver update. Update availability, support status, and whether build 26200.9457 is the latest applicable build were not checked against Microsoft.

## Scope and Missing Information

This report covers only Main_PC. It contains no serial numbers, product keys, or network addresses from the collection. The following were not captured: TPM and Secure Boot status, activation status, storage health, peripherals, power supply, cooling hardware, chassis, or CPU/system temperatures. GPU memory and GPU temperature are documented above from the later NVIDIA snapshot. Unknown values and collection limitations have been retained rather than inferred.
