from __future__ import annotations
import base64
import hashlib
import hmac
import json
import os
import secrets
from pathlib import Path
from .utils import atomic_write

def create_auth(path: str, username: str = "admin", password: str | None = None) -> str:
    password = password or secrets.token_urlsafe(18)
    salt=secrets.token_bytes(16)
    n=2**14; r=8; p=1
    digest=hashlib.scrypt(password.encode(),salt=salt,n=n,r=r,p=p,dklen=32)
    data={"username":username,"scheme":"scrypt","n":n,"r":r,"p":p,"salt":base64.b64encode(salt).decode(),"hash":base64.b64encode(digest).decode()}
    atomic_write(path,json.dumps(data,indent=2)+"\n",0o640)
    return password

def verify_auth(path: str, username: str, password: str) -> bool:
    try: data=json.loads(Path(path).read_text())
    except (OSError,json.JSONDecodeError): return False
    if not hmac.compare_digest(username,data.get("username","")): return False
    try:
        salt=base64.b64decode(data["salt"]); expected=base64.b64decode(data["hash"])
        got=hashlib.scrypt(password.encode(),salt=salt,n=int(data["n"]),r=int(data["r"]),p=int(data["p"]),dklen=len(expected))
        return hmac.compare_digest(got,expected)
    except Exception: return False

def parse_basic(header: str | None):
    if not header or not header.startswith("Basic "): return None,None
    try:
        raw=base64.b64decode(header[6:]).decode("utf-8")
        return tuple(raw.split(":",1))
    except Exception: return None,None
