import time
from pathlib import Path
from arduino.app_utils import App
from arduino.app_bricks.web_ui import WebUI
from room import Room

web_ui = WebUI()
token_path = Path('/app/.cache/openchat-host-token')
room = Room(web_ui.send_message, token_path.read_text().strip() if token_path.exists() else '', '/app/.cache/openchat-history.json')
web_ui.on_disconnect(room.disconnect)
for event in ('join', 'sync', 'worker-register', 'worker-status', 'model-chunk', 'model-done',
              'model-error', 'cursor-update', 'draft-update', 'scroll-update', 'chat-send', 'chat-stop', 'chat-clear'):
    # Keep each ordered Socket.IO event on the event loop. WebUI's generic
    # callbacks run in worker threads, which can reorder streamed text chunks.
    async def receive(sid, data, event=event):
        room.handle(event, sid, data)
    web_ui.sio.on(event)(receive)

def loop():
    room.tick()
    time.sleep(1)

App.run(user_loop=loop)
