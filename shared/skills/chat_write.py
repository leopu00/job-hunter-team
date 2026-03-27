"""Scrivi un messaggio nel file chat dell'assistente.

Uso: python chat_write.py <chat_file> <role> <message>
  role: "user" | "assistant"
"""
import json
import sys
import time


def write_message(chat_file: str, role: str, text: str):
    msg = {"role": role, "text": text, "ts": time.time()}
    with open(chat_file, "a", encoding="utf-8") as f:
        f.write(json.dumps(msg, ensure_ascii=False) + "\n")


if __name__ == "__main__":
    if len(sys.argv) < 4:
        print("Uso: python chat_write.py <chat_file> <role> <message>")
        sys.exit(1)
    write_message(sys.argv[1], sys.argv[2], sys.argv[3])
