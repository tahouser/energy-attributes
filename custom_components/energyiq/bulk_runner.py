"""Reliable sequential bulk-training runner for EnergyIQ."""
from __future__ import annotations

import asyncio
import logging

_LOGGER = logging.getLogger(__name__)


async def async_run_bulk_auto_training(coordinator, device_ids: list[str]) -> dict:
    """Run the selected training jobs one at a time without task handoff races.

    The existing coordinator training implementation owns the actual capture.
    This runner owns only queue sequencing.  In particular, it waits for the
    previous training task itself to finish before asking the coordinator to
    start the next device.  Looking only at training_state is insufficient
    because the state is marked complete just before the asyncio task returns.
    """
    selected: list[str] = []
    skipped: list[dict] = []

    for did in device_ids:
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
        "status": "running",
        "queue": selected,
        "current_index": 0,
        "total": len(selected),
        "current_device_id": None,
        "completed": 0,
        "skipped": skipped,
        "failed": [],
    })
    await coordinator._persist(force=True)

    for index, did in enumerate(selected, start=1):
        coordinator.bulk_training_state["current_index"] = index
        coordinator.bulk_training_state["current_device_id"] = did
        task = None
        try:
            await coordinator.async_start_training(did, "quick")
            task = coordinator._training_task

            deadline = coordinator.hass.loop.time() + 90.0
            while coordinator.hass.loop.time() < deadline:
                state = coordinator.training_state.get(did, {})
                if state.get("status") != "active":
                    break
                if task is not None and task.done():
                    break
                await asyncio.sleep(0.10)

            state = coordinator.training_state.get(did, {})

            # A completed state is written by _training_loop immediately before
            # that task returns. Always await the task before starting the next
            # device so async_start_training cannot see a stale active task.
            if state.get("status") == "complete":
                if task is not None and not task.done():
                    await task
                coordinator.bulk_training_state["completed"] += 1
            else:
                reason = state.get("error") or state.get("instruction") or state.get("status", "failed")
                coordinator.bulk_training_state["failed"].append({"device_id": did, "reason": reason})
                if task is not None and not task.done():
                    task.cancel()
                    try:
                        await task
                    except asyncio.CancelledError:
                        pass
        except Exception as err:
            _LOGGER.exception("Bulk training failed for %s", did)
            coordinator.bulk_training_state["failed"].append({"device_id": did, "reason": str(err)})
            if task is None:
                task = coordinator._training_task
            if task is not None and not task.done():
                task.cancel()
                try:
                    await task
                except asyncio.CancelledError:
                    pass
        finally:
            # Do not leave the previous engine/device attached to the
            # coordinator.  This is done only after the task has unwound.
            if task is not None and not task.done():
                task.cancel()
                try:
                    await task
                except asyncio.CancelledError:
                    pass
            coordinator._training_task = None
            coordinator._training_engine = None
            coordinator._training_device = None
            if coordinator._direct_rpc_task is not None and not coordinator._direct_rpc_task.done():
                coordinator._direct_rpc_task.cancel()
                try:
                    await coordinator._direct_rpc_task
                except asyncio.CancelledError:
                    pass
            await coordinator._persist(force=True)

        if index < len(selected):
            coordinator.bulk_training_state["current_device_id"] = selected[index]
            await asyncio.sleep(1.0)

    coordinator.bulk_training_state.update({
        "status": "complete",
        "current_device_id": None,
    })
    await coordinator._persist(force=True)
    return dict(coordinator.bulk_training_state)
