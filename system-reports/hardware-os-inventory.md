# Hardware and OS Inventory

**Collected:** 2026-10-08 12:24 CDT  
**Scope:** This computer only; other computers were not inspected. Dynamic readings (battery, temperatures, utilization) are snapshots and change over time.

## System identity and firmware

| Property | Value |
|---|---|
| Hostname | `arch-lptp` |
| System manufacturer / model | Micro-Star International Co., Ltd. (MSI) GS63VR 7RF |
| Product family / SKU | GS / 16K2.3 |
| Mainboard | MSI MS-16K2, REV:1.0 |
| Chassis type | Laptop |
| Firmware vendor / version | American Megatrends Inc. / E16K2IMS.31B |
| Firmware date / release | 2018-03-14 / 3.27 |
| Firmware mode | UEFI |
| CPU architecture | x86_64 |

## Processor and platform

| Component | Details |
|---|---|
| CPU | Intel Core i7-7700HQ, Kaby Lake-H, 14 nm, family 6 / model 158 / stepping 9 |
| Current OS-visible topology | 1 package, 4 cores, 4 logical CPUs; one thread per core is exposed to Linux |
| Frequency range | 800 MHz–3.80 GHz; base model frequency 2.80 GHz |
| CPU frequency driver | `intel_pstate` |
| Cache | L1: 32 KiB data + 32 KiB instruction per core; L2: 256 KiB per core; L3: 6 MiB shared |
| Virtualization | Intel VT-x / VMX support present |
| Microcode | `0xf8` |
| Chipset/platform devices | Intel 7th-generation host bridge and HM175/QM175-class platform controllers; Intel SATA AHCI, SMBus, USB 3.x, thermal, and Management Engine interfaces |
| Thunderbolt | Intel DSL6340 Alpine Ridge Thunderbolt 3 bridge/controller and NHI detected |

The CPU supports common x86-64 features including SSE4.1/4.2, AES-NI, AVX/AVX2, FMA, and VT-x. The i7-7700HQ supports Intel Hyper-Threading (4 cores / 8 threads), but this machine currently exposes only four logical CPUs to Linux (one per core). The CPU advertises the `ht` capability, yet Linux reports only CPUs 0-3 as possible, present, and online, with each core's thread-sibling list containing only itself. The active kernel command line has no `nosmt` or CPU-count limit, and the machine is not detected as virtualized. This points to Hyper-Threading being disabled or hidden by firmware/BIOS as the most likely explanation; the exact firmware setting cannot be confirmed from the running OS alone. Check BIOS/UEFI setup for an Intel Hyper-Threading/Logical Processor setting, enable it if disabled, save, and reboot; then confirm `lscpu` shows 8 CPUs and sibling pairs (for example `0,4`). If that setting is already enabled, a firmware update or firmware reset may merit investigation.

## Memory

| Property | Details |
|---|---|
| Installed memory | 16 GiB total; 15.49 GiB available to the OS |
| Modules reported by SMBIOS | 2 x 8 GiB SK Hynix DDR4-2400 SO-DIMMs |
| Module part number | HMA81GS6AFR8N-UH |
| Slots / maximum | 2 slots; 32 GiB maximum is an SMBIOS/inxi estimate |
| Current use at collection | About 3.5 GiB used; approximately 12 GiB available |

Module details are firmware/SMBIOS-reported rather than independently read from the memory modules. Memory serial numbers are not included.

## Graphics and display

| Component | Details |
|---|---|
| Integrated GPU | Intel Kaby Lake-H GT2 / HD Graphics 630; PCI ID `8086:591b`; kernel driver `i915` |
| Discrete GPU | NVIDIA GeForce GTX 1060 Mobile (GP106M, Pascal); PCI ID `10de:1c20`; 6 GiB VRAM |
| NVIDIA driver / VBIOS | 580.178.04 / 86.06.18.00.18 |
| Current GPU snapshot | NVIDIA GPU at 49 C; about 3 MiB VRAM used of 6144 MiB; discrete GPU display output inactive at collection |
| Internal panel | Chi Mei Innolux 0x15D6; 15.5-inch-class, 1920 x 1080, 16:9 |
| Active display mode | 1920 x 1080 at approximately 60.01 Hz via embedded DisplayPort (`eDP-1`) |
| Panel dimensions | Approximately 340 x 190 mm reported; panel EDID reports about 142 DPI |
| Display routing | Internal screen currently driven by Intel graphics; NVIDIA-reported external DP/HDMI outputs are not active |

The integrated GPU uses system memory; its dedicated/reserved graphics-memory amount was not reported.

## Storage and filesystems

