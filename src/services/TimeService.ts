export default class TimeService {
  /**
   * Parses the duration
   * @param duration The duration in the format of 1s, 1m, 1h, 1d, 1w
   * @returns
   */
  public static parseDuration(duration: string): number {
    const durationRegex = /^(\d+)([a-zA-Z]+)$/;
    const match = durationRegex.exec(duration);
    if (!match) {
      throw new Error(`Invalid duration format: ${duration}`);
    }

    const value = parseInt(match[1]);
    const unit = match[2];
    switch (unit) {
      case "s":
        return value * 1000;
      case "m":
        return value * 1000 * 60;
      case "h":
        return value * 1000 * 60 * 60;
      case "d":
        return value * 1000 * 60 * 60 * 24;
      case "w":
        return value * 1000 * 60 * 60 * 24 * 7;
      default:
        throw new Error(`Invalid time unit: ${unit}`);
    }
  }

  /**
   * Formats the duration in milliseconds to a human readable format.
   * @param duration The duration in milliseconds.
   */
  public static formatDuration(duration: number) {
    const weeks = Math.floor(duration / (1000 * 60 * 60 * 24 * 7));
    duration -= weeks * (1000 * 60 * 60 * 24 * 7);
    const days = Math.floor(duration / (1000 * 60 * 60 * 24));
    duration -= days * (1000 * 60 * 60 * 24);
    const hours = Math.floor(duration / (1000 * 60 * 60));
    duration -= hours * (1000 * 60 * 60);
    const minutes = Math.floor(duration / (1000 * 60));
    duration -= minutes * (1000 * 60);
    const seconds = Math.floor(duration / 1000);

    let formattedDuration = "";
    if (weeks > 0) {
      formattedDuration += `${weeks} week${weeks !== 1 ? "s" : ""} `;
    }
    if (days > 0) {
      formattedDuration += `${days} day${days !== 1 ? "s" : ""} `;
    }
    if (hours > 0) {
      formattedDuration += `${hours} hour${hours !== 1 ? "s" : ""} `;
    }
    if (minutes > 0) {
      formattedDuration += `${minutes} minute${minutes !== 1 ? "s" : ""} `;
    }
    if (seconds > 0) {
      formattedDuration += `${seconds} second${seconds !== 1 ? "s" : ""} `;
    }

    return formattedDuration.trim();
  }
}
