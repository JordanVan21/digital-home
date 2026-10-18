"""
Headless stand-in for the Blender MCP addon: speaks the same TCP JSON protocol, so
BlenderMcpClient works against `blender -b` with no GUI session.

    blender -b --factory-startup -P blender_server.py -- [--port 9876]

Mirrors the real addon (ahujasid/blender-mcp addon.py v1.8): one JSON request per connection,
{"type": "execute_code", "params": {"code": "..."}} -> {"status": "success", "result": {"executed": true,
"result": "<stdout>"}}; failures -> {"status": "error", "message": "<json: exception_type, message, traceback>"}.
Like the addon, every execute_code call runs in a FRESH namespace containing only `bpy`: Python variables do
not persist between calls, scene data does. Also supports ping and get_scene_info; every other command
answers "Unknown command type", which makes the client fall back (e.g. from export_scene to a script).
{"type": "quit"} stops the server. It executes whatever code it receives, so it only listens on 127.0.0.1.
"""
import contextlib
import io
import json
import socket
import sys
import traceback

port = 9876
if "--" in sys.argv:
    extra = sys.argv[sys.argv.index("--") + 1:]
    if "--port" in extra:
        port = int(extra[extra.index("--port") + 1])

def handle(request):
    kind = request.get("type")
    params = request.get("params") or {}
    if kind == "ping":
        return {"status": "success", "result": {"pong": True}}
    if kind == "execute_code":
        import bpy
        out = io.StringIO()
        try:
            with contextlib.redirect_stdout(out):
                exec(params.get("code", ""), {"bpy": bpy})
            return {"status": "success", "result": {"executed": True, "result": out.getvalue()}}
        except Exception as e:
            return {"status": "error", "message": json.dumps({"exception_type": type(e).__name__, "message": str(e), "traceback": traceback.format_exc()})}
    if kind == "get_scene_info":
        import bpy
        return {"status": "success", "result": {"objects": [o.name for o in bpy.data.objects]}}
    return {"status": "error", "message": "Unknown command type: %s" % kind}


server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
server.bind(("127.0.0.1", port))
server.listen(4)
print("house blender server listening on 127.0.0.1:%d" % port, flush=True)
running = True
while running:
    conn, _ = server.accept()
    with conn:
        data = b""
        request = None
        while request is None:
            chunk = conn.recv(65536)
            if not chunk:
                break
            data += chunk
            try:
                request = json.loads(data.decode("utf-8"))
            except ValueError:
                continue
        if request is None:
            continue
        if request.get("type") == "quit":
            conn.sendall(json.dumps({"status": "success", "result": "bye"}).encode("utf-8"))
            running = False
            continue
        conn.sendall(json.dumps(handle(request)).encode("utf-8"))
server.close()
