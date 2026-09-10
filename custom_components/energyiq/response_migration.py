"""Migrate the EnergyIQ training response log without leaving an orphan file."""
from __future__ import annotations

from pathlib import Path


def migrate_response_log(hass) -> Path:
    """Migrate the legacy response log to the EnergyIQ filename.

    The legacy file is removed only after the new file has been created and
    its contents have been verified. If the new file already exists, the
    legacy file is removed only when both files have identical contents.
    """
    old_path = Path(hass.config.path("energy_attribution_response.csv"))
    new_path = Path(hass.config.path("energyiq_response.csv"))

    if not old_path.exists():
        return new_path

    new_path.parent.mkdir(parents=True, exist_ok=True)

    if new_path.exists():
        if old_path.read_bytes() == new_path.read_bytes():
            old_path.unlink()
        return new_path

    old_bytes = old_path.read_bytes()
    temp_path = new_path.with_suffix(new_path.suffix + ".migrating")
    temp_path.write_bytes(old_bytes)
    if temp_path.read_bytes() != old_bytes:
        temp_path.unlink(missing_ok=True)
        raise OSError("EnergyIQ response log migration verification failed")
    temp_path.replace(new_path)
    old_path.unlink()
    return new_path
