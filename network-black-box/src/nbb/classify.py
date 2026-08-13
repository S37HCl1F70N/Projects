from __future__ import annotations

def classify(hostname: str | None, vendor: str | None) -> tuple[str, float, str]:
    h = (hostname or "").lower()
    v = (vendor or "").lower()
    text = f"{h} {v}"
    rules = [
        ("raspberry_pi", .98, ["raspberry pi", "raspberrypi", "raspberry-pi", "raspberry"]),
        ("game_console", .92, ["playstation", "ps5", "ps4", "xbox", "nintendo", "switch"]),
        ("printer", .90, ["printer", "brother", "epson", "xerox", "lexmark", "hewlett packard", "hp inc.", "canon"]),
        ("streaming_device", .90, ["roku", "chromecast", "fire tv", "firetv", "apple tv"]),
        ("television", .84, ["smarttv", "smart-tv", "television", "vizio", "hisense", "tcl", "lg tv", "samsung tv"]),
        ("router", .88, ["router", "gateway", "fritz!box"]),
        ("access_point", .86, ["access point", "access-point", "unifi", "uap-"] ),
        ("server", .78, ["server", "nas", "synology", "qnap", "truenas"]),
        ("phone", .83, ["iphone", "android", "pixel", "galaxy", "oneplus"]),
        ("tablet", .84, ["ipad", "tablet", "kindle"]),
        ("laptop", .70, ["macbook", "laptop", "thinkpad", "latitude", "xps-"] ),
        ("desktop", .66, ["desktop", "imac", "workstation"]),
        ("smart_home_iot", .74, ["espressif", "tuya", "nest", "ring", "ecobee", "shelly", "tasmota", "sonoff", "philips lighting"]),
    ]
    for category, confidence, needles in rules:
        if any(n in text for n in needles):
            match = next(n for n in needles if n in text)
            return category, confidence, f"heuristic match: {match}"
    if v:
        return "unknown", .20, "vendor known; no reliable category heuristic"
    if h:
        return "unknown", .15, "hostname known; no reliable category heuristic"
    return "unknown", 0.0, "insufficient evidence"
