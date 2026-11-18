import json
import os
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from village import Provider


class Response:
    def __enter__(self):
        return self

    def __exit__(self, *args):
        pass

    def read(self, bound):
        return b'{"choices":[{"message":{"content":"fixture"}}],"usage":{"prompt_tokens":2,"completion_tokens":3,"total_tokens":5}}'


class ProviderContractTests(unittest.TestCase):
    def test_compatible_adapter_sends_expected_endpoint_and_usage(self):
        configs = [{"id": "fixture", "name": "fixture", "base_url": "https://example.invalid/v1", "model": "fixture-model", "key_env": "VILLAGE_FIXTURE_TEST_KEY", "max_tokens_field": "max_tokens"}]
        with patch.dict(os.environ, {"VILLAGE_FIXTURE_TEST_KEY": "fixture-only-nonsecret"}), patch('urllib.request.build_opener') as opener:
            opener.return_value.open.return_value = Response()
            provider = Provider(configs)
            result = provider.call("fixture", [{"role": "user", "content": "hi"}], 700)
            request = opener.return_value.open.call_args.args[0]
            self.assertEqual(request.full_url, "https://example.invalid/v1/chat/completions")
            self.assertEqual(json.loads(request.data)["max_tokens"], 700)
            self.assertFalse(json.loads(request.data)["stream"])
            self.assertEqual(result["usage"]["total_tokens"], 5)
            self.assertNotIn("fixture-only-nonsecret", json.dumps(provider.public()))

    def test_invalid_endpoint_not_ready_and_no_network_call(self):
        for endpoint in ["http://example.invalid", "https://user:pass@example.invalid", "https://example.invalid?key=no", "file:///tmp/test"]:
            with self.subTest(endpoint=endpoint), patch.dict(os.environ, {"VILLAGE_FIXTURE_TEST_KEY": "fixture-only"}), patch('urllib.request.build_opener') as opener:
                provider = Provider([{"id":"fixture","name":"fixture","model":"fixture","base_url":endpoint,"key_env":"VILLAGE_FIXTURE_TEST_KEY"}])
                self.assertFalse(provider.ready("fixture"))
                with self.assertRaises(ValueError):
                    provider.call("fixture", [], 20)
                opener.assert_not_called()


if __name__ == "__main__":
    unittest.main(verbosity=2)
