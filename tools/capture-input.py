#!/usr/bin/env python3
"""Captura TODOS los eventos de entrada del teclado ASUS Zenbook Duo.

Sirve para ver qué envía el equipo al presionar una tecla (por ejemplo la de
pantalla inferior), por Bluetooth o por USB.

Uso (requiere root para leer /dev/input y /dev/hidraw):

    sudo python3 capture-input.py            # solo dispositivos ASUS/Zenbook/Primax
    sudo python3 capture-input.py --all      # todos los dispositivos de entrada

Cada evento se imprime en pantalla y se guarda en un archivo de log junto a
este script. Detén la captura con Ctrl+C.

Qué muestra:
  - evdev (/dev/input/eventN): tipo, código y valor de cada evento, sin SYN_REPORT.
  - hidraw (/dev/hidrawN): reporte crudo en hexadecimal.
  - Los dispositivos nuevos (al reconectar BT/USB) se añaden solos.
"""

import argparse
import datetime
import glob
import os
import select
import struct
import sys
import time

EV_NAMES = {0: "EV_SYN", 1: "EV_KEY", 2: "EV_REL", 3: "EV_ABS", 4: "EV_MSC", 5: "EV_SW", 17: "EV_LED", 20: "EV_REP"}
EVENT = struct.Struct("llHHi")
KEYWORDS = ("zenbook", "asus", "primax")

LOG_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                        f"capture-input-{datetime.datetime.now():%Y%m%d-%H%M%S}.log")


def ts():
    return datetime.datetime.now().strftime("%H:%M:%S.%f")[:-3]


def device_name(event_path):
    base = os.path.basename(event_path)
    try:
        with open(f"/sys/class/input/{base}/device/name") as f:
            return f.read().strip()
    except OSError:
        return "?"


def hidraw_name(hidraw_path):
    base = os.path.basename(hidraw_path)
    try:
        with open(f"/sys/class/hidraw/{base}/device/uevent") as f:
            for line in f:
                if line.startswith("HID_NAME="):
                    return line.split("=", 1)[1].strip()
    except OSError:
        pass
    return "?"


def wanted(name, show_all):
    return show_all or any(k in name.lower() for k in KEYWORDS)


def discover(show_all):
    found = {}
    for path in sorted(glob.glob("/dev/input/event*")):
        name = device_name(path)
        if wanted(name, show_all):
            found[path] = ("evdev", name)
    for path in sorted(glob.glob("/dev/hidraw*")):
        name = hidraw_name(path)
        if wanted(name, show_all):
            found[path] = ("hidraw", name)
    return found


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--all", action="store_true", help="capturar todos los dispositivos de entrada")
    args = parser.parse_args()

    if os.geteuid() != 0:
        print("Ejecuta con sudo: sudo python3 capture-input.py", file=sys.stderr)
        return 1

    log = open(LOG_PATH, "w", buffering=1)

    def out(line):
        print(line, flush=True)
        log.write(line + "\n")

    fds = {}  # fd -> (path, kind, name)

    def open_device(path, kind, name):
        try:
            fd = os.open(path, os.O_RDONLY | os.O_NONBLOCK)
        except OSError as e:
            out(f"{ts()} no se pudo abrir {path} ({name}): {e}")
            return
        fds[fd] = (path, kind, name)
        out(f"{ts()} + {kind} {path}  {name}")

    def close_device(fd, reason):
        path, kind, name = fds.pop(fd)
        try:
            os.close(fd)
        except OSError:
            pass
        out(f"{ts()} - {kind} {path}  {name}  ({reason})")

    out(f"Log: {LOG_PATH}")
    out("Presiona la tecla y observa. Ctrl+C para terminar.")
    known = discover(args.all)
    for path, (kind, name) in known.items():
        open_device(path, kind, name)
    if not fds:
        out("No se encontraron dispositivos ASUS/Zenbook. Usa --all para ver todo.")

    last_scan = time.time()
    try:
        while True:
            if fds:
                ready, _, _ = select.select(list(fds), [], [], 0.5)
            else:
                ready = []
                time.sleep(0.5)

            for fd in ready:
                path, kind, name = fds[fd]
                try:
                    data = os.read(fd, EVENT.size if kind == "evdev" else 64)
                except BlockingIOError:
                    continue
                except OSError as e:
                    close_device(fd, f"error: {e}")
                    continue
                if not data:
                    close_device(fd, "cerrado")
                    continue

                if kind == "evdev":
                    if len(data) < EVENT.size:
                        continue
                    _, _, etype, code, value = EVENT.unpack(data)
                    if etype == 0:  # SYN_REPORT: separador, no aporta información
                        continue
                    tname = EV_NAMES.get(etype, f"type{etype}")
                    out(f"{ts()} {path} {tname:<7} code={code:<4} value={value:<7} [{name}]")
                else:
                    out(f"{ts()} {path} HID {data.hex(' ')}  [{name}]")

            if time.time() - last_scan > 2:
                last_scan = time.time()
                current = discover(args.all)
                open_paths = {v[0] for v in fds.values()}
                for path, (kind, name) in current.items():
                    if path not in open_paths:
                        open_device(path, kind, name)

    except KeyboardInterrupt:
        out(f"\n{ts()} captura terminada")
    finally:
        for fd in list(fds):
            try:
                os.close(fd)
            except OSError:
                pass
        log.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
