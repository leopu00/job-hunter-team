"""Apri un dialog nativo per selezionare una cartella. Stampa il path scelto."""
import os
import sys
import tkinter as tk
from tkinter import filedialog


def browse():
    root = tk.Tk()

    # Nascondi finestra root dalla taskbar
    root.attributes('-toolwindow', True)
    root.withdraw()

    # Dialog in primo piano
    root.attributes('-topmost', True)

    # Icona: explorer.exe = icona cartella di Windows
    if sys.platform == 'win32':
        try:
            explorer = os.path.join(
                os.environ.get('SystemRoot', r'C:\Windows'), 'explorer.exe'
            )
            root.iconbitmap(default=explorer)
        except Exception:
            pass

    folder = filedialog.askdirectory(
        title='Seleziona cartella workspace Job Hunter Team'
    )

    root.destroy()
    print(folder or '')


if __name__ == '__main__':
    browse()
