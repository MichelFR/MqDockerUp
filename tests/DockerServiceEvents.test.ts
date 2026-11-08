jest.mock("../src/index", () => ({ mqttClient: {} }));
jest.mock("../src/services/DatabaseService", () => ({ __esModule: true, default: {} }));
jest.mock("../src/services/HomeassistantService", () => ({ __esModule: true, default: {} }));
jest.mock("../src/services/LoggerService", () => ({
  __esModule: true, default: { info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import {EventEmitter, once} from "events";
import {PassThrough} from "stream";
import DockerService from "../src/services/DockerService";
import logger from "../src/services/LoggerService";

describe("DockerService.listenToDockerEvents", () => {
  const originalDocker = DockerService.docker;
  const originalEvents = DockerService.events;
  let streams: PassThrough[];
  let emit: jest.SpyInstance;

  const event = (action = "start", name = "example") => ({
    Type: "container", Action: action, Actor: {ID: "container-id", Attributes: {name}},
  });
  const line = (action = "start", name = "example") => `${JSON.stringify(event(action, name))}\n`;

  function listen() {
    const stream = new PassThrough();
    streams.push(stream);
    DockerService.docker = {getEvents: jest.fn((options, callback) => callback(null, stream))} as any;
    DockerService.listenToDockerEvents();
    return stream;
  }

  beforeEach(() => {
    jest.clearAllMocks();
    streams = [];
    DockerService.events = new EventEmitter();
    emit = jest.spyOn(DockerService.events, "emit");
  });

  afterEach(() => {
    for (const stream of streams) stream.destroy();
    jest.restoreAllMocks();
    DockerService.docker = originalDocker;
    DockerService.events = originalEvents;
  });

  test("waits for the rest of a split event without reporting a parse error", () => {
    const stream = listen();
    const json = line();
    stream.write(json.slice(0, 20));
    expect(emit).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
    stream.write(json.slice(20));
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith("start", {containerName: "example", containerId: "container-id"});
    expect(logger.error).not.toHaveBeenCalled();
  });

  test("processes combined events in order", () => {
    listen().write(line("create") + line("start") + line("die"));
    expect(emit.mock.calls.map(call => call[0])).toEqual(["create", "start", "die"]);
    expect(logger.error).not.toHaveBeenCalled();
  });

  test("retains an incomplete tail after complete events", () => {
    const stream = listen();
    const next = line("stop");
    stream.write(line("start") + next.slice(0, 15));
    expect(emit.mock.calls.map(call => call[0])).toEqual(["start"]);
    stream.write(next.slice(15));
    expect(emit.mock.calls.map(call => call[0])).toEqual(["start", "stop"]);
    expect(logger.error).not.toHaveBeenCalled();
  });

  test("accepts every byte split, including inside multibyte UTF-8 names", () => {
    const name = "caf\u00e9-\u6696-\ud83d\ude80";
    const bytes = Buffer.from(line("start", name));
    for (let boundary = 1; boundary < bytes.length; boundary++) {
      emit.mockClear();
      const stream = listen();
      stream.write(bytes.subarray(0, boundary));
      stream.write(bytes.subarray(boundary));
      expect(emit).toHaveBeenCalledTimes(1);
      expect(emit).toHaveBeenCalledWith("start", {containerName: name, containerId: "container-id"});
    }
    expect(logger.error).not.toHaveBeenCalled();
  });

  test("handles CRLF and ignores blank lines", () => {
    listen().write(`\n \r\n${JSON.stringify(event())}\r\n\n`);
    expect(emit).toHaveBeenCalledTimes(1);
    expect(logger.error).not.toHaveBeenCalled();
  });

  test("does not treat escaped newlines or braces inside strings as delimiters", () => {
    const name = 'example\n"quoted" {value}';
    listen().write(line("start", name) + line("stop"));
    expect(emit).toHaveBeenNthCalledWith(1, "start", {containerName: name, containerId: "container-id"});
    expect(emit).toHaveBeenCalledTimes(2);
    expect(logger.error).not.toHaveBeenCalled();
  });

  test("skips malformed JSON without dropping valid neighboring records", () => {
    listen().write(line("create") + '{broken json}\n' + line("start"));
    expect(emit.mock.calls.map(call => call[0])).toEqual(["create", "start"]);
    expect(logger.error).toHaveBeenCalledTimes(1);
  });

  test("recovers from malformed JSON split across chunks", () => {
    const stream = listen();
    stream.write('{broken');
    expect(logger.error).not.toHaveBeenCalled();
    stream.write(' json}\n' + line());
    expect(emit).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledTimes(1);
  });

  test("malformed event objects cannot stop subsequent events", () => {
    listen().write('null\n{"Type":"container"}\n' + line());
    expect(emit).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledTimes(2);
  });

  test("ignores non-container events and unhandled actions", () => {
    listen().write(JSON.stringify({...event(), Type: "image"}) + '\n' + line("attach") + line());
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit.mock.calls[0][0]).toBe("start");
    expect(logger.error).not.toHaveBeenCalled();
  });

  test.each(["create", "start", "die", "health_status", "stop", "destroy", "rename", "update", "pause", "unpause", "restart"])("preserves the existing %s action", action => {
    listen().write(line(action));
    expect(emit).toHaveBeenCalledWith(action, {containerName: "example", containerId: "container-id"});
  });

  test("processes a final valid event without a trailing newline", async () => {
    const stream = listen();
    const ended = once(stream, "end");
    stream.end(JSON.stringify(event()));
    await ended;
    expect(emit).toHaveBeenCalledTimes(1);
    expect(logger.error).not.toHaveBeenCalled();
  });

  test("reports a truncated final event only when the stream ends", async () => {
    const stream = listen();
    stream.write('{"Type":"container"');
    expect(logger.error).not.toHaveBeenCalled();
    const ended = once(stream, "end");
    stream.end();
    await ended;
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(emit).not.toHaveBeenCalled();
  });

  test("an empty stream ends without errors", async () => {
    const stream = listen();
    const ended = once(stream, "end");
    stream.end();
    await ended;
    expect(logger.error).not.toHaveBeenCalled();
    expect(emit).not.toHaveBeenCalled();
  });

  test("skips an oversized event and resumes at the next newline", () => {
    listen().write('x'.repeat(1024 * 1024 + 1) + '\n' + line());
    expect(emit).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledTimes(1);
  });

  test("bounds an unterminated event across chunks and discards its remainder", () => {
    const stream = listen();
    stream.write('x'.repeat(1024 * 1024));
    stream.write('y');
    expect(logger.error).toHaveBeenCalledTimes(1);
    stream.write('remainder\n' + line());
    expect(emit).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledTimes(1);
  });

  test("does not limit a large chunk containing many bounded events", () => {
    const chunk = line().repeat(12000);
    expect(chunk.length).toBeGreaterThan(1024 * 1024);
    listen().write(chunk);
    expect(emit).toHaveBeenCalledTimes(12000);
    expect(logger.error).not.toHaveBeenCalled();
  });

  test("logs Docker connection errors without attaching stream handlers", () => {
    const error = new Error("connection failed");
    DockerService.docker = {getEvents: jest.fn((options, callback) => callback(error))} as any;
    expect(() => DockerService.listenToDockerEvents()).not.toThrow();
    expect(logger.error).toHaveBeenCalledWith('Error while listening to docker events:', error);
  });

  test("logs errors emitted by the stream", () => {
    const stream = listen();
    const error = new Error("stream failed");
    expect(() => stream.emit("error", error)).not.toThrow();
    expect(logger.error).toHaveBeenCalledWith('Error while listening to docker events:', error);
  });
});
