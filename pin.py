#!/usr/bin/python3
# SPDX-License-Identifier: GPL-3.0-only
"""Enroll and verify the local Focus Lock PIN."""

import argparse
import getpass
import hashlib
import hmac
import os
from pathlib import Path
import re
import stat
import sys
import tempfile
import warnings


ITERATIONS = 600_000
LEGACY_PIN = Path(__file__).resolve().with_name("unlock-pin.txt")


def config_path():
    config_home = Path(os.environ.get("XDG_CONFIG_HOME", ""))
    if not config_home.is_absolute():
        config_home = Path.home() / ".config"
    return config_home / "focus-lock" / "pin"


def valid_pin(pin):
    return re.fullmatch(r"[0-9]{4,12}", pin) is not None


def private_text(path):
    with os.fdopen(
        os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK),
        encoding="ascii",
    ) as handle:
        info = os.fstat(handle.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077:
            raise ValueError("PIN file must be private")
        return handle.read(192).strip()


def hash_pin(pin, salt):
    return hashlib.pbkdf2_hmac("sha256", pin.encode("ascii"), salt, ITERATIONS)


def read_record(path):
    scheme, salt, digest = private_text(path).split()
    if not (
        scheme == "pbkdf2-sha256"
        and re.fullmatch(r"[0-9a-f]{32}", salt)
        and re.fullmatch(r"[0-9a-f]{64}", digest)
    ):
        raise ValueError("invalid PIN record")
    return bytes.fromhex(salt), bytes.fromhex(digest)


def save_pin(path, pin, *, replace=True):
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    salt = os.urandom(16)
    digest = hash_pin(pin, salt)
    with tempfile.NamedTemporaryFile(
        mode="w", encoding="ascii", dir=path.parent, delete=False
    ) as handle:
        temporary = Path(handle.name)
        try:
            handle.write(f"pbkdf2-sha256 {salt.hex()} {digest.hex()}\n")
            handle.close()
            if replace:
                os.replace(temporary, path)
            else:
                try:
                    os.link(temporary, path)
                except FileExistsError:
                    pass
        finally:
            temporary.unlink(missing_ok=True)


def migrate_pin(path):
    try:
        pin = private_text(LEGACY_PIN)
    except FileNotFoundError:
        return
    if not valid_pin(pin):
        raise ValueError("invalid legacy PIN")
    if not path.exists():
        save_pin(path, pin, replace=False)
    read_record(path)
    LEGACY_PIN.unlink(missing_ok=True)


def set_pin(path):
    if not sys.stdin.isatty():
        raise ValueError("set the PIN from a Terminal window")
    warnings.simplefilter("error", getpass.GetPassWarning)
    pin = getpass.getpass("New Focus Lock PIN (4–12 digits): ")
    if not valid_pin(pin):
        raise ValueError("enter 4–12 digits")
    if pin != getpass.getpass("Repeat Focus Lock PIN: "):
        raise ValueError("the PINs did not match")
    save_pin(path, pin)
    print("Focus Lock PIN saved.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--set-pin", action="store_true", help="choose a new PIN privately")
    mode.add_argument("--verify", action="store_true", help=argparse.SUPPRESS)
    mode.add_argument("--migrate", action="store_true", help=argparse.SUPPRESS)
    args = parser.parse_args()
    path = config_path()
    try:
        if args.set_pin:
            set_pin(path)
        elif args.migrate:
            migrate_pin(path)
        else:
            raw = sys.stdin.read(14)
            pin = raw.removesuffix("\n")
            salt, digest = read_record(path)
            return 0 if valid_pin(pin) and hmac.compare_digest(hash_pin(pin, salt), digest) else 1
    except (OSError, ValueError, getpass.GetPassWarning) as error:
        print(f"Focus Lock: {error}", file=sys.stderr)
        return 2
    except (EOFError, KeyboardInterrupt):
        print("Focus Lock PIN setup cancelled.", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
