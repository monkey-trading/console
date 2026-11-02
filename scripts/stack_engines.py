"""Turns the local stack's node config into the two configs of the second-engine option: the first
engine's, which seals its own keys and offers them to its successor, and the second engine's, a copy
with its own ports, data and operator admin key. The genesis stays identical, because the second
engine continues the first one's log. Prints the SHA-256 of each file, which the registry names the
two releases by (a release is the launch measurement and the config hash).

usage: stack_engines.py WORK FIRST_HANDOVER_PORT SECOND_API_PORT SECOND_METRICS_PORT SECOND_HANDOVER_PORT \
    SECOND_ADMIN_PUBLIC_KEY
"""

import copy
import hashlib
import sys
import tomllib
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from stack_toml import dumps  # noqa: E402


def sealed(cfg: dict, data: Path, handover_port: str) -> None:
    """Seals the engine's keys under `data` and offers them to a successor at `handover_port`.
    Rotation on makes the node follow the registry's elections. The mock TEE seals with a public
    stand-in, and the successor's TLS check is off because both engines' keys are self-generated."""
    cfg["operator"]["rotation_enabled"] = True
    cfg["tee"]["use_published_mock_key"] = False
    cfg["tee"]["sealing"] = {
        "dir": str(data / "keys"),
        "handover": {"listen": f"127.0.0.1:{handover_port}", "danger_accept_invalid_certs": True},
    }


def main() -> None:
    work, first_handover, api, metrics, second_handover, admin_key = sys.argv[1:]
    work_dir = Path(work)
    first = tomllib.loads((work_dir / "node.toml").read_text())
    sealed(first, work_dir, first_handover)

    second = copy.deepcopy(first)
    data = work_dir / "second"
    second["node"].update(listen=f"127.0.0.1:{api}", log_dir=str(data / "log"))
    second["history"]["dir"] = str(data / "history")
    second["metrics"]["listen"] = f"127.0.0.1:{metrics}"
    second["alerts"]["outbox"]["dir"] = str(data / "alerts")
    evm = second["custody"]["evm"]
    evm["cursor_path"] = str(data / "custody-cursor.json")
    evm["staking"]["cursor_path"] = str(data / "staking-cursor.json")
    # The log records the operator key from the first engine's start; this is the key the election
    # names, which the registry holds as the candidate's admin key.
    second["operator"]["public_key"] = admin_key
    sealed(second, data, second_handover)

    hashes = []
    for name, cfg in (("node.toml", first), ("second.toml", second)):
        text = dumps(cfg)
        (work_dir / name).write_text(text)
        hashes.append("0x" + hashlib.sha256(text.encode()).hexdigest())
    print(*hashes)


if __name__ == "__main__":
    main()
