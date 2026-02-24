#!/usr/bin/env python3
"""Simple Wyze camera API server for Drift plugin.

No Docker, no TUTK — just talks to Wyze cloud API for:
- Camera list with thumbnails
- Camera controls (power on/off, restart)
- Device info & properties
- WebRTC signaling for live video (via Wyze/AWS Kinesis)
"""

import hashlib
import json
import os
import re
import sys
import time
import urllib.parse
import uuid
from pathlib import Path

import requests
from flask import Flask, Response, jsonify, request
from flask_cors import CORS

# ── Config ──────────────────────────────────────────────────────────────────

APP_VERSION = "3.1.0.6"
IOS_VERSION = "17.1.1"
USER_AGENT = f"Wyze/{APP_VERSION} (iPhone; iOS {IOS_VERSION}; Scale/3.00)"
AUTH_API = "https://auth-prod.api.wyze.com"
WYZE_API = "https://api.wyzecam.com/app"

SC_SV = {
    "default": {"sc": "9f275790cab94a72bd206c8876429f3c", "sv": "e1fe392906d54888a9b99b88de4162d7"},
    "run_action": {"sc": "01dd431d098546f9baf5233724fa2ee2", "sv": "2c0edc06d4c5465b8c55af207144f0d9"},
    "get_device_Info": {"sc": "01dd431d098546f9baf5233724fa2ee2", "sv": "0bc2c3bedf6c4be688754c9ad42bbf2e"},
    "set_device_Info": {"sc": "01dd431d098546f9baf5233724fa2ee2", "sv": "e8e1db44128f4e31a2047a8f5f80b2bd"},
}

MODEL_NAMES = {
    "WYZEC1": "V1", "WYZEC1-JZ": "V2", "WYZE_CAKP2JFUS": "V3", "HL_CAM4": "V4",
    "HL_CAM3P": "V3 Pro", "WYZECP1_JEF": "Pan", "HL_PAN2": "Pan V2", "HL_PAN3": "Pan V3",
    "HL_PANP": "Pan Pro", "HL_CFL2": "Floodlight V2", "WYZEDB3": "Doorbell",
    "HL_DB2": "Doorbell V2", "GW_BE1": "Doorbell Pro", "AN_RDB1": "Doorbell Pro 2",
    "GW_GC1": "OG", "GW_GC2": "OG 3X", "WVOD1": "Outdoor", "HL_WCO2": "Outdoor V2",
    "AN_RSCW": "Battery Cam Pro", "LD_CFP": "Floodlight Pro",
}

PAN_CAMS = {"WYZECP1_JEF", "HL_PAN2", "HL_PAN3", "HL_PANP"}
PRO_CAMS = {"HL_CAM3P", "HL_PANP", "HL_CAM4", "HL_DB2", "HL_CFL2"}

# ── State ───────────────────────────────────────────────────────────────────

_creds = None  # WyzeCredential dict
_cameras = []  # cached camera list
_cameras_ts = 0  # last fetch timestamp
CACHE_TTL = 120  # refresh cameras every 2 minutes
TOKEN_FILE = Path(__file__).parent / ".wyze_tokens.json"


# ── Wyze API helpers ────────────────────────────────────────────────────────

def _hash_password(password: str) -> str:
    encoded = password.strip()
    for prefix in ("hashed:", "md5:"):
        if encoded.lower().startswith(prefix):
            return encoded[len(prefix):]
    for _ in range(3):
        encoded = hashlib.md5(encoded.encode("ascii")).hexdigest()
    return encoded


def _headers(phone_id=None, key_id=None, api_key=None):
    if not phone_id:
        return {"user-agent": USER_AGENT, "appversion": APP_VERSION, "env": "prod"}
    if key_id and api_key:
        return {"apikey": api_key, "keyid": key_id, "user-agent": f"wyze-drift-server/1.0"}
    return {
        "x-api-key": "WMXHYf79Nr5gIlt3r0r7p9Tcw5bvs6BB4U8O8nGJ",
        "phone-id": phone_id,
        "user-agent": f"wyze_ios_{APP_VERSION}",
    }


