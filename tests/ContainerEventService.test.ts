import {
  getEventDrivenUpdatePlan,
  normalizeContainerEventAction,
} from "../src/services/ContainerEventService";

describe("ContainerEventService", () => {
  test("normalizes health_status events with status suffix", () => {
    expect(normalizeContainerEventAction("health_status: healthy")).toBe(
      "health_status"
    );
    expect(normalizeContainerEventAction("health_status: unhealthy")).toBe(
      "health_status"
    );
  });

  test("keeps known non-health actions untouched", () => {
    expect(normalizeContainerEventAction("start")).toBe("start");
    expect(normalizeContainerEventAction("destroy")).toBe("destroy");
  });

  test("ignores unsupported actions", () => {
    expect(normalizeContainerEventAction("attach")).toBeNull();
  });

  test("returns targeted update plan for destroy and rename", () => {
    expect(getEventDrivenUpdatePlan("destroy")).toEqual({
      publishConfig: false,
      publishContainerState: false,
      publishImageUpdateState: false,
      cleanupRemovedContainer: true,
    });

    expect(getEventDrivenUpdatePlan("rename")).toEqual({
      publishConfig: true,
      publishContainerState: true,
      publishImageUpdateState: false,
      cleanupRemovedContainer: false,
    });
  });
});

