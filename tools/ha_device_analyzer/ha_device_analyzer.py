#!/usr/bin/env python3
"""Standalone, read-only Home Assistant Device Intelligence Analyzer."""
from __future__ import annotations
import argparse, base64, json, os, socket, ssl, struct, sys, urllib.parse, urllib.request
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path

ELECTRICAL_CLASSES = {
    "power": "power", "energy": "energy", "current": "current",
    "voltage": "voltage", "apparent_power": "apparent_power",
    "reactive_power": "reactive_power", "power_factor": "power_factor",
    "reactive_energy": "reactive_energy",
}
UNIT_CLASSES = {
    "W": "power", "kW": "power", "MW": "power",
    "Wh": "energy", "kWh": "energy", "MWh": "energy",
    "A": "current", "mA": "current", "V": "voltage", "mV": "voltage",
    "VA": "apparent_power", "kVA": "apparent_power",
    "var": "reactive_power", "kvar": "reactive_power",
    "varh": "reactive_energy", "kvarh": "reactive_energy",
}
UNKNOWN_STATES = {"unknown", "unavailable", None}

def iso(ts):
    return None if ts is None else datetime.fromtimestamp(ts, timezone.utc).isoformat()

def parse_float(v):
    try: return float(v)
    except (TypeError, ValueError): return None

class HAWebSocket:
    def __init__(self, url, token, timeout=30):
        p = urllib.parse.urlparse(url.rstrip("/") + "/api/websocket")
        scheme = "wss" if p.scheme in ("https", "wss") else "ws"
        self.host, self.port = p.hostname, p.port or (443 if scheme == "wss" else 80)
        self.path, self.timeout, self.token = p.path or "/api/websocket", timeout, token
        self.sock = socket.create_connection((self.host, self.port), timeout=timeout)
        if scheme == "wss":
            self.sock = ssl.create_default_context().wrap_socket(self.sock, server_hostname=self.host)
        key = base64.b64encode(os.urandom(16)).decode()
        req = (f"GET {self.path} HTTP/1.1\r\nHost: {self.host}:{self.port}\r\n"
               "Upgrade: websocket\r\nConnection: Upgrade\r\n"
               f"Sec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n")
        self.sock.sendall(req.encode())
        raw = b""
        while b"\r\n\r\n" not in raw:
            raw += self.sock.recv(4096)
        if b" 101 " not in raw.split(b"\r\n\r\n", 1)[0]:
            raise RuntimeError("WebSocket handshake failed")
        if self.recv().get("type") != "auth_required":
            raise RuntimeError("Unexpected Home Assistant WebSocket greeting")
        self.send({"type": "auth", "access_token": token})
        if self.recv().get("type") != "auth_ok":
            raise RuntimeError("Home Assistant authentication failed")
        self.msg_id = 0

    def frame(self, payload):
        mask = os.urandom(4)
        n = len(payload)
        if n < 126: head = bytes([0x81, 0x80 | n])
        elif n < 65536: head = bytes([0x81, 0x80 | 126]) + struct.pack("!H", n)
        else: head = bytes([0x81, 0x80 | 127]) + struct.pack("!Q", n)
        return head + mask + bytes(b ^ mask[i % 4] for i, b in enumerate(payload))

    def send(self, value):
        payload = json.dumps(value, separators=(",", ":")).encode()
        self.sock.sendall(self.frame(payload))

    def recv(self):
        while True:
            h = self._read(2); b1, b2 = h
            opcode, n = b1 & 15, b2 & 127
            if n == 126: n = struct.unpack("!H", self._read(2))[0]
            elif n == 127: n = struct.unpack("!Q", self._read(8))[0]
            mask = self._read(4) if b2 & 128 else None
            payload = self._read(n)
            if mask: payload = bytes(b ^ mask[i % 4] for i, b in enumerate(payload))
            if opcode == 8: raise RuntimeError("Home Assistant WebSocket closed")
            if opcode == 9:
                self.send(payload.decode())
                continue
            if opcode == 1: return json.loads(payload.decode())

    def _read(self, n):
        out = b""
        while len(out) < n:
            chunk = self.sock.recv(n - len(out))
            if not chunk: raise RuntimeError("WebSocket connection closed")
            out += chunk
        return out

    def command(self, typ, **kwargs):
        self.msg_id += 1
        self.send({"id": self.msg_id, "type": typ, **kwargs})
        while True:
            r = self.recv()
            if r.get("id") != self.msg_id: continue
            if not r.get("success"): raise RuntimeError(str(r.get("error", r)))
            return r.get("result")

    def close(self):
        try: self.sock.close()
        except OSError: pass

