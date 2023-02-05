# MqDockerUp

Mqtt Docker Updater (MqDockerUp) is a tool for updating Docker containers. It provides an easy way to check for updates and publish changes to a MQTT broker. The goal of this project is to provide an easy and seamless way of updating containers.

In the future, it may also be a tool for updating Home Assistant, making it as easy as updating Hass.IO. The plan is to implement Home Assistant discovery and Home Assistant UpdateEntities support to allow for a single click update in the Home Assistant UI.

The project is open-source and any help is welcome. It is also planned to containerize MqDockerUp itself in the future.

## How it works

MqDockerUp uses Docker APIs to get information about containers and images. It then makes a request to the Docker Hub API to get information about the latest image tags. If there is a new version, it will publish the change to a specified MQTT broker.

## How to use

1. Clone the repository and install dependencies with `npm install`.
2. Change the `config.yaml` file with your desired configuration.
3. Run the project with `npm start`.

## Configuration

The configuration file `config.yaml` contains the following sections:

### Main Configuration
The main configuration is specified in the `main` section:
```yaml
main:
  # Interval at which the updates are checked and published.
  # The interval must be specified in the format [number][unit]
  # where [number] is a positive integer and [unit] is one of s (seconds)
  # m (minutes), h (hours), d (days), w (weeks).
  interval: "15m"
```
The `interval` parameter specifies the frequency at which updates are checked and published to the MQTT broker. The interval must be in the format `[number][unit]`, where `[number]` is a positive integer and `[unit]` is one of `s` (seconds), `m` (minutes), `h` (hours), `d` (days), or `w` (weeks).

### MQTT Configuration
The MQTT configuration is specified in the `mqtt` section:
```yaml
mqtt:
  ha_discovery: true
  connectionUri: "mqtt://localhost:1883"
  topic: "mqdockerup"
  clientId: "mqdockerup"
  username: "ha"
  password: "12345678"
  connectTimeout: 60
  protocolVersion: 5
  qos: 2
  retain: false
```
The `mqtt` section contains the following parameters:

- `ha_discovery`: Specifies whether or not to enable Home Assistant discovery.
- `connectionUri`: The URL of the MQTT broker to connect to.
- `topic`: The MQTT topic to publish updates to.
- `clientId`: The MQTT client ID to use when connecting to the broker.
- `username`: The username to use when connecting to the MQTT broker.
- `password`: The password to use when connecting to the MQTT broker.
- `connectTimeout`: The maximum time, in seconds, to wait for a successful connection to the MQTT broker.
- `protocolVersion`: The MQTT protocol version to use when connecting to the broker.
- `qos`: The MQTT Quality of Service level to use when publishing updates.
- `retain`: Specifies whether or not to retain the latest update when publishing to the MQTT broker.

### Docker Configuration
The Docker configuration is specified in the `docker` section:
```yaml
docker:
  dockerhub:
    token: YOUR_AUTH_TOKEN_HERE
```
The docker section contains the Docker Hub configuration, which consists of the following parameter:

`token`: The Docker registry API token to use when checking for updates to the specified Docker image.
You will need to replace `YOUR_AUTH_TOKEN_HERE` with your actual Docker registry API token.


## Contribute

This project is open source and contributions are welcome. If you have any ideas or suggestions, please open an issue or a pull request.
