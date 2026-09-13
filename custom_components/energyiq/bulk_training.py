"""Sequential bulk training runner for EnergyIQ."""
from __future__ import annotations

import asyncio
import logging

_LOGGER = logging.getLogger(__name__)


async def async_run(coordinator, device_ids: list[str]) -> dict:
    """Train selected monitored HA loads one at a time.

    This runner deliberately owns the lifecycle between loads.  It waits for
    the actual per-device training task to finish, clears the coordinator's
    single-training handles, and only then starts the next device.  The caller
    can therefore run this as a background HA task without holding a websocket
    request open for the entire training sequence.
    """
    selected: list[str] = []
    skipped: list[dict] = []

    for did in dict.fromkeys(device_ids):
        candidate = coordinator.candidate_devices.get(did)
        if not candidate:
            skipped.append({"device_id": did, "reason": "device_not_found"})
            continue
        if str(candidate.get("source", "ha")).casefold() == "manual":
            skipped.append({"device_id": did, "reason": "manual_device"})
            continue
        if coordinator.device_classifications.get(did, "ignore") != "monitor":
            skipped.append({"device_id": did, "reason": "not_monitored"})
            continue
        selected.append(did)

    coordinator.bulk_training_state.update({
        "status": "running" if selected else "complete",
        "queue": selected,
        "current_index": 0,
        "total": len(selected),
        "current_device_id": selected[0] if selected else None,
        "completed": 0,
        "skipped": skipped,
        "failed": [],
    })
    await coordinator._persist(force=True)

    if not selected:
        return dict(coordinator.bulk_training_state)

    # Never take over an unrelated interactive training session.
    existing = coordinator._training_task
    if existing and not existing.done():
        coordinator.bulk_training_state["status"] = "error"
        coordinator.bulk_training_state["failed"].append({
            "device_id": selected[0],
            "reason": "Another training session is already active",
        })
        coordinator.bulk_training_state["current_device_id"] = None
        await coordinator._persist(force=True)
        return dict(coordinator.bulk_training_state)

    # Clear stale handles left by a completed interactive session.  The
    # training task itself is already done, so this does not interrupt work.
    coordinator._training_task = None
    coordinator._training_engine = None
    coordinator._training_device = None

    for index, did in enumerate(selected, start=1):
        coordinator.bulk_training_state["current_index"] = index
        coordinator.bulk_training_state["current_device_id"] = did
        await coordinator._persist(force=True)

        task = None
        try:
            await coordinator.async_start_training(did, "quick")
            task = coordinator._training_task
            if task is None:
                raise RuntimeError("Training task was not created")

            try:
                await asyncio.wait_for(asyncio.shield(task), timeout=90.0)
            except asyncio.TimeoutError:
                task.cancel()
                try:
                    await task
                except asyncio.CancelledError:
                    pass
                state = coordinator.training_state.get(did, {})
                reason = state.get("error") or "Training timed out after 90 seconds"
                coordinator.bulk_training_state["failed"].append({"device_id": did, "reason": reason})
            except asyncio.CancelledError:
                raise
            else:
                state = coordinator.training_state.get(did, {})
                if state.get("status") == "complete":
                    coordinator.bulk_training_state["completed"] += 1
                else:
                    reason = state.get("error") or state.get("instruction") or state.get("status", "failed")
                    coordinator.bulk_training_state["failed"].append({"device_id": did, "reason": reason})
        except Exception as err:
            _LOGGER.exception("Bulk training failed for %s", did)
            coordinator.bulk_training_state["failed"].append({"device_id": did, "reason": str(err)})
            if task and not task.done():
                task.cancel()
                try:
                    await task
                except asyncio.CancelledError:
                    pass
        finally:
            # The next device must never inherit the previous device's engine
            # or task state, even when the previous run ended in error.
            direct_task = getattr(coordinator, "_direct_rpc_task", None)
            if direct_task and not direct_task.done():
                direct_task.cancel()
                try:
                    await direct_task
                except asyncio.CancelledError:
                    pass
            coordinator._training_task = None
            coordinator._training_engine = None
            coordinator._training_device = None
            await coordinator._persist(force=True)

    coordinator.bulk_training_state["status"] = "complete"
    coordinator.bulk_training_state["current_device_id"] = None
    await coordinator._persist(force=True)
    return dict(coordinator.bulk_training_state)
