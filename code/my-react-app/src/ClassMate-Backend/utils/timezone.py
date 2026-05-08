from datetime import datetime, timedelta
import pytz
from flask import request

DEFAULT_TIMEZONE = 'Asia/Karachi'
PKT_TIMEZONE = 'Asia/Karachi'


def normalize_timezone(timezone_str):
    if not timezone_str:
        return DEFAULT_TIMEZONE
    try:
        pytz.timezone(timezone_str)
        return timezone_str
    except Exception:
        return DEFAULT_TIMEZONE


def get_user_timezone(default_tz=DEFAULT_TIMEZONE):
    tz = (
        request.args.get('timezone')
        or (request.get_json(silent=True) or {}).get('timezone')
        or request.headers.get('X-Timezone')
        or default_tz
    )
    return normalize_timezone(tz)


def local_to_utc(local_dt, timezone_str):
    if local_dt is None:
        return None
    user_tz = pytz.timezone(normalize_timezone(timezone_str))
    local_aware = user_tz.localize(local_dt)
    return local_aware.astimezone(pytz.UTC)


def utc_to_local(utc_dt, timezone_str):
    if utc_dt is None:
        return None
    user_tz = pytz.timezone(normalize_timezone(timezone_str))

    # Treat naive datetimes from DB as UTC (single source of truth).
    if utc_dt.tzinfo is None:
        utc_aware = pytz.UTC.localize(utc_dt)
    else:
        utc_aware = utc_dt.astimezone(pytz.UTC)

    return utc_aware.astimezone(user_tz)


def get_day_range_utc(timezone_str, local_date):
    user_tz = pytz.timezone(normalize_timezone(timezone_str))
    start_local = user_tz.localize(datetime.combine(local_date, datetime.min.time()))
    next_day_local = start_local + timedelta(days=1)

    start_utc = start_local.astimezone(pytz.UTC)
    end_utc = next_day_local.astimezone(pytz.UTC)
    return start_utc, end_utc


def to_utc_and_pkt_iso(dt):
    """Return (utc_iso, pkt_iso) for any datetime from DB/API layer."""
    if dt is None:
        return None, None

    if dt.tzinfo is None:
        utc_aware = pytz.UTC.localize(dt)
    else:
        utc_aware = dt.astimezone(pytz.UTC)

    pkt_aware = utc_aware.astimezone(pytz.timezone(PKT_TIMEZONE))
    return utc_aware.isoformat(), pkt_aware.isoformat()