def _payload(endpoint="default"):
    values = SC_SV.get(endpoint, SC_SV["default"])
    return {
        "sc": values["sc"], "sv": values["sv"],
        "app_ver": f"com.hualai.WyzeCam___{APP_VERSION}",
        "app_version": APP_VERSION, "app_name": "com.hualai.WyzeCam",
        "phone_system_type": 1, "ts": int(time.time() * 1000),
        "access_token": _creds["access_token"],
        "phone_id": _creds["phone_id"],
    }


def _validate(resp):
    data = resp.json()
    code = str(data.get("code", data.get("errorCode", 0)))
    if code == "2001":
        _refresh_token()
        raise TokenRefreshed()
    if code not in ("1", "0"):
        msg = data.get("msg", data.get("description", code))
        raise Exception(f"Wyze API error: {code} - {msg}")
    return data.get("data", data)


class TokenRefreshed(Exception):
    pass


def _save_tokens():
    TOKEN_FILE.write_text(json.dumps(_creds, indent=2))


def _load_tokens():
    global _creds
    if TOKEN_FILE.exists():
        _creds = json.loads(TOKEN_FILE.read_text())
        return True
    return False


def wyze_login(email, password, api_key, key_id):
    global _creds
    phone_id = str(uuid.uuid4())
    headers = _headers(phone_id, key_id=key_id, api_key=api_key)
    payload = {"email": email.strip(), "password": _hash_password(password)}
    resp = requests.post(f"{AUTH_API}/api/user/login", json=payload, headers=headers)
    data = _validate(resp)
    data["phone_id"] = phone_id
    _creds = data
    _save_tokens()
    return data


def _refresh_token():
    global _creds
    payload = _payload()
    payload["refresh_token"] = _creds["refresh_token"]
    resp = requests.post(f"{WYZE_API}/user/refresh_token", json=payload, headers=_headers())
    data = _validate(resp)
    _creds["access_token"] = data.get("access_token", _creds["access_token"])
    _creds["refresh_token"] = data.get("refresh_token", _creds["refresh_token"])
    _save_tokens()


def _name_uri(nickname, mac):
    name = nickname or mac
    uri = re.sub(r"[^\-\w+]", "", name.strip().replace(" ", "-")).lower()
    return uri.encode("ascii", "ignore").decode()


def fetch_cameras():
    global _cameras, _cameras_ts
    if not _creds:
        return []
    now = time.time()
    if _cameras and (now - _cameras_ts) < CACHE_TTL:
        return _cameras

    try:
        resp = requests.post(
            f"{WYZE_API}/v2/home_page/get_object_list",
            json=_payload(), headers=_headers(),
        )
        data = _validate(resp)
    except TokenRefreshed:
        resp = requests.post(
            f"{WYZE_API}/v2/home_page/get_object_list",
            json=_payload(), headers=_headers(),
        )
        data = _validate(resp)

    cameras = []
    for dev in data.get("device_list", []):
        if dev.get("product_type") != "Camera":
            continue
        mac = dev.get("mac")
        model = dev.get("product_model")
        if not mac or not model:
            continue

        params = dev.get("device_params", {})
        thumbs = params.get("camera_thumbnails", {})
        nickname = dev.get("nickname", mac)

        cameras.append({
            "mac": mac,
            "nickname": nickname,
            "name_uri": _name_uri(nickname, mac),
            "model": model,
            "model_name": MODEL_NAMES.get(model, model),
            "firmware_ver": dev.get("firmware_ver"),
            "ip": params.get("ip"),
            "thumbnail": thumbs.get("thumbnails_url"),
            "is_pan": model in PAN_CAMS,
            "is_2k": model in PRO_CAMS,
            "online": dev.get("device_conn_state", 0) == 1,
        })

    _cameras = cameras
    _cameras_ts = now
    return cameras


def run_action(mac, model, action):
    payload = dict(
        _payload("run_action"),
        action_params={}, action_key=action,
        instance_id=mac, provider_key=model, custom_string="",
    )
    try:
        resp = requests.post(f"{WYZE_API}/v2/auto/run_action", json=payload, headers=_headers())
        return _validate(resp)
    except TokenRefreshed:
        payload.update(_payload("run_action"))
        resp = requests.post(f"{WYZE_API}/v2/auto/run_action", json=payload, headers=_headers())
        return _validate(resp)


