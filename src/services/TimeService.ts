export class TimeService {
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
}

export default TimeService;
