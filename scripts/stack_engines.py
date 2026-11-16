"""Turns the local stack's node config into the configs of its engines: the first engine's, which seals
its own keys and offers them to its successor, and one for each other engine, a copy with its own ports,
data and operator admin key. The genesis stays identical, because each engine continues the first one's
log. An engine the spec gives relayers posts its checkpoints and log heads through them and runs a
liveness caller from its own account, as each member of a rotation set does. Prints the SHA-256 of each
file, the first engine's first, which the registry names the releases by (a release is the launch
measurement and the config hash).

usage: stack_engines.py WORK SPEC
    SPEC is JSON: {"first": ENGINE, "others": [ENGINE, ...]}. Each ENGINE gives its handover port
    ("handover"); each other one also its name, API and metrics ports and operator public key ("name",
    "api", "metrics", "admin"); and any may give its checkpoint and log-head relayers and its liveness
    caller ("checkpoints", "heads", "caller").
"""

import copy
import hashlib
import json
import sys
import tomllib
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from stack_toml import dumps  # noqa: E402


def sealed(cfg: dict, data: Path, handover_port) -> None:
    """Seals the engine's keys under `data` and offers them to a successor at `handover_port`.
    Rotation on makes the node follow the registry's elections. The mock TEE seals with a public
    stand-in, and the successor's TLS check is off because both engines' keys are self-generated."""
    cfg["operator"]["rotation_enabled"] = True
    cfg["tee"]["use_published_mock_key"] = False
    cfg["tee"]["sealing"] = {
        "dir": str(data / "keys"),
        "handover": {"listen": f"127.0.0.1:{handover_port}", "danger_accept_invalid_certs": True},
    }


def relayed(cfg: dict, engine: dict) -> None:
    """Gives the engine the relayers and liveness caller the spec names for it, if any."""
    if "checkpoints" in engine:
        cfg["checkpoints"]["relayer"] = engine["checkpoints"]
        cfg["log_heads"]["relayer"] = engine["heads"]
        cfg["liveness"] = {"caller": engine["caller"], "min_balance": "0.01"}


def main() -> None:
    work, spec = sys.argv[1:]
    work_dir = Path(work)
    spec = json.loads(spec)
    first = tomllib.loads((work_dir / "node.toml").read_text())
    engines = [("node.toml", first, work_dir, spec["first"])]
    for engine in spec["others"]:
        cfg = copy.deepcopy(first)
        data = work_dir / engine["name"]
        cfg["node"].update(listen=f"127.0.0.1:{engine['api']}", log_dir=str(data / "log"))
        cfg["history"]["dir"] = str(data / "history")
        cfg["metrics"]["listen"] = f"127.0.0.1:{engine['metrics']}"
        cfg["alerts"]["outbox"]["dir"] = str(data / "alerts")
        evm = cfg["custody"]["evm"]
        evm["cursor_path"] = str(data / "custody-cursor.json")
        evm["staking"]["cursor_path"] = str(data / "staking-cursor.json")
        # The log records the operator key from the first engine's start; this is the key the
        # registry holds as the candidate's admin key, by which the node finds its candidate.
        cfg["operator"]["public_key"] = engine["admin"]
        engines.append((f"{engine['name']}.toml", cfg, data, engine))

    hashes = []
    for name, cfg, data, engine in engines:
        sealed(cfg, data, engine["handover"])
        relayed(cfg, engine)
        text = dumps(cfg)
        (work_dir / name).write_text(text)
        hashes.append("0x" + hashlib.sha256(text.encode()).hexdigest())
    print(*hashes)


if __name__ == "__main__":
    main()
