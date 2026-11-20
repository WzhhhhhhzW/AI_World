import gzip
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
            for host in (f"10.0.2.2:{port}", f"10.0.2.100:{port}", "10.0.2.100:8766"):
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

    def test_revalidated_asset_and_health_share_a_connection(self):
        port = self.serve()
        conn = http.client.HTTPConnection("127.0.0.1", port, timeout=3)
        self.addCleanup(conn.close)
        asset = "/assets/maps/valley-layout-v1.json"
        conn.request("GET", asset)
        response = conn.getresponse()
        original = conn.sock
        etag = response.getheader("ETag")
        response.read()
        conn.request("GET", asset, headers={"If-None-Match": etag})
        response = conn.getresponse()
        self.assertEqual((response.status, response.read()), (304, b""))
        conn.request("GET", "/api/health")
        response = conn.getresponse()
        self.assertEqual(response.status, 200)
        self.assertIs(conn.sock, original)
        self.assertTrue(response.read())

    def test_tcg_index_loads_runtime_in_order_and_bundles_styles(self):
        port = self.serve()
        _, _, desktop = self.fetch(port, "/", {})
        self.assertIn(b'href="style.css"', desktop)
        status, _, page = self.fetch(port, "/?render=tcg", {})
        self.assertEqual(status, 200)
        self.assertIn(b'href="/village-style.css"', page)
        self.assertLess(page.index(b'src="boot.js"'), page.index(b'src="/village-runtime.js?render=tcg"'))
        status, headers, js = self.fetch(port, "/village-runtime.js", {})
        self.assertEqual(status, 200)
        self.assertEqual(headers["Content-Type"], "text/javascript; charset=utf-8")
        self.assertLess(js.index(b"const VillageMap="), js.index(b"const canvas ="))
        _, _, compact_js = self.fetch(port, "/village-runtime.js?render=tcg", {})
        self.assertNotIn(b"const villageTcgAssets = ", js)
        self.assertLess(compact_js.index(b"const villageTcgAssets = "), compact_js.index(b"const VillageUI ="))
        self.assertIn(b'"version":"village-wood-v2","regions":31', compact_js)
        _, headers, zipped = self.fetch(port, "/village-runtime.js", {"Accept-Encoding": "gzip"})
        self.assertEqual(headers["Content-Encoding"], "gzip")
        self.assertEqual(gzip.decompress(zipped), js)
        status, _, _ = self.fetch(port, "/village-runtime.js", {"If-None-Match": headers["ETag"]})
        self.assertEqual(status, 304)
