/**
 * Ringtone Generator - Creates a ringtone sound using Web Audio API
 * Used for incoming voice call notifications
 */

export const playVoiceCallRingtone = async () => {
    try {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (!AudioContextClass) {
            console.warn('Web Audio API not supported');
            return null;
        }

        const audioContext = new AudioContextClass();
        const duration = 0.5; // 500ms per tone
        const now = audioContext.currentTime;

        // Create two oscillators for a more phone-like ringtone
        const osc1 = audioContext.createOscillator();
        const osc2 = audioContext.createOscillator();
        const gain = audioContext.createGain();

        // Set frequencies for a pleasing ringtone (similar to old phone rings)
        osc1.frequency.value = 800; // First tone
        osc2.frequency.value = 600; // Second tone

        osc1.type = 'sine';
        osc2.type = 'sine';

        // Set volume
        gain.gain.setValueAtTime(0.3, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + duration);

        // Connect nodes
        osc1.connect(gain);
        osc2.connect(gain);
        gain.connect(audioContext.destination);

        // Start and stop
        osc1.start(now);
        osc2.start(now);
        osc1.stop(now + duration);
        osc2.stop(now + duration);

        return audioContext;
    } catch (error) {
        console.error('Error creating ringtone:', error);
        return null;
    }
};

/**
 * Play a repeating ringtone for incoming calls
 * @param {number} repetitions - How many times to repeat the ringtone
 * @returns {Promise<AudioContext>}
 */
export const playRepeatingRingtone = async (repetitions = 5) => {
    try {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (!AudioContextClass) {
            console.warn('Web Audio API not supported');
            return null;
        }

        const audioContext = new AudioContextClass();
        const toneLength = 0.4; // 400ms tone
        const silenceLength = 0.2; // 200ms silence
        const cycleDuration = toneLength + silenceLength;

        for (let i = 0; i < repetitions; i++) {
            const startTime = audioContext.currentTime + i * cycleDuration;

            // Create oscillator for this cycle
            const osc = audioContext.createOscillator();
            const gain = audioContext.createGain();

            osc.frequency.value = 750;
            osc.type = 'sine';

            gain.gain.setValueAtTime(0.2, startTime);
            gain.gain.setValueAtTime(0, startTime + toneLength);

            osc.connect(gain);
            gain.connect(audioContext.destination);

            osc.start(startTime);
            osc.stop(startTime + toneLength);
        }

        return audioContext;
    } catch (error) {
        console.error('Error playing repeating ringtone:', error);
        return null;
    }
};

/**
 * Stop an active ringtone
 * @param {AudioContext} audioContext - The audio context to stop
 */
export const stopRingtone = (audioContext) => {
    if (audioContext && audioContext.state !== 'closed') {
        try {
            audioContext.close();
        } catch (error) {
            console.error('Error stopping ringtone:', error);
        }
    }
};
