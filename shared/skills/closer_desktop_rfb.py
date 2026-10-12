"""Bounded loopback RFB client for OwnedScreen only (RFC 6143, raw encoding).

No clipboard, file transfer, arbitrary target, shell, or provider. VNC's legacy
DES response uses the installed OpenSSL implementation; it is transport
compatibility behind the existing private own-user host channel, not #279 auth.
"""
import ctypes
import socket
import struct
import time
import zlib


class RFBError(Exception):
    pass


class DisplayClient:
    def __init__(self, port, password):
        self.socket = socket.create_connection(("127.0.0.1", port), timeout=3)
        self.buttons = 0
        try:
            version = self.read(12)
            if version not in {b"RFB 003.008\n", b"RFB 003.007\n"}:
                raise RFBError("rfb_version")
            self.socket.sendall(b"RFB 003.008\n")
            count = self.read(1)[0]
            if not 1 <= count <= 32 or 2 not in self.read(count):
                raise RFBError("rfb_auth_required")
            self.socket.sendall(b"\x02")
            challenge = self.read(16)
            key = bytes(int(f"{byte:08b}"[::-1], 2) for byte in password[:8].ljust(8, b"\0"))
            crypto = ctypes.CDLL("libcrypto.so.3")
            crypto.DES_set_key_unchecked.argtypes = [ctypes.c_void_p, ctypes.c_void_p]
            crypto.DES_set_key_unchecked.restype = None
            crypto.DES_ecb_encrypt.argtypes = [ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_int]
            crypto.DES_ecb_encrypt.restype = None
            schedule = ctypes.create_string_buffer(256)
            crypto.DES_set_key_unchecked(ctypes.create_string_buffer(key, 8), schedule)
            response = bytearray()
            for offset in (0, 8):
                output = ctypes.create_string_buffer(8)
                crypto.DES_ecb_encrypt(ctypes.create_string_buffer(challenge[offset:offset+8], 8), output, schedule, 1)
                response.extend(output.raw)
            self.socket.sendall(response)
            if self.read(4) != b"\0\0\0\0":
                raise RFBError("rfb_auth_failed")
            self.socket.sendall(b"\x01")  # shared viewer; never steals another viewer
            init = self.read(24)
            self.width, self.height = struct.unpack(">HH", init[:4])
            if (self.width, self.height) != (1440, 1000):
                raise RFBError("rfb_dimensions")
            name_length = struct.unpack(">I", init[20:24])[0]
            if name_length > 4096:
                raise RFBError("rfb_name_limit")
            self.read(name_length)
            pixel = struct.pack(">BBBBHHHBBBxxx", 32, 24, 0, 1, 255, 255, 255, 16, 8, 0)
            self.socket.sendall(b"\0\0\0\0" + pixel)
            self.socket.sendall(struct.pack(">BBHi", 2, 0, 1, 0))  # only raw
        except BaseException:
            self.close()
            raise

    def read(self, size):
        if not 0 <= size <= 1440 * 1000 * 4:
            raise RFBError("rfb_read_limit")
        result = bytearray()
        deadline = min(time.monotonic() + 3, getattr(self, "deadline", float("inf")))
        while len(result) < size:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise RFBError("rfb_read_timeout")
            self.socket.settimeout(remaining)
            data = self.socket.recv(min(65536, size - len(result)))
            if not data:
                raise RFBError("rfb_closed")
            result.extend(data)
        return bytes(result)

    def frame(self):
        self.deadline = time.monotonic() + 4
        self.socket.sendall(struct.pack(">BBHHHH", 3, 0, 0, 0, self.width, self.height))
        raw = bytearray(self.width * self.height * 4)
        covered = 0
        # x11vnc may send Bell or ServerCutText before the framebuffer. We
        # discard bounded text without returning, logging, or setting clipboard.
        for _ in range(16):
            kind = self.read(1)[0]
            if kind == 2:
                continue
            if kind == 3:
                length = struct.unpack(">I", self.read(7)[3:])[0]
                if length > 4096:
                    raise RFBError("rfb_clipboard_limit")
                self.read(length)
                continue
            if kind != 0:
                raise RFBError("rfb_message")
            count = struct.unpack(">H", self.read(3)[1:])[0]
            if not 1 <= count <= 256:
                raise RFBError("rfb_rect_limit")
            for _ in range(count):
                x, y, width, height, encoding = struct.unpack(">HHHHi", self.read(12))
                if (encoding != 0 or not width or not height or x + width > self.width or
                        y + height > self.height or covered + width * height > self.width * self.height):
                    raise RFBError("rfb_rectangle")
                data = self.read(width * height * 4)
                for row in range(height):
                    start = ((y + row) * self.width + x) * 4
                    raw[start:start+width*4] = data[row*width*4:(row+1)*width*4]
                covered += width * height
            break
        if covered != self.width * self.height:
            raise RFBError("rfb_incomplete_frame")
        rgb = bytearray(self.width * self.height * 3)
        rgb[0::3], rgb[1::3], rgb[2::3] = raw[2::4], raw[1::4], raw[0::4]
        scanlines = b"".join(b"\0" + rgb[row*self.width*3:(row+1)*self.width*3] for row in range(self.height))
        def chunk(kind, data):
            return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))
        return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", self.width, self.height, 8, 2, 0, 0, 0)) +
                chunk(b"IDAT", zlib.compress(scanlines, 1)) + chunk(b"IEND", b""))

    def input(self, request):
        self.deadline = time.monotonic() + 3
        pressed = request.get("pressed")
        if type(pressed) is not bool:
            raise RFBError("rfb_input_invalid")
        if request.get("kind") == "pointer":
            x, y, button = (request.get(key) for key in ("x", "y", "button"))
            if (any(type(value) is not int for value in (x, y, button)) or
                    not 0 <= x < self.width or not 0 <= y < self.height or not 0 <= button <= 5):
                raise RFBError("rfb_input_invalid")
            if button:
                mask = 1 << (button - 1)
                self.buttons = self.buttons | mask if pressed else self.buttons & ~mask
            self.socket.sendall(struct.pack(">BBHH", 5, self.buttons, x, y))
        elif request.get("kind") == "key":
            key = request.get("key")
            keys = {"BackSpace": 0xff08, "Tab": 0xff09, "Return": 0xff0d, "Escape": 0xff1b,
                    "Delete": 0xffff, "Home": 0xff50, "End": 0xff57, "Page_Up": 0xff55,
                    "Page_Down": 0xff56, "Left": 0xff51, "Right": 0xff53, "Up": 0xff52,
                    "Down": 0xff54, "Shift_L": 0xffe1, "Control_L": 0xffe3, "Alt_L": 0xffe9}
            if isinstance(key, str) and len(key) == 1 and key.isprintable() and not 0xd800 <= ord(key) <= 0xdfff:
                symbol = ord(key) if ord(key) <= 255 else 0x01000000 | ord(key)
            elif isinstance(key, str) and key in keys:
                symbol = keys[key]
            else:
                raise RFBError("rfb_input_invalid")
            self.socket.sendall(struct.pack(">BBHI", 4, int(pressed), 0, symbol))
        else:
            raise RFBError("rfb_input_invalid")

    def close(self):
        self.socket.close()
