from __future__ import annotations
import argparse
from .config import load_config
from .database import Database
from .logging_setup import setup_logging

def main(argv=None):
    ap=argparse.ArgumentParser(); ap.add_argument("--config"); args=ap.parse_args(argv)
    cfg=load_config(args.config); log=setup_logging(cfg,"maintenance")
    db=Database(cfg["core"]["database_path"]); db.initialize()
    result=db.maintenance(cfg["retention"])
    db.event("database_maintenance","info","Retention maintenance completed",details=result)
    log.info("Retention maintenance: %s",result)
    return 0
if __name__=="__main__": raise SystemExit(main())
