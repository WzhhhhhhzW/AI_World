import http.client
import threading
import unittest
from http.server import ThreadingHTTPServer

from server import make_handler


class GuestHTTPTests(unittest.TestCase):
    def serve(self, guest=False):
        httpd = ThreadingHTTPServer(("127.0.0.1", 0), make_handler(None, qemu_guest=guest))
        thread = threading.Thread(target=httpd.serve_forever, kwargs={"poll_interval": .01})
        thread.start()
        self.addCleanup(httpd.server_close)
        self.addCleanup(thread.join)
        self.addCleanup(httpd.shutdown)
        return httpd.server_port

    def fetch(self, port, path, headers):
        conn = http.client.HTTPConnection("127.0.0.1", port, timeout=3)
        try:
            conn.request("GET", path, headers=headers)
            response = conn.getresponse()
            return response.status, dict(response.getheaders()), response.read()
        finally:
            conn.close()

    def test_qemu_guest_requires_opt_in_and_matching_origin(self):
        for guest in (False, True):
            port = self.serve(guest)
            for addr in ("10.0.2.2", "10.0.2.100"):
                host = f"{addr}:{port}"
                headers = {"Host": host, "Origin": "http://" + host}
                self.assertEqual(self.fetch(port, "/api/health", headers)[0], 200 if guest else 403)
                for origin in (f"http://127.0.0.1:{port}", "http://elsewhere.invalid", "null"):
                    self.assertEqual(self.fetch(port, "/api/health", dict(headers, Origin=origin))[0], 403)

    def test_artwork_can_be_revalidated_without_caching_private_data(self):
        port = self.serve()
        asset = "/assets/maps/valley-layout-v1.json"
        status, headers, body = self.fetch(port, asset, {})
        self.assertEqual(status, 200)
        self.assertTrue(body)
        repeated, _, body = self.fetch(port, asset, {"If-None-Match": headers["ETag"]})
        self.assertEqual((repeated, body), (304, b""))
        self.assertEqual(self.fetch(port, "/api/health", {})[1]["Cache-Control"], "no-store")
