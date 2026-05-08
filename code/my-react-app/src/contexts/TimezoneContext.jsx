import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import moment from 'moment-timezone';

const DEFAULT_TIMEZONE = 'Asia/Karachi';
const TimezoneContext = createContext({ timezone: DEFAULT_TIMEZONE, setTimezone: () => {} });

export const useTimezone = () => useContext(TimezoneContext);

export const TimezoneProvider = ({ children }) => {
  const [timezone, setTimezone] = useState(DEFAULT_TIMEZONE);

  useEffect(() => {
    const detected = moment.tz.guess();
    if (detected) {
      setTimezone(detected);
    }
  }, []);

  const value = useMemo(() => ({ timezone, setTimezone }), [timezone]);

  return <TimezoneContext.Provider value={value}>{children}</TimezoneContext.Provider>;
};
