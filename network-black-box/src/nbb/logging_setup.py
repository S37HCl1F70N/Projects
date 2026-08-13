from __future__ import annotations
import logging
import logging.handlers
from pathlib import Path

def setup_logging(cfg: dict, name: str) -> logging.Logger:
    log_cfg = cfg["logging"]
    logger = logging.getLogger(name)
    if logger.handlers:
        return logger
    logger.setLevel(getattr(logging, str(log_cfg["level"]).upper(), logging.INFO))
    fmt = logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s")
    stream = logging.StreamHandler()
    stream.setFormatter(fmt)
    logger.addHandler(stream)
    log_dir = Path(cfg["core"]["log_dir"])
    try:
        log_dir.mkdir(parents=True, exist_ok=True)
        fileh = logging.handlers.RotatingFileHandler(
            log_dir / f"{name}.log",
            maxBytes=int(log_cfg["max_bytes"]), backupCount=int(log_cfg["backup_count"]),
        )
        fileh.setFormatter(fmt)
        logger.addHandler(fileh)
    except OSError as exc:
        logger.warning("File logging unavailable: %s", exc)
    return logger
