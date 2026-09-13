"""Sequential bulk training runner for EnergyIQ."""
from __future__ import annotations

import asyncio
import logging

_LOGGER = logging.getLogger(__name__)


async def _safe_persist(coordinator) -> None:
    """Persist queue state without allowing persistence to kill the worker."""
    try:
        await coordinator._persist(force=True)
    except Exception:
        _LOGGER.exception("EnergyIQ bulk state persistence failed")


def _phase(coordinator, value: str) -> None:
    """Record the exact queue handoff phase for the UI/diagnostics."""
    coordinator.bulk_training_state["phase"] = value


async def async_run(coordinator, device_ids: list[str]) -> dict:
    """Train selected monitored HA loads one at a time.

    The worker owns the handoff between devices. A device is not considered
    handed off until its actual asyncio training task has returned, its direct
    Shelly poller has stopped, and the coordinator's single-device handles have
    been cleared. A cancellation of one individual training task is recorded as
    a device failure so it cannot silently terminate the remaining queue.
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
        "phase": "queued" if selected else "complete",
        "queue": selected,
        "current_index": 0,
        "total": len(selected),
        "current_device_id": selected[0] if selected else None,
        "completed": 0,
        "skipped": skipped,
        "failed": [],
        "last_error": None,
    })
    await _safe_persist(coordinator)

    if not selected:
        return dict(coordinator.bulk_training_state)

    existing = coordinator._training_task
    if existing and not existing.done():
        coordinator.bulk_training_state["status"] = "error"
        coordinator.bulk_training_state["phase"] = "blocked"
        coordinator.bulk_training_state["failed"].append({
            "device_id": selected[0],
            "reason": "Another training session is already active",
        })
        coordinator.bulk_training_state["last_error"] = "Another training session is already active"
        coordinator.bulk_training_state["current_device_id"] = None
        await _safe_persist(coordinator)
        return dict(coordinator.bulk_training_state)

    coordinator._training_task = None
    coordinator._training_engine = None
    coordinator._training_device = None

    try:
        for index, did in enumerate(selected, start=1):
            coordinator.bulk_training_state["current_index"] = index
            coordinator.bulk_training_state["current_device_id"] = did
            _phase(coordinator, "starting")
            await _safe_persist(coordinator)

            task = None
            try:
                await coordinator.async_start_training(did, "quick")
                task = coordinator._training_task
                if task is None:
                    raise RuntimeError("Training task was not created")

                _phase(coordinator, "waiting_for_training")
                try:
                    # Wait for the task itself, not merely training_state. The
                    # latter is marked complete just before _training_loop returns.
                    await asyncio.wait_for(asyncio.shield(task), timeout=90.0)
                except asyncio.TimeoutError:
                    state = coordinator.training_state.get(did, {})
                    reason = state.get("error") or "Training timed out after 90 seconds"
                    coordinator.bulk_training_state["failed"].append({"device_id": did, "reason": reason})
                    coordinator.bulk_training_state["last_error"] = reason
                    _phase(coordinator, "training_timeout")
                    task.cancel()
                    try:
                        await task
                    except asyncio.CancelledError:
                        pass
                except asyncio.CancelledError:
                    # CancelledError is a BaseException in Python 3.8+ and was
                    # previously re-raised here, which could silently kill the
                    # entire bulk queue after the first device. Treat a cancelled
                    # individual device task as a failed queue item instead.
                    reason = "Individual training task was cancelled"
                    coordinator.bulk_training_state["failed"].append({"device_id": did, "reason": reason})
                    coordinator.bulk_training_state["last_error"] = reason
                    _phase(coordinator, "training_cancelled")
                else:
                    state = coordinator.training_state.get(did, {})
                    if state.get("status") == "complete":
                        coordinator.bulk_training_state["completed"] += 1
                        _phase(coordinator, "training_complete")
                    else:
                        reason = state.get("error") or state.get("instruction") or state.get("status", "failed")
                        coordinator.bulk_training_state["failed"].append({"device_id": did, "reason": reason})
                        coordinator.bulk_training_state["last_error"] = reason
                        _phase(coordinator, "training_failed")
            except Exception as err:
                _LOGGER.exception("Bulk training failed for %s", did)
                reason = str(err)
                coordinator.bulk_training_state["failed"].append({"device_id": did, "reason": reason})
                coordinator.bulk_training_state["last_error"] = reason
                _phase(coordinator, "start_failed")
                if task is None:
                    task = coordinator._training_task
                if task and not task.done():
                    task.cancel()
                    try:
                        await task
                    except asyncio.CancelledError:
                        pass
            finally:
                _phase(coordinator, "cleanup")
                # Stop the direct Shelly poller before releasing the device. Any
                # cancellation exception belongs to the poller, not the queue.
                direct_task = getattr(coordinator, "_direct_rpc_task", None)
                if direct_task and not direct_task.done():
                    direct_task.cancel()
                    try:
                        await direct_task
                    except asyncio.CancelledError:
                        pass
                    except Exception:
                        _LOGGER.exception("EnergyIQ direct Shelly poller cleanup failed")
                coordinator._direct_rpc_task = None

                # These handles are cleared only after the previous task has
                # completely unwound. This is the critical handoff guarantee.
                coordinator._training_task = None
                coordinator._training_engine = None
                coordinator._training_device = None
                await _safe_persist(coordinator)

            if index < len(selected):
                coordinator.bulk_training_state["current_device_id"] = selected[index]
                _phase(coordinator, "handoff")
                await _safe_persist(coordinator)
                await asyncio.sleep(0.25)

        coordinator.bulk_training_state["status"] = "complete"
        coordinator.bulk_training_state["current_device_id"] = None
        _phase(coordinator, "complete")
        await _safe_persist(coordinator)
        return dict(coordinator.bulk_training_state)
    except asyncio.CancelledError:
        # This is cancellation of the BULK WORKER itself (for example during
        # an integration unload), not the individual training task above.
        coordinator.bulk_training_state["status"] = "cancelled"
        coordinator.bulk_training_state["current_device_id"] = None
        coordinator.bulk_training_state["last_error"] = "Bulk training worker was cancelled"
        _phase(coordinator, "cancelled")
        await _safe_persist(coordinator)
        raise
    except Exception as err:
        _LOGGER.exception("EnergyIQ bulk training worker failed")
        coordinator.bulk_training_state["status"] = "error"
        coordinator.bulk_training_state["current_device_id"] = None
        coordinator.bulk_training_state["last_error"] = str(err)
        _phase(coordinator, "worker_error")
        await _safe_persist(coordinator)
        return dict(coordinator.bulk_training_state)
