"""Writes a config read with `tomllib` back out as TOML, for the local stack's scripts, which edit the
engine's dev configs and hand the result to a node. `tomllib` reads TOML and cannot write it."""

import json
import re
import tomllib


def _key(name: str) -> str:
    return name if re.fullmatch(r"[A-Za-z0-9_-]+", name) else json.dumps(name)


def _value(item) -> str:
    if isinstance(item, bool):
        return "true" if item else "false"
    if isinstance(item, int):
        return str(item)
    if isinstance(item, str):
        return json.dumps(item)
    if isinstance(item, list):
        return "[" + ", ".join(map(_value, item)) + "]"
    if isinstance(item, dict):
        return "{ " + ", ".join(f"{_key(k)} = {_value(v)}" for k, v in item.items()) + " }"
    raise TypeError(f"no TOML writer for {item!r}")


def _table(section: dict, path: list, lines: list) -> None:
    lines += [f"{_key(k)} = {_value(v)}" for k, v in section.items() if not isinstance(v, dict)]
    for k, v in section.items():
        if isinstance(v, dict):
            lines += ["", "[" + ".".join(map(_key, path + [k])) + "]"]
            _table(v, path + [k], lines)


def dumps(cfg: dict) -> str:
    """The TOML text of `cfg`, checked to read back as the same config."""
    lines: list = []
    _table(cfg, [], lines)
    text = "\n".join(lines).lstrip("\n") + "\n"
    assert tomllib.loads(text) == cfg, "the written config does not read back the same"
    return text
