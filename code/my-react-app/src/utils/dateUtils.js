const PKT_TIMEZONE = 'Asia/Karachi';

const toValidDate = (utcDateString) => {
    if (!utcDateString) return null;
    const date = new Date(utcDateString);
    if (Number.isNaN(date.getTime())) return null;
    return date;
};

// Format: "Apr 9, 2026, 10:39 PM"
export const formatPKTDateTime = (utcDateString) => {
    const date = toValidDate(utcDateString);
    if (!date) return 'N/A';

    return new Intl.DateTimeFormat('en-PK', {
        timeZone: PKT_TIMEZONE,
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
    }).format(date);
};

// Format: "Apr 9, 2026"
export const formatPKTDate = (utcDateString) => {
    const date = toValidDate(utcDateString);
    if (!date) return 'N/A';

    return new Intl.DateTimeFormat('en-PK', {
        timeZone: PKT_TIMEZONE,
        year: 'numeric',
        month: 'short',
        day: 'numeric'
    }).format(date);
};

// Format: "10:39 PM"
export const formatPKTTime = (utcDateString) => {
    const date = toValidDate(utcDateString);
    if (!date) return 'N/A';

    return new Intl.DateTimeFormat('en-PK', {
        timeZone: PKT_TIMEZONE,
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
    }).format(date);
};

// Backward-compatible aliases used by existing pages.
export const formatPKTDateOnly = formatPKTDate;
export const formatPKTTimeOnly = formatPKTTime;

// Utility for grouping messages by PKT calendar day (YYYY-MM-DD).
export const getPKTDateKey = (utcDateString) => {
    const date = toValidDate(utcDateString);
    if (!date) return null;

    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: PKT_TIMEZONE,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).formatToParts(date);

    const year = parts.find((p) => p.type === 'year')?.value;
    const month = parts.find((p) => p.type === 'month')?.value;
    const day = parts.find((p) => p.type === 'day')?.value;

    if (!year || !month || !day) return null;
    return `${year}-${month}-${day}`;
};

export const formatPKTWeekdayShort = (utcDateString) => {
    const date = toValidDate(utcDateString);
    if (!date) return 'N/A';

    return new Intl.DateTimeFormat('en-PK', {
        timeZone: PKT_TIMEZONE,
        weekday: 'short'
    }).format(date);
};

export const formatPKTDayNumber = (utcDateString) => {
    const date = toValidDate(utcDateString);
    if (!date) return 'N/A';

    return new Intl.DateTimeFormat('en-PK', {
        timeZone: PKT_TIMEZONE,
        day: 'numeric'
    }).format(date);
};
