"""Authoritative shared room. All events are serialized under a single lock."""
import copy
import json
import math
import secrets
import threading
import time
from pathlib import Path


class Room:
    def __init__(self, send, token, history_path=None):
        self.send = send
        self.token = token
        self.path = Path(history_path) if history_path else None
        self.lock = threading.RLock()
        self.clients = {}
        self.worker = None
        self.ready = False
        self.active = None
        self.messages = []
        self.draft = ''
        self.scroll = 1.0
        self.revision = 0
        if self.path and self.path.exists():
            try:
                self.messages = json.loads(self.path.read_text())[-100:]
                for m in self.messages:
                    if m.get('status') == 'streaming':
                        m['status'] = 'interrupted'
            except (ValueError, OSError):
                pass

    def snapshot(self):
        return copy.deepcopy(dict(clients=list(self.clients.values()), messages=self.messages,
            draft=self.draft, scroll=self.scroll, revision=self.revision,
            host=next(iter(self.clients), None), modelReady=self.ready,
            active=self.active['id'] if self.active else None))

    def publish(self):
        self.send('room-state', self.snapshot())

    def save(self):
        if self.path:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            tmp = self.path.with_suffix('.tmp')
            tmp.write_text(json.dumps(self.messages))
            tmp.replace(self.path)

    def error(self, sid, message):
        self.send('room-error', {'message': message}, sid)

    def finish(self, status, error=None):
        if not self.active:
            return
        self.messages[-1]['status'] = status
        if error:
            self.messages[-1]['error'] = error
        self.active = None
        self.save()
        self.publish()

    def disconnect(self, sid):
        with self.lock:
            self.clients.pop(sid, None)
            if self.worker == sid:
                self.worker = None
                self.ready = False
                self.finish('interrupted', 'Model host disconnected. Send another message after it reconnects.')
            self.publish()

    def handle(self, event, sid, data):
        if not isinstance(data, dict):
            return
        with self.lock:
            if event == 'worker-register':
                if not self.token or not secrets.compare_digest(str(data.get('token', '')), self.token):
                    return self.error(sid, 'Invalid host token.')
                if self.worker and self.worker != sid:
                    return self.error(sid, 'A model host is already connected.')
                self.worker = sid
                self.ready = data.get('ready') is True
                self.send('worker-accepted', {}, sid)
                self.publish()
                return
            if event == 'worker-status' and sid == self.worker:
                self.ready = data.get('ready') is True
                self.publish()
                return
            if event in ('model-chunk', 'model-done', 'model-error'):
                if sid != self.worker or not self.active or data.get('id') != self.active['id']:
                    return
                self.active['touched'] = time.monotonic()
                if event == 'model-chunk':
                    chunk = data.get('text')
                    if isinstance(chunk, str) and len(chunk) <= 8192:
                        self.messages[-1]['content'] += chunk
                        self.send('chat-chunk', {'id': self.active['id'], 'text': chunk})
                else:
                    self.finish('complete' if event == 'model-done' else 'error', str(data.get('message', 'Inference failed.'))[:500] if event == 'model-error' else None)
                return
            if event == 'join':
                if sid not in self.clients:
                    self.clients[sid] = dict(id=sid, name=str(data.get('name', 'Guest'))[:32] or 'Guest',
                        color=['#83e6bd', '#9aaeff', '#f4b87e', '#f590b5', '#d2b1ff'][len(self.clients) % 5])
                self.publish()
                return
            if sid not in self.clients:
                return
            if event == 'sync':
                self.send('room-state', self.snapshot(), sid)
            elif event == 'cursor-update':
                x, y = data.get('x'), data.get('y')
                if all(isinstance(v, (float, int)) and math.isfinite(v) and 0 <= v <= 1 for v in (x, y)):
                    self.send('cursor-update', dict(id=sid, x=x, y=y, visible=data.get('visible', True)))
            elif event == 'draft-update':
                if data.get('revision') != self.revision:
                    self.send('room-state', self.snapshot(), sid)
                elif isinstance(data.get('text'), str) and len(data['text']) <= 2000:
                    self.draft = data['text']
                    self.revision += 1
                    self.send('draft-state', dict(text=self.draft, revision=self.revision))
            elif event == 'scroll-update':
                value = data.get('value')
                if isinstance(value, (int, float)) and math.isfinite(value) and 0 <= value <= 1:
                    self.scroll = value
                    self.send('scroll-state', {'value': value})
            elif event == 'chat-clear':
                if self.active:
                    self.send('model-cancel', {'id': self.active['id']}, self.worker)
                self.active = None
                self.messages = []
                self.draft = ''
                self.revision += 1
                self.scroll = 1.0
                self.save()
                self.publish()
            elif event == 'chat-stop' and self.active:
                self.send('model-cancel', {'id': self.active['id']}, self.worker)
                self.finish('stopped')
            elif event == 'chat-send':
                if self.active:
                    return self.error(sid, 'A reply is already being generated.')
                if not self.ready or not self.worker:
                    return self.error(sid, 'The laptop model host is offline or still loading.')
                content = data.get('text')
                if not isinstance(content, str) or not content.strip() or len(content) > 2000:
                    return self.error(sid, 'Enter a message of up to 2,000 characters.')
                if data.get('revision') != self.revision or content != self.draft:
                    self.send('room-state', self.snapshot(), sid)
                    return self.error(sid, 'The shared draft changed. Review it and send again.')
                self.messages.append(dict(id=secrets.token_hex(8), role='user', content=content.strip(), name=self.clients[sid]['name'], status='complete'))
                request_id = secrets.token_hex(8)
                # Bound inference history independently of displayed room history.
                context = []
                size = 0
                for m in reversed(self.messages):
                    if m['status'] != 'complete':
                        continue
                    if size + len(m['content']) > 2400:
                        break
                    context.insert(0, dict(role=m['role'], content=m['content']))
                    size += len(m['content'])
                while context and context[0]['role'] != 'user':
                    context.pop(0)
                self.messages.append(dict(id=request_id, role='assistant', content='', status='streaming'))
                self.messages = self.messages[-100:]
                self.active = dict(id=request_id, touched=time.monotonic())
                self.draft = ''
                self.revision += 1
                self.scroll = 1.0
                self.save()
                self.publish()
                self.send('model-request', dict(id=request_id, messages=context), self.worker)

    def tick(self):
        with self.lock:
            if self.active and time.monotonic() - self.active['touched'] > 180:
                self.send('model-cancel', {'id': self.active['id']}, self.worker)
                self.finish('error', 'The model timed out. Check the laptop and try again.')
