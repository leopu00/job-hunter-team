"""Apri un dialog nativo per selezionare una cartella. Stampa il path scelto."""
import os
import sys
import subprocess


def browse_macos():
    """Usa osascript (AppleScript) per aprire il Finder folder picker."""
    script = 'tell application "Finder" to activate\n' \
             'set f to choose folder with prompt "Seleziona cartella workspace Job Hunter Team"\n' \
             'return POSIX path of f'
    try:
        result = subprocess.run(
            ['osascript', '-e', script],
            capture_output=True, text=True, timeout=120
        )
        return result.stdout.strip()
    except Exception:
        return ''


def browse_tkinter():
    """Fallback: usa tkinter per il dialog."""
    import tkinter as tk
    from tkinter import filedialog

    root = tk.Tk()
    try:
        root.attributes('-toolwindow', True)
    except Exception:
        pass
    root.withdraw()
    root.attributes('-topmost', True)

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
    return folder or ''


def browse():
    if sys.platform == 'darwin':
        return browse_macos()
    else:
        return browse_tkinter()


if __name__ == '__main__':
    print(browse())
