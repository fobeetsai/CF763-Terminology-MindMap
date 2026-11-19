import asyncio
import hashlib
import json
import os
import socket
import sys
import threading
import urllib.parse
import webbrowser
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

try:
    import edge_tts
except ImportError:
    edge_tts = None

APP_DIR = os.path.dirname(os.path.abspath(__file__))
CACHE_DIR = os.path.join(APP_DIR, "tts_cache")
os.makedirs(CACHE_DIR, exist_ok=True)

ALLOWED_VOICES = {
    "ja-JP-NanamiNeural": "ja",
    "ja-JP-KeitaNeural": "ja",
    "zh-TW-HsiaoChenNeural": "zh",
    "zh-TW-YunJheNeural": "zh",
}

DEFAULT_VOICE = {
    "ja": "ja-JP-NanamiNeural",
    "zh": "zh-TW-HsiaoChenNeural",
}

_gen_locks = {}
_locks_guard = threading.Lock()


def get_key_lock(key: str) -> threading.Lock:
    with _locks_guard:
        lock = _gen_locks.get(key)
        if lock is None:
            lock = threading.Lock()
            _gen_locks[key] = lock
        return lock


def normalize_rate(rate_str: str) -> str:
    try:
        val = float(rate_str)
    except (TypeError, ValueError):
        return "+0%"
    val = max(0.5, min(1.8, val))
    pct = int(round((val - 1.0) * 100))
    return f"+{pct}%" if pct >= 0 else f"{pct}%"


async def synthesize_to_file(text: str, voice: str, rate: str, out_path: str):
    comm = edge_tts.Communicate(text=text, voice=voice, rate=rate)
    tmp_path = out_path + ".tmp"
    await comm.save(tmp_path)
    os.replace(tmp_path, out_path)


class AppHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=APP_DIR, **kwargs)

    def log_message(self, format, *args):
        # Keep console output clean
        if args and str(args[1]).startswith(("4", "5")):
            super().log_message(format, *args)

    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        super().end_headers()

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/api/health":
            self.handle_health()
            return
        if parsed.path == "/api/tts":
            self.handle_tts(parsed.query)
            return
        super().do_GET()

    def handle_health(self):
        payload = {
            "ok": edge_tts is not None,
            "engine": "edge-tts" if edge_tts is not None else "unavailable",
            "voices": list(ALLOWED_VOICES.keys()),
        }
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def handle_tts(self, query: str):
        if edge_tts is None:
            self.send_error(HTTPStatus.SERVICE_UNAVAILABLE, "edge-tts not installed")
            return

        params = urllib.parse.parse_qs(query)
        text = (params.get("text", [""])[0] or "").strip()
        lang = (params.get("lang", ["ja"])[0] or "ja").strip().lower()
        voice = (params.get("voice", [""])[0] or "").strip()
        rate = normalize_rate(params.get("rate", ["1.0"])[0])

        if not text:
            self.send_error(HTTPStatus.BAD_REQUEST, "Missing text parameter")
            return
        if len(text) > 500:
            text = text[:500]

        if voice not in ALLOWED_VOICES:
            voice = DEFAULT_VOICE.get(lang, "ja-JP-NanamiNeural")

        cache_key = hashlib.sha256(f"{voice}|{rate}|{text}".encode("utf-8")).hexdigest()
        cache_path = os.path.join(CACHE_DIR, f"{cache_key}.mp3")

        lock = get_key_lock(cache_key)
        try:
            with lock:
                if not os.path.exists(cache_path) or os.path.getsize(cache_path) == 0:
                    asyncio.run(synthesize_to_file(text, voice, rate, cache_path))
            with open(cache_path, "rb") as f:
                audio_bytes = f.read()
        except Exception as exc:
            msg = json.dumps({"error": str(exc)}, ensure_ascii=False).encode("utf-8")
            self.send_response(HTTPStatus.INTERNAL_SERVER_ERROR)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(msg)))
            self.end_headers()
            self.wfile.write(msg)
            return

        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "audio/mpeg")
        self.send_header("Content-Length", str(len(audio_bytes)))
        self.send_header("Cache-Control", "public, max-age=31536000")
        self.end_headers()
        self.wfile.write(audio_bytes)


def find_free_port(start_port: int = 8763) -> int:
    for port in range(start_port, start_port + 30):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            try:
                s.bind(("127.0.0.1", port))
                return port
            except OSError:
                continue
    return 0


def main():
    no_browser = "--no-browser" in sys.argv
    port = find_free_port(8763)
    server = ThreadingHTTPServer(("127.0.0.1", port), AppHandler)
    url = f"http://127.0.0.1:{port}/index.html"
    print(f"[CF763 術語互動複習與心智圖] 本機微軟神經語音伺服器已啟動：{url}")
    print(f"TTS 引擎狀態：{'edge-tts (Microsoft Neural Voices) 就緒' if edge_tts else '未安裝 edge-tts'}")
    print("關閉此視窗即可停止伺服器。")
    if not no_browser:
        threading.Timer(0.6, lambda: webbrowser.open(url)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
