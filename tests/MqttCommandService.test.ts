import MqttCommandService from "../src/services/MqttCommandService";

describe("MqttCommandService", () => {
  test("builds command subscriptions", () => {
    expect(MqttCommandService.getCommandSubscription("mqdockerup_server")).toBe("mqdockerup_server/+/command/+");
    expect(MqttCommandService.getLegacyCommandSubscriptions("mqdockerup_server")).toEqual([
      "mqdockerup_server/update",
      "mqdockerup_server/restart",
      "mqdockerup_server/start",
      "mqdockerup_server/stop",
      "mqdockerup_server/pause",
      "mqdockerup_server/unpause",
      "mqdockerup_server/manualUpdate",
    ]);
  });

  test("builds scoped command topics", () => {
    expect(MqttCommandService.getCommandTopic("mqdockerup_server", "server_esphome", "restart")).toBe(
      "mqdockerup_server/server_esphome/command/restart"
    );
  });

  test("parses scoped and legacy command topics", () => {
    expect(MqttCommandService.parseCommandTopic("mqdockerup_server", "mqdockerup_server/server_esphome/command/restart")).toEqual({
      containerTopic: "server_esphome",
      command: "restart",
    });
    expect(MqttCommandService.parseLegacyCommandTopic("mqdockerup_server", "mqdockerup_server/restart")).toBe("restart");
  });

  test("rejects unrelated, malformed, and unknown command topics", () => {
    expect(MqttCommandService.parseCommandTopic("mqdockerup_server", "other/server_esphome/command/restart")).toBeNull();
    expect(MqttCommandService.parseCommandTopic("mqdockerup_server", "mqdockerup_server/server_esphome/restart")).toBeNull();
    expect(MqttCommandService.parseCommandTopic("mqdockerup_server", "mqdockerup_server/server_esphome/command/delete")).toBeNull();
    expect(MqttCommandService.parseCommandTopic("mqdockerup_server", "mqdockerup_server/server_esphome/extra/command/restart")).toBeNull();
    expect(MqttCommandService.parseLegacyCommandTopic("mqdockerup_server", "mqdockerup_server/delete")).toBeNull();
    expect(MqttCommandService.parseLegacyCommandTopic("mqdockerup_server", "mqdockerup_server/restart/extra")).toBeNull();
  });

  test("parses valid command payloads", () => {
    expect(MqttCommandService.parseCommandPayload(JSON.stringify({
      containerId: "abc123",
      image: "ghcr.io/esphome/esphome",
      topicName: "server_esphome",
    }))).toEqual({
      containerId: "abc123",
      image: "ghcr.io/esphome/esphome",
      topicName: "server_esphome",
    });
  });

  test("rejects invalid command payloads", () => {
    expect(MqttCommandService.parseCommandPayload("{")).toBeNull();
    expect(MqttCommandService.parseCommandPayload("{}")).toBeNull();
    expect(MqttCommandService.parseCommandPayload(JSON.stringify({ containerId: "" }))).toBeNull();
    expect(MqttCommandService.parseCommandPayload(JSON.stringify({ containerId: 42 }))).toBeNull();
  });
});


describe("MqttCommandService command messages", () => {
  test("parses complete command messages", () => {
    expect(MqttCommandService.parseCommandMessage(
      "mqdockerup_server",
      "mqdockerup_server/server_esphome/command/restart",
      Buffer.from(JSON.stringify({ containerId: "abc123", topicName: "server_esphome" }))
    )).toEqual({
      containerTopic: "server_esphome",
      command: "restart",
      payload: {
        containerId: "abc123",
        topicName: "server_esphome",
      },
    });
  });

  test("identifies command topics", () => {
    expect(MqttCommandService.isCommandTopic("mqdockerup_server", "mqdockerup_server/server_esphome/command/restart")).toBe(true);
    expect(MqttCommandService.isCommandTopic("mqdockerup_server", "mqdockerup_server/restart")).toBe(true);
    expect(MqttCommandService.isCommandTopic("mqdockerup_server", "mqdockerup_server/server_esphome/state")).toBe(false);
  });

  test("rejects scoped command messages without matching payload topics", () => {
    expect(MqttCommandService.parseCommandMessage(
      "mqdockerup_server",
      "mqdockerup_server/server_esphome/command/restart",
      JSON.stringify({ containerId: "abc123", topicName: "server_other" })
    )).toBeNull();
    expect(MqttCommandService.parseCommandMessage(
      "mqdockerup_server",
      "mqdockerup_server/server_esphome/command/restart",
      JSON.stringify({ containerId: "abc123" })
    )).toBeNull();
  });
});


describe("MqttCommandService legacy command messages", () => {
  test("keeps old flat command topics working", () => {
    expect(MqttCommandService.parseCommandMessage(
      "mqdockerup_server",
      "mqdockerup_server/restart",
      JSON.stringify({ containerId: "abc123" })
    )).toEqual({
      command: "restart",
      payload: {
        containerId: "abc123",
      },
    });
  });
});
