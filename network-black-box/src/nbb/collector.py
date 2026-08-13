from __future__ import annotations
import argparse
import signal
import time
from .collectors import CollectorEngine
from .config import load_config
from .database import Database
from .health import sample, sample_systemd_service
from .logging_setup import setup_logging

def main(argv=None):
    ap=argparse.ArgumentParser(); ap.add_argument("--config"); ap.add_argument("--once",action="store_true")
    args=ap.parse_args(argv); cfg=load_config(args.config); log=setup_logging(cfg,"collector")
    db=Database(cfg["core"]["database_path"]); db.initialize()
    if db.get_meta("collector_running") == "1":
        db.event("service_recovery","warning","Collector restarted after an unclean stop or host power loss")
    db.set_meta("collector_running","1")
    db.set_meta("collector_last_start",__import__("nbb.utils",fromlist=["utcnow"]).utcnow())
    engine=CollectorEngine(cfg,db,log)
    if args.once:
        engine.discovery_once(); sample(db,cfg); db.set_meta("collector_running","0"); return 0
    def stop(*_): engine.stop()
    signal.signal(signal.SIGTERM,stop); signal.signal(signal.SIGINT,stop)
    engine.start(); last=0
    try:
        while not engine.stop_event.wait(1):
            now=time.monotonic()
            if now-last >= int(cfg["health"]["sample_seconds"]):
                sample(db,cfg)
                sample_systemd_service(db,"network-black-box-web.service","web")
                last=now
    finally:
        engine.stop()
        try: db.set_meta("collector_running","0")
        except Exception: pass
    return 0
if __name__=="__main__": raise SystemExit(main())
