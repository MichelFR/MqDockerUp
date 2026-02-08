export const SUPPORTED_CONTAINER_EVENT_ACTIONS = [
  "create",
  "start",
  "die",
  "stop",
  "destroy",
  "rename",
  "update",
  "pause",
  "unpause",
  "restart",
  "health_status",
] as const;

export type SupportedContainerEventAction =
  (typeof SUPPORTED_CONTAINER_EVENT_ACTIONS)[number];

export interface EventDrivenUpdatePlan {
  publishConfig: boolean;
  publishContainerState: boolean;
  publishImageUpdateState: boolean;
  cleanupRemovedContainer: boolean;
}

const supportedActionSet = new Set<string>(SUPPORTED_CONTAINER_EVENT_ACTIONS);

export const normalizeContainerEventAction = (
  action: string | undefined | null
): SupportedContainerEventAction | null => {
  if (!action) {
    return null;
  }

  if (action === "health_status" || action.startsWith("health_status:")) {
    return "health_status";
  }

  if (supportedActionSet.has(action)) {
    return action as SupportedContainerEventAction;
  }

  return null;
};

const eventDrivenUpdatePlans: Record<
  SupportedContainerEventAction,
  EventDrivenUpdatePlan
> = {
  create: {
    publishConfig: true,
    publishContainerState: true,
    publishImageUpdateState: true,
    cleanupRemovedContainer: false,
  },
  start: {
    publishConfig: false,
    publishContainerState: true,
    publishImageUpdateState: false,
    cleanupRemovedContainer: false,
  },
  die: {
    publishConfig: false,
    publishContainerState: true,
    publishImageUpdateState: false,
    cleanupRemovedContainer: false,
  },
  stop: {
    publishConfig: false,
    publishContainerState: true,
    publishImageUpdateState: false,
    cleanupRemovedContainer: false,
  },
  destroy: {
    publishConfig: false,
    publishContainerState: false,
    publishImageUpdateState: false,
    cleanupRemovedContainer: true,
  },
  rename: {
    publishConfig: true,
    publishContainerState: true,
    publishImageUpdateState: false,
    cleanupRemovedContainer: false,
  },
  update: {
    publishConfig: true,
    publishContainerState: true,
    publishImageUpdateState: true,
    cleanupRemovedContainer: false,
  },
  pause: {
    publishConfig: false,
    publishContainerState: true,
    publishImageUpdateState: false,
    cleanupRemovedContainer: false,
  },
  unpause: {
    publishConfig: false,
    publishContainerState: true,
    publishImageUpdateState: false,
    cleanupRemovedContainer: false,
  },
  restart: {
    publishConfig: false,
    publishContainerState: true,
    publishImageUpdateState: false,
    cleanupRemovedContainer: false,
  },
  health_status: {
    publishConfig: false,
    publishContainerState: true,
    publishImageUpdateState: false,
    cleanupRemovedContainer: false,
  },
};

export const getEventDrivenUpdatePlan = (
  action: SupportedContainerEventAction
): EventDrivenUpdatePlan => eventDrivenUpdatePlans[action];