def http_json(base, token, path, params):
    url = base.rstrip("/") + path + "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"Authorization": "Bearer " + token})
    with urllib.request.urlopen(req, timeout=60) as r: return json.load(r)

def measurement_class(state):
    attrs = (state or {}).get("attributes", {})
    dc, unit = attrs.get("device_class"), attrs.get("unit_of_measurement")
    if dc in ELECTRICAL_CLASSES: return ELECTRICAL_CLASSES[dc]
    if unit in UNIT_CLASSES: return UNIT_CLASSES[unit]
    return None

def history_stats(rows):
    obs, unavailable, unknown = [], 0, 0
    for r in rows:
        if r.get("state") == "unavailable": unavailable += 1
        elif r.get("state") == "unknown": unknown += 1
        v = parse_float(r.get("state"))
        t = r.get("last_changed") or r.get("last_updated")
        try: t = datetime.fromisoformat(t.replace("Z", "+00:00")).timestamp()
        except Exception: t = None
        if v is not None and t is not None: obs.append((t, v))
    obs.sort()
    if not obs: return {"samples": 0, "unavailable_count": unavailable, "unknown_count": unknown}
    vals = [v for _, v in obs]
    gaps = [obs[i][0] - obs[i-1][0] for i in range(1, len(obs))]
    changes = sum(obs[i][1] != obs[i-1][1] for i in range(1, len(obs)))
    return {
        "samples": len(obs), "first_sample": iso(obs[0][0]), "last_sample": iso(obs[-1][0]),
        "min": min(vals), "max": max(vals),
        "zero_percent": round(100 * sum(v == 0 for v in vals) / len(vals), 2),
        "identical_reading_percent": round(100 * (1 - changes / max(1, len(vals)-1)), 2),
        "distinct_values": len(set(vals)),
        "longest_gap_seconds": round(max(gaps), 3) if gaps else 0,
        "median_update_seconds": round(sorted(gaps)[len(gaps)//2], 3) if gaps else None,
        "unavailable_count": unavailable, "unknown_count": unknown,
        "possible_rounding": len(set(vals)) < min(20, len(vals) / 4),
    }

def main():
    ap = argparse.ArgumentParser(description="Read-only Home Assistant Device Intelligence Analyzer V1")
    ap.add_argument("--url", default=os.getenv("HA_URL"))
    ap.add_argument("--token", default=os.getenv("HA_TOKEN"))
    ap.add_argument("--hours", type=float, default=0, help="Hours of history to analyze; 0 disables history (default)")
    ap.add_argument("--out", default="ha-device-analyzer-v1.json")
    a = ap.parse_args()
    if not a.url or not a.token: ap.error("Provide --url and --token, or set HA_URL and HA_TOKEN")

    ws = HAWebSocket(a.url, a.token)
    try:
        devices = ws.command("config/device_registry/list")
        entities = ws.command("config/entity_registry/list")
        areas = ws.command("config/area_registry/list")
        states = ws.command("get_states")
    finally: ws.close()

    states_by_id = {x["entity_id"]: x for x in states}
    candidates = [e["entity_id"] for e in entities if measurement_class(states_by_id.get(e["entity_id"]))]
    history = {}
    end, start = datetime.now(timezone.utc), datetime.now(timezone.utc) - timedelta(hours=a.hours)

    for i, eid in enumerate(candidates, 1):
        try:
            rows = http_json(a.url, a.token, "/api/history/period", {
                "start_time": start.isoformat(), "end_time": end.isoformat(),
                "filter_entity_id": eid, "minimal_response": "false", "no_attributes": "true",
            })
            history[eid] = history_stats(rows[0] if rows else [])
            print(f"[{i}/{len(candidates)}] {eid}", file=sys.stderr)
        except Exception as exc:
            history[eid] = {"error": str(exc)}

    area_by_id = {x["id"]: x for x in areas}
    device_by_id = {x["id"]: x for x in devices}
    entities_by_device = defaultdict(list)
    entity_rows = []

    for e in entities:
        eid, st = e["entity_id"], states_by_id.get(e["entity_id"])
        attrs = (st or {}).get("attributes", {})
        cls = measurement_class(st)
        row = {
            "entity_id": eid, "domain": eid.split(".", 1)[0], "platform": e.get("platform"),
            "unique_id": e.get("unique_id"), "device_id": e.get("device_id"),
            "area_id": e.get("area_id"), "area": area_by_id.get(e.get("area_id"), {}).get("name"),
            "name": e.get("name") or e.get("original_name"), "entity_category": e.get("entity_category"),
            "disabled_by": e.get("disabled_by"), "hidden_by": e.get("hidden_by"),
            "measurement_class": cls, "state": st.get("state") if st else None,
            "available": bool(st and st.get("state") not in UNKNOWN_STATES),
            "attributes": {k: attrs.get(k) for k in (
                "device_class", "state_class", "unit_of_measurement", "last_reset",
                "suggested_display_precision", "display_precision") if attrs.get(k) is not None},
            "history": history.get(eid),
        }
        entity_rows.append(row)
        if e.get("device_id"): entities_by_device[e["device_id"]].append(row)

    device_rows = []
    for d in devices:
        did = d["id"]; parent = device_by_id.get(d.get("parent_device_id"), {})
        area_id = d.get("area_id") or (parent.get("area_id") if d.get("parent_device_id") else None)
        linked = entities_by_device.get(did, [])
        device_rows.append({
            "device_id": did, "name": d.get("name"), "name_by_user": d.get("name_by_user"),
            "manufacturer": d.get("manufacturer"), "model": d.get("model"), "model_id": d.get("model_id"),
            "area_id": area_id, "area": area_by_id.get(area_id, {}).get("name"),
            "config_entry_id": d.get("config_entry_id"), "config_subentry_id": d.get("config_subentry_id"),
            "parent_device_id": d.get("parent_device_id"), "via_device_id": d.get("via_device_id"),
            "child_device": d.get("parent_device_id") is not None,
            "entities": [x["entity_id"] for x in linked],
            "measurement_candidates": [{
                "entity_id": x["entity_id"], "class": x["measurement_class"],
                "unit": x["attributes"].get("unit_of_measurement"),
                "device_class": x["attributes"].get("device_class"),
                "state_class": x["attributes"].get("state_class"),
            } for x in linked if x["measurement_class"]],
        })

    report = {
        "schema": "ha-device-intelligence-v1",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "home_assistant_url": a.url.rstrip("/"),
        "scope": {"read_only": True, "energyiq_dependency": False, "history_hours": a.hours},
        "summary": {
            "devices": len(device_rows), "entities": len(entity_rows),
            "measurement_entities": sum(bool(x["measurement_class"]) for x in entity_rows),
            "power_entities": sum(x["measurement_class"] == "power" for x in entity_rows),
            "energy_entities": sum(x["measurement_class"] == "energy" for x in entity_rows),
            "history_candidates": len(candidates),
        },
        "devices": device_rows, "entities": entity_rows,
    }
    Path(a.out).write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report["summary"], indent=2))

if __name__ == "__main__":
    main()