| Device | Details |
|---|---|
| SATA SSD | Kingston RBU-SNS8152S3128GG6; 119.24 GiB; SATA 6 Gb/s; firmware SAFM01.X / 01.X; non-rotating; 512-byte logical and physical sectors |
| SATA HDD | HGST HTS541010B7E610; 931.51 GiB; 5400 RPM; SATA 6 Gb/s; firmware 1A01; rotational; 512-byte logical / 4096-byte physical sectors |
| EFI/boot partition | 2 GiB FAT32 on the SSD; mounted at `/boot` |
| Encrypted root | 117.2 GiB LUKS2 container on the SSD, opened as `/dev/mapper/root`; Btrfs filesystem |
| Btrfs mountpoints | `/`, `/home`, `/var/log`, and `/var/cache/pacman/pkg` share the same root filesystem |
| Second-drive partition | One 931.5 GiB NTFS partition on the HDD; not mounted at collection |
| Current filesystem use | Root/Btrfs: about 35 GiB used of 118 GiB; `/boot`: about 647 MiB used of 2 GiB |
| TRIM/discard | SSD exposes discard support |
| SMART / wear data | Not collected: `smartctl` is not installed, so drive health, power-on hours, and SSD wear cannot be stated |

Device serial numbers, partition UUIDs, and encryption identifiers are omitted from this report.

## Networking and external interfaces

| Component | Details |
|---|---|
| Wired Ethernet | Qualcomm Atheros Killer E2500 Gigabit Ethernet; PCI ID `1969:e0b1`; `alx` driver; interface `enp61s0` was down with no carrier |
| Wi-Fi | Intel Wireless 8265/8275 Dual Band Wireless-AC; PCI ID `8086:24fd`; `iwlwifi` driver; dual-band 802.11ac-class adapter |
| Bluetooth | Intel USB Bluetooth controller; Bluetooth 4.2 reported; `btusb` driver; controller was up |
| USB controllers | Intel 100/C230 xHCI USB 3.0 controller and Intel Alpine Ridge USB 3.1 controller detected |
| Webcam | Bison HD webcam; USB 2.0 device using `uvcvideo` |
| Thunderbolt | Alpine Ridge Thunderbolt 3 controller detected; no attached Thunderbolt device was reported |

No network addresses, Wi-Fi network names, or MAC addresses are included.

## Audio, input, power, and sensors

| Component | Details |
|---|---|
| Audio controllers | Intel HM175/QM175/CM238 HD Audio (`8086:a171`) and NVIDIA GP106 HDMI/DisplayPort audio (`10de:10f1`); both use `snd_hda_intel` |
| Audio stack | ALSA kernel devices; PipeWire and WirePlumber active |
| Built-in input devices | Internal keyboard, ElanTech PS/2 touchpad, lid switch, and MSI WMI hotkeys detected |
| Battery | MSI BIF0_9 lithium-ion battery; 64.98 Wh design capacity |
| Battery condition snapshot | Full-charge capacity 50.86 Wh (78.3% of design); energy 48.92 Wh (96% charge); 12.781 V; fully charged/not charging |
| Battery cycle count | Not reported by firmware |
| AC power | Adapter present and online at collection |
| Temperature snapshot | CPU package/cores about 49–51 C; PCH about 63.5 C; Wi-Fi sensor about 57 C |
| Fan telemetry | Fan RPM was not exposed by available sensor interfaces |

## Operating system and active drivers

| Property | Value |
|---|---|
| Distribution / release | Omarchy 4.0.4 (`BUILD_ID` / `VERSION_ID` 4.0.4) |
| Omarchy package version | 4.0.4-1 |
| Kernel | Linux 7.1.9-arch1-2, x86_64, SMP, PREEMPT_DYNAMIC |
| Kernel build date | 2026-08-21 |
| Desktop/compositor | Hyprland 0.56.2 on Wayland |
| Display manager | SDDM |
| Graphics drivers | Intel `i915`; NVIDIA 580.178.04 |
| Other notable drivers | `ahci`, `xhci_hcd`, `iwlwifi`, `alx`, `btusb`, `uvcvideo`, `snd_hda_intel` |
| Init system | systemd |

## Swap configuration

| Device | Details |
|---|---|
| Disk swap | 15.49 GiB swap file at `/swap/swapfile` |
| zram swap | 15.49 GiB compressed RAM swap; `zstd` selected; priority higher than disk swap |
| Total configured swap | Approximately 31 GiB |

This inventory reflects what the running operating system, SMBIOS, device drivers, and installed inspection utilities exposed without elevated access. It does not include inaccessible firmware tables, component serial numbers, drive SMART health, fan speeds, or unreported module-level electrical/timing details. Capacities use device/kernel-reported units and may differ from marketed decimal capacities.
