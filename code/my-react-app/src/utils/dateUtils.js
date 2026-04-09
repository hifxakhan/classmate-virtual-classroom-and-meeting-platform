// Pakistan Timezone (UTC+5)
const PKT_OFFSET = 5;

export const convertUTCToPKT = (utcDateString) => {
    if (!utcDateString) return null;

    const date = new Date(utcDateString);
    if (Number.isNaN(date.getTime())) return null;

    // Add 5 hours for PKT when backend returns naive UTC timestamps.
    date.setHours(date.getHours() + PKT_OFFSET);
    return date;
};

export const formatPKTTime = (utcDateString, format = 'datetime') => {
    const pktDate = convertUTCToPKT(utcDateString);
    if (!pktDate) return 'N/A';

    if (format === 'date') {
        return pktDate.toLocaleDateString('en-PK', {
            year: 'numeric',
            month: 'short',
            day: 'numeric'
        });
    }

    if (format === 'time') {
        return pktDate.toLocaleTimeString('en-PK', {
            hour: '2-digit',
            minute: '2-digit'
        });
    }

    return pktDate.toLocaleString('en-PK', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });
};

export const formatPKTDateOnly = (utcDateString) => formatPKTTime(utcDateString, 'date');
export const formatPKTTimeOnly = (utcDateString) => formatPKTTime(utcDateString, 'time');