def set_property(mac, model, pid, pvalue):
    params = {
        "pid": pid.upper(), "pvalue": str(pvalue),
        "device_mac": mac, "device_model": model,
    }
    params.update(_payload("set_device_Info"))
    try:
        resp = requests.post(f"{WYZE_API}/v2/device/set_property", json=params, headers=_headers())
        return _validate(resp)
    except TokenRefreshed:
        params.update(_payload("set_device_Info"))
        resp = requests.post(f"{WYZE_API}/v2/device/set_property", json=params, headers=_headers())
        return _validate(resp)


def get_device_info(mac, model):
    params = {"device_mac": mac, "device_model": model}
    params.update(_payload("get_device_Info"))
    try:
        resp = requests.post(f"{WYZE_API}/v2/device/get_device_Info", json=params, headers=_headers())
        return _validate(resp)
    except TokenRefreshed:
        params.update(_payload("get_device_Info"))
        resp = requests.post(f"{WYZE_API}/v2/device/get_device_Info", json=params, headers=_headers())
        return _validate(resp)


def get_webrtc_signaling(mac):
    """Get WebRTC signaling data for a camera (via Wyze/AWS Kinesis)."""
    headers = _headers()
    headers["content-type"] = "application/json"
    headers["authorization"] = f"Bearer {_creds['access_token']}"
    try:
        resp = requests.get(
            f"https://webrtc.api.wyze.com/signaling/device/{mac}?use_trickle=true",
            headers=headers,
        )
        data = _validate(resp)
    except TokenRefreshed:
        headers["authorization"] = f"Bearer {_creds['access_token']}"
        resp = requests.get(
            f"https://webrtc.api.wyze.com/signaling/device/{mac}?use_trickle=true",
            headers=headers,
        )
        data = _validate(resp)

    # Normalize server URLs and resolve hostnames to IPs.
    # AWS Kinesis TURN servers use hostnames like "54-201-33-198.t-xxx.kinesisvideo..."
    # which embed the IP as hyphened octets. Electron's network resolver fails on these
    # (ERR_NAME_NOT_RESOLVED), so we extract the IP directly from the hostname.
    for s in data.get("results", {}).get("servers", []):
        if "url" in s:
            s["urls"] = s.pop("url")
        urls = s.get("urls", "")
        # Replace hyphened-IP hostnames with actual IPs
        # Pattern: turn(s):A-B-C-D.t-xxxxx.kinesisvideo...:port -> turn(s):A.B.C.D:port...
        m = re.match(r'^(turns?:)(\d+)-(\d+)-(\d+)-(\d+)\.t-[^:]+(:.*)', urls)
        if m:
            s["urls"] = f"{m.group(1)}{m.group(2)}.{m.group(3)}.{m.group(4)}.{m.group(5)}{m.group(6)}"

    return {
        "ClientId": _creds["phone_id"],
        "signalingUrl": urllib.parse.unquote(data["results"]["signalingUrl"]),
        "servers": data["results"]["servers"],
    }


# ── Flask app ───────────────────────────────────────────────────────────────

app = Flask(__name__)
CORS(app)


def _find_camera(name_uri):
    cameras = fetch_cameras()
    for cam in cameras:
        if cam["name_uri"] == name_uri:
            return cam
    return None


@app.route("/api")
def api_cameras():
    cameras = fetch_cameras()
    return jsonify(cameras)


@app.route("/api/<name_uri>")
def api_camera_detail(name_uri):
    cam = _find_camera(name_uri)
    if not cam:
        return jsonify({"error": "Camera not found"}), 404
    return jsonify(cam)


