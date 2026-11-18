"""Store resident API keys outside the public game state and static web tree."""
import ctypes
import os
import re
import uuid
from ctypes import wintypes


def _windows_protect(data, decrypt=False):
    class Blob(ctypes.Structure):
        _fields_ = [("size", wintypes.DWORD), ("data", ctypes.c_void_p)]

    buffer = ctypes.create_string_buffer(data)
    source = Blob(len(data), ctypes.cast(buffer, ctypes.c_void_p))
    output = Blob()
    crypt = ctypes.WinDLL("crypt32", use_last_error=True)
    operation = crypt.CryptUnprotectData if decrypt else crypt.CryptProtectData
    if not operation(ctypes.byref(source), None, None, None, None, 1, ctypes.byref(output)):
        raise OSError("无法使用当前 Windows 账户保护或读取居民密钥")
    try:
        return ctypes.string_at(output.data, output.size)
    finally:
        ctypes.windll.kernel32.LocalFree(ctypes.c_void_p(output.data))


class ResidentKeys:
    def __init__(self, save_path):
        self.directory = save_path.with_name(save_path.name + ".keys")

    def path(self, reference):
        if not isinstance(reference, str) or not re.fullmatch(r"[a-f0-9]{32}", reference):
            raise ValueError("居民密钥引用无效")
        return self.directory / reference

    def write(self, key):
        payload = key.encode("ascii")
        if os.name == "nt":
            payload = _windows_protect(payload)
        self.directory.mkdir(parents=True, exist_ok=True, mode=0o700)
        reference = uuid.uuid4().hex
        path = self.path(reference)
        fd = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY | getattr(os, "O_BINARY", 0), 0o600)
        try:
            with os.fdopen(fd, "wb") as stream:
                stream.write(payload)
                stream.flush()
                os.fsync(stream.fileno())
        except OSError:
            path.unlink(missing_ok=True)
            raise
        return reference

    @staticmethod
    def read(path):
        payload = path.read_bytes()
        if os.name == "nt":
            payload = _windows_protect(payload, decrypt=True)
        return payload.decode("ascii")
