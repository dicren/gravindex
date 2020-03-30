export const timmings = {
  methods: {
    formatTime(seconds, hours) {
      const s = Math.floor(seconds % 60);
      const m = Math.floor((seconds / 60) % 60);
      const h = Math.floor(seconds / (60 * 60));

      if (s < 0 || m < 0 || h < 0) return "--:--:--";

      return `
      ${h > 0 || hours ? (h < 10 ? "0" + h : h) + ":" : ""}${
        m < 10 ? "0" + m : m
      }:${s < 10 ? "0" + s : s}`.trim();
    },
    hhmmssToSeconds(text) {
      const valueSplitted = text.split(":");
      let h, m, s;
      h = parseInt(valueSplitted[0], 10);
      m = parseInt(valueSplitted[1], 10);
      if (valueSplitted.length === 3) {
        s = parseInt(valueSplitted[2], 10);
      } else {
        s = 0;
      }
      return h * 60 * 60 + m * 60 + s;
    },
  },
};