@app.route("/api/<name_uri>/info")
def api_camera_info(name_uri):
    cam = _find_camera(name_uri)
    if not cam:
        return jsonify({"error": "Camera not found"}), 404
    try:
        info = get_device_info(cam["mac"], cam["model"])
        return jsonify(info)
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/<name_uri>/<action>", methods=["GET", "POST", "PUT"])
def api_camera_action(name_uri, action):
    cam = _find_camera(name_uri)
    if not cam:
        return jsonify({"error": "Camera not found"}), 404

    # Property settings
    PROP_MAP = {
        "status_light": "P1", "night_vision": "P2",
        "motion_detection": "P13", "motion_tracking": "P27",
    }
    if action in PROP_MAP:
        value = request.args.get("value", "1")
        try:
            result = set_property(cam["mac"], cam["model"], PROP_MAP[action], value)
            return jsonify({"status": "success", "result": result})
        except Exception as e:
            return jsonify({"error": str(e)}), 500

    # Run actions
    ACTIONS = {"power_on": "power_on", "power_off": "power_off",
               "turn_on": "power_on", "turn_off": "power_off", "restart": "restart"}
    action_key = ACTIONS.get(action, action)
    try:
        result = run_action(cam["mac"], cam["model"], action_key)
        return jsonify({"status": "success", "result": result})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/refresh")
def api_refresh():
    global _cameras_ts
    _cameras_ts = 0
    cameras = fetch_cameras()
    return jsonify(cameras)


@app.route("/signaling/<name_uri>")
def api_signaling(name_uri):
    """Get WebRTC signaling data for live video streaming."""
    cam = _find_camera(name_uri)
    if not cam:
        return jsonify({"error": "Camera not found", "result": "error"}), 404
    try:
        signal = get_webrtc_signaling(cam["mac"])
        signal["result"] = "ok"
        signal["cam"] = name_uri
        return jsonify(signal)
    except Exception as e:
        return jsonify({"error": str(e), "result": "error", "cam": name_uri}), 500


@app.route("/thumb/<name_uri>")
def api_thumbnail(name_uri):
    cam = _find_camera(name_uri)
    if not cam or not cam.get("thumbnail"):
        return jsonify({"error": "No thumbnail"}), 404
    # Proxy the signed thumbnail URL
    try:
        resp = requests.get(cam["thumbnail"], timeout=5)
        if resp.status_code == 200:
            return Response(resp.content, content_type=resp.headers.get("content-type", "image/jpeg"))
    except Exception:
        pass
    # If signed URL expired, force refresh camera list for fresh URLs
    global _cameras_ts
    _cameras_ts = 0
    cameras = fetch_cameras()
    cam = next((c for c in cameras if c["name_uri"] == name_uri), None)
    if cam and cam.get("thumbnail"):
        try:
            resp = requests.get(cam["thumbnail"], timeout=5)
            if resp.status_code == 200:
                return Response(resp.content, content_type=resp.headers.get("content-type", "image/jpeg"))
        except Exception:
            pass
    return jsonify({"error": "Thumbnail unavailable"}), 404


@app.route("/health")
def health():
    return jsonify({"status": "ok", "authenticated": _creds is not None, "cameras": len(_cameras)})


# ── Main ────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    email = os.environ.get("WYZE_EMAIL")
    password = os.environ.get("WYZE_PASSWORD")
    api_key = os.environ.get("API_KEY")
    api_id = os.environ.get("API_ID")
    port = int(os.environ.get("PORT", "5050"))

    if _load_tokens():
        print(f"[wyze-server] Loaded cached tokens")
        try:
            cameras = fetch_cameras()
            print(f"[wyze-server] Found {len(cameras)} cameras")
        except Exception:
            print("[wyze-server] Cached tokens expired, re-authenticating...")
            _creds = None

    if not _creds:
        if not all([email, password, api_key, api_id]):
            print("ERROR: Set WYZE_EMAIL, WYZE_PASSWORD, API_KEY, API_ID env vars")
            sys.exit(1)
        print("[wyze-server] Authenticating with Wyze...")
        wyze_login(email, password, api_key, api_id)
        cameras = fetch_cameras()
        print(f"[wyze-server] Found {len(cameras)} cameras:")
        for c in cameras:
            print(f"  - {c['nickname']} ({c['model_name']}) {'🟢' if c['online'] else '⚫'}")

    print(f"[wyze-server] Starting on port {port}")
    app.run(host="0.0.0.0", port=port, debug=False)
