import sys
import tempfile
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'board/python'))
from room import Room


class RoomTests(unittest.TestCase):
    def setUp(self):
        self.events = []
        self.room = Room(lambda *args: self.events.append(args), 'secret')
        self.room.handle('join', 'a', {'name': 'Alice'})
        self.room.handle('join', 'b', {'name': 'Bob'})
        self.room.handle('worker-register', 'worker', {'token': 'secret', 'ready': True})

    def send(self, text='Hello'):
        self.room.handle('draft-update', 'a', {'text': text, 'revision': self.room.revision})
        self.room.handle('chat-send', 'a', {'text': text, 'revision': self.room.revision})
        return self.room.active['id']

    def test_shared_stream_and_late_join(self):
        request = self.send()
        self.room.handle('model-chunk', 'worker', {'id': request, 'text': 'Hello everyone'})
        self.room.handle('model-done', 'worker', {'id': request})
        self.room.handle('join', 'c', {'name': 'Charlie'})
        snapshot = self.events[-1][1]
        self.assertEqual(snapshot['messages'][-1]['content'], 'Hello everyone')
        self.assertEqual(snapshot['messages'][-1]['status'], 'complete')
        self.assertIsNone(snapshot['active'])
        self.assertEqual(len(snapshot['clients']), 3)

    def test_untrusted_client_cannot_supply_model_output(self):
        self.room.handle('worker-register', 'b', {'token': 'wrong', 'ready': True})
        self.assertEqual(self.room.worker, 'worker')
        request = self.send()
        self.room.handle('model-chunk', 'b', {'id': request, 'text': 'forged'})
        self.room.handle('model-done', 'b', {'id': request})
        self.assertEqual(self.room.messages[-1]['content'], '')
        self.assertIsNotNone(self.room.active)

    def test_concurrent_send_and_stale_draft(self):
        self.room.handle('draft-update', 'a', {'text': 'new', 'revision': 0})
        self.room.handle('draft-update', 'b', {'text': 'stale', 'revision': 0})
        self.assertEqual(self.room.draft, 'new')
        self.room.handle('chat-send', 'b', {'text': 'stale', 'revision': 0})
        self.assertIsNone(self.room.active)
        self.room.handle('chat-send', 'a', {'text': 'new', 'revision': 1})
        self.room.handle('chat-send', 'b', {'text': 'new', 'revision': 1})
        self.assertEqual(len(self.room.messages), 2)

    def test_disconnect_cleans_presence_and_interrupts_reply(self):
        self.send()
        self.room.disconnect('a')
        self.assertEqual(self.room.snapshot()['host'], 'b')
        self.room.disconnect('worker')
        self.assertFalse(self.room.ready)
        self.assertIsNone(self.room.active)
        self.assertEqual(self.room.messages[-1]['status'], 'interrupted')

    def test_cancel_rejects_late_chunks(self):
        request = self.send()
        self.room.handle('chat-stop', 'b', {})
        self.room.handle('model-chunk', 'worker', {'id': request, 'text': 'late'})
        self.assertEqual(self.room.messages[-1]['content'], '')
        self.assertEqual(self.room.messages[-1]['status'], 'stopped')

    def test_cursor_validation_and_shared_scroll(self):
        before = len(self.events)
        self.room.handle('cursor-update', 'a', {'x': float('nan'), 'y': 0})
        self.room.handle('cursor-update', 'unknown', {'x': 0, 'y': 0})
        self.assertEqual(len(self.events), before)
        self.room.handle('cursor-update', 'a', {'x': .25, 'y': .5})
        self.assertEqual(self.events[-1][1]['id'], 'a')
        self.room.handle('scroll-update', 'b', {'value': .4})
        self.assertEqual(self.room.snapshot()['scroll'], .4)

    def test_history_survives_restart(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'history.json'
            self.room.path = path
            self.send()
            restored = Room(lambda *args: None, 'secret', path)
            self.assertEqual(restored.messages[0]['content'], 'Hello')
            self.assertEqual(restored.messages[-1]['status'], 'interrupted')

    def test_clear_cancels_generation_and_persists_empty_history(self):
        with tempfile.TemporaryDirectory() as folder:
            self.room.path = Path(folder) / 'history.json'
            request = self.send()
            self.room.handle('chat-clear', 'unknown', {})
            self.assertIsNotNone(self.room.active)
            revision = self.room.revision
            self.room.handle('chat-clear', 'b', {})
            self.room.handle('model-chunk', 'worker', {'id': request, 'text': 'late'})
            self.assertEqual(self.room.messages, [])
            self.assertEqual(self.room.draft, '')
            self.assertGreater(self.room.revision, revision)
            self.assertIsNone(self.room.active)
            self.assertTrue(self.room.ready)
            self.assertEqual(len(self.room.clients), 2)
            self.assertIn(('model-cancel', {'id': request}, 'worker'), self.events)
            restored = Room(lambda *args: None, 'secret', self.room.path)
            self.assertEqual(restored.messages, [])

    def test_timeout_and_offline_send(self):
        self.send()
        self.room.active['touched'] -= 181
        self.room.tick()
        self.assertIsNone(self.room.active)
        self.assertEqual(self.room.messages[-1]['status'], 'error')
        self.room.disconnect('worker')
        self.room.handle('chat-send', 'a', {'text': 'hi', 'revision': self.room.revision})
        self.assertEqual(len(self.room.messages), 2)

if __name__ == '__main__':
    unittest.main()
