#!/usr/bin/env python3
"""Small helper that runs inside the Relay VM.

It starts allowlisted CLIs with the account already logged in on this machine.
It does not read, store, or type passwords.
"""

import json
import subprocess
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ALLOW = {"claude", "cursor-agent", "agent"}


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/health":
            self._send(200, {"ok": True, "service": "relay-guest"})
            return
        self._send(404, {"error": "not found"})

    def do_POST(self):
        if self.path != "/cli":
            self._send(404, {"error": "not found"})
            return
        length = int(self.headers.get("content-length", "0"))
        try:
            body = json.loads(self.rfile.read(length) or b"{}")
        except json.JSONDecodeError:
            self._send(400, {"error": "bad json"})
            return
        program = body.get("bin")
        if program not in ALLOW:
            self._send(400, {"error": "command not allowlisted"})
            return
        args = body.get("args") or []
        if not isinstance(args, list) or any(not isinstance(item, str) for item in args):
            self._send(400, {"error": "bad args"})
            return
        try:
            completed = subprocess.run(
                [program, *args],
                input=body.get("input") or "",
                text=True,
                capture_output=True,
                timeout=int(body.get("timeoutSec") or 600),
                cwd=body.get("cwd") or "/home/relay",
            )
        except FileNotFoundError:
            self._send(200, {"code": 127, "stdout": "", "stderr": f"{program} is not installed in the VM"})
            return
        except subprocess.TimeoutExpired:
            self._send(200, {"code": 124, "stdout": "", "stderr": "timed out"})
            return
        self._send(200, {"code": completed.returncode, "stdout": completed.stdout[-20000:], "stderr": completed.stderr[-4000:]})

    def _send(self, status, payload):
        raw = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def log_message(self, fmt, *args):
        return


if __name__ == "__main__":
    ThreadingHTTPServer(("0.0.0.0", 43125), Handler).serve_forever()
