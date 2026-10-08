#!/usr/bin/env python3
"""Validate invented fixture contracts only; this is not an application parser."""

import json
import re
import sys
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from pathlib import Path
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError


ROOT = Path(__file__).resolve().parent


def reject_constant(_):
    raise ValueError("non_finite_json_number")


def decode(text):
    return json.loads(text, parse_float=Decimal, parse_constant=reject_constant)


def read(name):
    return decode((ROOT / name).read_text(encoding="utf-8"))


def instant(text):
    result = datetime.fromisoformat(text.replace("Z", "+00:00"))
    assert result.tzinfo is not None, "expected_offset_timestamp"
    return result


def amount(value):
    return Decimal(str(value))


def no_private_projection(value):
    if isinstance(value, dict):
        for key, child in value.items():
            assert key not in {
                "userId", "requestId", "session_id", "executionId", "loop_id",
                "prompt", "sourceCode", "credential", "content", "input",
            }, "private_projection_key"
            no_private_projection(child)
    elif isinstance(value, list):
        for child in value:
            no_private_projection(child)
    elif isinstance(value, str):
        assert "DO_NOT_RETAIN" not in value, "private_projection_marker"
        assert "synthetic-user" not in value, "private_projection_identity"


def validate_core():
    expected = read("expected.json")
    assert expected["synthetic"] is True
    zone = ZoneInfo(expected["timezone"])
    unique = set()
    synthetic_accounts = set()
    log_count = 0
    for line in (ROOT / "account-snapshots.log").read_text().splitlines():
        match = re.fullmatch(
            r"(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}) \[info\] synthetic-envelope (\{.*\})",
            line,
        )
        assert match, "invalid_synthetic_log_shape"
        timestamp = datetime.fromisoformat(match[1]).replace(tzinfo=zone)
        envelope = decode(match[2])
        assert envelope["commandName"] == "GetUsageLimitsCommand"
        assert envelope["metadata"]["httpStatusCode"] == 200
        body = envelope["output"]
        breakdown, = body["usageBreakdownList"]
        assert breakdown["resourceType"] == "CREDIT"
        assert breakdown["unit"] == "INVOCATIONS"
        assert breakdown["nextDateReset"] == body["nextDateReset"]
        assert envelope["output"]["userInfo"]["userId"].startswith("synthetic-")
        synthetic_accounts.add(envelope["output"]["userInfo"]["userId"])
        assert envelope["metadata"]["requestId"].startswith("synthetic-")
        unique.add((timestamp.astimezone(timezone.utc), amount(breakdown["currentUsageWithPrecision"]),
                    amount(breakdown["usageLimitWithPrecision"]), instant(body["nextDateReset"])))
        log_count += 1
    assert len(synthetic_accounts) == 1, "core_fixture_requires_account_continuity"
    exp = expected["account_log"]
    actual = sorted(unique)
    wanted = [(instant(row["observed_at"]), amount(row["current_usage"]),
               amount(row["usage_limit"]), instant(row["reset_at"])) for row in exp["snapshots"]]
    assert actual == wanted, "account_projection_mismatch"
    assert log_count == exp["input_records"]
    assert log_count - len(actual) == exp["duplicate_records"]
    assert actual[-1][1] == amount(exp["latest_account_usage"])
    assert actual[-1][0] == instant(exp["latest_account_observed_at"])
    assert actual[1][1] - actual[0][1] == amount(exp["same_cycle_interval_net_change"])
    assert actual[2][3] > actual[1][3] and actual[2][1] < actual[1][1]
    assert exp["reset_detected"] is True
    for field in ("cross_cycle_delta", "previous_cycle_final_usage", "account_daily_consumption_across_gap"):
        assert exp[field] is None, "gap_must_remain_unknown"

    cache = read("usage-cache.json")["kiro.resourceNotifications.usageState"]
    cache_at = datetime.fromtimestamp(cache["timestamp"] / 1000, timezone.utc)
    assert cache_at == instant(expected["cache"]["observed_at"])
    assert amount(cache["usageBreakdowns"][0]["currentUsage"]) == amount(expected["cache"]["current_usage"])
    assert cache_at < actual[-1][0]
    assert expected["cache"]["selection"] == "older_than_latest_log"
    assert expected["cache"]["refresh_on_reread"] is False

    daily = defaultdict(Decimal)
    seen = set()
    counts = defaultdict(int)
    for line in (ROOT / "ide-events.jsonl").read_text().splitlines():
        event = decode(line)
        counts["input_records"] += 1
        assert event["id"].startswith("synthetic-")
        if event["payload"]["type"] != "usage_summary":
            counts["ignored_non_usage_records"] += 1
            continue
        if event["id"] in seen:
            counts["duplicates"] += 1
            continue
        seen.add(event["id"])
        counts["unique_usage_events"] += 1
        summary, = event["payload"]["promptTurnSummaries"]
        assert summary["unit"] == "credit"
        day = instant(event["timestamp"]).astimezone(zone).date().isoformat()
        daily[day] += amount(summary["usage"])
    exp = expected["ide"]
    assert all(exp[key] == value for key, value in counts.items())
    assert dict(daily) == {key: amount(value) for key, value in exp["local_daily_observed_credits"].items()}
    assert sum(daily.values()) == amount(exp["observed_total"])
    assert exp["coverage"] == "partial_local" and exp["account_usage_override"] is False

    cli = read("cli-session.json")
    turns = cli["session_state"]["conversation_metadata"]["user_turn_metadatas"]
    exp = expected["cli"]
    assert cli["session_id"].startswith("synthetic-")
    assert all(t["loop_id"].startswith("synthetic-") for t in turns)
    assert all(instant(t["end_timestamp"]) for t in turns)
    assert all(entry["unit"] == "credit" and entry["unitPlural"] == "credits"
               for t in turns for entry in t["metering_usage"]), "cli_fixture_requires_credit_units"
    assert len(turns) == exp["turn_count"]
    assert sum(len(t["metering_usage"]) for t in turns) == exp["entry_count"]
    assert sum(not t["metering_usage"] for t in turns) == exp["empty_metering_turns"]
    assert exp["aggregate_credits"] is None and exp["status"] == "unverified_semantics"
    values = [amount(entry["value"]) for entry in turns[0]["metering_usage"]]
    hypotheses = exp["hypothetical_interpretations_not_outputs"]
    assert sum(values) == amount(hypotheses["if_additive"])
    assert values[-1] == amount(hypotheses["if_cumulative_final_last"])
    assert sum(values) != values[-1], "fixture_must_expose_semantic_ambiguity"

    counts = {"complete_valid_records": 0, "malformed_complete_records": 0, "pending_trailing_records": 0}
    for line in (ROOT / "malformed-and-partial.txt").read_text().splitlines(keepends=True):
        if not line.endswith("\n"):
            counts["pending_trailing_records"] += 1
            continue
        try:
            decode(line)
        except ValueError:
            counts["malformed_complete_records"] += 1
        else:
            counts["complete_valid_records"] += 1
    assert counts == expected["malformed_and_partial"]
    assert all(value is False for value in expected["privacy"].values())
    no_private_projection(expected)


def validate_scenarios():
    document = read("scenarios.json")
    assert document["synthetic"] is True
    cases = document["cases"]
    assert len(cases) == 20 and len({case["id"] for case in cases}) == 20
    for case in cases:
        data, exp, kind = case["input"], case["expected"], case["kind"]
        no_private_projection(exp)
        if kind == "snapshot_pair":
            before, after = data
            assert instant(after["observed_at"]) > instant(before["observed_at"])
            delta = None
            if not before["account_partition"] or before["account_partition"] != after["account_partition"]:
                status = "account_discontinuity"
            elif instant(after["reset_at"]) > instant(before["reset_at"]):
                status = "cycle_change_observed"
            else:
                assert before["reset_at"] == after["reset_at"]
                delta = amount(after["current_usage"]) - amount(before["current_usage"])
                status = "counter_decrease_not_reset" if delta < 0 else "same_cycle_net_change"
            assert status == exp["status"]
            assert delta == (None if exp["interval_net_change"] is None else amount(exp["interval_net_change"]))
            assert exp["daily_consumption"] is None
        elif kind == "breakdown":
            usage = None
            if data["resourceType"] != "CREDIT":
                status = "unsupported_resource"
            elif "currentUsageWithPrecision" not in data and "currentUsage" not in data:
                status = "missing_usage"
            else:
                precise = "currentUsageWithPrecision" in data
                usage = amount(data["currentUsageWithPrecision"] if precise else data["currentUsage"])
                status = "unsupported_extra_credits" if data.get("bonuses") else "precise" if precise else "reduced_precision"
            assert status == exp["status"]
            assert usage == (None if exp["current_usage"] is None else amount(exp["current_usage"]))
            assert exp["remaining_credits"] is None
        elif kind == "local_day":
            zone = ZoneInfo(data["timezone"])
            start = datetime.fromisoformat(data["date"]).replace(tzinfo=zone)
            end = start + timedelta(days=1)
            hours = (end.astimezone(timezone.utc) - start.astimezone(timezone.utc)).total_seconds() / 3600
            assert hours == exp["duration_hours"]
        elif kind == "ambiguous_local_time":
            local = datetime.fromisoformat(data["timestamp"])
            zone = ZoneInfo(data["timezone"])
            candidates = [local.replace(tzinfo=zone, fold=fold).astimezone(timezone.utc) for fold in (0, 1)]
            assert candidates[0] != candidates[1]
            assert candidates == [instant(value) for value in exp["candidate_instants"]]
            assert exp["status"] == "ambiguous_timezone" and exp["selected_instant"] is None
        elif kind == "cli_updates":
            latest = {turn["loop_id"]: turn for turn in data}
            assert len(data) == exp["observations"] and len(latest) == exp["logical_turns"]
            assert sum(len(turn["metering_usage"]) for turn in latest.values()) == exp["latest_entry_count"]
            assert exp["aggregate_credits"] is None and exp["status"] == "unverified_semantics"
        elif kind == "ide_multiple":
            assert len(data["promptTurnSummaries"]) > 1
            assert exp["status"] == "unverified_multiple_summary_semantics" and exp["aggregate_credits"] is None
        elif kind == "reset_mismatch":
            assert data["nextDateReset"] != data["usageBreakdownList"][0]["nextDateReset"]
            assert exp["status"] == "conflicting_reset_metadata" and exp["selected_reset"] is None
        elif kind == "sqlite_guard":
            assert data["wal_present"] and data["reader_mode"] == "immutable"
            assert exp["status"] == "unavailable_unsupported_database_state" and exp["current_snapshot"] is None
        elif kind == "unsupported_version":
            assert data["schemaVersion"] == "synthetic-unsupported-version"
            assert exp["status"] == "unsupported_format" and exp["aggregate_credits"] is None
        elif kind == "snapshot_conflict":
            before, after = data
            assert before["observed_at"] == after["observed_at"] and before["current_usage"] != after["current_usage"]
            assert exp["status"] == "conflicting_snapshots" and exp["selected_usage"] is None
        elif kind == "privacy_projection":
            assert exp["resource_type"] == data["resourceType"]
            assert amount(exp["current_usage"]) == amount(data["currentUsageWithPrecision"])
            assert set(exp) == {"resource_type", "current_usage"}
            assert any("DO_NOT_RETAIN" in str(value) for value in data.values())
        else:
            raise AssertionError("unrecognized_fixture_case")
    return len(cases)


def main():
    try:
        validate_core()
        count = validate_scenarios()
    except ZoneInfoNotFoundError:
        print("FAIL: IANA timezone data unavailable; use a Python environment with tzdata.")
        return 1
    except (AssertionError, ValueError, KeyError, TypeError, OSError):
        # Never echo records or exception values, even though these inputs are invented.
        print("FAIL: synthetic fixture contract validation.")
        return 1
    print(f"PASS: 7 synthetic data files; {count} edge-case contracts; decimal, timezone, privacy and coverage checks.")
    print("Fixture validation only: no application parser or live Kiro/platform behavior tested.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
